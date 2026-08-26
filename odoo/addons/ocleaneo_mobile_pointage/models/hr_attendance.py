# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import api, fields, models


class HrAttendance(models.Model):
    _inherit = "hr.attendance"

    ocleaneo_pointage_ids = fields.One2many(
        "ocleaneo.mobile.pointage",
        "hr_attendance_id",
        string="Mobile clockings",
        readonly=True,
    )
