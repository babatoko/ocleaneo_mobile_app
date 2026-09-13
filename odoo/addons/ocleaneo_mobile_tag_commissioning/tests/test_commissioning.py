# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Commissioning: flag gate, idempotency, normalisation, company binding.

These are ORM-level tests of commission_tag() + the flag resolution, the
same code path the controller serves; the HTTP layer is a thin wrapper
(authenticate -> flag check -> commission_tag) whose pieces are each
covered here.
"""

from odoo.tests.common import TransactionCase

from odoo.addons.ocleaneo_mobile_tag_commissioning import post_init_hook
from odoo.addons.ocleaneo_mobile_tag_commissioning.tools.commissioning import (
    commission_tag,
)


class CommissioningBase(TransactionCase):

    def setUp(self):
        super().setUp()
        self.company = self.env["res.company"].create({"name": "Ocleaneo Test"})
        self.other_company = self.env["res.company"].create({"name": "Ocleaneo Autre"})
        self.agent_user = self.env["res.users"].with_context(
            no_reset_password=True
        ).create({
            "name": "Agent Commission",
            "login": "agent.commission@example.com",
            "company_id": self.company.id,
            "company_ids": [(6, 0, [self.company.id])],
            "groups_id": [(6, 0, [self.env.ref("base.group_user").id,
                                  self.env.ref("fieldservice.group_fsm_user").id])],
        })
        self.agent = self.env["hr.employee"].create({
            "name": "Agent Commission",
            "user_id": self.agent_user.id,
            "company_id": self.company.id,
        })
        post_init_hook(self.env.cr, None)
        self.Config = self.env["mobile.module.config"].sudo()
        self.flag = self.Config.search([
            ("technical_name", "=", "ocleaneo_tag_commissioning"),
            ("company_id", "=", self.company.id),
        ])
        self.assertTrue(self.flag, "post_init_hook must create the flag")
        self.assertFalse(self.flag.is_active, "flag must default to OFF")


class TestFlagFromHook(CommissioningBase):

    def test_hook_creates_one_flag_per_company(self):
        for company in (self.company, self.other_company):
            flag = self.Config.search([
                ("technical_name", "=", "ocleaneo_tag_commissioning"),
                ("company_id", "=", company.id),
            ])
            self.assertEqual(len(flag), 1)
            self.assertFalse(flag.is_active)

    def test_hook_is_idempotent(self):
        before = self.flag.read(["is_active", "route_path"])[0]
        post_init_hook(self.env.cr, None)
        flags = self.Config.search([
            ("technical_name", "=", "ocleaneo_tag_commissioning"),
            ("company_id", "=", self.company.id),
        ])
        self.assertEqual(len(flags), 1)
        self.assertEqual(flags.read(["is_active", "route_path"])[0], before)


class TestCommissionTag(CommissioningBase):

    def test_creates_draft_tag_with_sequence_number(self):
        tag, existing = commission_tag(self.env, self.agent, "045A3B82F16C80")
        self.assertFalse(existing)
        self.assertEqual(tag.state, "draft")
        self.assertTrue(tag.name, "sequence must have filled the tag number")
        self.assertEqual(tag.company_id, self.company)
        self.assertEqual(tag.commissioned_by_employee_id, self.agent)

    def test_normalises_uid_like_registry(self):
        """Same physical badge typed lowercase or colon-separated lands on
        one registry row — canonical_nfc_uid is the registry's own rule."""
        tag1, existing1 = commission_tag(self.env, self.agent, "04:5a:3b:82:f1:6c:80")
        tag2, existing2 = commission_tag(self.env, self.agent, "045A3B82F16C80")
        self.assertFalse(existing1)
        self.assertTrue(existing2)
        self.assertEqual(tag1, tag2)

    def test_rescan_existing_tag_is_idempotent(self):
        tag1, existing1 = commission_tag(self.env, self.agent, "04ABCD")
        tag2, existing2 = commission_tag(self.env, self.agent, "04:AB:CD")
        self.assertEqual(tag1, tag2)
        self.assertTrue(existing2)
        self.assertFalse(existing1)

    def test_unknown_tag_of_any_state_returned_not_modified(self):
        """An already-assigned (active) badge scanned by an agent must come
        back untouched — the registry keeps sole ownership of state."""
        partner = self.env["res.partner"].create({"name": "Client NFC"})
        location = self.env["fsm.location"].create({
            "name": "Site A",
            "partner_id": partner.id,
            "owner_id": partner.id,
        })
        assigned = self.env["ocleaneo.nfc.tag"].create({
            "uid": "04AABBCCDD",
            "state": "active",
            "location_id": location.id,
            "company_id": self.company.id,
        })
        tag, existing = commission_tag(self.env, self.agent, "04AABBCCDD")
        self.assertTrue(existing)
        self.assertEqual(tag, assigned)
        self.assertEqual(tag.state, "active")
        self.assertEqual(tag.location_id, location)

    def test_blank_uid_rejected(self):
        tag, existing = commission_tag(self.env, self.agent, "   ")
        self.assertFalse(tag)
        self.assertFalse(existing)

    def test_chatter_posted_on_first_commission_only(self):
        tag, _ = commission_tag(self.env, self.agent, "04EEEE")
        n = len(tag.message_ids)
        commission_tag(self.env, self.agent, "04EEEE")
        self.assertEqual(len(tag.message_ids), n)


class TestFeatureFlagGate(CommissioningBase):

    def test_flag_off_blocks_endpoint_decision(self):
        """The gate the controller implements: flag absent or inactive ->
        403 branch, regardless of the payload."""
        # flag exists but is off (post_init_hook default)
        config = self.flag
        self.assertFalse(config.get_active_flag(self.agent_user, "ocleaneo_tag_commissioning"))

    def test_flag_on_for_this_company_allows(self):
        self.flag.write({"is_active": True})
        self.assertTrue(self.flag.get_active_flag(self.agent_user, "ocleaneo_tag_commissioning"))

    def test_targeted_flag_excludes_non_member(self):
        """is_active + targeting: the agent must be in the groups/employees
        targeting to pass the gate."""
        self.flag.write({
            "is_active": True,
            "visible_employee_ids": [(6, 0, [self.agent.id])],
        })
        self.assertTrue(self.flag.get_active_flag(self.agent_user, "ocleaneo_tag_commissioning"))

        outsider_user = self.env["res.users"].with_context(no_reset_password=True).create({
            "name": "Outsider",
            "login": "outsider@example.com",
            "company_id": self.company.id,
            "company_ids": [(6, 0, [self.company.id])],
            "groups_id": [(6, 0, [self.env.ref("base.group_user").id])],
        })
        self.assertFalse(self.flag.get_active_flag(outsider_user, "ocleaneo_tag_commissioning"))