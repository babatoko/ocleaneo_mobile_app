# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""End-to-end tests of the mobile API routes over real HTTP.

Covers what only shows up once the whole chain runs: JSON-RPC enveloping,
Bearer-token authentication, the ownership check on fsm_order_id, and
client_ref idempotency.
"""

import json

import odoo
from odoo.addons.ocleaneo_mobile_api.models.mobile_auth_attempt import (
    MAX_ATTEMPTS,
    MAX_IP_ATTEMPTS,
)
from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import mobile_routes
from odoo.tests.common import HOST, HttpCase

from .common import MobilePointageCommon

PASSWORD = "TestPass123!"


class MobileRpcMixin:
    """Appel JSON-RPC vers l'API mobile, partagé par les classes de ce module.

    Les deux classes en portaient chacune leur copie. Lors du passage aux
    chemins versionnés, seule la première a été corrigée : la seconde a
    continué d'appeler une URL qui n'existait plus, et ses six tests sont
    tombés. Une seule définition, donc — un helper dupliqué est un correctif
    qu'on n'appliquera qu'à moitié.
    """

    def _rpc(self, endpoint, params=None, token=None):
        """POST un appel JSON-RPC 2.0 et rend le corps décodé.

        `endpoint` est le suffixe ("auth/login"), pas un chemin complet : il
        est résolu par mobile_routes(), la MÊME fonction que les contrôleurs.
        Écrire "/api/mobile/v1/auth/login" en dur ferait passer ces tests à
        côté du jour où la version change — ils vérifieraient une v1 que plus
        personne ne sert.
        """
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer %s" % token
        response = self.url_open(
            mobile_routes(endpoint)[0],
            data=json.dumps({
                "jsonrpc": "2.0",
                "method": "call",
                "id": 1,
                "params": params or {},
            }),
            headers=headers,
        )
        return response.json()

    def _result(self, endpoint, params=None, token=None):
        body = self._rpc(endpoint, params, token)
        self.assertNotIn(
            "error", body,
            "unexpected server exception: %s" % body.get("error"),
        )
        return body["result"]


class TestMobileApi(MobileRpcMixin, MobilePointageCommon, HttpCase):

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.employee.barcode = "BADGE-WORKER-1"
        # authenticate() reads the password straight from the database on
        # its own cursor, so the ORM write above has to be flushed first —
        # otherwise it sits in cache and the login is refused.
        self.user.flush()
        self.employee.flush()

        # A second worker, to prove one cannot act on the other's job.
        self.other_user, self.other_employee, self.other_person = self._make_worker(
            "Worker Deux", "worker.deux@test.example"
        )
        self.other_location, self.other_order = self._make_order(
            self.other_person, "Chantier Autre"
        )


    def _login(self):
        result = self._result(
            "auth/login",
            {"login": self.user.login, "password": PASSWORD},
        )
        return result["token"]

    # --- authentication --------------------------------------------------

    def test_login_returns_token_and_identity(self):
        result = self._result(
            "auth/login",
            {"login": self.user.login, "password": PASSWORD},
        )
        self.assertTrue(result["token"])
        self.assertEqual(result["employee_id"], self.employee.id)
        self.assertEqual(result["user_id"], self.user.id)

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
        result = self._result("me")
        self.assertEqual(result["code"], 401)

    def test_request_with_garbage_token_is_unauthorized(self):
        result = self._result("me", token="not-a-real-token")
        self.assertEqual(result["code"], 401)

    def test_logout_revokes_the_token(self):
        token = self._login()
        self.assertEqual(self._result("me", token=token)["user_id"], self.user.id)

        self._result("auth/logout", token=token)

        self.assertEqual(self._result("me", token=token)["code"], 401)

    def test_expired_token_is_rejected(self):
        from datetime import timedelta
        from odoo import fields

        token = self._login()
        self.employee.mobile_api_token_expire = fields.Datetime.now() - timedelta(minutes=1)

        self.assertEqual(self._result("me", token=token)["code"], 401)

    # --- badge login -----------------------------------------------------

    def test_login_badge_returns_token(self):
        result = self._result(
            "auth/login_badge", {"barcode": "BADGE-WORKER-1"}
        )
        self.assertTrue(result["token"])
        self.assertEqual(result["employee_id"], self.employee.id)

    def test_login_badge_with_unknown_barcode_is_rejected(self):
        result = self._result(
            "auth/login_badge", {"barcode": "BADGE-INCONNU"}
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
            "auth/login_badge", {"barcode": "BADGE-WORKER-1"}
        )

        self.assertEqual(result["code"], 401)

    # --- ownership (IDOR) ------------------------------------------------

    def test_cannot_clock_on_another_workers_order(self):
        token = self._login()

        result = self._result("pointage", {
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

        self._result("pointage", {
            "type": "depart",
            "fsm_order_id": self.other_order.id,
            "datetime": "2026-03-10T17:00:00",
        }, token=token)

        self.assertEqual(self.other_order.stage_id, stage_before)

    def test_clocking_on_own_order_succeeds(self):
        token = self._login()

        result = self._result("pointage", {
            "type": "arrivee",
            "fsm_order_id": self.order.id,
            "datetime": "2026-03-10T08:00:00",
        }, token=token)

        self.assertTrue(result["id"])
        self.assertEqual(result["fsm_order_id"], self.order.id)

    def test_non_numeric_order_id_is_a_clean_400(self):
        token = self._login()
        result = self._result("pointage", {
            "type": "arrivee",
            "fsm_order_id": "abc",
            "datetime": "2026-03-10T08:00:00",
        }, token=token)
        self.assertEqual(result["code"], 400)

    def test_unknown_order_id_is_a_clean_404(self):
        token = self._login()
        result = self._result("pointage", {
            "type": "arrivee",
            "fsm_order_id": 999999999,
            "datetime": "2026-03-10T08:00:00",
        }, token=token)
        self.assertEqual(result["code"], 404)

    def test_invalid_type_is_a_clean_400(self):
        token = self._login()
        result = self._result("pointage", {
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

        first = self._result("pointage", params, token=token)
        second = self._result("pointage", params, token=token)

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
        self._result("pointage", {
            "type": "arrivee",
            "fsm_order_id": self.order.id,
            "datetime": "2026-03-10T08:00:00",
            "client_ref": "shared-key",
        }, token=token)

        self.other_user.password = PASSWORD
        other_token = self._result("auth/login", {
            "login": self.other_user.login, "password": PASSWORD,
        })["token"]
        self._result("pointage", {
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
        self._result("pointage", {
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
            "pointage/mine", {"date": "2026-03-10"}, token=token
        )

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["entries"][0]["fsm_order_id"], self.order.id)

    def test_chantiers_returns_own_orders_with_coordinates(self):
        self.location.write({
            "partner_latitude": 48.8566,
            "partner_longitude": 2.3522,
            "nfc_tag_id": "04A1B2C3",
        })
        token = self._login()

        result = self._result("chantiers/aujourdhui", token=token)

        self.assertEqual(result["count"], 1)
        order = result["orders"][0]
        self.assertEqual(order["id"], self.order.id)
        self.assertAlmostEqual(order["location_latitude"], 48.8566, places=4)
        self.assertAlmostEqual(order["location_longitude"], 2.3522, places=4)
        self.assertEqual(order["nfc_tag_id"], "04A1B2C3")

    def test_me_finds_the_current_job_on_a_night_shift(self):
        """GET /api/mobile/me used to lose the job across midnight.

        It looked the running timesheet line up by
        `date = attendance.check_in.date()` — a UTC date — while
        project_timesheet_time_control rewrites that column from date_time
        with fields.Date.context_today, i.e. in the worker's timezone. For
        a clock-in at 23:30 UTC (00:30 in Paris) the two differ by a day,
        the search matched nothing, and a worker demonstrably on the clock
        got current_fsm_order_id = False.

        The same trap had already been fixed once in _manage_timesheet;
        this route had escaped it, and escaped it because nothing covered
        the crossing-midnight case here. It does now.
        """
        self.user.tz = "Europe/Paris"
        self.user.flush()
        token = self._login()

        # 23:30 UTC == 00:30 the next morning in Paris.
        self._result(
            "pointage",
            {
                "type": "arrivee",
                "fsm_order_id": self.order.id,
                "datetime": "2026-03-10T23:30:00Z",
            },
            token=token,
        )

        result = self._result("me", token=token)

        self.assertTrue(
            result["current_attendance_id"],
            "the clocking above must have opened an attendance",
        )
        self.assertEqual(
            result["current_fsm_order_id"], self.order.id,
            "the worker is clocked in on this job; /me must report it "
            "whichever side of midnight the shift started",
        )

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


class TestMobileAuthFailures(MobileRpcMixin, MobilePointageCommon, HttpCase):
    """Tests that deliberately fail authentication, kept in their own class.

    Two Odoo behaviours make failed logins messy to test alongside
    everything else, hence the separate class:

    - res.users.authenticate() opens its own cursor and rolls it back when
      credentials are refused. Under HttpCase that cursor is the test's
      own, so a rejected login also discards the fixtures set up for the
      test — the user record included.
    - Odoo's native login cooldown (_assert_can_auth) counts failures in
      *process memory*, keyed by source address. That state is not
      transactional: it survives the rollback between tests and would make
      a later test fail to log in for reasons unrelated to what it asserts.
      setUp disables it so these tests measure this module's limiter rather
      than Odoo's.
    """

    def setUp(self):
        super().setUp()
        self.user.password = PASSWORD
        self.employee.barcode = "BADGE-WORKER-1"
        # authenticate() reads the password straight from the database on
        # its own cursor, so the ORM write above has to be flushed first —
        # otherwise it sits in cache and the login is refused.
        self.user.flush()
        self.employee.flush()
        # 0 disables Odoo's own in-memory cooldown (see class docstring).
        self.env["ir.config_parameter"].sudo().set_param("base.login_cooldown_after", "0")
        self.Attempt = self.env["ocleaneo.mobile.auth.attempt"]


    def _bad_login(self):
        return self._result("auth/login", {
            "login": self.user.login, "password": "wrong",
        })

    def test_login_with_wrong_password_is_rejected(self):
        self.assertEqual(self._bad_login()["code"], 401)

    def test_repeated_bad_logins_are_eventually_throttled(self):
        """Brute force must stop getting fresh 401s indefinitely."""
        codes = [self._bad_login()["code"] for _ in range(MAX_ATTEMPTS + 1)]

        self.assertEqual(codes[0], 401)
        self.assertEqual(codes[-1], 429, "the last attempt should be throttled")

    def test_throttling_survives_a_correct_password(self):
        """Once throttled, the right password gets no free pass — otherwise
        the limit would only slow down an attacker who never guesses right."""
        for _ in range(MAX_ATTEMPTS):
            self._bad_login()

        result = self._result("auth/login", {
            "login": self.user.login, "password": PASSWORD,
        })

        self.assertEqual(result["code"], 429)

    def test_badge_enumeration_is_stopped_by_the_address_budget(self):
        """Guessing a different badge each time never fills the per-badge
        bucket — only the shared per-address one stops the sweep."""
        first = self._result("auth/login_badge", {"barcode": "BADGE-GUESS-1"})
        self.assertEqual(first["code"], 401)

        # Fast-forward the sweep rather than issuing MAX_IP_ATTEMPTS requests.
        for _ in range(MAX_IP_ATTEMPTS):
            self.Attempt.record_failure("ip", "127.0.0.1", ip="127.0.0.1")

        later = self._result("auth/login_badge", {"barcode": "BADGE-GUESS-2"})
        self.assertEqual(later["code"], 429)

    def test_a_valid_login_cannot_reset_the_address_budget(self):
        """Otherwise anyone holding one valid account could clear the address
        limit at will and keep enumerating the others."""
        for _ in range(MAX_IP_ATTEMPTS):
            self.Attempt.record_failure("ip", "127.0.0.1", ip="127.0.0.1")

        self.assertEqual(
            self._result("auth/login", {
                "login": self.user.login, "password": PASSWORD,
            })["code"],
            429,
        )
        self.assertTrue(self.Attempt.is_rate_limited("ip", "127.0.0.1"))

    def test_successful_login_clears_the_credential_budget(self):
        """A worker who mistypes once must not carry that against them.

        The earlier failures are seeded through the model rather than by
        actually failing a login: authenticate()'s rollback would take the
        whole fixture with it — the user record included — leaving nobody
        to log in as afterwards. What this test is about, that the endpoint
        clears the bucket on success, is still exercised for real.
        """
        for _ in range(MAX_ATTEMPTS - 1):
            self.Attempt.record_failure("login", self.user.login, ip="127.0.0.1")
        self.assertEqual(
            self.Attempt.search_count([
                ("scope", "=", "login"), ("key", "=", self.user.login),
            ]),
            MAX_ATTEMPTS - 1,
        )

        result = self._result("auth/login", {
            "login": self.user.login, "password": PASSWORD,
        })

        self.assertTrue(result.get("token"), "expected a successful login, got %s" % result)
        self.assertEqual(
            self.Attempt.search_count([
                ("scope", "=", "login"), ("key", "=", self.user.login),
            ]),
            0,
        )
