# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Tests for the mobile API token lifecycle on hr.employee.

The token lives on hr.employee, alongside Odoo's own worker identifiers
(pin, barcode); res.users stays scoped to access control. These tests pin
that placement, the hashing, and the indexed-prefix lookup.
"""

import hashlib

from odoo.tests.common import TransactionCase


class TestMobileApiToken(TransactionCase):

    def setUp(self):
        super().setUp()
        company = self.env.ref("base.main_company")
        partner = self.env["res.partner"].create({"name": "Token Worker Partner"})
        self.user = self.env["res.users"].with_context(no_reset_password=True).create({
            "name": "Token Worker",
            "login": "token.worker@test.example",
            "partner_id": partner.id,
            "company_id": company.id,
            "company_ids": [(6, 0, [company.id])],
            "groups_id": [(6, 0, [self.env.ref("base.group_user").id])],
        })
        self.employee = self.env["hr.employee"].create({
            "name": "Token Worker",
            "user_id": self.user.id,
            "company_id": company.id,
        })

    def test_token_fields_live_on_employee_not_user(self):
        self.assertIn("mobile_api_token", self.env["hr.employee"]._fields)
        self.assertNotIn("mobile_api_token", self.env["res.users"]._fields)

    def test_generate_returns_raw_token_and_stores_only_its_hash(self):
        token = self.employee.generate_mobile_api_token()

        self.assertTrue(token)
        self.assertNotEqual(
            self.employee.mobile_api_token, token,
            "the raw token must never be persisted",
        )
        self.assertEqual(
            self.employee.mobile_api_token,
            hashlib.sha256(token.encode()).hexdigest(),
        )

    def test_generate_sets_an_expiry(self):
        self.employee.generate_mobile_api_token()
        self.assertTrue(self.employee.mobile_api_token_expire)

    def test_generate_stores_the_lookup_index(self):
        """The indexed prefix turns authentication into a single-row lookup
        instead of hashing every employee that ever held a token."""
        token = self.employee.generate_mobile_api_token()
        self.assertEqual(self.employee.mobile_api_token_index, token[:8])

    def test_verify_accepts_the_right_token(self):
        token = self.employee.generate_mobile_api_token()
        self.assertTrue(self.employee.verify_mobile_api_token(token))

    def test_verify_rejects_a_wrong_token(self):
        self.employee.generate_mobile_api_token()
        self.assertFalse(self.employee.verify_mobile_api_token("wrong-token"))

    def test_verify_rejects_when_no_token_is_set(self):
        self.assertFalse(self.employee.verify_mobile_api_token("anything"))

    def test_regenerating_invalidates_the_previous_token(self):
        first = self.employee.generate_mobile_api_token()
        second = self.employee.generate_mobile_api_token()

        self.assertFalse(self.employee.verify_mobile_api_token(first))
        self.assertTrue(self.employee.verify_mobile_api_token(second))

    def test_invalidate_clears_token_index_and_expiry(self):
        token = self.employee.generate_mobile_api_token()
        self.employee.invalidate_mobile_api_token()

        self.assertFalse(self.employee.mobile_api_token)
        self.assertFalse(self.employee.mobile_api_token_index)
        self.assertFalse(self.employee.mobile_api_token_expire)
        self.assertFalse(self.employee.verify_mobile_api_token(token))
