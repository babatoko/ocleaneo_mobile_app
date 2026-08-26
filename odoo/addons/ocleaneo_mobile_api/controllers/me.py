# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import logging
from odoo import http, _
from odoo.http import request

_logger = logging.getLogger(__name__)

MOBILE_CORS_ORIGIN = "http://127.0.0.1:5173"


class MobileMeController(http.Controller):

    def _authenticate_mobile(self):
        auth_header = request.httprequest.headers.get("Authorization", "")
        token = ""
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        if not token:
            token = request.httprequest.headers.get("X-Mobile-Token", "")
        if not token:
            return None
        env = request.env
        users = env["res.users"].sudo().search([("mobile_api_token", "!=", False)])
        for user in users:
            if user.verify_mobile_api_token(token):
                return user
        return None

    @http.route("/api/mobile/me", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def me(self, **kwargs):
        """Return current user/employee profile with open attendance and current FSM order."""
        user = self._authenticate_mobile()
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
