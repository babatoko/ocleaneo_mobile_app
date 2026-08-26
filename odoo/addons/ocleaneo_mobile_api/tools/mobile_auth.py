# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Shared authentication helpers for every /api/mobile/* controller.

Previously each controller (auth.py, me.py, pointage.py, planning.py)
carried its own verbatim copy of the Bearer-token lookup and its own
hardcoded CORS origin. Centralizing them here means a fix (e.g. enforcing
token expiry) only has to be made once.
"""

import os

from odoo import fields
from odoo.http import request

# Origin allowed for CORS on the mobile API. Configurable via environment
# variable so dev/staging/prod can each set their own value without a code
# change — the same pattern the frontend uses for its own runtime
# configuration (see frontend/.env.example and docker-compose.yml).
MOBILE_CORS_ORIGIN = os.environ.get("OCLEANEO_MOBILE_CORS_ORIGIN", "http://127.0.0.1:5173")


def authenticate_mobile_request():
    """Verify the Authorization: Bearer *** header (or legacy
    X-Mobile-Token) against stored mobile API tokens and return the
    matching, non-expired res.users record — or None.
    """
    auth_header = request.httprequest.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    # Fallback for legacy X-Mobile-Token during transition
    if not token:
        token = request.httprequest.headers.get("X-Mobile-Token", "")
    if not token:
        return None

    env = request.env
    now = fields.Datetime.now()
    users = env["res.users"].sudo().search([("mobile_api_token", "!=", False)])
    for user in users:
        if not user.verify_mobile_api_token(token):
            continue
        if user.mobile_api_token_expire and user.mobile_api_token_expire < now:
            continue
        return user
    return None
