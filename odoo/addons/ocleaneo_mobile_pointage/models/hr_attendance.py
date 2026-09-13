# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from odoo.addons.ocleaneo_mobile_api.tools.mobile_time import (
    DEFAULT_TZ,
    local_day_bounds_utc,
    parse_date,
)


class HrAttendance(models.Model):
    _inherit = "hr.attendance"

    ocleaneo_pointage_ids = fields.One2many(
        "ocleaneo.mobile.pointage",
        "hr_attendance_id",
        string="Mobile clockings",
        readonly=True,
    )

    def _ocleaneo_pointage_user(self):
        """Return the res.users that should be associated with a manually
        created departure pointage. Prefer the employee's user; fall back to
        any user linked to the employee's address. Returns None if the
        employee has no user at all — in that case no mobile pointage is
        created, because the model requires a user_id.
        """
        self.ensure_one()
        if not self.employee_id:
            return False
        employee = self.employee_id
        if employee.user_id:
            return employee.user_id
        # Some deployments link the employee to a partner but the user is
        # reached through the partner's user_ids (e.g. portal-style setup).
        if employee.address_id and employee.address_id.user_ids:
            return employee.address_id.user_ids[0]
        return False

    def _ocleaneo_sync_departure_pointage(self):
        """Ensure a closed hr.attendance has a matching mobile departure.

        This is called on manual backoffice changes. It only handles the
        simple, common case: an attendance that has a check_out and an
        associated mobile arrival but no mobile departure. More complex
        cases (pause_debut/pause_fin, multiple slices) are intentionally left
        for explicit backoffice handling.

        Guarded by the ocleaneo_mobile_clocking context key (set for the
        whole duration of a POST /pointage request, see pointage.py): every
        check_out this method could ever see during such a request already
        has its own authoritative ocleaneo.mobile.pointage record — the one
        the mobile clocking flow just created — so there is nothing here to
        backfill. Without this guard a plain pause_debut (which also closes
        the attendance, exactly like a real depart) got "mirrored" into a
        fabricated depart pointage, from three different call sites below
        and in ocleaneo_mobile_pointage.py — hence checking it once, here,
        rather than at each one.
        """
        if self.env.context.get("ocleaneo_mobile_clocking"):
            return
        Pointage = self.env["ocleaneo.mobile.pointage"].sudo()
        for attendance in self:
            if not attendance.check_out:
                continue
            user = attendance._ocleaneo_pointage_user()
            if not user:
                continue

            # Already has a departure for this attendance? Nothing to do.
            if attendance.ocleaneo_pointage_ids.filtered(lambda p: p.type == "depart"):
                continue

            # We need at least one mobile arrival linked to this attendance to
            # mirror a departure against it. Without that anchor we cannot
            # safely invent the fsm_order_id / location_id context.
            arrivals = attendance.ocleaneo_pointage_ids.filtered(lambda p: p.type == "arrivee")
            if not arrivals:
                continue
            # Ignore arrivals that were themselves manually created in the
            # backoffice: they are not the source-of-truth mobile event and do
            # not carry the original GPS/NFC context.
            mobile_arrivals = arrivals.filtered(lambda p: p.source == "mobile")
            if not mobile_arrivals:
                continue
            arrival = mobile_arrivals.sorted("datetime", reverse=True)[0]

            # Only create the mirror if there isn't already a mobile departure
            # on the same day for the same user/order — this prevents a
            # duplicate if the worker actually did depart via the app but the
            # manual edit happened before the next sync.
            existing_depart = Pointage.search([
                ("user_id", "=", user.id),
                ("employee_id", "=", attendance.employee_id.id),
                ("fsm_order_id", "=", arrival.fsm_order_id.id),
                ("type", "=", "depart"),
                ("datetime", ">=", attendance.check_in),
                ("datetime", "<=", attendance.check_out),
                ("source", "=", "mobile"),
            ], limit=1)
            if existing_depart:
                continue

            Pointage.create({
                "user_id": user.id,
                "employee_id": attendance.employee_id.id,
                "fsm_order_id": arrival.fsm_order_id.id,
                "fsm_location_id": arrival.fsm_location_id.id,
                "type": "depart",
                "datetime": attendance.check_out,
                "source": "manuel",
                "state": "valide",
                "hr_attendance_id": attendance.id,
                "company_id": attendance.employee_id.company_id.id or attendance.company_id.id,
            })

    def write(self, vals):
        res = super(HrAttendance, self).write(vals)
        if "check_out" in vals:
            self._ocleaneo_sync_departure_pointage()
        return res

    def recompute_attendance(self, employee_id, target_date, apply=False):
        """Batch safety net for a single suspect day: replay that day's
        ocleaneo.mobile.pointage events in order and compare the resulting
        attendance slices against what is actually stored.

        _manage_hr_attendance() (pointage.py) is intentionally incremental:
        each request only ever looks at "the currently open attendance",
        which is fast but means a bug in that reasoning — like the
        pause_debut → fabricated depart incident this module now regression-
        tests against — can drift the stored hr.attendance away from what
        the event log actually says happened, without anything noticing.
        This method is the batch counterpart the audit recommended: given
        one employee and one local day, it rebuilds the slices a fresh read
        of the log implies and reports every place that disagrees with
        hr.attendance, so a suspect day can be diagnosed on demand instead
        of trusting the incremental machine forever. It never replaces that
        incremental path — both keep running side by side.

        Returns a list of discrepancy dicts, one per mismatch found. With
        apply=False (the default) nothing is written — this is a dry run.
        With apply=True, only gaps get filled in: a slice the log requires
        but hr.attendance is missing gets created, and a slice left open
        that the log says should be closed gets its check_out set. An
        existing hr.attendance row is never edited or deleted beyond that:
        it may carry a legitimate manual correction the event log has no way
        to see, and this tool's job is to surface a disagreement for a human
        to judge, not to silently overwrite payroll data.
        """
        self = self.sudo()
        employee = self.env["hr.employee"].sudo().browse(employee_id)
        if not employee.exists():
            raise ValidationError("recompute_attendance: unknown employee_id %s" % employee_id)

        tz_name = employee.user_id.tz or self.env.user.tz or DEFAULT_TZ
        if isinstance(target_date, str):
            target_date = parse_date(target_date, tz_name)
        day_start, day_end = local_day_bounds_utc(target_date, tz_name)

        events = self.env["ocleaneo.mobile.pointage"].sudo().search([
            ("employee_id", "=", employee.id),
            ("datetime", ">=", day_start),
            ("datetime", "<=", day_end),
            ("state", "!=", "annule"),
        ], order="datetime asc, id asc")

        # Same open/close rules as _manage_hr_attendance, but replayed as a
        # pure pass over this one day's own events — never carrying over
        # "currently open" state from a previous request or a previous day.
        expected_slices = []
        open_slice = None
        for event in events:
            if event.type in ("arrivee", "pause_fin"):
                if open_slice is None:
                    open_slice = {"check_in": event.datetime, "check_out": False}
                # else: reuse (double arrivée, pause_fin without pause_debut) —
                # same "no-op" rule _manage_hr_attendance already applies.
            elif event.type in ("pause_debut", "depart"):
                if open_slice is not None:
                    open_slice["check_out"] = event.datetime
                    expected_slices.append(open_slice)
                    open_slice = None
                # else: closing event with nothing open is already logged as
                # an anomaly by _manage_hr_attendance when it happened; there
                # is no slice to replay it into here.
        if open_slice is not None:
            expected_slices.append(open_slice)

        actual = self.env["hr.attendance"].search([
            ("employee_id", "=", employee.id),
            ("check_in", "<=", day_end),
            "|", ("check_out", ">=", day_start), ("check_out", "=", False),
        ], order="check_in asc")

        discrepancies = []
        expected_check_ins = set()
        for slice_ in expected_slices:
            expected_check_ins.add(slice_["check_in"])
            match = actual.filtered(lambda a, ci=slice_["check_in"]: a.check_in == ci)
            if not match:
                discrepancies.append({
                    "kind": "missing_slice",
                    "check_in": slice_["check_in"],
                    "check_out": slice_["check_out"],
                })
                if apply:
                    self.create({
                        "employee_id": employee.id,
                        "check_in": slice_["check_in"],
                        "check_out": slice_["check_out"],
                    })
                continue

            record = match[0]
            expected_out = slice_["check_out"]
            if expected_out and not record.check_out:
                discrepancies.append({
                    "kind": "should_be_closed",
                    "attendance_id": record.id,
                    "check_in": record.check_in,
                    "expected_check_out": expected_out,
                })
                if apply:
                    record.check_out = expected_out
            elif expected_out and record.check_out and record.check_out != expected_out:
                discrepancies.append({
                    "kind": "check_out_mismatch",
                    "attendance_id": record.id,
                    "stored_check_out": record.check_out,
                    "expected_check_out": expected_out,
                })
            elif not expected_out and record.check_out:
                discrepancies.append({
                    "kind": "closed_but_log_says_open",
                    "attendance_id": record.id,
                    "stored_check_out": record.check_out,
                })

        for record in actual:
            if record.check_in not in expected_check_ins:
                discrepancies.append({
                    "kind": "unmatched_attendance",
                    "attendance_id": record.id,
                    "check_in": record.check_in,
                    "check_out": record.check_out,
                })

        return discrepancies

    @api.model_create_multi
    def create(self, vals_list):
        records = super(HrAttendance, self).create(vals_list)
        # Only mirror manual sources, not mobile-originated ones.
        # hr.attendance has no explicit source field, so we heuristically
        # skip records created while running under a user that does not have
        # the mobile API group, i.e. backoffice/manual entries.
        manual_records = records.filtered(
            lambda a: a.check_out
            and not a.ocleaneo_pointage_ids
            and a._ocleaneo_pointage_user()
        )
        manual_records._ocleaneo_sync_departure_pointage()
        return records
