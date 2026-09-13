# Copyright 2026 Ocleaneo (https://www.ocleaneo.ch)
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import api, fields, models


class FsmOrder(models.Model):
    _inherit = "fsm.order"

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._ocleaneo_sync_request_window(vals)
        return super(FsmOrder, self).create(vals_list)

    def write(self, vals):
        self._ocleaneo_sync_request_window(vals)
        return super(FsmOrder, self).write(vals)

    def _ocleaneo_sync_request_window(self, vals):
        """
        Keep the OCA fieldservice request window (request_early/request_late)
        in sync with the scheduled date when it is explicitly changed.

        This prevents stale request window dates (e.g. July) from persisting
        after a duplicated order is rescheduled for another month, which
        otherwise leaves Odoo planning views and mobile tour data partly
        outdated.
        """
        scheduled_start = vals.get("scheduled_date_start")
        if scheduled_start is False:
            # User is clearing the scheduled date; do not force a request window.
            return
        if not scheduled_start:
            return

        scheduled_start_dt = fields.Datetime.to_datetime(scheduled_start)
        if not scheduled_start_dt:
            return

        # Update the request window only if it currently differs, to avoid
        # unnecessary writes and to respect explicit request-date edits.
        early_dt = self.request_early if self else False
        if "request_early" in vals:
            early_dt = fields.Datetime.to_datetime(vals["request_early"])

        if early_dt and early_dt.date() == scheduled_start_dt.date():
            return

        vals["request_early"] = scheduled_start_dt
        # request_late is recomputed by the parent create/write logic, but
        # setting a value here ensures it stays coherent when the parent logic
        # does not run (e.g. direct write without the standard helpers).
        vals["request_late"] = scheduled_start_dt