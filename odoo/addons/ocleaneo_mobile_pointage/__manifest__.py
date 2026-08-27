# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).
{
    "name": "Ocleaneo Mobile Pointage",
    "summary": "Mobile clocking for field-service orders and daily attendance.",
    "version": "14.0.1.0.8",
    "license": "AGPL-3",
    "author": "Ocleaneo",
    "category": "Human Resources",
    "website": "https://www.entretien-maconnais.fr",
    "depends": [
        "ocleaneo_mobile_api",
        "hr_attendance",
        "hr_timesheet",
        "ocleaneo_fieldservice_timesheet",
        "ocleaneo_timesheet_duration_compute",
    ],
    "data": [
        "security/ir.model.access.csv",
        "security/record_rules.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
