# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""End-to-end tests of the /api/mobile/* routes over real HTTP.

Covers what only shows up once the whole chain runs: JSON-RPC enveloping,
Bearer-token authentication, the ownership check on fsm_order_id, and
client_ref idempotency.
"""

import json

import odoo
from odoo.tests.common import HOST, HttpCase

from .common import MobilePointageCommon

PASSWORD = "TestPass123!"


class TestMobileApi(MobilePointageCommon, HttpCase):

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.employee.barcode = "BADGE-WORKER-1"

        # A second worker, to prove one cannot act on the other's job.
        self.other_user, self.other_employee, self.other_person = self._make_worker(
            "Worker Deux", "worker.deux@test.example"
        )
        self.other_location, self.other_order = self._make_order(
            self.other_person, "Chantier Autre"
        )

    # --- helpers ---------------------------------------------------------

    def _rpc(self, path, params=None, token=None):
        """POST a JSON-RPC 2.0 call and return the decoded body."""
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer %s" % token
        response = self.url_open(
            path,
            data=json.dumps({
                "jsonrpc": "2.0",
                "method": "call",
                "id": 1,
                "params": params or {},
            }),
            headers=headers,
        )
        return response.json()

    def _result(self, path, params=None, token=None):
        body = self._rpc(path, params, token)
        self.assertNotIn(
            "error", body,
            "unexpected server exception: %s" % body.get("error"),
        )
        return body["result"]

    def _login(self):
        result = self._result(
            "/api/mobile/auth/login",
            {"login": self.user.login, "password": PASSWORD},
        )
        return result["token"]

    # --- authentication --------------------------------------------------

    def test_login_returns_token_and_identity(self):
        result = self._result(
            "/api/mobile/auth/login",
            {"login": self.user.login, "password": PASSWORD},
        )
        self.assertTrue(result["token"])
        self.assertEqual(result["employee_id"], self.employee.id)
        self.assertEqual(result["user_id"], self.user.id)

    def test_login_with_wrong_password_is_rejected(self):
        result = self._result(
            "/api/mobile/auth/login",
            {"login": self.user.login, "password": "wrong"},
        )
        self.assertEqual(result["code"], 401)

    def test_token_is_stored_on_the_employee_not_the_user(self):
        """res.users keeps access control; hr.employee carries identity."""
        self._login()
        # The token was written by the HTTP request; this test's own record
        # cache predates it and would otherwise still read the old value.
        self.employee.invalidate_cache()

        self.assertTrue(self.employee.mobile_api_token)
        self.assertTrue(self.employee.mobile_api_token_expire)
        self.assertNotIn("mobile_api_token", self.env["res.users"]._fields)

    def test_request_without_token_is_unauthorized(self):
        result = self._result("/api/mobile/me")
        self.assertEqual(result["code"], 401)

    def test_request_with_garbage_token_is_unauthorized(self):
        result = self._result("/api/mobile/me", token="not-a-real-token")
        self.assertEqual(result["code"], 401)

    def test_logout_revokes_the_token(self):
        token = self._login()
        self.assertEqual(self._result("/api/mobile/me", token=token)["user_id"], self.user.id)

        self._result("/api/mobile/auth/logout", token=token)

        self.assertEqual(self._result("/api/mobile/me", token=token)["code"], 401)

    def test_expired_token_is_rejected(self):
        from datetime import timedelta
        from odoo import fields

        token = self._login()
        self.employee.mobile_api_token_expire = fields.Datetime.now() - timedelta(minutes=1)

        self.assertEqual(self._result("/api/mobile/me", token=token)["code"], 401)

    # --- badge login -----------------------------------------------------

    def test_login_badge_returns_token(self):
        result = self._result(
            "/api/mobile/auth/login_badge", {"barcode": "BADGE-WORKER-1"}
        )
        self.assertTrue(result["token"])
        self.assertEqual(result["employee_id"], self.employee.id)

    def test_login_badge_with_unknown_barcode_is_rejected(self):
        result = self._result(
            "/api/mobile/auth/login_badge", {"barcode": "BADGE-INCONNU"}
        )
        self.assertEqual(result["code"], 401)

    def test_barcode_uniqueness_is_enforced_by_the_database(self):
        """Why login_badge needs no ambiguity handling of its own.

        hr.employee carries `unique (barcode)` as a SQL constraint, so two
        employees can never share a badge — the lookup cannot return more
        than one row, and arbitrating between candidates would be dead
        code.
        """
        from psycopg2 import IntegrityError

        from odoo.tools import mute_logger

        with self.assertRaises(IntegrityError), mute_logger("odoo.sql_db"):
            with self.cr.savepoint():
                self.other_employee.barcode = "BADGE-WORKER-1"

    def test_archived_employee_cannot_badge_in(self):
        """Archiving a worker must revoke badge access, with no special case:
        search() filters active=True, so the badge simply stops matching."""
        self.employee.active = False

        result = self._result(
            "/api/mobile/auth/login_badge", {"barcode": "BADGE-WORKER-1"}
        )

        self.assertEqual(result["code"], 401)

    # --- ownership (IDOR) ------------------------------------------------

    def test_cannot_clock_on_another_workers_order(self):
        token = self._login()

        result = self._result("/api/mobile/pointage", {
            "type": "arrivee",
            "fsm_order_id": self.other_order.id,
            "datetime": "2026-03-10T08:00:00",
        }, token=token)

        self.assertEqual(result["code"], 403)
        self.assertFalse(
            self.env["ocleaneo.mobile.pointage"].search([
                ("fsm_order_id", "=", self.other_order.id),
            ]),
            "no clocking may be recorded against another worker's job",
        )

    def test_cannot_close_another_workers_order(self):
        """The IDOR mattered most on 'depart', which also closes the job."""
        token = self._login()
        stage_before = self.other_order.stage_id

        self._result("/api/mobile/pointage", {
            "type": "depart",
            "fsm_order_id": self.other_order.id,
            "datetime": "2026-03-10T17:00:00",
        }, token=token)

        self.assertEqual(self.other_order.stage_id, stage_before)

    def test_clocking_on_own_order_succeeds(self):
        token = self._login()

        result = self._result("/api/mobile/pointage", {
            "type": "arrivee",
            "fsm_order_id": self.order.id,
            "datetime": "2026-03-10T08:00:00",
        }, token=token)

        self.assertTrue(result["id"])
        self.assertEqual(result["fsm_order_id"], self.order.id)

    def test_non_numeric_order_id_is_a_clean_400(self):
        token = self._login()
        result = self._result("/api/mobile/pointage", {
            "type": "arrivee",
            "fsm_order_id": "abc",
            "datetime": "2026-03-10T08:00:00",
        }, token=token)
        self.assertEqual(result["code"], 400)

    def test_unknown_order_id_is_a_clean_404(self):
        token = self._login()
        result = self._result("/api/mobile/pointage", {
            "type": "arrivee",
            "fsm_order_id": 999999999,
            "datetime": "2026-03-10T08:00:00",
        }, token=token)
        self.assertEqual(result["code"], 404)

    def test_invalid_type_is_a_clean_400(self):
        token = self._login()
        result = self._result("/api/mobile/pointage", {
            "type": "not_a_type",
            "datetime": "2026-03-10T08:00:00",
        }, token=token)
        self.assertEqual(result["code"], 400)

    # --- idempotency -----------------------------------------------------

    def test_same_client_ref_does_not_create_a_duplicate(self):
        """The offline queue resends the same key after a lost response."""
        token = self._login()
        params = {
            "type": "arrivee",
            "fsm_order_id": self.order.id,
            "datetime": "2026-03-10T08:00:00",
            "client_ref": "idem-key-001",
        }

        first = self._result("/api/mobile/pointage", params, token=token)
        second = self._result("/api/mobile/pointage", params, token=token)

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(
            self.env["ocleaneo.mobile.pointage"].search_count([
                ("client_ref", "=", "idem-key-001"),
            ]),
            1,
        )

    def test_client_ref_is_scoped_per_user(self):
        """Two workers may legitimately generate the same key."""
        token = self._login()
        self._result("/api/mobile/pointage", {
            "type": "arrivee",
            "fsm_order_id": self.order.id,
            "datetime": "2026-03-10T08:00:00",
            "client_ref": "shared-key",
        }, token=token)

        self.other_user.password = PASSWORD
        other_token = self._result("/api/mobile/auth/login", {
            "login": self.other_user.login, "password": PASSWORD,
        })["token"]
        self._result("/api/mobile/pointage", {
            "type": "arrivee",
            "fsm_order_id": self.other_order.id,
            "datetime": "2026-03-10T08:00:00",
            "client_ref": "shared-key",
        }, token=other_token)

        self.assertEqual(
            self.env["ocleaneo.mobile.pointage"].search_count([
                ("client_ref", "=", "shared-key"),
            ]),
            2,
        )

    # --- reads -----------------------------------------------------------

    def test_pointage_mine_returns_only_own_clockings(self):
        token = self._login()
        self._result("/api/mobile/pointage", {
            "type": "arrivee",
            "fsm_order_id": self.order.id,
            "datetime": "2026-03-10T08:00:00",
        }, token=token)
        # A clocking belonging to the other worker, same day.
        self.env["ocleaneo.mobile.pointage"].create({
            "user_id": self.other_user.id,
            "employee_id": self.other_employee.id,
            "type": "arrivee",
            "datetime": "2026-03-10 08:00:00",
            "company_id": self.company.id,
        })

        result = self._result(
            "/api/mobile/pointage/mine", {"date": "2026-03-10"}, token=token
        )

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["entries"][0]["fsm_order_id"], self.order.id)

    def test_chantiers_returns_own_orders_with_coordinates(self):
        self.location.write({"partner_latitude": 48.8566, "partner_longitude": 2.3522})
        token = self._login()

        result = self._result("/api/mobile/chantiers/aujourdhui", token=token)

        self.assertEqual(result["count"], 1)
        order = result["orders"][0]
        self.assertEqual(order["id"], self.order.id)
        self.assertAlmostEqual(order["location_latitude"], 48.8566, places=4)
        self.assertAlmostEqual(order["location_longitude"], 2.3522, places=4)

    def test_cors_preflight_is_answered(self):
        """type='json' routes answer no preflight of their own — a dedicated
        type='http' OPTIONS route exists precisely for this, and without it
        no browser can reach the API at all."""
        response = self.opener.options(
            "http://%s:%s/api/mobile/auth/login" % (HOST, odoo.tools.config["http_port"]),
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers.get("Access-Control-Allow-Origin"))
