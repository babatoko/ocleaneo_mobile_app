# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import api, models, fields


class AccountAnalyticLine(models.Model):
    _inherit = "account.analytic.line"

    # Replace the computed date_time_end from project_timesheet_time_control
    # with a stored, user-controlled datetime. This prevents Odoo from
    # overwriting the user's input when they edit the end time.
    #
    # compute=False, inverse=False ARE REQUIRED here, not cosmetic: Odoo's
    # field merging across an _inherit chain only overrides attributes a
    # child class explicitly passes (see odoo/fields.py Field._get_attrs,
    # `attrs.update(field.args)` then `attrs.update(self.args)` — a key
    # simply absent from the child's args is left untouched, it is not
    # reset to a default). Without compute=False/inverse=False, this
    # redeclaration does NOT drop project_timesheet_time_control's
    # compute="_compute_date_time_end" / inverse="_inverse_date_time_end":
    # store=True just makes it a *stored* computed+inverse field, and every
    # write() to date_time_end still runs through that inherited inverse
    # (which derives unit_amount from a UoM-hours check that our mobile
    # flow never satisfies, since the lines it creates don't set
    # product_uom_id) instead of behaving like the plain field this module
    # was written to assume. Confirmed against the real OCA source
    # (OCA/project, 14.0 branch) and Odoo 14's own field-merging code —
    # verified precedent for this exact pattern: OCA/stock-logistics-
    # orderpoint uses `compute=False, store=False` to the same end.
    date_time_end = fields.Datetime(
        string="End Time",
        store=True,
        copy=False,
        compute=False,
        inverse=False,
    )

    @api.onchange("date_time", "date_time_end")
    def _onchange_date_time_duration(self):
        """Recalculate unit_amount in real time when start/end times change."""
        for line in self:
            if line.date_time and line.date_time_end and line.date_time_end > line.date_time:
                duration_hours = (line.date_time_end - line.date_time).total_seconds() / 3600.0
                line.unit_amount = round(duration_hours, 2)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            vals = self._compute_duration(vals)
        return super(AccountAnalyticLine, self).create(vals_list)

    def write(self, vals):
        """Recompute unit_amount from date_time/date_time_end.

        The mobile clocking flow (ocleaneo_mobile_pointage) creates a line
        with only date_time set, then later writes only date_time_end on
        that same record (`open_line.date_time_end = now`) once the worker
        clocks out. _compute_duration(vals) alone only ever sees whichever
        single field is in vals for that call, so it never fired on the
        write that actually closes the line — every mobile-created
        timesheet stayed at unit_amount=0. Falling back to each record's
        own current value for the field not present in vals fixes that
        while still supporting direct two-field writes/create() calls.
        """
        if ('date_time' in vals or 'date_time_end' in vals) and 'unit_amount' not in vals:
            for line in self:
                merged = dict(vals)
                merged.setdefault('date_time', line.date_time)
                merged.setdefault('date_time_end', line.date_time_end)
                merged = self._compute_duration(merged)
                super(AccountAnalyticLine, line).write(merged)
            return True
        return super(AccountAnalyticLine, self).write(vals)

    def _compute_duration(self, vals):
        """Compute unit_amount from date_time and date_time_end when applicable.
        If both date_time and date_time_end are provided, recalculate unit_amount
        unless the user explicitly set a non-zero unit_amount in the same call."""
        if vals.get('date_time') and vals.get('date_time_end'):
            # If user explicitly supplied a non-zero unit_amount, respect it.
            if vals.get('unit_amount'):
                return vals
            start = fields.Datetime.from_string(vals['date_time']) if isinstance(vals['date_time'], str) else vals['date_time']
            end = fields.Datetime.from_string(vals['date_time_end']) if isinstance(vals['date_time_end'], str) else vals['date_time_end']
            if start and end and end > start:
                duration_hours = (end - start).total_seconds() / 3600.0
                vals['unit_amount'] = round(duration_hours, 2)
        return vals
