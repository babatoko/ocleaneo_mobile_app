# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import models


class FsmLocation(models.Model):
    _inherit = "fsm.location"

    def get_nfc_tag_uid_for_mobile(self):
        """Return the NFC UID the mobile app should match a scan against.

        Plain passthrough here: no local NFC field is declared on this
        module.  ocleaneo_nfc_tag_registry overrides this method to resolve
        the registered tag from the central registry.  Routing every mobile
        controller through this method instead of reading a concrete field
        directly lets that module provide the UID without ocleaneo_mobile_
        pointage/ocleaneo_mobile_api_planning needing to depend on it.
        """
        self.ensure_one()
        return False
