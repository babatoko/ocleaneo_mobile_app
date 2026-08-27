# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import fields, models


class MobileApiPlanningConfig(models.Model):
    _name = "mobile.api.planning.config"
    _description = "Mobile API Planning Configuration"

    company_id = fields.Many2one("res.company", string="Company", required=True, default=lambda self: self.env.company)
    default_view = fields.Selection([
        ("day", "Day"),
        ("week", "Week"),
        ("route", "Optimized route"),
    ], string="Default view", default="day")
    show_customer_phone = fields.Boolean(string="Show customer phone", default=True)
    show_customer_email = fields.Boolean(string="Show customer email", default=False)
    show_route_duration = fields.Boolean(string="Show route duration", default=True)
    optimized_route_provider = fields.Selection([
        ("osrm", "OSRM (self-hosted)"),
        ("manual", "Manual / none"),
    ], string="Route provider", default="osrm")
    osrm_base_url = fields.Char(string="OSRM base URL", default="http://localhost:5000")
