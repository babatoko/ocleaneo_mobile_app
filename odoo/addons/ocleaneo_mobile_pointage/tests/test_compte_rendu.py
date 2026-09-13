# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""End-to-end tests for POST /pointage/compte-rendu.

A "depart" pointage is always created immediately when the badge is
scanned (see test_attendance.py / test_api.py) — this endpoint only
attaches the end-of-job report (free text + validated activities)
afterwards, on an already-existing pointage. These tests cover that it
never touches a pointage it shouldn't, never writes an activity outside
the pointage's own fsm_order, and alerts the manager (best-effort) when
a required activity is left unvalidated.
"""

from odoo import fields

from .test_api import MobileRpcMixin, PASSWORD
from .common import MobilePointageCommon
from odoo.tests.common import HttpCase


class TestCompteRendu(MobileRpcMixin, MobilePointageCommon, HttpCase):

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.user.flush()
        # Odoo's login cooldown (_assert_can_auth) counts failures in process
        # memory keyed by source address, not transactionally — it survives
        # the rollback between tests, so a deliberate-bad-login test earlier
        # in the same process can leave 127.0.0.1 throttled here too (see
        # test_api.py:TestMobileAuthFailures and TestMobilePlanningApi.setUp,
        # which document and work around the same hazard).
        self.env["ir.config_parameter"].sudo().set_param("base.login_cooldown_after", "0")

        self.activity_required = self.env["fsm.activity"].create({
            "name": "Nettoyage des sanitaires",
            "required": True,
            "fsm_order_id": self.order.id,
        })
        self.activity_optional = self.env["fsm.activity"].create({
            "name": "Dépoussiérage bureaux",
            "required": False,
            "fsm_order_id": self.order.id,
        })

    def _login(self):
        result = self._result(
            "auth/login",
            {"login": self.user.login, "password": PASSWORD},
        )
        return result["token"]

    def _make_depart_pointage(self, client_ref="cr-1", fsm_order_id=None):
        return self.env["ocleaneo.mobile.pointage"].sudo().create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "type": "depart",
            "datetime": fields.Datetime.now(),
            "fsm_order_id": fsm_order_id if fsm_order_id is not None else self.order.id,
            "client_ref": client_ref,
            "company_id": self.company.id,
        })

    def test_submits_report_and_validates_activities(self):
        pointage = self._make_depart_pointage()
        token = self._login()

        result = self._result("pointage/compte-rendu", {
            "client_ref": "cr-1",
            "commentaire": "RAS, tout est fait.",
            "activities": [
                {"id": self.activity_required.id, "completed": True},
                {"id": self.activity_optional.id, "completed": False},
            ],
        }, token=token)

        self.assertEqual(result["id"], pointage.id)
        pointage.invalidate_cache()
        self.activity_required.invalidate_cache()
        self.assertEqual(pointage.commentaire, "RAS, tout est fait.")
        self.assertTrue(self.activity_required.completed)
        self.assertFalse(self.activity_optional.completed)

    def test_unknown_client_ref_is_404(self):
        self._make_depart_pointage()
        token = self._login()

        result = self._result("pointage/compte-rendu", {
            "client_ref": "does-not-exist",
            "commentaire": "peu importe",
        }, token=token)

        self.assertEqual(result["code"], 404)

    def test_non_depart_pointage_is_rejected(self):
        pointage = self.env["ocleaneo.mobile.pointage"].sudo().create({
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "type": "arrivee",
            "datetime": fields.Datetime.now(),
            "client_ref": "cr-arrivee",
            "company_id": self.company.id,
        })
        token = self._login()

        result = self._result("pointage/compte-rendu", {
            "client_ref": "cr-arrivee",
            "commentaire": "peu importe",
        }, token=token)

        self.assertEqual(result["code"], 400)
        pointage.invalidate_cache()
        self.assertFalse(pointage.commentaire)

    def test_activity_from_another_order_is_ignored(self):
        _, other_order = self._make_order(self.person, "Autre Chantier")
        foreign_activity = self.env["fsm.activity"].create({
            "name": "Activité d'un autre chantier",
            "required": True,
            "fsm_order_id": other_order.id,
        })
        self._make_depart_pointage()
        token = self._login()

        result = self._result("pointage/compte-rendu", {
            "client_ref": "cr-1",
            "commentaire": "RAS",
            "activities": [{"id": foreign_activity.id, "completed": True}],
        }, token=token)

        self.assertNotIn("error", result)
        foreign_activity.invalidate_cache()
        self.assertFalse(
            foreign_activity.completed,
            "an activity belonging to another fsm.order must never be written",
        )

    def test_uncompleted_required_activity_alerts_manager(self):
        manager = self.env["res.users"].create({
            "name": "Manager Test",
            "login": "manager.cr@test.example",
            "email": "manager.cr@test.example",
            # Same access requirement as _alert_manager_stale_attendance
            # (test_attendance.py) — mail.activity refuses to assign a
            # record the user cannot read.
            "groups_id": [(6, 0, [
                self.env.ref("base.group_user").id,
                self.env.ref("hr.group_hr_user").id,
            ])],
        })
        manager_employee = self.env["hr.employee"].create({
            "name": "Manager Test",
            "user_id": manager.id,
        })
        self.employee.parent_id = manager_employee
        self._make_depart_pointage()
        token = self._login()

        self._result("pointage/compte-rendu", {
            "client_ref": "cr-1",
            "commentaire": "RAS",
            "activities": [{"id": self.activity_required.id, "completed": False}],
        }, token=token)

        activity = self.env["mail.activity"].search([
            ("res_model", "=", "hr.employee"),
            ("res_id", "=", self.employee.id),
            ("user_id", "=", manager.id),
        ])
        self.assertTrue(activity)
        self.assertIn("obligatoire", activity.summary.lower())
