# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Tests for the reverse sync from hr.attendance to ocleaneo.mobile.pointage.

When a manager closes an attendance manually in the Odoo backoffice, the
mobile pointage log must receive a matching departure record so the app does
not show an open clocking.
"""

from datetime import datetime

from odoo.addons.ocleaneo_mobile_pointage.tests.common import MobilePointageCommon


class TestAttendanceReverseSync(MobilePointageCommon):

    def setUp(self):
        super().setUp()
        self.Pointage = self.env["ocleaneo.mobile.pointage"].sudo()
        self.Attendance = self.env["hr.attendance"].sudo()
        self.arrival_time = datetime(2026, 3, 10, 7, 0, 0)
        self.departure_time = datetime(2026, 3, 10, 17, 0, 0)

    def test_manual_close_creates_mobile_departure(self):
        """Closing an hr.attendance with a linked mobile arrival must create
        a matching mobile departure pointage.
        """
        arrival = self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "fsm_order_id": self.order.id,
            "fsm_location_id": self.location.id,
            "type": "arrivee",
            "datetime": self.arrival_time,
            "source": "mobile",
            "state": "valide",
        })
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": self.arrival_time,
        })
        arrival.hr_attendance_id = attendance.id

        attendance.check_out = self.departure_time

        departure = self.Pointage.search([
            ("hr_attendance_id", "=", attendance.id),
            ("type", "=", "depart"),
        ])
        self.assertEqual(len(departure), 1)
        self.assertEqual(departure.datetime, self.departure_time)
        self.assertEqual(departure.source, "manuel")
        self.assertEqual(departure.user_id, self.user)
        self.assertEqual(departure.employee_id, self.employee)
        self.assertEqual(departure.fsm_order_id, self.order)
        self.assertEqual(departure.fsm_location_id, self.location)

    def test_no_departure_if_no_linked_arrival(self):
        """A manually closed attendance without a mobile arrival must not
        invent a departure pointage, because we cannot safely determine the
        fsm_order_id / location_id context.
        """
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": self.arrival_time,
            "check_out": self.departure_time,
        })
        departure = self.Pointage.search([
            ("hr_attendance_id", "=", attendance.id),
            ("type", "=", "depart"),
        ])
        self.assertFalse(departure)

    def test_no_duplicate_departure(self):
        """If a departure already exists for this attendance, do not create a
        second one when the attendance is edited again.
        """
        arrival = self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "fsm_order_id": self.order.id,
            "fsm_location_id": self.location.id,
            "type": "arrivee",
            "datetime": self.arrival_time,
            "source": "mobile",
            "state": "valide",
        })
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": self.arrival_time,
            "check_out": self.departure_time,
        })
        arrival.hr_attendance_id = attendance.id

        # First close already produced the mirror.
        first_departure = self.Pointage.search([
            ("hr_attendance_id", "=", attendance.id),
            ("type", "=", "depart"),
        ])
        self.assertEqual(len(first_departure), 1)

        # Editing check_out again must not duplicate the mirror.
        attendance.check_out = self.departure_time.replace(hour=18)
        departures = self.Pointage.search([
            ("hr_attendance_id", "=", attendance.id),
            ("type", "=", "depart"),
        ])
        self.assertEqual(len(departures), 1)

    def test_no_departure_if_mobile_depart_already_exists(self):
        """If the worker already departed via the app, a manual close should
        not create a second departure pointage for the same order/time window.
        """
        arrival = self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "fsm_order_id": self.order.id,
            "fsm_location_id": self.location.id,
            "type": "arrivee",
            "datetime": self.arrival_time,
            "source": "mobile",
            "state": "valide",
        })
        # Mobile departure already exists (not linked to the attendance yet,
        # as can happen when the app departed before the manager edited the
        # attendance).
        self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "fsm_order_id": self.order.id,
            "fsm_location_id": self.location.id,
            "type": "depart",
            "datetime": self.departure_time,
            "source": "mobile",
            "state": "valide",
        })
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": self.arrival_time,
        })
        arrival.hr_attendance_id = attendance.id

        # Manager tweaks check_out after the fact.
        attendance.check_out = self.departure_time.replace(hour=18)
        all_departures = self.Pointage.search([
            ("user_id", "=", self.user.id),
            ("fsm_order_id", "=", self.order.id),
            ("type", "=", "depart"),
        ])
        self.assertEqual(len(all_departures), 1)

    def test_no_departure_if_attendance_already_has_linked_depart(self):
        """If a depart is already linked to the attendance, editing check_out
        again must not duplicate it.
        """
        arrival = self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "fsm_order_id": self.order.id,
            "fsm_location_id": self.location.id,
            "type": "arrivee",
            "datetime": self.arrival_time,
            "source": "mobile",
            "state": "valide",
        })
        depart = self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "fsm_order_id": self.order.id,
            "fsm_location_id": self.location.id,
            "type": "depart",
            "datetime": self.departure_time,
            "source": "mobile",
            "state": "valide",
        })
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": self.arrival_time,
        })
        arrival.hr_attendance_id = attendance.id
        depart.hr_attendance_id = attendance.id

        attendance.check_out = self.departure_time.replace(hour=18)
        linked_departures = self.Pointage.search([
            ("hr_attendance_id", "=", attendance.id),
            ("type", "=", "depart"),
        ])
        self.assertEqual(len(linked_departures), 1)

    def test_no_departure_for_manual_arrival_anchor(self):
        """A manually created arrival must not be used as anchor for an
        automatic departure mirror: only mobile-sourced arrivals are the
        ground truth of what the worker actually did.
        """
        arrival = self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "fsm_order_id": self.order.id,
            "fsm_location_id": self.location.id,
            "type": "arrivee",
            "datetime": self.arrival_time,
            "source": "manuel",
            "state": "valide",
        })
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": self.arrival_time,
            "check_out": self.departure_time,
        })
        arrival.hr_attendance_id = attendance.id

        departure = self.Pointage.search([
            ("hr_attendance_id", "=", attendance.id),
            ("type", "=", "depart"),
        ])
        self.assertFalse(departure)

    def test_manual_create_closed_attendance_syncs_departure(self):
        """Creating a closed attendance manually in the backoffice also syncs
        a departure pointage if a matching mobile arrival exists.
        """
        arrival = self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "fsm_order_id": self.order.id,
            "fsm_location_id": self.location.id,
            "type": "arrivee",
            "datetime": self.arrival_time,
            "source": "mobile",
            "state": "valide",
        })
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": self.arrival_time,
            "check_out": self.departure_time,
        })
        arrival.hr_attendance_id = attendance.id

        departure = self.Pointage.search([
            ("hr_attendance_id", "=", attendance.id),
            ("type", "=", "depart"),
        ])
        self.assertEqual(len(departure), 1)
        self.assertEqual(departure.datetime, self.departure_time)

    def test_no_sync_for_open_attendance(self):
        """An attendance left open must not produce any mobile pointage."""
        attendance = self.Attendance.create({
            "employee_id": self.employee.id,
            "check_in": self.arrival_time,
        })
        pointages = self.Pointage.search([
            ("hr_attendance_id", "=", attendance.id),
        ])
        self.assertFalse(pointages)

    def test_no_sync_if_employee_has_no_user(self):
        """If the employee has no res.users, the mirror cannot determine the
        user_id required by ocleaneo.mobile.pointage and must be skipped.
        """
        employee_no_user = self.env["hr.employee"].create({
            "name": "No User",
            "company_id": self.company.id,
        })
        attendance = self.Attendance.create({
            "employee_id": employee_no_user.id,
            "check_in": self.arrival_time,
            "check_out": self.departure_time,
        })
        pointages = self.Pointage.search([
            ("hr_attendance_id", "=", attendance.id),
        ])
        self.assertFalse(pointages)
