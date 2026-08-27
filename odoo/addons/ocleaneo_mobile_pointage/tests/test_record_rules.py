# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""What the record rules on ocleaneo.mobile.pointage must do — and must not.

Two failures, both measured on a live Odoo 14, motivate this file.

1. The manager ACL was a dead letter. Group rules combine as
   AND(global, OR(group rules)) — see ir_rule._compute_domain. The
   "own clockings only" rule was attached to base.group_user and was the
   *only* rule on the model, so it applied to managers too: they are
   members of base.group_user like everyone else. The manager ACL granted
   full access and the rule took all of it back — a Settings user and an
   Attendance manager each saw 0 clockings out of 2. This model exists to
   let someone check payroll, and nobody could.

2. The worker-facing reads in the controllers ran under sudo(), which
   bypasses rules entirely. The rule was therefore decorative: the only
   thing keeping one worker out of another's clockings was the
   `("user_id", "=", user.id)` term written by hand in each route. Those
   reads no longer use sudo, so the rule is now load-bearing — and these
   tests fail if it stops being.

A note for whoever tries to extend this: an ir.rule CANNOT express "this
user sees less when the request comes through the mobile API".
ir_rule._eval_context deliberately passes `user` with an empty context
("to make the domain evaluation independent from the context"), so a rule
has no way to know the channel. Restricting a shared model through a rule
restricts it everywhere, backoffice included — which is exactly the
regression that had to be removed from res.users (see
ocleaneo_mobile_api/tests/test_security.py). Scope the mobile API in its
controllers; use rules only for things that are true on every channel.
"""

from odoo.exceptions import AccessError

from .common import MobilePointageCommon


class TestPointageRecordRules(MobilePointageCommon):

    def setUp(self):
        super().setUp()
        self.other_user, self.other_employee, _p = self._make_worker(
            "Worker Deux", "worker.deux@test.example"
        )
        Pointage = self.env["ocleaneo.mobile.pointage"]
        self.mine = Pointage.create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "type": "arrivee",
            "datetime": "2026-03-10 07:00:00",
            "company_id": self.company.id,
        })
        self.theirs = Pointage.create({
            "user_id": self.other_user.id,
            "employee_id": self.other_employee.id,
            "type": "arrivee",
            "datetime": "2026-03-10 08:00:00",
            "company_id": self.company.id,
        })

    def _as(self, user):
        return self.env(user=user.id)["ocleaneo.mobile.pointage"]

    def _grant(self, user, xmlid):
        user.write({"groups_id": [(4, self.env.ref(xmlid).id)]})
        return user

    # --- workers ---------------------------------------------------------

    def test_a_worker_sees_only_their_own_clockings(self):
        visible = self._as(self.user).search([])
        self.assertIn(self.mine, visible)
        self.assertNotIn(self.theirs, visible)

    def test_a_worker_cannot_read_another_workers_clocking_by_id(self):
        """Knowing the id must not be enough — ids are guessable.

        invalidate_cache() is not decoration. Odoo's ORM cache is shared
        by every environment in a transaction, so the value setUp() wrote
        while creating the record is still there, and reading it back as
        another user is served from cache without ever touching the
        database — no query, no rule, no error. Without this line the test
        passes whether or not the rule exists, which makes it worse than
        no test at all.
        """
        self.theirs.invalidate_cache()
        with self.assertRaises(AccessError):
            self._as(self.user).browse(self.theirs.id).type

    def test_a_worker_cannot_write_another_workers_clocking(self):
        with self.assertRaises(AccessError):
            self._as(self.user).browse(self.theirs.id).write({"commentaire": "x"})

    # --- managers --------------------------------------------------------

    def test_an_attendance_manager_sees_every_clocking(self):
        """The regression this file exists for: they used to see none."""
        manager = self._grant(
            self.other_user, "hr_attendance.group_hr_attendance_manager"
        )
        visible = self._as(manager).search([])
        self.assertIn(self.mine, visible)
        self.assertIn(self.theirs, visible)

    def test_a_settings_user_sees_every_clocking(self):
        manager = self._grant(self.other_user, "base.group_system")
        visible = self._as(manager).search([])
        self.assertIn(self.mine, visible)
        self.assertIn(self.theirs, visible)

    def test_granting_a_manager_group_does_not_narrow_anyone(self):
        """Guards the OR semantics the manager rule relies on.

        Group rules are OR'ed, so the permissive manager rule must widen a
        manager's view without touching a plain worker's. If someone later
        turns it into a global (groupless) rule, it would be AND'ed instead
        and this pairing is what would notice.
        """
        self._grant(self.other_user, "hr_attendance.group_hr_attendance_manager")
        worker_visible = self._as(self.user).search([])
        self.assertIn(self.mine, worker_visible)
        self.assertNotIn(self.theirs, worker_visible)
