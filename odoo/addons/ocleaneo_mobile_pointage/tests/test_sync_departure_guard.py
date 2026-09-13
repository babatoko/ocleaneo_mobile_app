# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Structural regression test for the single-writer rule on hr.attendance.

test_pause_no_fake_departure.py pins down the one incident actually observed
in production (a pause_debut fabricating a depart). This file generalizes
the same invariant across every event type reachable through the mobile
clocking flow — not just pause_debut — because the context flag the guard
checks (ocleaneo_mobile_clocking) is set once for the *whole* POST /pointage
request in pointage(), independently of which event closed or reopened the
attendance. A future change that narrowed the guard back to a per-call-site
check, or to only some event types, would reopen this exact class of bug for
a different event without this test catching it: every step of a full day
(arrivée, pause, reprise, départ, plus a double arrivée) is checked, not just
the one branch that broke before.
"""

from datetime import datetime

from odoo import fields

from .common import MobilePointageCommon
from .test_api import MobileRpcMixin, PASSWORD

from odoo.tests.common import HttpCase


class TestSyncDepartureGuardGeneric(MobileRpcMixin, MobilePointageCommon, HttpCase):

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.user.flush()
        # See test_compte_rendu.py / test_api.py for why this hazard exists.
        self.env["ir.config_parameter"].sudo().set_param("base.login_cooldown_after", "0")

    def _login(self):
        return self._result(
            "auth/login", {"login": self.user.login, "password": PASSWORD},
        )["token"]

    def _clock(self, token, type_, hour, minute, ref):
        result = self._result("pointage", {
            "type": type_,
            "fsm_order_id": self.order.id,
            "datetime": fields.Datetime.to_string(datetime(2026, 4, 6, hour, minute, 0)),
            "client_ref": ref,
        }, token=token)
        self.assertNotIn("error", result, result)
        return result

    def _mobile_pointages(self):
        return self.env["ocleaneo.mobile.pointage"].sudo().search([
            ("user_id", "=", self.user.id),
        ], order="datetime asc")

    def test_full_day_never_fabricates_extra_pointages(self):
        """arrivée → pause → reprise → départ: every closing event in a
        realistic day (pause_debut included, the original bug) must leave
        exactly one mobile pointage per API call — never an extra one
        invented by the reverse-sync mirror."""
        token = self._login()
        sequence = [
            ("arrivee", 8, 0, "day-arrivee"),
            ("pause_debut", 12, 0, "day-pause-debut"),
            ("pause_fin", 12, 30, "day-pause-fin"),
            ("depart", 17, 0, "day-depart"),
        ]
        for i, (type_, hour, minute, ref) in enumerate(sequence):
            self._clock(token, type_, hour, minute, ref)
            pointages = self._mobile_pointages()
            expected_types = [t for t, _, _, _ in sequence[:i + 1]]
            self.assertEqual(
                pointages.mapped("type"), expected_types,
                "no closing event should ever fabricate an extra pointage "
                "via _ocleaneo_sync_departure_pointage",
            )
            self.assertTrue(
                all(p.source == "mobile" for p in pointages),
                "every pointage in this sequence came from the mobile flow "
                "and must never be re-labelled 'manuel' by the mirror",
            )

    def test_double_arrivee_then_depart_never_fabricates_extra_pointages(self):
        """Reusing the already-open attendance (double tap on arrivée) must
        not confuse the guard either — still exactly the pointages sent."""
        token = self._login()
        self._clock(token, "arrivee", 8, 0, "dbl-arrivee-1")
        self._clock(token, "arrivee", 8, 5, "dbl-arrivee-2")
        self._clock(token, "depart", 17, 0, "dbl-depart")

        pointages = self._mobile_pointages()
        self.assertEqual(pointages.mapped("type"), ["arrivee", "arrivee", "depart"])
        self.assertTrue(all(p.source == "mobile" for p in pointages))
