# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).
{
    "name": "Ocleaneo Mobile Tag Commissioning",
    "summary": "Commissionner des tags NFC depuis l'app mobile : scan d'un tag vierge, enregistrement dans le registre, numéro retourné à l'agent.",
    "version": "14.0.1.0.0",
    "license": "AGPL-3",
    "author": "Ocleaneo",
    "category": "Field Service",
    "website": "https://www.entretien-maconnais.fr",
    "depends": [
        "ocleaneo_mobile_api",
        "ocleaneo_nfc_tag_registry",
    ],
    "data": [
        "security/ir.model.access.csv",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
    "application": False,
    "auto_install": False,
}