# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import json
import logging
from odoo import http, _
from odoo.http import request
from odoo.exceptions import AccessDenied

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import (
    MOBILE_CORS_ORIGIN,
    authenticate_mobile_request,
)

_logger = logging.getLogger(__name__)


class MobileAuthController(http.Controller):

    @http.route("/api/mobile/config", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def config(self, **kwargs):
        """Return active mobile modules and app-level configuration for the current user."""
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        ModuleConfig = env["mobile.module.config"].sudo()
        configs = ModuleConfig.get_modules_for_user(user)

        return {
            "company_id": user.company_id.id,
            "company_name": user.company_id.name,
            "modules": [c.to_mobile_dict() for c in configs],
        }

    @http.route("/api/mobile/auth/login", type="json", auth="none", methods=["POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def login(self, login=None, password=None, **kwargs):
        """Authenticate user and return a mobile API token."""
        login = kwargs.get("login", login)
        password = kwargs.get("password", password)
        if not login or not password:
            return {"error": "login and password required", "code": 400}

        env = request.env
        try:
            uid = env["res.users"].authenticate(
                request.db, login, password, {"interactive": True}
            )
        except AccessDenied:
            return {"error": "Invalid credentials", "code": 401}
        except Exception as e:
            _logger.exception("Mobile login error: %s", e)
            return {"error": "Authentication failed", "code": 401}

        if not uid:
            return {"error": "Invalid credentials", "code": 401}

        user = env["res.users"].sudo().browse(uid)
        employee = user.get_employee_for_mobile()
        return self._issue_mobile_token(env, user, employee)

    @http.route("/api/mobile/auth/login_badge", type="json", auth="none", methods=["POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def login_badge(self, barcode=None, **kwargs):
        """Authenticate by badge/NFC identifier alone and return a mobile API token.

        The phone itself acts as the badge here (NFC/RFID), identified by
        hr.employee.barcode — the same field Odoo uses for physical badge
        scans elsewhere (Attendance, PoS). This is possession-based, not a
        second factor: unlike login()'s login+password pair, a single
        barcode value is the entire credential. That's an intentional
        product choice for field workers (see odoo/README.md), not an
        oversight — but it does mean whoever holds/knows a valid barcode
        can obtain a full mobile API token for that employee, so treat
        barcode values with the same care as a password, and note that no
        rate-limiting is applied here any more than on login() (see
        odoo/README.md § Comparaison avec res.users.apikeys).
        """
        barcode = kwargs.get("barcode", barcode)
        if not barcode:
            return {"error": "barcode required", "code": 400}

        env = request.env
        # A single match is guaranteed by hr.employee's own SQL constraint
        # (`unique (barcode)`, verified in PostgreSQL) — two employees
        # cannot share a badge, so there is no ambiguity to arbitrate here.
        # search() also filters on active=True, which is what we want: an
        # archived employee's badge stops working, without a special case.
        employee = env["hr.employee"].sudo().search([("barcode", "=", barcode)], limit=1)
        if not employee:
            return {"error": "Invalid badge", "code": 401}
        return self._issue_mobile_token(env, employee.user_id, employee)

    def _issue_mobile_token(self, env, user, employee):
        """Shared by login() and login_badge(): validate the employee/user
        link and issue a mobile API token, or return the matching error.
        """
        if not employee:
            return {"error": "no employee linked to user", "code": 400}
        # The mobile API token lives on hr.employee (see models/hr_employee.py),
        # resolved back to a res.users context via employee.user_id on every
        # later request (tools/mobile_auth.py) — so that link must be the
        # direct one, not one of get_employee_for_mobile()'s fallback paths
        # (fsm.person / address_home_id), which don't guarantee employee.user_id
        # points back at this same user.
        if not employee.user_id or not user or employee.user_id.id != user.id:
            return {
                "error": "employee is not directly linked to a user account (hr.employee.user_id); "
                         "required to issue a mobile API token",
                "code": 400,
            }
        token = employee.generate_mobile_api_token()

        company = user.company_id
        configs = env["mobile.module.config"].sudo().get_modules_for_user(user)

        return {
            "token": token,
            "user_id": user.id,
            "user_login": user.login,
            "user_name": user.name,
            "company_id": company.id,
            "company_name": company.name,
            "employee_id": employee.id,
            "employee_name": employee.name,
            "modules": [c.to_mobile_dict() for c in configs],
        }

    @http.route("/api/mobile/auth/logout", type="json", auth="none", methods=["POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def logout(self, **kwargs):
        """Invalidate the mobile API token used for this request.

        Uses the same Bearer-token authentication as every other mobile
        route (auth="none" + authenticate_mobile_request()) rather than
        Odoo's session-cookie auth="user" — the mobile client never holds
        a web session, only a Bearer token, so auth="user" here made
        logout unreachable from the app.
        """
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}
        employee.invalidate_mobile_api_token()
        return {"status": "ok"}

    @http.route("/api/mobile/auth/me", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def auth_me(self, **kwargs):
        """Return current user/employee profile (used by mobile app on cold start)."""
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        company = user.company_id

        return {
            "user_id": user.id,
            "user_login": user.login,
            "user_name": user.name,
            "company_id": company.id,
            "company_name": company.name,
            "employee_id": employee.id if employee else False,
            "employee_name": employee.name if employee else False,
        }
