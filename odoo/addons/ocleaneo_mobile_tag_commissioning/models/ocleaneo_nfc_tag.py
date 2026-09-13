# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import fields, models


class OcleaneoNfcTag(models.Model):
    _inherit = "ocleaneo.nfc.tag"

    # Set only by the mobile commissioning endpoint — provenance of the
    # enrollment when it happened in the field (vs. typed by a manager in
    # the registry backoffice, which leaves it empty). Useful when a
    # mislabeled badge has to be traced back to who scanned it, when.
    commissioned_by_employee_id = fields.Many2one(
        "hr.employee",
        string="Commissioned by",
        readonly=True,
        index=True,
        help="Agent who scanned this tag into the registry from the mobile app.",
    )