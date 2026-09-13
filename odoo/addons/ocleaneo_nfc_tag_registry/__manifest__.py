# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).
{
    "name": "Ocleaneo NFC Tag Registry",
    "summary": "Central registry of NFC tags assigned to field-service locations.",
    "version": "14.0.1.0.11",
    "license": "AGPL-3",
    "author": "Ocleaneo",
    "category": "Field Service",
    "website": "https://www.entretien-maconnais.fr",
    "depends": [
        "fieldservice",
        "ocleaneo_mobile_pointage",
    ],
    "data": [
        "data/sequence.xml",
        "security/ir.model.access.csv",
        "security/record_rules.xml",
        "views/ocleaneo_nfc_tag_views.xml",
        "views/fsm_location_views.xml",
        "views/res_partner_views.xml",
        "views/menu.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
