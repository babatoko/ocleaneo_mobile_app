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
    visible_group_ids = fields.Many2many(
        "res.groups",
        "mobile_module_config_group_rel",
        "config_id",
        "group_id",
        string="Visible groups",
        help=(
            "Restrict this feature to these user groups. Empty (together with "
            "the employees list) = every employee of the company sees it. "
            "Non-empty = union with the employees list: an employee sees the "
            "feature if they belong to at least one of these groups OR appear "
            "in the employees list."
        ),
    )
    visible_employee_ids = fields.Many2many(
        "hr.employee",
        "mobile_module_config_employee_rel",
        "config_id",
        "employee_id",
        string="Visible employees",
        help=(
            "Restrict this feature to these employees. Empty (together with "
            "the groups list) = every employee of the company sees it. "
            "Non-empty = union with the groups list."
        ),
    )
    requires_role = fields.Selection([
        ("all", "All"),
        ("agent", "Agent"),
        ("chef_equipe", "Chef d'équipe"),
        ("responsable", "Responsable exploitation"),
    ], string="Required role", default="all",
        help="Legacy, superseded by the groups/employees targeting above. "
             "Kept in the payload for app compatibility; never enforced.")
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

    def _is_visible_for_employee(self, employee):
        """Targeting rule for one config row vs one employee.

        Both targeting lists empty -> the feature is company-wide: visible.
        Otherwise the employee must belong to at least one of the selected
        groups (via their linked user's groups_id) OR appear in the selected
        employees list (union, never intersection).

        `self.company_id` is already one of the caller's companies when this
        is called from get_modules_for_user(); cross-company membership is
        handled there (one config row per company), not here.
        """
        self.ensure_one()
        if not self.visible_group_ids and not self.visible_employee_ids:
            return True
        if employee and employee in self.visible_employee_ids:
            return True
        user = employee.user_id if employee else employee
        if user and user.groups_id & self.visible_group_ids:
            return True
        return False

    @api.model
    def get_modules_for_user(self, user):
        """Return the mobile module configs resolved FOR one user, company by
        company, targeting applied.

        This is the single source of truth shared by the login payload, the
        /auth/me payload and every mobile endpoint that must refuse a
        disabled feature (403): the app hides screens based on this list and
        the server re-checks membership in it, so a screen can never be
        visible while its endpoint refuses.

        Resolution per config row:
        - the row must be active and enabled (is_active), for one of the
          user's companies (unchanged from the historical behaviour);
        - then targeting applies per employee (see _is_visible_for_employee):
          empty lists = the whole company; non-empty = employee in the
          employees list OR their user carries one of the groups.

        `requires_role` is carried into the payload but NOT filtered on
        here — it is legacy, superseded by the explicit groups/employees
        targeting. Anything that must actually be denied to a worker has to
        be denied by the route that serves it, not by leaving an entry out
        of this list.
        """
        employee = self.env["hr.employee"].sudo().search([
            ("user_id", "=", user.id),
        ], limit=1)
        configs = []
        for config in self.sudo().search([
            ("active", "=", True),
            ("is_active", "=", True),
            ("company_id", "in", [user.company_id.id] + user.company_ids.ids),
        ], order="sequence, id"):
            if config._is_visible_for_employee(employee):
                configs.append(config)
        return self.sudo().browse([c.id for c in configs])

    def get_active_flag(self, user, technical_name):
        """Boolean helper for endpoints: is this feature enabled for this
        user (company + targeting)? The 403 check of e.g. the tag
        commissioning route is a membership test on get_modules_for_user(),
        so the UI and the API can never disagree.
        """
        self.ensure_one()
        return self in self.get_modules_for_user(user)