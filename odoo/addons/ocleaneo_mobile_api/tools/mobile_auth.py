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
#
# odoo/http.py sets Access-Control-Allow-Origin to this cors= value
# verbatim, with no matching against a list — a deployment can only ever
# allow ONE of "packaged native app" or "Vite dev server / PWA" without
# setting this variable, never both at once.
#
# The default targets the packaged native app: Capacitor's Android WebView
# is a real Chromium engine and DOES enforce CORS like any browser (see
# @capacitor/android's CapConfig.java — default hostname "localhost",
# androidScheme "https", unchanged by this project's capacitor.config.json),
# so its origin is exactly https://localhost. An earlier version of this
# comment claimed the opposite ("a WebView does not enforce CORS at all")
# and defaulted to the Vite dev origin instead — on any deployment that
# never set this variable, including production, every preflight from the
# real app was silently rejected. Nothing about that failure is
# distinguishable from a genuine network outage on the JS side (see
# frontend services/errorLog.ts / OdooProvider.ts, where the axios error
# this produces is the generic ERR_NETWORK), so it went undiagnosed for a
# while: reachability, DNS and TLS all checked out fine, because the
# request was never actually rejected by the network — it was rejected by
# the browser itself, before being sent, on the strength of this exact
# mismatch.
#
# Running the Vite dev server against this backend still needs the
# variable set explicitly (http://127.0.0.1:5173, or the PWA's own site
# origin) — the trade-off is deliberate: a developer notices and fixes a
# blocked dev request at their desk in seconds; a field employee locked
# out of login has no such feedback loop.
NATIVE_APP_ORIGIN = "https://localhost"
MOBILE_CORS_ORIGIN = os.environ.get("OCLEANEO_MOBILE_CORS_ORIGIN", NATIVE_APP_ORIGIN)

if MOBILE_CORS_ORIGIN == NATIVE_APP_ORIGIN:
    logging.getLogger(__name__).warning(
        "OCLEANEO_MOBILE_CORS_ORIGIN is unset; /api/mobile/* allows the "
        "packaged native app's origin (%s) only. Set it explicitly to run "
        "the Vite dev server (http://127.0.0.1:5173) or a PWA (the site's "
        "own origin) against this backend.",
        NATIVE_APP_ORIGIN,
    )


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


# --- API versioning -------------------------------------------------------
#
# Aucune route n'etait versionnee. Ce n'est pas un probleme tant que le seul
# client est celui qu'on livre en meme temps que le serveur — mais
# l'application s'installe sur les telephones des salaries et se met a jour a
# LEUR rythme, pas a celui du serveur. Le jour ou une reponse doit changer de
# forme, anciens et nouveaux clients coexistent pendant des semaines, et sans
# version dans le chemin il ne reste que deux options : casser le terrain, ou
# ne plus jamais faire evoluer un contrat.
#
# Le versionnement est pose MAINTENANT, avant tout deploiement, parce que
# c'est le seul moment ou il ne coute rien. Aucune application n'est installee
# aujourd'hui : il n'y a donc aucun alias non versionne a maintenir, et
# `mobile_routes()` ne rend qu'un seul chemin. Le jour ou une v2 sera
# necessaire, c'est a ce moment-la que les deux versions cohabiteront — et le
# mecanisme sera deja en place.
#
# /api/mobile/config annonce `api_version` et `supported_versions` pour qu'un
# client sache a quoi il parle sans le deduire d'un 404.
API_VERSION = "v1"
SUPPORTED_VERSIONS = [API_VERSION]


def mobile_routes(path):
    """Return the route list for one mobile endpoint.

    `path` is the part after /api/mobile — e.g. "planning" or "auth/login".
    Une liste (et non une chaine) parce qu'une future v2 devra servir deux
    versions en parallele : la forme du retour n'aura pas a changer, seul son
    contenu.
    """
    path = path.strip("/")
    return ["/api/mobile/%s/%s" % (API_VERSION, path)]
