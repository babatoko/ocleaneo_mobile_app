# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""End-to-end tests for POST /pointage/with-tag.

Complements ocleaneo_mobile_pointage/tests/test_api.py, which only exercises
/pointage directly (fsm_order_id passed explicitly by the caller). This
module resolves a scanned NFC badge to a location/order via ocleaneo.nfc.tag
— a model only defined once ocleaneo_nfc_tag_registry (which depends on
ocleaneo_mobile_pointage) is installed, hence living here rather than there.
"""

from odoo.tests.common import HttpCase

from odoo.addons.ocleaneo_mobile_pointage.tests.common import MobilePointageCommon
from odoo.addons.ocleaneo_mobile_pointage.tests.test_api import MobileRpcMixin, PASSWORD


class TestPointageWithTag(MobileRpcMixin, MobilePointageCommon, HttpCase):

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.user.flush()
        # Odoo's login cooldown (_assert_can_auth) counts failures in process
        # memory keyed by source address, not transactionally — a
        # deliberate-bad-login test elsewhere in the same process can leave
        # 127.0.0.1 throttled here too (see test_api.py / test_compte_rendu.py,
        # which document and work around the same hazard).
        self.env["ir.config_parameter"].sudo().set_param("base.login_cooldown_after", "0")

    def _login(self):
        result = self._result(
            "auth/login",
            {"login": self.user.login, "password": PASSWORD},
        )
        return result["token"]

    def test_matched_order_sets_fsm_order_id(self):
        """Sanity check on the existing happy path (an open order assigned
        to the worker at the tag's location) — must still resolve
        fsm_order_id after adding the location-only fallback below."""
        tag = self.env["ocleaneo.nfc.tag"].sudo().create({
            "location_id": self.location.id,
            "uid": "04:11:22:33:44:55:66",
            "state": "active",
        })
        token = self._login()

        result = self._result("pointage/with-tag", {
            "nfc_tag_id": tag.uid,
            "type": "arrivee",
        }, token=token)

        self.assertNotIn("error", result)
        self.assertEqual(result["fsm_order_id"], self.order.id)

    def test_unmatched_location_still_records_the_location(self):
        """A badge whose location has no open fsm.order at all ("location-only
        clocking", case 4 in pointage_with_tag.py's docstring) must still
        carry the location on the created pointage.

        Before this fix, fsm_location_id was only ever set from inside the
        `if fsm_order_id:` branch of pointage() — this path lost every
        chantier reference (neither fsm_order_id nor fsm_location_id), even
        though the tag lookup here already knew exactly which location it
        was. The agent's clocking still succeeded, but the mobile app had
        nothing left to name the chantier with.
        """
        lonely_partner = self.env["res.partner"].create({"name": "Site Sans Chantier"})
        lonely_location = self.env["fsm.location"].create({
            "name": "Site Sans Chantier Ouvert",
            "owner_id": lonely_partner.id,
        })
        tag = self.env["ocleaneo.nfc.tag"].sudo().create({
            "location_id": lonely_location.id,
            "uid": "04:99:88:77:66:55:44",
            "state": "active",
        })
        token = self._login()

        result = self._result("pointage/with-tag", {
            "nfc_tag_id": tag.uid,
            "type": "arrivee",
        }, token=token)

        self.assertNotIn("error", result)
        self.assertFalse(result["fsm_order_id"])
        self.assertEqual(result["fsm_location_id"], lonely_location.id)
        self.assertEqual(result["fsm_location_name"], lonely_location.display_name)

    def test_badge_not_recognized_is_404(self):
        token = self._login()

        result = self._result("pointage/with-tag", {
            "nfc_tag_id": "04:AA:BB:CC:DD:EE:FF",
            "type": "arrivee",
        }, token=token)

        self.assertEqual(result["code"], 404)

    def test_second_badge_tap_becomes_departure(self):
        """A second badge tap at the same site must close the clocking even if
        the mobile app (or an old APK) still sends 'arrivee'. This is the
        production bug where every NFC scan created a new arrival."""
        tag = self.env["ocleaneo.nfc.tag"].sudo().create({
            "location_id": self.location.id,
            "uid": "04:11:22:33:44:55:77",
            "state": "active",
        })
        token = self._login()

        first = self._result("pointage/with-tag", {
            "nfc_tag_id": tag.uid,
            "type": "arrivee",
        }, token=token)
        self.assertEqual(first["type"], "arrivee")

        second = self._result("pointage/with-tag", {
            "nfc_tag_id": tag.uid,
            "type": "arrivee",
        }, token=token)
        self.assertEqual(second["type"], "depart")
        self.assertEqual(second["fsm_order_id"], self.order.id)

    def test_third_badge_tap_becomes_arrival_again(self):
        """After a departure, a new badge tap must open a new clocking."""
        tag = self.env["ocleaneo.nfc.tag"].sudo().create({
            "location_id": self.location.id,
            "uid": "04:11:22:33:44:55:88",
            "state": "active",
        })
        token = self._login()

        self._result("pointage/with-tag", {"nfc_tag_id": tag.uid, "type": "arrivee"}, token=token)
        self._result("pointage/with-tag", {"nfc_tag_id": tag.uid, "type": "arrivee"}, token=token)
        third = self._result("pointage/with-tag", {"nfc_tag_id": tag.uid, "type": "arrivee"}, token=token)
        self.assertEqual(third["type"], "arrivee")

    def test_location_only_clocking_also_toggles(self):
        """A badge at a location with no open order still alternates
        arrivee-depart based on the worker's history at that location."""
        lonely_partner = self.env["res.partner"].create({"name": "Toggle Site"})
        lonely_location = self.env["fsm.location"].create({
            "name": "Toggle Site Ouvert",
            "owner_id": lonely_partner.id,
        })
        tag = self.env["ocleaneo.nfc.tag"].sudo().create({
            "location_id": lonely_location.id,
            "uid": "04:99:88:77:66:55:33",
            "state": "active",
        })
        token = self._login()

        first = self._result("pointage/with-tag", {
            "nfc_tag_id": tag.uid,
            "type": "arrivee",
        }, token=token)
        self.assertEqual(first["type"], "arrivee")
        self.assertFalse(first["fsm_order_id"])

        second = self._result("pointage/with-tag", {
            "nfc_tag_id": tag.uid,
            "type": "arrivee",
        }, token=token)
        self.assertEqual(second["type"], "depart")
        self.assertFalse(second["fsm_order_id"])

