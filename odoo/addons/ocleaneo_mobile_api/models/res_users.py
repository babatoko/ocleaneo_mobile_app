# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import api, fields, models, _
from odoo.exceptions import AccessDenied
from datetime import timedelta
import os
import secrets
import hashlib

# Mobile API token lifetime. Configurable via environment variable, same
# pattern as MOBILE_CORS_ORIGIN (see tools/mobile_auth.py) — no code change
# needed to tighten/loosen it per environment.
MOBILE_TOKEN_TTL_DAYS = int(os.environ.get("OCLEANEO_MOBILE_TOKEN_TTL_DAYS", "30"))


class ResUsers(models.Model):
    _inherit = "res.users"

    mobile_api_token = fields.Char(
        string="Mobile API Token",
        copy=False,
        help="Token used by the mobile app to authenticate API calls.",
    )
    mobile_api_token_expire = fields.Datetime(
        string="Mobile API Token Expiry",
        copy=False,
    )

    def generate_mobile_api_token(self):
        """Generate a new token and invalidate the old one."""
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        self.mobile_api_token = token_hash
        self.mobile_api_token_expire = fields.Datetime.now() + timedelta(days=MOBILE_TOKEN_TTL_DAYS)
        return token

    def verify_mobile_api_token(self, token):
        """Verify a raw token against the stored hash."""
        if not self.mobile_api_token:
            return False
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        return secrets.compare_digest(self.mobile_api_token, token_hash)

    def invalidate_mobile_api_token(self):
        """Revoke the current token."""
        self.mobile_api_token = False
        self.mobile_api_token_expire = False

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
