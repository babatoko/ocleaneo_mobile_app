# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import fields, models


class FsmLocation(models.Model):
    _inherit = "fsm.location"

    # fsm.location (OCA fieldservice) has no field for this — see
    # docs/backend-integration-plan.md and README § Anti-fraude par
    # géofence. Matched against a scanned badge UID by
    # stores/pointage.ts (frontend) via GET /chantiers/aujourdhui.
    nfc_tag_id = fields.Char(string="NFC Tag ID")
