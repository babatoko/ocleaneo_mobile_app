# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import logging

from odoo import _, fields, models

_logger = logging.getLogger(__name__)

# Below this share of the scheduled duration, the worker is considered to
# not have done the job at all: the order is left exactly as if nobody had
# clocked in on it.
MIN_RATIO_PARTIAL = 0.10
# At or above this share, the job is considered done and the order closes.
# Between the two thresholds it is only partially done: the order stays
# open, but a manager is alerted and the ratio is exposed to the mobile app.
MIN_RATIO_DONE = 0.90


class FsmOrder(models.Model):
    _inherit = "fsm.order"

    completion_ratio = fields.Float(
        string="Taux de réalisation",
        help="Temps de présence effectif (somme des lignes de temps liées à "
             "cette commande, account.analytic.line.unit_amount) rapporté à "
             "la durée prévue (scheduled_duration). Recalculé à chaque "
             "départ pointé sur ce chantier.",
    )
    completion_state = fields.Selection([
        ("not_done", "Non fait"),
        ("partial", "Fait partiellement"),
        ("done", "Terminé"),
    ], string="État de réalisation", copy=False)

    def _worked_hours(self):
        self.ensure_one()
        return sum(self.timesheet_ids.mapped("unit_amount"))

    def update_completion_from_worked_time(self, employee=None):
        """Recompute completion_ratio/completion_state from time actually
        worked vs the scheduled duration, and close the order only when
        enough of that duration was actually spent on site.

        Called from controllers/pointage.py after every 'depart' clocking.
        Before this method existed, a departure unconditionally closed the
        FSM order regardless of how long the worker had been there —
        clocking in and immediately back out marked a job "Completed" the
        same as an honest full visit.

        Rule:
        - worked/planned < 10%: not done at all — order left untouched.
        - 10% <= worked/planned < 90%: partially done — order stays open,
          the manager is alerted (chatter + activity) and the ratio is
          exposed to the mobile app so it can show its own alert.
        - worked/planned >= 90%: done — order closed, as before.

        `employee` is the worker who just clocked out, passed in by the
        caller (which already resolved it from the auth token) rather than
        re-derived here from fsm.order.person_id — that field is an
        fsm.person, not an hr.employee, and matching one back to the other
        would need a partner lookup the caller has no reason to redo. It is
        only used to find a manager to alert; the completion computation
        itself does not depend on it.

        An order with no scheduled_duration has nothing to compare worked
        time against, so it keeps the old unconditional behavior (closed on
        depart) rather than being stuck open forever for lack of data.
        """
        for order in self:
            planned_hours = order.scheduled_duration
            worked_hours = order._worked_hours()

            if not planned_hours or planned_hours <= 0:
                order.completion_ratio = 0.0
                order.completion_state = "done"
                order._close_as_completed()
                continue

            ratio = worked_hours / planned_hours
            order.completion_ratio = ratio

            if ratio < MIN_RATIO_PARTIAL:
                order.completion_state = "not_done"
            elif ratio < MIN_RATIO_DONE:
                order.completion_state = "partial"
                order._alert_manager_partial_completion(employee, worked_hours, planned_hours, ratio)
            else:
                order.completion_state = "done"
                order._close_as_completed()

    def _close_as_completed(self):
        """Move to the closed 'Completed' stage, bypassing the Kanban guard.

        fsm.order.write() (OCA fieldservice) refuses a plain write to the
        Completed stage ("Cannot move to completed from Kanban") unless
        is_button=True is set in the very same write — see its source for
        why: that guard exists to force completion through the button
        action's own side effects rather than a raw stage_id write from the
        Kanban view. is_button is reset to False by that same write, so it
        never lingers as stored state.
        """
        self.ensure_one()
        completed_stage = self.env["fsm.stage"].sudo().search([
            ("name", "ilike", "completed"),
            ("is_closed", "=", True),
        ], limit=1)
        if completed_stage:
            try:
                self.write({"stage_id": completed_stage.id, "is_button": True})
            except Exception as e:
                _logger.warning("Could not set FSM order %s to Completed: %s", self.id, e)

    def _alert_manager_partial_completion(self, employee, worked_hours, planned_hours, ratio):
        """Post a chatter note on the order and raise an activity for the
        clocking employee's manager (hr.employee.parent_id) — there is no
        dedicated "FSM manager" field on fsm.order/fsm.team, and the
        reporting manager is the one generic field guaranteed to exist for
        every worker without extra configuration.

        The chatter note is posted regardless of whether a manager is
        found, so the alert is never silently lost for an employee with no
        parent_id set — only the activity (which needs a concrete
        assignee) is skipped in that case.
        """
        self.ensure_one()
        message = _(
            "Chantier fait partiellement : %(pct)s%% du temps prévu a été "
            "passé sur place (%(worked).2fh sur %(planned).2fh prévues)."
        ) % {
            "pct": round(ratio * 100),
            "worked": worked_hours,
            "planned": planned_hours,
        }
        self.message_post(body=message)

        manager = employee.parent_id if employee else self.env["hr.employee"]
        if manager and manager.user_id:
            self.activity_schedule(
                "mail.mail_activity_data_todo",
                summary=_("Chantier fait partiellement"),
                note=message,
                user_id=manager.user_id.id,
            )
        else:
            _logger.info(
                "No manager (hr.employee.parent_id.user_id) to alert about "
                "partial completion of FSM order %s (employee=%s)",
                self.id, employee.name if employee else None,
            )
