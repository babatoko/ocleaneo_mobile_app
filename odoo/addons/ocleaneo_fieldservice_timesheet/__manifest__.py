# Copyright 2025 Camptocamp SA
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).
{
    "name": "Field Service - Timesheet (Ocleaneo Backport v14)",
    "summary": "Timesheet on Field Service Orders — backport of fieldservice_timesheet v18 for Odoo 14.",
    "version": "14.0.1.0.0",
    "license": "AGPL-3",
    "author": "Camptocamp, Odoo Community Association (OCA), Ocleaneo",
    "category": "Project",
    "website": "https://github.com/OCA/field-service",
    "depends": [
        "hr_timesheet",
        "fieldservice_project",
    ],
    "data": [
        "views/fsm_order.xml",
        "views/hr_timesheet.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
