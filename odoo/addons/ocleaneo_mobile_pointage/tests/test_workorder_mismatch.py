# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""_warn_if_workorder_date_mismatch: alerting a manager when a clocking
lands on a different day than its own workorder's schedule — e.g. a
monthly job ("vitres 1x/mois") actually done on a day other than the one
fsm.recurring picked when it pre-generated the order.
"""

from datetime import datetime

from odoo.addons.ocleaneo_mobile_pointage.controllers.pointage import (
    MobilePointageController,
)

from .common import MobilePointageCommon


class TestWorkorderDateMismatch(MobilePointageCommon):

    def setUp(self):
        super().setUp()
        self.controller = MobilePointageController()
        self.manager_user, self.manager_employee, _ = self._make_worker(
            "Manager Un", "manager.un@test.example"
        )
        self.employee.parent_id = self.manager_employee

    def _warn(self, scheduled, now):
        self.order.scheduled_date_start = scheduled
        self.controller._warn_if_workorder_date_mismatch(
            self.env, self.order, self.employee, now
        )

    def _pending_activity(self):
        return self.env["mail.activity"].search([
            ("res_model", "=", "fsm.order"),
            ("res_id", "=", self.order.id),
        ])

    def test_same_day_is_not_flagged(self):
        now = datetime(2026, 3, 10, 8, 0, 0)
        self._warn(scheduled=now, now=now)

        self.assertFalse(self._pending_activity())

    def test_same_month_different_day_is_flagged_with_activity_and_chatter(self):
        """The 'vitres 1x/mois' case: scheduled on the 3rd, actually done on the 24th."""
        scheduled = datetime(2026, 3, 3, 8, 0, 0)
        now = datetime(2026, 3, 24, 9, 0, 0)
        self._warn(scheduled, now)

        activity = self._pending_activity()
        self.assertEqual(len(activity), 1)
        self.assertEqual(activity.user_id, self.manager_user)
        self.assertIn(self.order.name, activity.note)

        messages = self.order.message_ids.filtered(lambda m: "pointé son arrivée" in (m.body or ""))
        self.assertTrue(messages, "a chatter note must be posted on the workorder")

    def test_a_few_days_into_next_month_is_flagged(self):
        """Scheduled on the last day of the month, done a few days into the next one."""
        scheduled = datetime(2026, 3, 31, 8, 0, 0)
        now = datetime(2026, 4, 3, 8, 0, 0)
        self._warn(scheduled, now)

        self.assertEqual(len(self._pending_activity()), 1)

    def test_far_outside_the_window_is_not_flagged(self):
        """A different month, well beyond the surrounding-days window: unrelated."""
        scheduled = datetime(2026, 1, 5, 8, 0, 0)
        now = datetime(2026, 3, 10, 8, 0, 0)
        self._warn(scheduled, now)

        self.assertFalse(self._pending_activity())

    def test_no_scheduled_date_is_not_flagged(self):
        self.order.scheduled_date_start = False
        self.controller._warn_if_workorder_date_mismatch(
            self.env, self.order, self.employee, datetime(2026, 3, 10, 8, 0, 0)
        )

        self.assertFalse(self._pending_activity())

    def test_without_a_manager_only_the_chatter_note_is_posted(self):
        self.employee.parent_id = False
        scheduled = datetime(2026, 3, 3, 8, 0, 0)
        now = datetime(2026, 3, 24, 8, 0, 0)
        self._warn(scheduled, now)

        self.assertFalse(self._pending_activity(), "no manager to assign — no activity")
        messages = self.order.message_ids.filtered(lambda m: "pointé son arrivée" in (m.body or ""))
        self.assertTrue(messages, "the chatter note is still posted without a manager")

    def test_a_second_mismatch_on_the_same_order_does_not_duplicate_the_activity(self):
        scheduled = datetime(2026, 3, 3, 8, 0, 0)
        self._warn(scheduled, now=datetime(2026, 3, 20, 8, 0, 0))
        self._warn(scheduled, now=datetime(2026, 3, 24, 8, 0, 0))

        self.assertEqual(
            len(self._pending_activity()), 1,
            "an already-pending alert for this order must not be duplicated",
        )

