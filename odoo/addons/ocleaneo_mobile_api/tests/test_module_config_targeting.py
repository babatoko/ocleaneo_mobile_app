# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Feature flags: company targeting + groups/employees resolution.

get_modules_for_user() is the single source of truth shared by the login
payload, /auth/me and every endpoint that must refuse a disabled feature:
these tests pin the resolution rules — empty targeting lists mean the whole
company (unchanged historical behaviour), non-empty lists form a union
(employee in the list OR their user carries one of the groups).
"""

from odoo.tests.common import TransactionCase


class FlagsBase(TransactionCase):

    def setUp(self):
        super().setUp()
        self.Config = self.env["mobile.module.config"]
        self.company = self.env["res.company"].create({"name": "Ocleaneo Test"})
        self.other_company = self.env["res.company"].create({"name": "Ocleaneo Autre"})

        self.category = self.env.ref(
            "ocleaneo_mobile_api.module_category_mobile"
        )
        self.group_agent = self.env.ref("ocleaneo_mobile_api.group_mobile_agent")
        self.group_chef = self.env.ref("ocleaneo_mobile_api.group_mobile_chef_equipe")

        def _employee(name, login, groups=None, company=None):
            user = self.env["res.users"].with_context(no_reset_password=True).create({
                "name": name,
                "login": login,
                "company_id": company.id if company else self.company.id,
                "company_ids": [(6, 0, [company.id if company else self.company.id])],
                "groups_id": [(6, 0, [self.env.ref("base.group_user").id] + (groups or []))],
            })
            return self.env["hr.employee"].create({
                "name": name,
                "user_id": user.id,
                "company_id": company.id if company else self.company.id,
            })

        self.agent = _employee("Agent Sans Groupe", "agent.nu@example.com")
        self.agent_in_group = _employee(
            "Agent Groupe", "agent.groupe@example.com", groups=[self.group_agent.id]
        )
        self.chef = _employee(
            "Chef Equipe", "chef@example.com", groups=[self.group_chef.id]
        )

    def _flag(self, tech="flag_test", **vals):
        vals.setdefault("company_id", self.company.id)
        return self.Config.create({
            "technical_name": tech,
            "label": "Fonctionnalité test",
            "is_active": True,
            **vals,
        })

    def _modules_for(self, employee):
        return self.Config.get_modules_for_user(employee.user_id)


class TestCompanySwitch(FlagsBase):

    def test_active_flag_visible_to_everyone_when_no_targeting(self):
        """Both targeting lists empty = the whole company (historical
        behaviour must be preserved for existing rows)."""
        flag = self._flag()
        self.assertIn(flag, self._modules_for(self.agent))
        self.assertIn(flag, self._modules_for(self.agent_in_group))

    def test_inactive_flag_hidden_even_without_targeting(self):
        self._flag(is_active=False)
        self.assertFalse(self._modules_for(self.agent))

    def test_config_archived_hidden(self):
        self._flag(active=False)
        self.assertFalse(self._modules_for(self.agent))

    def test_other_company_flag_not_leaked(self):
        self._flag(company_id=self.other_company.id)
        self.assertFalse(self._modules_for(self.agent))


class TestGroupTargeting(FlagsBase):

    def test_flag_with_group_hidden_from_non_member(self):
        flag = self._flag(visible_group_ids=[(6, 0, [self.group_agent.id])])
        self.assertNotIn(flag, self._modules_for(self.agent))

    def test_flag_with_group_visible_to_member(self):
        flag = self._flag(visible_group_ids=[(6, 0, [self.group_agent.id])])
        self.assertIn(flag, self._modules_for(self.agent_in_group))

    def test_union_of_two_groups(self):
        flag = self._flag(visible_group_ids=[
            (6, 0, [self.group_agent.id, self.group_chef.id])
        ])
        self.assertIn(flag, self._modules_for(self.agent_in_group))
        self.assertIn(flag, self._modules_for(self.chef))
        self.assertNotIn(flag, self._modules_for(self.agent))


class TestEmployeeTargeting(FlagsBase):

    def test_flag_with_employee_visible_to_that_employee_only(self):
        flag = self._flag(visible_employee_ids=[(6, 0, [self.agent.id])])
        self.assertIn(flag, self._modules_for(self.agent))
        self.assertNotIn(flag, self._modules_for(self.agent_in_group))

    def test_groups_and_employees_union(self):
        """Employee in list OR member of group — never intersection."""
        flag = self._flag(
            visible_group_ids=[(6, 0, [self.group_agent.id])],
            visible_employee_ids=[(6, 0, [self.agent.id])],
        )
        self.assertIn(flag, self._modules_for(self.agent))
        self.assertIn(flag, self._modules_for(self.agent_in_group))
        self.assertNotIn(flag, self._modules_for(self.chef))


class TestMultiCompanyEmployee(FlagsBase):

    def test_same_feature_different_targeting_per_company(self):
        """An employee belonging to two companies can have the feature in one
        and not the other: targeting is resolved per company config row."""
        shared_user = self.agent.user_id
        shared_user.write({
            "company_ids": [(6, 0, [self.company.id, self.other_company.id])],
        })
        flag_here = self._flag(
            visible_employee_ids=[(6, 0, [self.agent.id])]
        )
        flag_other = self._flag(
            tech="flag_test_other",
            company_id=self.other_company.id,
            visible_group_ids=[(6, 0, [self.group_agent.id])],
        )
        modules = self._modules_for(self.agent)
        self.assertIn(flag_here, modules)
        self.assertNotIn(flag_other, modules)


class TestGetActiveFlagHelper(FlagsBase):

    def test_get_active_flag_mirrors_resolution(self):
        flag = self._flag(visible_group_ids=[(6, 0, [self.group_agent.id])])
        self.assertTrue(flag.get_active_flag(self.agent_in_group.user_id, "flag_test"))
        self.assertFalse(flag.get_active_flag(self.agent.user_id, "flag_test"))

    def test_get_active_flag_false_when_inactive(self):
        flag = self._flag(is_active=False)
        self.assertFalse(flag.get_active_flag(self.agent.user_id, "flag_test"))


class TestAuthMeModules(FlagsBase):

    def test_to_mobile_dict_shape_is_stable(self):
        """The payload shape is a public contract with the app — the
        targeting fields are resolved server-side and must NOT leak as
        recordsets."""
        flag = self._flag(
            visible_group_ids=[(6, 0, [self.group_agent.id])],
            settings='{"foo": 1}',
        )
        d = flag.to_mobile_dict()
        self.assertEqual(set(d.keys()), {
            "technical_name", "label", "icon", "route_path", "is_active",
            "requires_role", "phase", "offline_capable", "settings",
        })
        self.assertEqual(d["settings"], '{"foo": 1}')
        self.assertEqual(d["technical_name"], "flag_test")