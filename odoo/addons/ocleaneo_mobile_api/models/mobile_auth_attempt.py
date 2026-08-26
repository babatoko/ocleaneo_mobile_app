# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import logging
import os
from datetime import timedelta

from odoo import api, fields, models

_logger = logging.getLogger(__name__)

# Failed credential attempts allowed per key within the window before the
# key is refused. Env-configurable like the rest of this module's tunables
# (see tools/mobile_auth.py, models/hr_employee.py).
MAX_ATTEMPTS = int(os.environ.get("OCLEANEO_MOBILE_AUTH_MAX_ATTEMPTS", "10"))

# The per-address budget is deliberately looser than the per-credential
# one: a whole crew commonly shares a single connection (site wifi, 4G
# NAT), so a strict address limit would lock out colleagues of whoever
# mistyped. Its job is to stop enumeration across many credentials, not to
# police one worker's typing.
MAX_IP_ATTEMPTS = int(os.environ.get("OCLEANEO_MOBILE_AUTH_MAX_IP_ATTEMPTS", "50"))

WINDOW_MINUTES = int(os.environ.get("OCLEANEO_MOBILE_AUTH_WINDOW_MINUTES", "15"))

# Attempts are kept a while past the window so an operator can still see a
# burst after the fact; the autovacuum below drops anything older.
RETENTION_HOURS = int(os.environ.get("OCLEANEO_MOBILE_AUTH_RETENTION_HOURS", "24"))


class MobileAuthAttempt(models.Model):
    """Failed authentication attempts against the mobile API.

    Relationship with Odoo's own login cooldown
    -------------------------------------------
    res.users._assert_can_auth() already throttles repeated failures
    (`base.login_cooldown_after`, 10 by default, then
    `base.login_cooldown_duration` seconds). It is not a substitute here:

    - It only guards res.users.authenticate(). /api/mobile/auth/login_badge
      never calls it, so the single-factor endpoint — the most exposed one
      — gets no native protection at all.
    - It buckets by source address only, so it cannot slow a stuffing run
      spread across addresses against one account.
    - Its counter lives in process memory. Odoo's own docstring calls this
      out ("not shared between workers") and points at a database-backed
      strategy for anything stronger; with N workers the effective budget
      is N times the configured one, and a restart clears it.

    So /api/mobile/auth/login ends up guarded twice, which is harmless, and
    login_badge is guarded once — by this.

    Storage
    -------
    A row is written only on *failure*, so the normal path costs nothing.
    Keys are namespaced by scope ("login", "badge", "ip") so that limiting
    a credential and limiting a source address stay independent: throttling
    only by credential would let anyone lock a colleague out of the app by
    failing on their behalf, and throttling only by address would miss
    credential stuffing spread across many addresses.
    """

    _name = "ocleaneo.mobile.auth.attempt"
    _description = "Mobile API failed authentication attempt"
    _order = "create_date desc"
    _rec_name = "key"

    scope = fields.Selection(
        [("login", "Login"), ("badge", "Badge"), ("ip", "IP address")],
        required=True,
        index=True,
    )
    key = fields.Char(required=True, index=True)
    ip = fields.Char(string="Source address")

    @api.model
    def _window_start(self):
        return fields.Datetime.now() - timedelta(minutes=WINDOW_MINUTES)

    @api.model
    def _limit_for_scope(self, scope):
        return MAX_IP_ATTEMPTS if scope == "ip" else MAX_ATTEMPTS

    @api.model
    def is_rate_limited(self, scope, key):
        """True when this key has burnt its attempt budget for the window."""
        if not key:
            return False
        return self.sudo().search_count([
            ("scope", "=", scope),
            ("key", "=", key),
            ("create_date", ">=", self._window_start()),
        ]) >= self._limit_for_scope(scope)

    @api.model
    def record_failure(self, scope, key, ip=None):
        if not key:
            return
        self.sudo().create({"scope": scope, "key": key, "ip": ip})

    @api.model
    def clear(self, scope, key):
        """Drop a key's history — called on a successful authentication so a
        worker who simply mistyped is not still throttled afterwards."""
        if not key:
            return
        self.sudo().search([("scope", "=", scope), ("key", "=", key)]).unlink()

    @api.autovacuum
    def _gc_mobile_auth_attempts(self):
        stale = self.sudo().search([
            ("create_date", "<", fields.Datetime.now() - timedelta(hours=RETENTION_HOURS)),
        ])
        if stale:
            _logger.info("Garbage-collecting %s stale mobile auth attempts", len(stale))
            stale.unlink()
