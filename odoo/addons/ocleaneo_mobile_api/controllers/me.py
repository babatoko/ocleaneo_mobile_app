# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import logging
from odoo import http, _
from odoo.http import request

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import (
    MOBILE_CORS_ORIGIN,
    authenticate_mobile_request,
)

_logger = logging.getLogger(__name__)


class MobileMeController(http.Controller):

    @http.route("/api/mobile/me", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def me(self, **kwargs):
        """Return current user/employee profile with open attendance and current FSM order."""
        user = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        employee = user.get_employee_for_mobile()
        company = user.company_id

        attendances = False
        if employee:
            attendances = env["hr.attendance"].sudo().search([
                ("employee_id", "=", employee.id),
                ("check_out", "=", False),
            ], limit=1)

        current_fsm_order = False
        if employee and attendances:
            Timesheet = env["account.analytic.line"].sudo()
            ts = Timesheet.search([
                ("employee_id", "=", employee.id),
                ("date", "=", attendances.check_in.date()),
                ("fsm_order_id", "!=", False),
                ("unit_amount", "=", 0),
            ], limit=1)
            if ts and ts.fsm_order_id:
                current_fsm_order = ts.fsm_order_id

        return {
            "user_id": user.id,
            "user_login": user.login,
            "user_name": user.name,
            "company_id": company.id,
            "company_name": company.name,
            "employee_id": employee.id if employee else False,
            "employee_name": employee.name if employee else False,
            "current_attendance_id": attendances.id if attendances else False,
            "current_fsm_order_id": current_fsm_order.id if current_fsm_order else False,
        }
