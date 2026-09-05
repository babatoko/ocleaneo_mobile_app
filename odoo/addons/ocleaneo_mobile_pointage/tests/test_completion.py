# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Tests for the completion-ratio rule applied on 'depart'.

Before fsm_order.update_completion_from_worked_time() existed, a 'depart'
clocking unconditionally closed the FSM order — clocking in and immediately
back out marked a job "Completed" the same as an honest full visit. These
tests pin the replacement rule: worked time vs scheduled_duration, with the
order closed only once at least 90% of the planned time was actually spent
on site, left fully open below 10%, and merely flagged (not closed) with a
manager alert in between.
"""

from .common import MobilePointageCommon
from .test_api import MobileRpcMixin
from odoo.tests.common import HttpCase

PASSWORD = "TestPass123!"


class TestFsmOrderCompletion(MobileRpcMixin, MobilePointageCommon, HttpCase):

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.user.flush()
        self.order.scheduled_duration = 2.0  # 2h planned
        # Odoo's native login cooldown (_assert_can_auth) counts failures in
        # *process memory*, not per-transaction — see test_api.py's
        # TestMobileAuthFailures docstring. That class deliberately fails
        # logins on purpose and normally runs before this one in the same
        # process; without disabling the cooldown here too, its leftover
        # failure count blocks the very first _login() below with a 429
        # that has nothing to do with what this test is checking.
        self.env["ir.config_parameter"].sudo().set_param("base.login_cooldown_after", "0")

        self.manager_user, self.manager_employee, _person = self._make_worker(
            "Manager Un", "manager.un@test.example"
        )
        self.employee.parent_id = self.manager_employee.id

    def _login(self):
        return self._result(
            "auth/login",
            {"login": self.user.login, "password": PASSWORD},
        )["token"]

    def _clock(self, token, type_, at):
        return self._result("pointage", {
            "type": type_,
            "fsm_order_id": self.order.id,
            "datetime": at,
        }, token=token)

    def test_below_10_percent_leaves_the_order_open_and_not_done(self):
        """5 minutes out of 2h planned (~4%) — the job was not done."""
        token = self._login()
        self._clock(token, "arrivee", "2026-03-10T08:00:00")
        stage_before = self.order.stage_id
        self._clock(token, "depart", "2026-03-10T08:05:00")

        self.order.invalidate_cache()
        self.assertEqual(self.order.completion_state, "not_done")
        self.assertEqual(self.order.stage_id, stage_before)
        self.assertFalse(self.order.stage_id.is_closed)

    def test_between_10_and_90_percent_is_partial_and_alerts_the_manager(self):
        """1h out of 2h planned (50%) — partially done, order stays open."""
        token = self._login()
        self._clock(token, "arrivee", "2026-03-10T08:00:00")
        stage_before = self.order.stage_id
        self._clock(token, "depart", "2026-03-10T09:00:00")

        self.order.invalidate_cache()
        self.assertEqual(self.order.completion_state, "partial")
        self.assertAlmostEqual(self.order.completion_ratio, 0.5, places=2)
        self.assertEqual(
            self.order.stage_id, stage_before,
            "a partially-completed job must not be closed",
        )

        activity = self.env["mail.activity"].search([
            ("res_model", "=", "fsm.order"),
            ("res_id", "=", self.order.id),
        ])
        self.assertTrue(activity, "the manager must get an activity to review")
        self.assertEqual(activity.user_id, self.manager_user)

        self.assertTrue(
            any("fait partiellement" in (m.body or "") for m in self.order.message_ids),
            "the chatter must carry a note explaining the partial completion",
        )

    def test_90_percent_or_more_closes_the_order(self):
        """1h54 out of 2h planned (95%) — done, closed like a full visit."""
        token = self._login()
        self._clock(token, "arrivee", "2026-03-10T08:00:00")
        self._clock(token, "depart", "2026-03-10T09:54:00")

        self.order.invalidate_cache()
        self.assertEqual(self.order.completion_state, "done")
        self.assertTrue(self.order.stage_id.is_closed)

    def test_no_scheduled_duration_keeps_the_old_always_close_behavior(self):
        """An order with nothing to compare worked time against must not be
        stuck open forever for lack of data — same as before this rule."""
        self.order.scheduled_duration = 0.0
        token = self._login()
        self._clock(token, "arrivee", "2026-03-10T08:00:00")
        self._clock(token, "depart", "2026-03-10T08:05:00")

        self.order.invalidate_cache()
        self.assertEqual(self.order.completion_state, "done")
        self.assertTrue(self.order.stage_id.is_closed)
