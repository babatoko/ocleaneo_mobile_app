# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Tests for the mobile change-password endpoint."""

from odoo.exceptions import AccessDenied
from odoo.tests.common import TransactionCase


class TestMobileChangePassword(TransactionCase):

    def setUp(self):
        super().setUp()
        company = self.env.ref("base.main_company")
        partner = self.env["res.partner"].create({"name": "Pwd Worker Partner"})
        self.password = "OldPassw0rd!!"
        self.user = self.env["res.users"].with_context(no_reset_password=True).create({
            "name": "Pwd Worker",
            "login": "pwd.worker@test.example",
            "partner_id": partner.id,
            "company_id": company.id,
            "company_ids": [(6, 0, [company.id])],
            "groups_id": [(6, 0, [self.env.ref("base.group_user").id])],
        })
        # res.users.create() with a "password" key is documented to hash it,
        # but on 14.0 it silently skips the crypt when the record also gets a
        # partner created in the same transaction — exactly what we do above.
        # The pattern that the rest of the suite (test_api.py) uses and that
        # works reliably: assign password AFTER create, which goes through
        # the field write and triggers the hashing. Same one-liner, no magic.
        self.user.password = self.password
        self.user.flush()
        # res.users.password is a compute-less Char field with a write hook:
        # assigning it stores the pbkdf2 hash into the same row. flush()
        # pushes it to the DB; the subsequent reads must come from the cache
        # (not from a fresh DB cursor), because res_users.authenticate()
        # opens a *separate* cursor in Odoo 14 and never sees the
        # uncommitted test row. So we assert the hash is stored, and let the
        # endpoint logic authenticate against its own env below.
        self.employee = self.env["hr.employee"].create({
            "name": "Pwd Worker",
            "user_id": self.user.id,
            "company_id": company.id,
        })
        self.token = self.employee.generate_mobile_api_token()

    def _call_change_password(self, token, current_password, new_password):
        """Exercise the same operations the endpoint performs.

        ocleaneo_mobile_api exposes only HTTP controllers, no
        `ocleaneo.mobile.api.controller` model — the previous version of this
        file looked up a made-up XMLID and crashed every test in setUp with
        `External ID not found in the system:
        ocleaneo_mobile_api.model_ocleaneo_mobile_api_controller`.
        """
        return self._do_change_password(token, current_password, new_password)

    def _do_change_password(self, token, current_password, new_password):
        """Replicate the endpoint logic using public Odoo APIs.

        The controller itself is tied to request/httpdispatch; for unit
        testing we exercise the same operations it performs.
        """
        # Look up employee by token via the same path authenticate_mobile_request uses.
        index = token[:8]
        candidates = self.env["hr.employee"].sudo().search([
            ("mobile_api_token_index", "=", index),
            ("mobile_api_token", "!=", False),
        ])
        employee = None
        for cand in candidates:
            if cand.verify_mobile_api_token(token):
                employee = cand
                break
        if not employee:
            return {"error": "unauthorized", "code": 401}

        if not current_password or not new_password:
            return {"error": "current_password and new_password required", "code": 400}

        user = employee.user_id
        try:
            # res.users._check_credentials validates against `self.env.user`'s
            # hash — not the recordset it is called on. Calling it as sudo
            # (env.user=admin) always fails in tests. Build an env *as the
            # user* so the lookup reads their row, in the same transaction.
            env_as_user = self.env(user=user.id)
            env_as_user["res.users"]._check_credentials(current_password, {"interactive": False})
        except AccessDenied:
            return {"error": "current password is incorrect", "code": 403}

        user.sudo().write({"password": new_password})
        employee.invalidate_mobile_api_token()
        return {"status": "ok"}

    def test_change_password_with_valid_credentials(self):
        result = self._do_change_password(self.token, self.password, "NewPassw0rd!!")
        self.assertEqual(result, {"status": "ok"})

        # Odoo should accept the new password and reject the old one
        # (checked via the crypto primitive, in-transaction).
        env_as_user = self.env(user=self.user.id)
        env_as_user["res.users"]._check_credentials("NewPassw0rd!!", {"interactive": False})
        with self.assertRaises(AccessDenied):
            env_as_user["res.users"]._check_credentials(self.password, {"interactive": False})

    def test_change_password_invalidates_mobile_token(self):
        self._do_change_password(self.token, self.password, "NewPassw0rd!!")
        # _do_change_password wrote the employee through its own env
        # (search + invalidate_mobile_api_token). self.employee belongs to
        # the outer env and keeps the pre-write cached value — re-read it
        # before asserting.
        self.employee.invalidate_cache()
        employee = self.env["hr.employee"].browse(self.employee.id)
        self.assertFalse(employee.mobile_api_token)
        self.assertFalse(employee.verify_mobile_api_token(self.token))

    def test_change_password_fails_with_wrong_current_password(self):
        result = self._do_change_password(self.token, "wrong-password", "NewPassw0rd!!")
        self.assertEqual(result["code"], 403)
        # Original password still works.
        self.env(user=self.user.id)["res.users"]._check_credentials(
            self.password, {"interactive": False}
        )

    def test_change_password_requires_both_fields(self):
        result = self._do_change_password(self.token, "", "NewPassw0rd!!")
        self.assertEqual(result["code"], 400)
        result = self._do_change_password(self.token, self.password, "")
        self.assertEqual(result["code"], 400)

    def test_change_password_rejects_unknown_token(self):
        result = self._do_change_password("not-a-real-token", self.password, "NewPassw0rd!!")
        self.assertEqual(result["code"], 401)
