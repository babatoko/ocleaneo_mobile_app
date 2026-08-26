# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import api, fields, models


class MobileModuleConfig(models.Model):
    _name = "mobile.module.config"
    _description = "Mobile App Module Configuration"
    _order = "sequence, id"

    active = fields.Boolean(string="Active", default=True)
    sequence = fields.Integer(string="Sequence", default=10)
    company_id = fields.Many2one("res.company", string="Company", required=True, default=lambda self: self.env.company)
    technical_name = fields.Char(string="Technical name", required=True, help="Module technical name, e.g. ocleaneo_mobile_pointage")
    label = fields.Char(string="Display label", required=True, translate=True, help="Label shown in the mobile app")
    icon = fields.Char(string="Icon name", default="apps", help="Material/Ionic icon name")
    route_path = fields.Char(string="Route path", help="Mobile app route path, e.g. /pointage")
    is_active = fields.Boolean(string="Enabled", default=True)
    requires_role = fields.Selection([
        ("all", "All"),
        ("agent", "Agent"),
        ("chef_equipe", "Chef d'équipe"),
        ("responsable", "Responsable exploitation"),
    ], string="Required role", default="all")
    phase = fields.Selection([
        ("mvp", "MVP"),
        ("phase2", "Phase 2"),
        ("phase3", "Phase 3"),
        ("phase4", "Phase 4"),
    ], string="Phase", default="mvp")
    offline_capable = fields.Boolean(string="Offline capable", default=False)
    settings = fields.Text(string="JSON settings", help="Module-specific JSON configuration consumed by the mobile app")

    _sql_constraints = [
        ("uniq_tech_name_company", "unique(technical_name, company_id)", "A module configuration already exists for this company."),
    ]

    def to_mobile_dict(self):
        self.ensure_one()
        return {
            "technical_name": self.technical_name,
            "label": self.label,
            "icon": self.icon,
            "route_path": self.route_path,
            "is_active": self.is_active,
            "requires_role": self.requires_role,
            "phase": self.phase,
            "offline_capable": self.offline_capable,
            "settings": self.settings or "{}",
        }

    @api.model
    def get_modules_for_user(self, user):
        """Return active mobile module configs for a given user/company."""
        company_id = user.company_id.id
        domain = [
            ("active", "=", True),
            ("is_active", "=", True),
            ("company_id", "in", [company_id] + user.company_ids.ids),
        ]
        return self.sudo().search(domain, order="sequence, id")
