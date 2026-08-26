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
        user = authenticate_mobile_request()
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
        token = user.generate_mobile_api_token()

        company = user.company_id
        employee = user.get_employee_for_mobile()
        configs = env["mobile.module.config"].sudo().get_modules_for_user(user)

        return {
            "token": token,
            "user_id": user.id,
            "user_login": user.login,
            "user_name": user.name,
            "company_id": company.id,
            "company_name": company.name,
            "employee_id": employee.id if employee else False,
            "employee_name": employee.name if employee else False,
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
        user = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}
        user.invalidate_mobile_api_token()
        return {"status": "ok"}

    @http.route("/api/mobile/auth/me", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def auth_me(self, **kwargs):
        """Return current user/employee profile (used by mobile app on cold start)."""
        user = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        employee = user.get_employee_for_mobile()
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
