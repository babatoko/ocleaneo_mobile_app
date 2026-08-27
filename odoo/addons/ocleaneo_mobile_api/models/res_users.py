# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import models


class ResUsers(models.Model):
    _inherit = "res.users"

    # res.users stays scoped to access control: login, password, groups
    # and rights. Mobile-app credentials (API token, and — like the
    # standard pin/barcode fields — any other worker-identification value)
    # live on hr.employee instead; see models/hr_employee.py.

    def get_employee_for_mobile(self):
        """Resolve hr.employee from the user, using partner/worker chain fallback."""
        Employee = self.env["hr.employee"].sudo()
        # 1. Direct link user_id
        if self.id:
            employee = Employee.search([("user_id", "=", self.id)], limit=1)
            if employee:
                return employee
        # 2. Via partner_id -> fsm.person -> hr.employee
        if self.partner_id:
            FsmPerson = self.env["fsm.person"].sudo()
            person = FsmPerson.search([("partner_id", "=", self.partner_id.id)], limit=1)
            if person and person.employee_id:
                return person.employee_id
            # Direct link partner -> employee
            employee = Employee.search([("address_home_id", "=", self.partner_id.id)], limit=1)
            if employee:
                return employee
        return Employee.browse()
