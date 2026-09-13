# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Tests for HrAttendance.recompute_attendance(), the batch safety net that
replays a day's ocleaneo.mobile.pointage log and reports where it disagrees
with the stored hr.attendance — see the docstring on the method itself for
why it exists alongside, not instead of, the incremental state machine.
"""

from datetime import datetime

from .common import MobilePointageCommon


class TestRecomputeAttendance(MobilePointageCommon):

    def setUp(self):
        super().setUp()
        # UTC keeps the day-window math trivial: no offset between the
        # naive datetimes written below and local_day_bounds_utc's output.
        self.user.tz = "UTC"
        self.Pointage = self.env["ocleaneo.mobile.pointage"].sudo()
        self.Attendance = self.env["hr.attendance"].sudo()

    def _pointage(self, type_, when, ref):
        return self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "fsm_order_id": self.order.id,
            "type": type_,
            "datetime": when,
            "source": "mobile",
            "client_ref": ref,
            "company_id": self.company.id,
        })

    def _recompute(self, apply=False):
        return self.Attendance.recompute_attendance(
            self.employee.id, datetime(2026, 5, 12).date(), apply=apply
        )

    def test_clean_day_has_no_discrepancy(self):
        self._pointage("arrivee", datetime(2026, 5, 12, 8, 0, 0), "clean-arrivee")
        self._pointage("depart", datetime(2026, 5, 12, 17, 0, 0), "clean-depart")
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": datetime(2026, 5, 12, 8, 0, 0),
            "check_out": datetime(2026, 5, 12, 17, 0, 0),
        })

        self.assertEqual(self._recompute(apply=False), [])
        self.assertEqual(self._recompute(apply=True), [])
        # apply=True on a clean day must not touch the existing record.
        self.assertEqual(attendance.check_out, datetime(2026, 5, 12, 17, 0, 0))

    def test_missing_slice_is_reported_and_filled_only_when_applied(self):
        self._pointage("arrivee", datetime(2026, 5, 12, 8, 0, 0), "missing-arrivee")
        self._pointage("depart", datetime(2026, 5, 12, 17, 0, 0), "missing-depart")
        # No hr.attendance created at all for this day — e.g. the mirror in
        # _create_attendance swallowed a ValidationError and only logged it.

        dry_run = self._recompute(apply=False)
        self.assertEqual(len(dry_run), 1)
        self.assertEqual(dry_run[0]["kind"], "missing_slice")
        self.assertEqual(
            self.Attendance.search_count([("employee_id", "=", self.employee.id)]), 0,
            "dry run (apply=False) must never write anything",
        )

        applied = self._recompute(apply=True)
        self.assertEqual(len(applied), 1)
        created = self.Attendance.search([("employee_id", "=", self.employee.id)])
        self.assertEqual(len(created), 1)
        self.assertEqual(created.check_in, datetime(2026, 5, 12, 8, 0, 0))
        self.assertEqual(created.check_out, datetime(2026, 5, 12, 17, 0, 0))

    def test_attendance_left_open_is_reported_and_closed_only_when_applied(self):
        self._pointage("arrivee", datetime(2026, 5, 12, 8, 0, 0), "open-arrivee")
        self._pointage("depart", datetime(2026, 5, 12, 17, 0, 0), "open-depart")
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": datetime(2026, 5, 12, 8, 0, 0),
        })  # left open, as if the depart's own mirror-write had failed silently

        dry_run = self._recompute(apply=False)
        self.assertEqual(len(dry_run), 1)
        self.assertEqual(dry_run[0]["kind"], "should_be_closed")
        self.assertEqual(dry_run[0]["attendance_id"], attendance.id)
        self.assertFalse(attendance.check_out, "dry run must not close the attendance")

        applied = self._recompute(apply=True)
        self.assertEqual(len(applied), 1)
        self.assertEqual(attendance.check_out, datetime(2026, 5, 12, 17, 0, 0))

    def test_manual_attendance_with_no_matching_pointage_is_never_touched(self):
        """A legitimate manual entry — no mobile clocking at all that day —
        must be reported, not silently deleted or rewritten, apply=True
        included: the tool's job is to surface a disagreement, never to
        assume the event log is the only source of truth."""
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": datetime(2026, 5, 12, 9, 0, 0),
            "check_out": datetime(2026, 5, 12, 16, 0, 0),
        })

        dry_run = self._recompute(apply=False)
        self.assertEqual(len(dry_run), 1)
        self.assertEqual(dry_run[0]["kind"], "unmatched_attendance")
        self.assertEqual(dry_run[0]["attendance_id"], attendance.id)

        applied = self._recompute(apply=True)
        self.assertEqual(len(applied), 1)
        self.assertEqual(applied[0]["kind"], "unmatched_attendance")
        self.assertTrue(attendance.exists())
        self.assertEqual(attendance.check_in, datetime(2026, 5, 12, 9, 0, 0))
        self.assertEqual(attendance.check_out, datetime(2026, 5, 12, 16, 0, 0))
