# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""What this module must NOT grant on res.users.

An earlier revision of this addon stored the mobile API token on
res.users, and shipped an ACL granting base.group_user write access to
res.users plus an ir.rule narrowing that access to the user's own record.
The token has since moved to hr.employee (see models/hr_employee.py);
both security records outlived their purpose and were removed, because
each of them caused real damage on their own:

- The ACL was a privilege escalation. res.users.write()'s
  SELF_WRITEABLE_FIELDS check does not *block* unsafe fields — it only
  decides whether a self-write may be escalated to sudo. What stops an
  internal user from writing groups_id is the ACL denying write in the
  first place, which stock Odoo does. Granting it back let any internal
  user add themselves to base.group_system. Reproduced on a live Odoo 14.

- The ir.rule broke the backoffice for everyone. It applied to
  base.group_user across the whole instance, not just the mobile API, so
  an internal user could no longer read *any* other user: assignment
  dropdowns, followers, chatter mentions and activity assignment all go
  through res.users. Measured on a live Odoo 14: 1 visible user with the
  rule, 7 without.

Neither is needed: every mobile controller reaches res.users through
sudo(). These tests fail if either record comes back.
"""

from odoo.exceptions import AccessError
from odoo.tests.common import TransactionCase


class TestResUsersNotWidened(TransactionCase):

    def setUp(self):
        super().setUp()
        company = self.env.ref("base.main_company")
        self.internal = self.env["res.users"].with_context(
            no_reset_password=True
        ).create({
            "name": "Salarié interne",
            "login": "audit.internal@example.com",
            "password": "Passw0rd!!",
            "company_id": company.id,
            "company_ids": [(6, 0, [company.id])],
            "groups_id": [(6, 0, [self.env.ref("base.group_user").id])],
        })

    def test_internal_user_cannot_grant_themselves_settings_access(self):
        """The escalation, stated as an assertion."""
        settings = self.env.ref("base.group_system")
        user_env = self.env(user=self.internal.id)
        with self.assertRaises(AccessError):
            user_env["res.users"].browse(self.internal.id).write(
                {"groups_id": [(4, settings.id)]}
            )
        self.assertNotIn(settings, self.internal.groups_id)

    def test_internal_user_still_sees_other_users(self):
        """Stock Odoo behaviour the removed ir.rule used to destroy.

        Not about the mobile API at all — it is what the rest of Odoo
        needs in order to assign work, follow a record or mention a
        colleague.
        """
        user_env = self.env(user=self.internal.id)
        others = user_env["res.users"].search([("id", "!=", self.internal.id)])
        self.assertTrue(
            others,
            "an internal user must be able to read other users; a record rule "
            "on res.users scoped to base.group_user would break the backoffice",
        )

    def test_module_declares_no_res_users_acl(self):
        """Guards the CSV itself, not just its observable effect.

        A future ACL on res.users could be narrower than the one removed
        and still slip past the two tests above; this one fails on any
        access line this module adds for res.users.
        """
        acls = self.env["ir.model.access"].search([
            ("model_id", "=", self.env.ref("base.model_res_users").id),
        ])
        owned = acls.filtered(
            lambda a: (a.get_external_id().get(a.id) or "").startswith(
                "ocleaneo_mobile_api."
            )
        )
        self.assertFalse(
            owned,
            "ocleaneo_mobile_api must not define ACLs on res.users — the "
            "mobile API reaches it through sudo(); see this module's "
            "tests/test_security.py docstring",
        )
