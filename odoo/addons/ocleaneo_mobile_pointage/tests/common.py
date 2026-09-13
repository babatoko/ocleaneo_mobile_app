# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Shared fixtures for the mobile pointage tests.

Builds the minimal object graph a mobile clocking needs: a res.users with
a directly-linked hr.employee (required to issue a mobile API token — see
ocleaneo_mobile_api/controllers/auth.py), an fsm.person pointing at the
same partner (that link is what the IDOR check compares against), an
fsm.location with the owner_id the module requires, and an fsm.order
assigned to that person.
"""

from odoo.tests.common import TransactionCase


class MobilePointageCommon(TransactionCase):

    def _make_worker(self, name, login):
        """Create a worker with the full user/employee/fsm.person chain."""
        partner = self.env["res.partner"].create({"name": "%s Partner" % name})
        user = self.env["res.users"].with_context(no_reset_password=True).create({
            "name": name,
            "login": login,
            "email": login,
            "partner_id": partner.id,
            "company_id": self.company.id,
            "company_ids": [(6, 0, [self.company.id])],
            # tz=UTC keeps local_day_bounds_utc == the UTC calendar day, so a
            # test clocked at "2026-03-10T08:00:00" and a sync that "defaults
            # to today" can only disagree when the test date itself is not
            # today — i.e. exactly the bug these tests are meant to catch when
            # they run with a frozen date. Any user tz (e.g. Europe/Paris
            # picked up per-user) would shift the window by ±1-2 h and make
            # those assertions flaky at CI time borders.
            "tz": "UTC",
            "groups_id": [(6, 0, [self.env.ref("base.group_user").id])],
        })
        employee = self.env["hr.employee"].create({
            "name": name,
            "user_id": user.id,
            "company_id": self.company.id,
        })
        person = self.env["fsm.person"].create({"name": name, "partner_id": partner.id})
        return user, employee, person

    def _make_order(self, person, location_name="Chantier Test"):
        owner = self.env["res.partner"].create({"name": "%s Client" % location_name})
        # owner_id is required=True on fsm.location (OCA fieldservice).
        location = self.env["fsm.location"].create({
            "name": location_name,
            "owner_id": owner.id,
        })
        order = self.env["fsm.order"].create({
            "location_id": location.id,
            "person_id": person.id,
        })
        return location, order

    def setUp(self):
        super().setUp()
        self.company = self.env.ref("base.main_company")
        self.user, self.employee, self.person = self._make_worker(
            "Worker Un", "worker.un@test.example"
        )
        self.location, self.order = self._make_order(self.person)
        # A second worker/order pair, used by tests that need to prove scoping.
        # Use a unique, deterministic email so adding it to common.py does not
        # collide with worker.deux@test.example already created by other tests.
        self.other_user, self.other_employee, self.other_person = self._make_worker(
            "Worker Other", f"worker.other.{self.user.id}@test.example"
        )
        self.other_location, self.other_order = self._make_order(
            self.other_person, "Chantier Autre"
        )
        # The generic project _manage_timesheet resolves by name unless the
        # ocleaneo_mobile_pointage.project_id system parameter is set.
        self.project = self.env["project.project"].create({
            "name": "Pointage chantiers",
            "company_id": self.company.id,
        })
