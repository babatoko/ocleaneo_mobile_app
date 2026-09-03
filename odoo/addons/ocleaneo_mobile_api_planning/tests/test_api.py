# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""End-to-end tests of /planning over real HTTP.

Covers ocleaneo#12: a closed fsm.order (Completed or Cancelled) within the
requested date range must still come back, with a status field
distinguishing the two — not be silently dropped, which is what a départ
badgé now does to its own order's stage (ocleaneo#11).
"""

import json
from datetime import timedelta

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import mobile_routes
from odoo.addons.ocleaneo_mobile_api.tools.mobile_time import local_day_bounds_utc, today_local
from odoo.tests.common import HttpCase

from .common import MobilePlanningCommon

PASSWORD = "TestPass123!"
TZ = "Europe/Paris"


class TestMobilePlanningApi(MobilePlanningCommon, HttpCase):

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.user.tz = TZ
        self.user.flush()
        # Odoo's native login cooldown (_assert_can_auth) counts failures in
        # *process memory*, keyed by source address — not transactional, so
        # it survives the rollback between tests (see
        # ocleaneo_mobile_pointage/tests/test_api.py:TestMobileAuthFailures,
        # which documents and works around the same hazard). Now that this
        # module depends on ocleaneo_mobile_pointage (ocleaneo#13), its own
        # deliberate-bad-login tests always run before this class in the
        # same CI process and can leave 127.0.0.1 throttled here too.
        self.env["ir.config_parameter"].sudo().set_param("base.login_cooldown_after", "0")

        # Fenêtre du jour local (voir mobile_time.py) : place la vacation au
        # milieu de la journée locale, pas à "maintenant" — un test lancé
        # près de minuit UTC serait sinon parfois côté veille/lendemain une
        # fois reconverti dans le fuseau du worker.
        target_date = today_local(TZ)
        self.today_str = str(target_date)
        date_start, _ = local_day_bounds_utc(target_date, TZ)
        self.scheduled_start = date_start + timedelta(hours=10)
        self.scheduled_end = self.scheduled_start + timedelta(hours=2)

    def _rpc(self, endpoint, params=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer %s" % token
        response = self.url_open(
            mobile_routes(endpoint)[0],
            data=json.dumps({"jsonrpc": "2.0", "method": "call", "id": 1, "params": params or {}}),
            headers=headers,
        )
        return response.json()

    def _result(self, endpoint, params=None, token=None):
        body = self._rpc(endpoint, params, token)
        self.assertNotIn("error", body, "unexpected server exception: %s" % body.get("error"))
        return body["result"]

    def _login(self):
        return self._result("auth/login", {"login": self.user.login, "password": PASSWORD})["token"]

    def _order_from_planning(self, token, order_id, date=None):
        result = self._result("planning", {"date": date or self.today_str}, token=token)
        matches = [o for o in result["orders"] if o["id"] == order_id]
        self.assertEqual(len(matches), 1, "commande %s absente de /planning : %s" % (order_id, result))
        return matches[0]

    def test_confirmed_order_has_confirmed_status(self):
        _, order = self._make_order(self.person)
        order.write({"scheduled_date_start": self.scheduled_start, "scheduled_date_end": self.scheduled_end})
        token = self._login()

        entry = self._order_from_planning(token, order.id)

        self.assertEqual(entry["status"], "confirmed")
        self.assertFalse(entry["is_closed"])

    def test_completed_order_is_still_returned_as_done(self):
        """La régression même : un WO clôturé (ocleaneo#11) doit rester
        visible dans le planning du jour, pas en disparaître."""
        _, order = self._make_order(self.person)
        order.write({"scheduled_date_start": self.scheduled_start, "scheduled_date_end": self.scheduled_end})
        # fsm.order.write() (OCA fieldservice) refuse un passage direct au
        # stage Completed sans is_button=True ("Cannot move to completed
        # from Kanban") — même contournement que ocleaneo#11.
        order.write({
            "stage_id": self.env.ref("fieldservice.fsm_stage_completed").id,
            "is_button": True,
        })
        token = self._login()

        entry = self._order_from_planning(token, order.id)

        self.assertEqual(entry["status"], "done")
        self.assertTrue(entry["is_closed"])

    def test_cancelled_order_is_distinguished_from_completed(self):
        """is_closed seul ne distingue pas terminé d'annulé (les deux stages
        l'ont) : status doit le faire."""
        _, order = self._make_order(self.person)
        order.write({"scheduled_date_start": self.scheduled_start, "scheduled_date_end": self.scheduled_end})
        order.stage_id = self.env.ref("fieldservice.fsm_stage_cancelled")
        token = self._login()

        entry = self._order_from_planning(token, order.id)

        self.assertEqual(entry["status"], "cancelled")
        self.assertTrue(entry["is_closed"])

    def test_location_exposes_nfc_tag_id(self):
        """ocleaneo#13 : le scan NFC ne doit pas dépendre uniquement de
        /chantiers/aujourdhui (plafonné à 50, non filtré par date) — /planning
        doit porter le même identifiant de badge que sa vacation du jour."""
        location, order = self._make_order(self.person)
        location.nfc_tag_id = "04:17:79:C9:78:00:00"
        order.write({"scheduled_date_start": self.scheduled_start, "scheduled_date_end": self.scheduled_end})
        token = self._login()

        entry = self._order_from_planning(token, order.id)

        self.assertEqual(entry["location"]["nfc_tag_id"], "04:17:79:C9:78:00:00")
