# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Regression tests for _manage_timesheet and the duration computation.

Three separate defects converged on the same visible symptom — a timesheet
stuck at 0 hours — and each is locked down here:
  1. date_time_end silently kept project_timesheet_time_control's
     compute/inverse through the _inherit chain (field-merge semantics).
  2. _compute_duration only ever saw the fields present in one write().
  3. _manage_timesheet looked for the open line by server-side "today",
     which does not match the date Odoo actually stores for a night shift.
"""

from datetime import datetime, timedelta

from odoo.addons.ocleaneo_mobile_pointage.controllers.pointage import (
    MobilePointageController,
)

from .common import MobilePointageCommon


class TestTimesheetDuration(MobilePointageCommon):
    """The ORM-level contract account.analytic.line must honour."""

    def setUp(self):
        super().setUp()
        self.Timesheet = self.env["account.analytic.line"]
        self.start = datetime(2026, 3, 10, 8, 0, 0)
        self.end = datetime(2026, 3, 10, 16, 30, 0)  # 8.5 h

    def _new_line(self, **vals):
        base = {
            "name": "Test",
            "project_id": self.project.id,
            "employee_id": self.employee.id,
            "unit_amount": 0,
            "company_id": self.company.id,
        }
        base.update(vals)
        return self.Timesheet.create(base)

    def test_date_time_end_is_a_plain_stored_field(self):
        """Redefining an inherited field only overrides what it re-declares.

        project_timesheet_time_control declares date_time_end with
        compute=_compute_date_time_end and inverse=_inverse_date_time_end.
        Odoo merges field attributes across the _inherit chain by layering
        only the keys each class explicitly passes, so our redefinition
        needs compute=False/inverse=False to actually drop them — without
        that the field stays computed (and inversed) despite store=True.
        """
        field = self.Timesheet._fields["date_time_end"]
        self.assertFalse(field.compute)
        self.assertFalse(field.inverse)
        self.assertTrue(field.store)

    def test_duration_computed_when_end_written_separately(self):
        """The write pattern the mobile flow actually produces.

        create() sets date_time only; the clock-out later writes
        date_time_end alone on that same record. A guard that inspects only
        the incoming vals never sees both fields together and never fires.
        """
        line = self._new_line(date_time=self.start, date=self.start.date())
        self.assertEqual(line.unit_amount, 0)

        line.date_time_end = self.end

        self.assertEqual(line.unit_amount, 8.5)

    def test_duration_computed_on_a_single_two_field_write(self):
        line = self._new_line(date_time=self.start, date=self.start.date())
        line.write({"date_time": self.start, "date_time_end": self.end})
        self.assertEqual(line.unit_amount, 8.5)

    def test_explicit_unit_amount_is_respected(self):
        """A caller stating the duration outright wins over the computation."""
        line = self._new_line(date_time=self.start, date=self.start.date())
        line.write({"date_time_end": self.end, "unit_amount": 2.0})
        self.assertEqual(line.unit_amount, 2.0)

    def test_end_before_start_leaves_duration_untouched(self):
        line = self._new_line(date_time=self.end, date=self.end.date())
        line.date_time_end = self.start
        self.assertEqual(line.unit_amount, 0)


class TestManageTimesheet(MobilePointageCommon):
    """The controller-side open-line lookup."""

    def setUp(self):
        super().setUp()
        self.controller = MobilePointageController()
        self.Timesheet = self.env["account.analytic.line"]
        self.Pointage = self.env["ocleaneo.mobile.pointage"]

    def _pointage(self, pointage_type, now):
        return self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "type": pointage_type,
            "datetime": now,
            "fsm_order_id": self.order.id,
            "fsm_location_id": self.location.id,
            "company_id": self.company.id,
        })

    def _manage(self, pointage_type, now):
        return self.controller._manage_timesheet(
            self.env, self.employee, self._pointage(pointage_type, now), pointage_type, now
        )

    def test_arrivee_creates_running_line(self):
        start = datetime(2026, 3, 10, 8, 0, 0)
        ids = self._manage("arrivee", start)

        self.assertEqual(len(ids), 1)
        line = self.Timesheet.browse(ids[0])
        self.assertEqual(line.date_time, start)
        self.assertFalse(line.date_time_end)
        self.assertEqual(line.unit_amount, 0)
        self.assertEqual(line.fsm_order_id, self.order)

    def test_depart_closes_the_line_opened_by_arrivee(self):
        start = datetime(2026, 3, 10, 8, 0, 0)
        end = datetime(2026, 3, 10, 16, 30, 0)

        opened = self._manage("arrivee", start)
        closed = self._manage("depart", end)

        self.assertEqual(opened, closed)
        line = self.Timesheet.browse(closed[0])
        self.assertEqual(line.date_time_end, end)
        self.assertEqual(line.unit_amount, 8.5)

    def test_night_shift_crossing_midnight_still_closes_its_line(self):
        """The date-filter bug, in the shape this app actually meets it.

        project_timesheet_time_control rewrites `date` from `date_time` on
        write, so the stored date follows the clocking, not the server's
        wall clock. Filtering the open-line lookup on today's server date
        therefore missed the line opened the calendar day before — and the
        clock-out silently created nothing, leaving 0 hours forever.
        """
        start = datetime(2026, 3, 10, 22, 0, 0)
        end = datetime(2026, 3, 11, 6, 0, 0)  # next calendar day, 8 h later

        opened = self._manage("arrivee", start)
        closed = self._manage("depart", end)

        self.assertEqual(
            opened, closed,
            "clock-out must find the line opened on the previous calendar day",
        )
        line = self.Timesheet.browse(closed[0])
        self.assertEqual(line.date_time_end, end)
        self.assertEqual(line.unit_amount, 8.0)

    def test_second_arrivee_reuses_the_running_line(self):
        start = datetime(2026, 3, 10, 8, 0, 0)
        first = self._manage("arrivee", start)
        second = self._manage("arrivee", start + timedelta(minutes=5))

        self.assertEqual(first, second)
        self.assertEqual(
            self.Timesheet.search_count([("fsm_order_id", "=", self.order.id)]), 1
        )

    def test_no_timesheet_without_an_fsm_order(self):
        """A clocking not tied to a job produces attendance only."""
        pointage = self.Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "type": "arrivee",
            "datetime": datetime(2026, 3, 10, 8, 0, 0),
            "company_id": self.company.id,
        })
        ids = self.controller._manage_timesheet(
            self.env, self.employee, pointage, "arrivee", datetime(2026, 3, 10, 8, 0, 0)
        )
        self.assertEqual(ids, [])

    def test_billed_partner_comes_from_location_owner(self):
        """fsm.location has owner_id, not customer_id (which never existed)."""
        ids = self._manage("arrivee", datetime(2026, 3, 10, 8, 0, 0))
        line = self.Timesheet.browse(ids[0])
        self.assertEqual(line.partner_id, self.location.owner_id)


class TestProjectResolution(MobilePointageCommon):

    def setUp(self):
        super().setUp()
        self.controller = MobilePointageController()

    def test_config_parameter_wins_over_name_search(self):
        """Renaming the project from the UI must not break clocking."""
        explicit = self.env["project.project"].create({
            "name": "Un tout autre nom",
            "company_id": self.company.id,
        })
        self.env["ir.config_parameter"].sudo().set_param(
            "ocleaneo_mobile_pointage.project_id", str(explicit.id)
        )

        found = self.controller._get_project_pointage_chantiers(self.env, self.company.id)

        self.assertEqual(found, explicit)

    def test_falls_back_to_name_search_when_parameter_missing(self):
        found = self.controller._get_project_pointage_chantiers(self.env, self.company.id)
        self.assertEqual(found, self.project)

    def test_falls_back_to_name_search_when_parameter_points_nowhere(self):
        self.env["ir.config_parameter"].sudo().set_param(
            "ocleaneo_mobile_pointage.project_id", "999999999"
        )
        found = self.controller._get_project_pointage_chantiers(self.env, self.company.id)
        self.assertEqual(found, self.project)
