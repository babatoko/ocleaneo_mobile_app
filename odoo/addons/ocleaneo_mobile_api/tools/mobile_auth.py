# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Shared authentication helpers for every /api/mobile/* controller.

Previously each controller (auth.py, me.py, pointage.py, planning.py)
carried its own verbatim copy of the Bearer-token lookup and its own
hardcoded CORS origin. Centralizing them here means a fix (e.g. enforcing
token expiry) only has to be made once.
"""

import logging
import os

import odoo
from odoo import fields
from odoo.http import request

_logger = logging.getLogger(__name__)

# Origin allowed for CORS on the mobile API. Configurable via environment
# variable so dev/staging/prod can each set their own value without a code
# change — the same pattern the frontend uses for its own runtime
# configuration (see frontend/.env.example and docker-compose.yml).
MOBILE_CORS_ORIGIN = os.environ.get("OCLEANEO_MOBILE_CORS_ORIGIN", "http://127.0.0.1:5173")


def request_ip():
    """Source address of the current request, honouring a reverse proxy.

    Odoo is normally deployed behind nginx, where remote_addr is the proxy
    itself — every request would then share one rate-limit bucket. Trust
    X-Forwarded-For only when Odoo is configured to run behind a proxy
    (`--proxy-mode`), because a client can otherwise forge that header at
    will and trivially escape the limit by rotating it.
    """
    httprequest = request.httprequest
    if odoo.tools.config.get("proxy_mode"):
        forwarded = httprequest.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return httprequest.remote_addr


def check_auth_rate_limit(env, scope, key):
    """Return an error payload when `key` (or this source address) has burnt
    its budget of failed attempts, otherwise None.

    Applied to the credential endpoints (login, login_badge) only. Token
    verification is deliberately not throttled: a mobile API token carries
    256 bits of entropy, so guessing one is not a realistic attack, while
    writing a row per unauthenticated request would hand anyone an easy way
    to flood the table.
    """
    Attempt = env["ocleaneo.mobile.auth.attempt"].sudo()
    ip = request_ip()
    for check_scope, check_key in ((scope, key), ("ip", ip)):
        if Attempt.is_rate_limited(check_scope, check_key):
            _logger.warning(
                "Mobile auth rate limit hit on %s (ip=%s)", check_scope, ip
            )
            return {
                "error": "too many attempts, try again later",
                "code": 429,
            }
    return None


def record_auth_failure(env, scope, key):
    Attempt = env["ocleaneo.mobile.auth.attempt"].sudo()
    ip = request_ip()
    Attempt.record_failure(scope, key, ip=ip)
    Attempt.record_failure("ip", ip, ip=ip)


def clear_auth_failures(env, scope, key):
    """Reset the credential's budget after it authenticated successfully.

    Only the credential bucket is cleared, never the address one. An
    attacker holding one valid account would otherwise reset the address
    budget at will — log in as themselves whenever they approach the
    limit — and enumerate other credentials from the same address
    indefinitely. The address budget decays with time only.
    """
    env["ocleaneo.mobile.auth.attempt"].sudo().clear(scope, key)


def authenticate_mobile_request():
    """Verify the Authorization: Bearer *** header (or legacy
    X-Mobile-Token) against stored mobile API tokens.

    The token is stored on hr.employee (see models/hr_employee.py), not
    res.users — res.users only carries login/password/rights. Returns
    (user, employee) for the matching, non-expired employee, resolved back
    to its linked res.users via employee.user_id (required: an employee
    without a direct user_id link cannot authenticate here — see
    controllers/auth.py's login() for why that link is enforced at token
    issuance time). Returns (None, None) if authentication fails for any
    reason.
    """
    auth_header = request.httprequest.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    # Fallback for legacy X-Mobile-Token during transition
    if not token:
        token = request.httprequest.headers.get("X-Mobile-Token", "")
    if not token:
        return None, None

    env = request.env
    now = fields.Datetime.now()
    # Narrow via the indexed token prefix (see hr_employee.py) instead of
    # scanning + hashing every employee that has ever had a token — turns
    # an O(n) scan into an indexed lookup that returns essentially one row.
    employees = env["hr.employee"].sudo().search([
        ("mobile_api_token_index", "=", token[:8]),
        ("mobile_api_token", "!=", False),
    ])
    for employee in employees:
        if not employee.verify_mobile_api_token(token):
            continue
        if employee.mobile_api_token_expire and employee.mobile_api_token_expire < now:
            continue
        if not employee.user_id:
            return None, None
        return employee.user_id, employee
    return None, None
