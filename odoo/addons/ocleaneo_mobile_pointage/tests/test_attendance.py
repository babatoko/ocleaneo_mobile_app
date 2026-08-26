# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Regression tests for _manage_hr_attendance.

hr.attendance allows at most one open record per employee. Every clocking
type that can open a record must therefore reuse an existing open one
rather than create a second — otherwise Odoo raises ValidationError and
the worker cannot clock at all. Two paths used to get this wrong; both
are locked down here.
"""

from datetime import datetime, timedelta

from odoo.addons.ocleaneo_mobile_pointage.controllers.pointage import (
    MobilePointageController,
)

from .common import MobilePointageCommon


class TestManageHrAttendance(MobilePointageCommon):

    def setUp(self):
        super().setUp()
        self.controller = MobilePointageController()
        self.Attendance = self.env["hr.attendance"]
        # Fixed, timezone-naive UTC instants — hr.attendance stores UTC.
        self.day1_morning = datetime(2026, 3, 10, 7, 0, 0)
        self.day1_noon = datetime(2026, 3, 10, 12, 0, 0)
        self.day1_afternoon = datetime(2026, 3, 10, 13, 0, 0)
        self.day1_evening = datetime(2026, 3, 10, 17, 0, 0)
        self.day2_morning = datetime(2026, 3, 11, 7, 0, 0)

    def _manage(self, pointage_type, now):
        return self.controller._manage_hr_attendance(
            self.env, self.employee, pointage_type, now
        )

    def _open_attendances(self):
        return self.Attendance.search([
            ("employee_id", "=", self.employee.id),
            ("check_out", "=", False),
        ])

    # --- arrivee ---------------------------------------------------------

    def test_arrivee_opens_attendance(self):
        ids = self._manage("arrivee", self.day1_morning)
        self.assertEqual(len(ids), 1)
        attendance = self.Attendance.browse(ids[0])
        self.assertEqual(attendance.check_in, self.day1_morning)
        self.assertFalse(attendance.check_out)

    def test_arrivee_twice_same_day_reuses_open_attendance(self):
        """A double tap must not try to open a second attendance."""
        first = self._manage("arrivee", self.day1_morning)
        second = self._manage("arrivee", self.day1_morning + timedelta(minutes=2))
        self.assertEqual(first, second)
        self.assertEqual(len(self._open_attendances()), 1)

    def test_arrivee_next_day_with_forgotten_checkout_does_not_raise(self):
        """The blocking bug: an attendance left open on a PREVIOUS day.

        The guard used to reuse the open attendance only when it started on
        the server's current date. A worker who forgot to clock out the day
        before therefore fell through to create(), hit hr.attendance's
        "only one open record" constraint, and could not clock in at all.
        """
        opened = self._manage("arrivee", self.day1_morning)
        # No "depart": the attendance stays open overnight.
        self.assertEqual(len(self._open_attendances()), 1)

        # Must not raise, and must not try to open a second record.
        next_day = self._manage("arrivee", self.day2_morning)

        self.assertEqual(
            next_day, opened,
            "should reuse the stale open attendance rather than create a second one",
        )
        self.assertEqual(len(self._open_attendances()), 1)

    # --- pause_fin -------------------------------------------------------

    def test_pause_fin_after_pause_debut_opens_new_attendance(self):
        """Normal flow: pause_debut closed the record, pause_fin reopens."""
        self._manage("arrivee", self.day1_morning)
        self._manage("pause_debut", self.day1_noon)
        self.assertFalse(self._open_attendances())

        ids = self._manage("pause_fin", self.day1_afternoon)

        self.assertEqual(len(ids), 1)
        attendance = self.Attendance.browse(ids[0])
        self.assertEqual(attendance.check_in, self.day1_afternoon)
        self.assertEqual(len(self._open_attendances()), 1)

    def test_pause_fin_without_pause_debut_does_not_raise(self):
        """The second blocking bug: pause_fin used to create unconditionally.

        Reachable via a double tap, an offline replay arriving out of
        order, or any app/server state desync — the attendance is still
        open, so an unguarded create() raised ValidationError.
        """
        opened = self._manage("arrivee", self.day1_morning)
        self.assertEqual(len(self._open_attendances()), 1)

        reused = self._manage("pause_fin", self.day1_afternoon)

        self.assertEqual(reused, opened)
        self.assertEqual(len(self._open_attendances()), 1)

    # --- depart / pause_debut -------------------------------------------

    def test_depart_closes_open_attendance(self):
        opened = self._manage("arrivee", self.day1_morning)
        closed = self._manage("depart", self.day1_evening)

        self.assertEqual(closed, opened)
        attendance = self.Attendance.browse(closed[0])
        self.assertEqual(attendance.check_out, self.day1_evening)
        self.assertFalse(self._open_attendances())

    def test_depart_without_open_attendance_records_zero_length_slice(self):
        """Clock-out with no matching clock-in still records the event."""
        ids = self._manage("depart", self.day1_evening)

        self.assertEqual(len(ids), 1)
        attendance = self.Attendance.browse(ids[0])
        self.assertEqual(attendance.check_in, self.day1_evening)
        self.assertEqual(attendance.check_out, self.day1_evening)

    def test_full_day_with_pause_produces_two_slices(self):
        """arrivee -> pause_debut -> pause_fin -> depart = 2 attendances."""
        self._manage("arrivee", self.day1_morning)
        self._manage("pause_debut", self.day1_noon)
        self._manage("pause_fin", self.day1_afternoon)
        self._manage("depart", self.day1_evening)

        attendances = self.Attendance.search(
            [("employee_id", "=", self.employee.id)], order="check_in asc"
        )
        self.assertEqual(len(attendances), 2)
        self.assertEqual(attendances[0].check_in, self.day1_morning)
        self.assertEqual(attendances[0].check_out, self.day1_noon)
        self.assertEqual(attendances[1].check_in, self.day1_afternoon)
        self.assertEqual(attendances[1].check_out, self.day1_evening)
        self.assertFalse(self._open_attendances())

    def test_attendance_conflict_does_not_lose_the_clocking(self):
        """A rejected hr.attendance write must not fail the whole request.

        hr.attendance is a derived mirror; ocleaneo.mobile.pointage is the
        record of what the worker actually did. _create_attendance turns a
        constraint rejection into a logged warning and an empty result, so
        the caller still persists the pointage itself.
        """
        # An already-closed slice covering the instant we are about to
        # record: creating a zero-length slice inside it violates
        # hr.attendance's no-overlap rule.
        self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": self.day1_morning,
            "check_out": self.day1_evening,
        })

        ids = self.controller._create_attendance(
            self.Attendance.sudo(),
            self.employee,
            {"check_in": self.day1_noon, "check_out": self.day1_noon},
        )

        self.assertEqual(ids, [], "conflict should be swallowed, not raised")
