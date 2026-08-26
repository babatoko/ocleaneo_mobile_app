# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).
{
    "name": "Timesheet Duration Auto-Compute",
    "summary": "Compute unit_amount automatically from date_time and date_time_end on account.analytic.line, for UI and API.",
    "version": "14.0.1.0.3",
    "license": "AGPL-3",
    "author": "Ocleaneo",
    "category": "Timesheet",
    "website": "https://www.entretien-maconnais.fr",
    "depends": [
        "project_timesheet_time_control",
        "hr_timesheet",
    ],
    "data": [
        "views/account_analytic_line_views.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
