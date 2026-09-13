# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Tests for the bidirectional pointage sync endpoint.

The sync endpoint returns the authenticated worker's server-side state:
mobile pointage records, attendances, timesheets, and (by delegation to
the planning endpoint) today's shifts. It is the "pull" half of the
refresh flow; the "push" half is the normal POST /pointage + offline queue.
"""

from .common import MobilePointageCommon
from .test_api import MobileRpcMixin, PASSWORD
from odoo.tests.common import HttpCase


class TestPointageSync(MobileRpcMixin, MobilePointageCommon, HttpCase):

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.user.flush()
        # Disable login cooldown that accumulates across test classes.
        self.env["ir.config_parameter"].sudo().set_param("base.login_cooldown_after", "0")

    def _login(self):
        return self._result(
            "auth/login",
            {"login": self.user.login, "password": PASSWORD},
        )["token"]

    def _clock(self, token, type_, at):
        return self._result("pointage", {
            "type": type_,
            "fsm_order_id": self.order.id,
            "datetime": at,
        }, token=token)

    def test_sync_returns_entries_for_today(self):
        """The endpoint returns mobile pointage records for the worker."""
        token = self._login()
        self._clock(token, "arrivee", "2026-03-10T08:00:00")
        self._clock(token, "depart", "2026-03-10T10:00:00")

        result = self._result("pointage/sync", {"date": "2026-03-10"}, token=token)

        self.assertIn("entries", result)
        self.assertEqual(result["count"], 2)
        self.assertEqual(len(result["entries"]), 2)
        self.assertIn("server_time", result)
        # Both records belong to the authenticated user.
        for entry in result["entries"]:
            self.assertEqual(entry["type"] in ("arrivee", "depart"), True)

    def test_sync_filters_by_date_range(self):
        """Passing date_from/date_to restricts the returned window."""
        token = self._login()
        self._clock(token, "arrivee", "2026-03-09T08:00:00")
        self._clock(token, "depart", "2026-03-09T10:00:00")
        self._clock(token, "arrivee", "2026-03-10T08:00:00")

        result = self._result("pointage/sync", {
            "date_from": "2026-03-10",
            "date_to": "2026-03-10",
        }, token=token)

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["entries"][0]["type"], "arrivee")

    def test_sync_includes_attendance_when_asked(self):
        """include_attendance=true returns hr.attendance rows."""
        token = self._login()
        self._clock(token, "arrivee", "2026-03-10T08:00:00")
        self._clock(token, "depart", "2026-03-10T10:00:00")

        result = self._result("pointage/sync", {
            "date": "2026-03-10",
            "include_attendance": True,
        }, token=token)

        self.assertIn("attendances", result)
        self.assertGreaterEqual(result["attendance_count"], 1)
        attendance = result["attendances"][0]
        self.assertIn("check_in", attendance)
        self.assertIn("check_out", attendance)

    def test_sync_includes_timesheet_when_asked(self):
        """include_timesheet=true returns account.analytic.line rows."""
        token = self._login()
        self.order.scheduled_duration = 2.0
        self._clock(token, "arrivee", "2026-03-10T08:00:00")
        self._clock(token, "depart", "2026-03-10T10:00:00")

        result = self._result("pointage/sync", {
            "date": "2026-03-10",
            "include_timesheet": True,
        }, token=token)

        self.assertIn("timesheets", result)
        self.assertGreaterEqual(result["timesheet_count"], 1)
        timesheet = result["timesheets"][0]
        self.assertIn("date_time", timesheet)
        self.assertIn("unit_amount", timesheet)

    def test_sync_does_not_expose_other_worker_records(self):
        """A worker only sees his own pointages through the sync endpoint."""
        # other_user clocks in on another order
        self.other_user.password = PASSWORD
        self.other_user.flush()
        other_token = self._result(
            "auth/login",
            {"login": self.other_user.login, "password": PASSWORD},
        )["token"]
        self._result("pointage", {
            "type": "arrivee",
            "fsm_order_id": self.other_order.id,
            "datetime": "2026-03-10T08:00:00",
        }, token=other_token)

        # main user has no pointages yet
        token = self._login()
        result = self._result("pointage/sync", {}, token=token)
        self.assertEqual(result["count"], 0)
