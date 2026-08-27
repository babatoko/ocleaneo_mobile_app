# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""client_ref must survive two retries arriving at the same moment.

The mobile app generates one client_ref per physical clocking and resends
it unchanged on every retry — after an offline queue replay, or when a
response was lost after the server had already processed it. The lookup
at the top of POST /api/mobile/pointage handles the sequential case, but
it is a check-then-act: two requests running concurrently both find
nothing and both create a clocking, so the worker's arrival is recorded
twice and their hours counted twice.

These tests cover the database half of the fix — the unique index that
makes exactly one insert win. The controller's half (turning the losing
insert into a request replay, because Odoo's REPEATABLE READ snapshot
makes re-reading the winner impossible in the same transaction) is
documented in controllers/pointage.py._create_pointage.
"""

from psycopg2 import IntegrityError

from odoo.service.model import PG_CONCURRENCY_ERRORS_TO_RETRY
from odoo.tools import mute_logger

from odoo.addons.ocleaneo_mobile_pointage.controllers.pointage import (
    ConcurrentClientRef,
    MobilePointageController,
)

from .common import MobilePointageCommon


class TestClientRefUnique(MobilePointageCommon):

    def _vals(self, client_ref, pointage_type="arrivee", user=None, employee=None):
        user = user or self.user
        employee = employee or self.employee
        return {
            "user_id": user.id,
            "employee_id": employee.id,
            "type": pointage_type,
            "datetime": "2026-03-10 07:00:00",
            "client_ref": client_ref,
            "company_id": self.company.id,
        }

    @mute_logger("odoo.sql_db")
    def test_same_client_ref_twice_is_rejected_by_the_database(self):
        """The guarantee the controller's replay logic rests on."""
        Pointage = self.env["ocleaneo.mobile.pointage"]
        Pointage.create(self._vals("REF-DUP"))
        with self.assertRaises(IntegrityError):
            with self.env.cr.savepoint():
                Pointage.create(self._vals("REF-DUP", "depart"))

    def test_different_client_refs_coexist(self):
        Pointage = self.env["ocleaneo.mobile.pointage"]
        first = Pointage.create(self._vals("REF-A"))
        second = Pointage.create(self._vals("REF-B", "depart"))
        self.assertNotEqual(first.id, second.id)

    def test_clockings_without_a_client_ref_are_not_constrained(self):
        """Backoffice entries and imports carry no key.

        Postgres allows any number of NULLs in a unique index, which is
        what makes it safe to put this constraint on an optional column.
        Worth pinning: a constraint that also caught NULLs would block
        every manual clocking after the first.
        """
        Pointage = self.env["ocleaneo.mobile.pointage"]
        first = Pointage.create(dict(self._vals(False), source="manuel"))
        second = Pointage.create(dict(self._vals(False, "depart"), source="manuel"))
        self.assertNotEqual(first.id, second.id)

    @mute_logger("odoo.sql_db")
    def test_the_key_is_scoped_to_one_worker(self):
        """Two workers' apps may independently generate the same key.

        The constraint is on (user_id, client_ref), not client_ref alone:
        the key is generated on the device, so uniqueness across the whole
        company is not something the app can promise.
        """
        Pointage = self.env["ocleaneo.mobile.pointage"]
        other_user, other_employee, _person = self._make_worker(
            "Worker Deux", "worker.deux@test.example"
        )

        Pointage.create(self._vals("REF-SHARED"))
        # Same key, different worker: allowed.
        self.assertTrue(
            Pointage.create(
                self._vals("REF-SHARED", user=other_user, employee=other_employee)
            )
        )
        # Same key, same worker: still rejected.
        with self.assertRaises(IntegrityError):
            with self.env.cr.savepoint():
                Pointage.create(self._vals("REF-SHARED", "depart"))


class TestConcurrentClientRefHandling(MobilePointageCommon):
    """How the losing insert is handed back to Odoo's retry machinery.

    Not testable over HTTP: in test mode Odoo puts the registry in
    "one cursor serves several requests" mode (registry.enter_test_mode),
    so two simultaneous requests are serialized onto the test's own
    cursor — the race cannot occur, and a replay would roll the test's
    fixtures back. The controller method is therefore exercised directly,
    and the end-to-end replay rests on Odoo's own documented behaviour:
    service/model.check retries on the pgcodes asserted below, and
    http.py's checked_call rolls the request cursor back before each
    attempt so the replay starts on a fresh snapshot.
    """

    def setUp(self):
        super().setUp()
        self.controller = MobilePointageController()

    def _vals(self, client_ref, **overrides):
        vals = {
            "user_id": self.user.id,
            "employee_id": self.employee.id,
            "type": "arrivee",
            "datetime": "2026-03-10 07:00:00",
            "client_ref": client_ref,
            "company_id": self.company.id,
        }
        vals.update(overrides)
        return vals

    @mute_logger("odoo.sql_db", "odoo.addons.ocleaneo_mobile_pointage.controllers.pointage")
    def test_losing_insert_asks_odoo_to_replay_the_request(self):
        env = self.env
        env["ocleaneo.mobile.pointage"].create(self._vals("REF-RACE"))

        with self.assertRaises(ConcurrentClientRef):
            self.controller._create_pointage(
                env, self._vals("REF-RACE", type="depart"), "REF-RACE"
            )

    def test_the_replay_signal_is_one_odoo_actually_retries_on(self):
        """The whole design hinges on this pgcode being in Odoo's list.

        If a future Odoo narrowed PG_CONCURRENCY_ERRORS_TO_RETRY, the
        losing request would surface as a 500 instead of replaying, and
        the duplicate clocking would come back. Assert against Odoo's own
        constant rather than a copy of it.
        """
        self.assertIn(ConcurrentClientRef.pgcode, PG_CONCURRENCY_ERRORS_TO_RETRY)

    @mute_logger("odoo.sql_db")
    def test_an_unrelated_integrity_error_is_not_mistaken_for_a_retry(self):
        """Replaying the wrong error would loop on a request that can never
        succeed, five times, before failing anyway.

        A foreign key violation is a genuine bad request, not a race: it
        must come out as itself.
        """
        with self.assertRaises(IntegrityError):
            with self.env.cr.savepoint():
                self.controller._create_pointage(
                    self.env,
                    self._vals("REF-FK", user_id=999999999),
                    "REF-FK",
                )

    @mute_logger("odoo.sql_db")
    def test_a_clocking_without_a_key_takes_the_plain_path(self):
        """No key, nothing to collide on — and no savepoint overhead."""
        created = self.controller._create_pointage(
            self.env, self._vals(False, source="manuel"), None
        )
        self.assertTrue(created.id)
        self.assertFalse(created.client_ref)
