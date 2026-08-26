# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).
{
    "name": "Ocleaneo Mobile API",
    "summary": "REST/JSON API for the employee mobile app: auth, pointage, planning.",
    "version": "14.0.1.0.4",
    "license": "AGPL-3",
    "author": "Ocleaneo",
    "category": "API",
    "website": "https://www.entretien-maconnais.fr",
    "depends": [
        "base",
        "mail",
        "hr",
        "hr_attendance",
        "fieldservice",
        "ocleaneo_fieldservice_timesheet",
    ],
    "data": [
        "security/ir.model.access.csv",
        "security/record_rules.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
