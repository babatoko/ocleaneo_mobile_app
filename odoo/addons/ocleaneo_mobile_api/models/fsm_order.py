# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import models


class FsmOrder(models.Model):
    _inherit = "fsm.order"

    def get_timesheet_for_mobile(self, employee_id=None, date=None):
        """Return open timesheet entries for this order, optionally filtered by employee/date."""
        Timesheet = self.env["account.analytic.line"].sudo()
        domain = [("fsm_order_id", "=", self.id)]
        if employee_id:
            domain.append(("employee_id", "=", employee_id))
        if date:
            domain.append(("date", "=", date))
        return Timesheet.search(domain)
