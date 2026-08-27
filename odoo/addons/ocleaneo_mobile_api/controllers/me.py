# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import logging
from odoo import http
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
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
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
            # No date filter, deliberately — the same trap already fixed in
            # ocleaneo_mobile_pointage._manage_timesheet(), which this had
            # escaped. Filtering on `date = attendances.check_in.date()`
            # compares a UTC date against a field that
            # project_timesheet_time_control rewrites from date_time using
            # fields.Date.context_today, i.e. in the *worker's* timezone.
            # For a shift starting at 23:30 UTC (00:30 in Paris) the two
            # differ by a day and the search matches nothing: the worker is
            # clocked in on a job, and current_fsm_order_id comes back
            # False. Reproduced on a live Odoo 14 — exactly the night and
            # pre-dawn crews this app is for.
            #
            # The open attendance above already establishes that the worker
            # is on the clock; the still-running line (unit_amount = 0) is
            # the job they are on, whichever calendar day it was opened.
            ts = Timesheet.search([
                ("employee_id", "=", employee.id),
                ("fsm_order_id", "!=", False),
                ("unit_amount", "=", 0),
            ], limit=1, order="date_time desc")
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
