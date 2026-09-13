# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import api, fields, models

from .ocleaneo_nfc_tag import canonical_nfc_uid


class OcleaneoMobilePointage(models.Model):
    _inherit = "ocleaneo.mobile.pointage"

    # Keep the legacy Char field for raw UID, but allow resolving to a registered tag.
    nfc_tag_registry_id = fields.Many2one(
        "ocleaneo.nfc.tag",
        string="Registered NFC Tag",
        compute="_compute_nfc_tag_registry_id",
        store=True,
        index=True,
        help="Registered tag matching the scanned UID.",
    )

    @api.depends("nfc_tag_id")
    def _compute_nfc_tag_registry_id(self):
        for rec in self:
            # canonical_nfc_uid, not just .strip(): the registry stores
            # every uid canonicalized the same way (see ocleaneo_nfc_tag.py)
            # precisely so this exact-match search finds the tag regardless
            # of how the mobile device's NFC reader formatted the raw scan
            # (with/without separators, upper/lower case).
            uid = canonical_nfc_uid(rec.nfc_tag_id)
            if uid:
                tag = self.env["ocleaneo.nfc.tag"].search([("uid", "=", uid)], limit=1)
                rec.nfc_tag_registry_id = tag.id if tag else False
            else:
                rec.nfc_tag_registry_id = False
