# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Shared fixtures for the mobile planning tests.

Same worker/employee/fsm.person chain as ocleaneo_mobile_pointage's own
common.py (a mobile API token needs a res.users with a directly-linked
hr.employee) — duplicated rather than imported: this module does not
depend on ocleaneo_mobile_pointage, and shouldn't gain a test-time
dependency it doesn't otherwise need.
"""

from odoo.tests.common import TransactionCase


class MobilePlanningCommon(TransactionCase):

    def _make_worker(self, name, login):
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

    def _make_order(self, person, location_name="Chantier Test", **values):
        owner = self.env["res.partner"].create({"name": "%s Client" % location_name})
        location = self.env["fsm.location"].create({
            "name": location_name,
            "owner_id": owner.id,
        })
        order = self.env["fsm.order"].create({
            "location_id": location.id,
            "person_id": person.id,
            **values,
        })
        return location, order

    def setUp(self):
        super().setUp()
        self.company = self.env.ref("base.main_company")
        self.user, self.employee, self.person = self._make_worker(
            "Worker Planning", "worker.planning@test.example"
        )
