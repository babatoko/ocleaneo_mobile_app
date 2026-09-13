# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Regression test: a pause_debut must never fabricate a depart pointage.

_manage_hr_attendance() closes the worker's open hr.attendance on
pause_debut (same as a real depart, business-wise: pause = not present).
HrAttendance.write()'s _ocleaneo_sync_departure_pointage() mirror exists to
backfill a missing mobile departure after a MANUAL backoffice edit — but it
fired on that same write regardless of who caused it, because at that point
in pointage() the pause_debut pointage that was just created is not yet
linked via hr_attendance_id (that happens a couple of lines later). The
mirror therefore saw "attendance just closed, no linked depart" and invented
one — turning a tap on "Pause" into a fake "Absent" the instant it landed.
"""

from datetime import datetime

from odoo import fields

from .common import MobilePointageCommon
from .test_api import MobileRpcMixin, PASSWORD

from odoo.tests.common import HttpCase


class TestPauseNoFakeDeparture(MobileRpcMixin, MobilePointageCommon, HttpCase):

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.user.flush()
        # See test_compte_rendu.py / test_api.py for why this hazard exists.
        self.env["ir.config_parameter"].sudo().set_param("base.login_cooldown_after", "0")

    def _login(self):
        result = self._result(
            "auth/login",
            {"login": self.user.login, "password": PASSWORD},
        )
        return result["token"]

    def test_pause_debut_does_not_create_a_depart_pointage(self):
        token = self._login()

        arrivee = self._result("pointage", {
            "type": "arrivee",
            "fsm_order_id": self.order.id,
            "datetime": fields.Datetime.to_string(datetime(2026, 3, 10, 8, 0, 0)),
            "client_ref": "arrivee-1",
        }, token=token)
        self.assertNotIn("error", arrivee)

        pause = self._result("pointage", {
            "type": "pause_debut",
            "fsm_order_id": self.order.id,
            "datetime": fields.Datetime.to_string(datetime(2026, 3, 10, 12, 0, 0)),
            "client_ref": "pause-1",
        }, token=token)
        self.assertNotIn("error", pause)

        pointages = self.env["ocleaneo.mobile.pointage"].sudo().search([
            ("user_id", "=", self.user.id),
        ], order="datetime asc")
        self.assertEqual(
            pointages.mapped("type"), ["arrivee", "pause_debut"],
            "pause_debut must never fabricate an extra 'depart' pointage",
        )

    def test_manual_close_still_syncs_a_departure(self):
        """The reverse-sync mirror itself (manual backoffice edits) must
        keep working — only the mobile clocking path is exempt."""
        arrivee = self._result("pointage", {
            "type": "arrivee",
            "fsm_order_id": self.order.id,
            "datetime": fields.Datetime.to_string(datetime(2026, 3, 10, 8, 0, 0)),
            "client_ref": "arrivee-2",
        }, token=self._login())
        self.assertNotIn("error", arrivee)

        attendance = self.env["hr.attendance"].sudo().browse(arrivee["attendance_id"])
        attendance.check_out = datetime(2026, 3, 10, 17, 0, 0)

        pointages = self.env["ocleaneo.mobile.pointage"].sudo().search([
            ("user_id", "=", self.user.id),
        ], order="datetime asc")
        self.assertEqual(pointages.mapped("type"), ["arrivee", "depart"])
        self.assertEqual(pointages.filtered(lambda p: p.type == "depart").source, "manuel")
