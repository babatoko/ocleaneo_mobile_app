# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import http
from odoo.http import request

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import MOBILE_CORS_ORIGIN


class MobileCorsPreflightController(http.Controller):
    """Answers the CORS preflight (OPTIONS) request that every browser
    sends before a JSON POST to any /api/mobile/* route.

    Every mobile route uses type="json" (JSON-RPC), which in Odoo 14 has
    no CORS preflight support at all: cors=... only adds the
    Access-Control-Allow-Origin header to the *actual* response.
    _is_cors_preflight() — the method that intercepts an OPTIONS request
    and answers it directly — is defined on HttpRequest (type="http") but
    left as `return False` on the base WebRequest class that JsonRequest
    (type="json") inherits without overriding (confirmed by reading Odoo
    14's own odoo/http.py). Simply adding "OPTIONS" to a type="json"
    route's methods doesn't fix this either: JsonRequest.__init__() tries
    to json.loads() the request body before the controller method ever
    runs, and a preflight OPTIONS request has no JSON body — the request
    fails with a 400 before any CORS header is added, instead of the 200
    a preflight needs.

    Confirmed against a live Odoo 14 instance: every /api/mobile/* POST
    from a real browser (not curl, not a native app WebView bypassing
    CORS) was silently unreachable — blocked at the preflight step,
    before the frontend's actual request was ever sent — until this route
    was added.

    The fix is a *separate* type="http" route (HttpRequest does implement
    the preflight short-circuit) matching every /api/mobile/* path via a
    <path:...> converter, OPTIONS only. Werkzeug routes OPTIONS requests
    here rather than to the type="json" routes below (which only declare
    GET/POST), so there's no ambiguity between the two. The handler body
    is never actually reached for a real preflight — HttpRequest.dispatch()
    returns its own 200 with the CORS headers before calling it — it only
    exists because Odoo's routing requires some callable at the path.
    """

    @http.route(
        "/api/mobile/<path:subpath>",
        type="http",
        auth="none",
        methods=["OPTIONS"],
        csrf=False,
        cors=MOBILE_CORS_ORIGIN,
    )
    def mobile_cors_preflight(self, subpath, **kwargs):
        return request.make_response("")
