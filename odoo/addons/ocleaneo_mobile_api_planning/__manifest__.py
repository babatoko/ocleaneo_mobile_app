# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

{
    "name": "Ocleaneo Mobile API Planning",
    "summary": "REST/JSON planning endpoints for the employee mobile app.",
    "version": "14.0.1.0.9",
    "license": "AGPL-3",
    "author": "Ocleaneo",
    "category": "API",
    "website": "https://www.entretien-maconnais.fr",
    "depends": [
        "ocleaneo_mobile_api",
        # fsm.order.order_activity_ids (fsm.activity) — la checklist
        # d'activités renvoyée par /planning.
        "fieldservice_activity",
        # fsm.location.nfc_tag_id (ocleaneo#13) — /planning doit exposer le
        # même identifiant de badge que /chantiers/aujourdhui, sinon le
        # scan NFC ne peut matcher que contre cette dernière liste, plafonnée
        # à 50 et non filtrée par date.
        "ocleaneo_mobile_pointage",
    ],
    "data": [
        "security/ir.model.access.csv",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
