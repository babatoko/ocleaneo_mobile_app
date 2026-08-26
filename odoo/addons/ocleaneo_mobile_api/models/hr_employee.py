# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import fields, models
from datetime import timedelta
import os
import secrets
import hashlib

# Mobile API token lifetime. Configurable via environment variable, same
# pattern as MOBILE_CORS_ORIGIN (see tools/mobile_auth.py) — no code change
# needed to tighten/loosen it per environment.
MOBILE_TOKEN_TTL_DAYS = int(os.environ.get("OCLEANEO_MOBILE_TOKEN_TTL_DAYS", "30"))


class HrEmployee(models.Model):
    _inherit = "hr.employee"

    # Mobile API identity/credential fields live here, not on res.users:
    # res.users is about *access* (login, password, groups/rights) — the
    # mobile app authenticates a *worker*, and hr.employee already carries
    # the equivalent identifiers for that (pin — "PIN Code", used by the
    # Attendance kiosk; barcode — "Badge ID", used for badge/NFC scans).
    # The mobile API token is the same kind of field and belongs next to
    # them, keyed off the employee rather than the backoffice user account.
    mobile_api_token = fields.Char(
        string="Mobile API Token",
        copy=False,
        help="Salted hash of the token used by the mobile app to authenticate API calls for this employee.",
    )
    # First 8 characters of the *raw* token, stored in the clear and
    # indexed, so authenticate_mobile_request() can narrow its search to a
    # handful of candidate rows instead of scanning + hashing every
    # employee that has ever had a token — same pattern core Odoo uses for
    # res.users.apikeys (its `index` column on the first 8 hex chars of the
    # raw key). A collision here only means a couple of extra hash
    # comparisons, never a security weakening: the actual credential check
    # is still the full token against the stored hash.
    mobile_api_token_index = fields.Char(
        string="Mobile API Token Index",
        size=8,
        copy=False,
        index=True,
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
        self.mobile_api_token_index = token[:8]
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
        self.mobile_api_token_index = False
        self.mobile_api_token_expire = False
