# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import http

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import (
    MOBILE_CORS_ORIGIN,
    authenticate_mobile_request,
    mobile_routes,
)
from odoo.addons.ocleaneo_mobile_tag_commissioning.tools.commissioning import (
    commission_tag,
)
from odoo.addons.ocleaneo_mobile_tag_commissioning.tools.commissioning import (
    FLAG_TECHNICAL_NAME,
)


class MobileTagCommissioning(http.Controller):

    @http.route(
        mobile_routes("tags/commission"),
        type="json",
        auth="none",
        methods=["POST"],
        csrf=False,
        cors=MOBILE_CORS_ORIGIN,
    )
    def commission(self, **kwargs):
        """Enroll one NFC tag scanned by a field agent.

        The feature flag is enforced HERE, at the route: hiding the screen
        in the app is cosmetic; this membership test on the resolved
        module list is the actual access control (see
        mobile.module.config.get_modules_for_user — the same list the
        app's home screen is gated on).

        Idempotent by design: scanning an already-known badge (any state)
        returns its record with existing=true and creates nothing.
        """
        user, employee = authenticate_mobile_request()
        if not user or not employee:
            return {"error": "unauthorized", "code": 401}

        env = http.request.env
        config = env["mobile.module.config"].sudo().search([
            ("technical_name", "=", FLAG_TECHNICAL_NAME),
            ("company_id", "in", [user.company_id.id] + user.company_ids.ids),
        ], limit=1)
        if not config or not config.get_active_flag(user, FLAG_TECHNICAL_NAME):
            return {"error": "feature not available", "code": 403}

        raw_uid = (kwargs.get("uid") or "").strip()
        if not raw_uid:
            return {"error": "uid required", "code": 400}

        tag, existing = commission_tag(env, employee, raw_uid)
        if not tag:
            return {"error": "invalid uid", "code": 400}

        return {
            "id": tag.id,
            "name": tag.name,
            "uid": tag.uid,
            "state": tag.state,
            "existing": existing,
            "company_id": tag.company_id.id,
        }