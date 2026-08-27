# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Tests for the failed-authentication rate limiter."""

from datetime import timedelta

from odoo import fields
from odoo.addons.ocleaneo_mobile_api.models.mobile_auth_attempt import (
    MAX_ATTEMPTS,
    MAX_IP_ATTEMPTS,
    WINDOW_MINUTES,
)
from odoo.tests.common import TransactionCase


class TestMobileAuthAttempt(TransactionCase):

    def setUp(self):
        super().setUp()
        self.Attempt = self.env["ocleaneo.mobile.auth.attempt"]

    def _fail(self, times, scope="login", key="victim@test.example"):
        for _ in range(times):
            self.Attempt.record_failure(scope, key, ip="10.0.0.1")

    def test_under_the_limit_is_not_throttled(self):
        self._fail(MAX_ATTEMPTS - 1)
        self.assertFalse(self.Attempt.is_rate_limited("login", "victim@test.example"))

    def test_reaching_the_limit_throttles(self):
        self._fail(MAX_ATTEMPTS)
        self.assertTrue(self.Attempt.is_rate_limited("login", "victim@test.example"))

    def test_throttling_is_scoped_to_the_key(self):
        """One account burning its budget must not lock out another."""
        self._fail(MAX_ATTEMPTS, key="victim@test.example")
        self.assertFalse(self.Attempt.is_rate_limited("login", "someone.else@test.example"))

    def test_scopes_are_independent(self):
        """A login key and a badge key never share a bucket."""
        self._fail(MAX_ATTEMPTS, scope="login", key="shared-value")
        self.assertFalse(self.Attempt.is_rate_limited("badge", "shared-value"))

    def test_attempts_outside_the_window_do_not_count(self):
        self._fail(MAX_ATTEMPTS)
        self.assertTrue(self.Attempt.is_rate_limited("login", "victim@test.example"))

        # Age every attempt past the window. create_date is readonly through
        # the ORM, so this rewrites it directly.
        self.env.cr.execute(
            "UPDATE ocleaneo_mobile_auth_attempt SET create_date = %s",
            (fields.Datetime.now() - timedelta(minutes=WINDOW_MINUTES + 1),),
        )
        self.Attempt.invalidate_cache()

        self.assertFalse(self.Attempt.is_rate_limited("login", "victim@test.example"))

    def test_clear_resets_the_budget(self):
        """A worker who simply mistyped must not stay throttled after a
        successful login."""
        self._fail(MAX_ATTEMPTS)
        self.Attempt.clear("login", "victim@test.example")
        self.assertFalse(self.Attempt.is_rate_limited("login", "victim@test.example"))

    def test_empty_key_is_never_throttled_and_records_nothing(self):
        before = self.Attempt.search_count([])
        self.Attempt.record_failure("login", False, ip="10.0.0.1")
        self.assertFalse(self.Attempt.is_rate_limited("login", False))
        self.assertEqual(self.Attempt.search_count([]), before)

    def test_address_budget_is_looser_than_the_credential_budget(self):
        """A shared connection (site wifi, 4G NAT) must not lock a crew out
        as fast as a single account gets locked."""
        self.assertGreater(MAX_IP_ATTEMPTS, MAX_ATTEMPTS)

        self._fail(MAX_ATTEMPTS, scope="ip", key="10.0.0.1")
        self.assertFalse(self.Attempt.is_rate_limited("ip", "10.0.0.1"))

        self._fail(MAX_IP_ATTEMPTS - MAX_ATTEMPTS, scope="ip", key="10.0.0.1")
        self.assertTrue(self.Attempt.is_rate_limited("ip", "10.0.0.1"))

    def test_autovacuum_drops_stale_attempts_only(self):
        self._fail(3, key="old@test.example")
        self.env.cr.execute(
            "UPDATE ocleaneo_mobile_auth_attempt SET create_date = %s",
            (fields.Datetime.now() - timedelta(days=30),),
        )
        self.Attempt.invalidate_cache()
        self._fail(2, key="recent@test.example")

        self.Attempt._gc_mobile_auth_attempts()

        self.assertEqual(
            self.Attempt.search_count([("key", "=", "old@test.example")]), 0
        )
        self.assertEqual(
            self.Attempt.search_count([("key", "=", "recent@test.example")]), 2
        )
