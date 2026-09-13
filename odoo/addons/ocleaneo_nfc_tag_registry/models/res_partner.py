# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import fields, models


class ResPartner(models.Model):
    _inherit = "res.partner"

    ocleaneo_nfc_tag_ids = fields.One2many(
        "ocleaneo.nfc.tag",
        "partner_id",
        string="NFC Tags",
        readonly=True,
        help="NFC tags attached to this customer's locations.",
    )
    ocleaneo_nfc_tag_count = fields.Integer(
        string="NFC Tag Count",
        compute="_compute_ocleaneo_nfc_tag_count",
    )

    def _compute_ocleaneo_nfc_tag_count(self):
        for partner in self:
            partner.ocleaneo_nfc_tag_count = len(partner.ocleaneo_nfc_tag_ids)
