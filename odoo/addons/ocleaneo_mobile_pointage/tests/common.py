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
        # The generic project _manage_timesheet resolves by name unless the
        # ocleaneo_mobile_pointage.project_id system parameter is set.
        self.project = self.env["project.project"].create({
            "name": "Pointage chantiers",
            "company_id": self.company.id,
        })
