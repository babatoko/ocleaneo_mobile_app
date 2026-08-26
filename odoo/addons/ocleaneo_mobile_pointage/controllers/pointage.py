# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import http, fields
from odoo.http import request
from odoo.exceptions import ValidationError, AccessError
import logging

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import (
    MOBILE_CORS_ORIGIN,
    authenticate_mobile_request,
)
from odoo.addons.ocleaneo_mobile_api.tools.mobile_time import local_day_bounds_utc, local_to_utc, parse_date

_logger = logging.getLogger(__name__)


class MobilePointageController(http.Controller):

    def _get_fsm_person(self, env, user):
        """Resolve the fsm.person linked to the authenticated user's partner."""
        return env["fsm.person"].sudo().search([("partner_id", "=", user.partner_id.id)], limit=1)

    @http.route("/api/mobile/chantiers/aujourdhui", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def chantiers_aujourdhui(self, **kwargs):
        """Return today's FSM orders for the connected employee."""
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        today = fields.Date.today()
        person = self._get_fsm_person(env, user)
        if not person:
            return {"count": 0, "orders": []}

        # FSM orders assigned to this worker and not closed.
        domain = [
            ("person_id", "=", person.id),
            ("stage_id.is_closed", "!=", True),
            ("company_id", "in", user.company_ids.ids or [user.company_id.id]),
        ]

        orders = env["fsm.order"].sudo().search(domain, limit=50, order="date_start desc, id desc")
        result = []
        for order in orders:
            result.append({
                "id": order.id,
                "name": order.name,
                "location_id": order.location_id.id,
                "location_name": order.location_id.name,
                "location_street": order.location_id.street,
                "location_city": order.location_id.city,
                "location_latitude": order.location_id.partner_latitude or False,
                "location_longitude": order.location_id.partner_longitude or False,
                "person_id": order.person_id.id,
                "person_name": order.person_id.name,
                "stage": order.stage_id.name,
                "date_start": order.date_start.isoformat() if order.date_start else False,
                "date_end": order.date_end.isoformat() if order.date_end else False,
            })
        return {"count": len(result), "orders": result}

    @http.route("/api/mobile/pointage/mine", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def pointage_mine(self, date=None, date_from=None, date_to=None, **kwargs):
        """Return the authenticated worker's own clocking records.

        No read endpoint existed for ocleaneo.mobile.pointage before this —
        POST /api/mobile/pointage could only create records, leaving a
        provider with no way to show today's status or clocking history
        after the fact. Query parameters:
        - date: YYYY-MM-DD, single day (defaults to today). Ignored if
          date_from/date_to are given.
        - date_from, date_to: YYYY-MM-DD, inclusive range.
        """
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        date_from = kwargs.get("date_from", date_from)
        date_to = kwargs.get("date_to", date_to)
        if date_from or date_to:
            range_start = parse_date(date_from) if date_from else fields.Date.today()
            range_end = parse_date(date_to) if date_to else range_start
        else:
            range_start = range_end = parse_date(kwargs.get("date", date))

        # Same local-day-boundary handling as chantiers/aujourdhui and
        # planning — a naive UTC window would misplace clockings for
        # shifts starting before dawn or crossing midnight.
        date_start, _ = local_day_bounds_utc(range_start, user.tz)
        _, date_end = local_day_bounds_utc(range_end, user.tz)

        Pointage = env["ocleaneo.mobile.pointage"].sudo()
        records = Pointage.search([
            ("user_id", "=", user.id),
            ("datetime", ">=", date_start),
            ("datetime", "<=", date_end),
        ], order="datetime asc")

        entries = [{
            "id": p.id,
            "type": p.type,
            "datetime": p.datetime.isoformat() if p.datetime else False,
            "fsm_order_id": p.fsm_order_id.id if p.fsm_order_id else False,
            "fsm_location_id": p.fsm_location_id.id if p.fsm_location_id else False,
            "commentaire": p.commentaire or False,
            "client_ref": p.client_ref or False,
        } for p in records]

        return {
            "date_from": str(range_start),
            "date_to": str(range_end),
            "count": len(entries),
            "entries": entries,
        }

    @http.route("/api/mobile/pointage", type="json", auth="none", methods=["POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def pointage(self, type=None, fsm_order_id=None, gps_latitude=None, gps_longitude=None,
                 gps_accuracy=None, nfc_tag_id=None, photo=None, commentaire=None,
                 datetime=None, description=None, client_ref=None, **kwargs):
        """Record a mobile clocking and update Odoo attendance/timesheet.

        datetime: ISO8601 local time sent by the mobile app.
        description: free text entered by the worker (used as timesheet line name).
        client_ref: idempotency key generated once by the app for this
            clocking (frontend CreateTimeEntryPayload.clientRef) and
            resent unchanged on every retry — including after an offline
            queue replay, or when the app only *thinks* the first attempt
            failed because the response was lost after the server had
            already processed it. Without honoring it, a retry creates a
            second attendance/timesheet/pointage record for the same
            physical clock-in.
        """
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        pointage_type = type
        if pointage_type not in ("arrivee", "depart", "pause_debut", "pause_fin"):
            return {"error": "invalid type", "code": 400}

        if client_ref:
            existing = env["ocleaneo.mobile.pointage"].sudo().search([
                ("user_id", "=", user.id),
                ("client_ref", "=", client_ref),
            ], limit=1)
            if existing:
                return self._pointage_response(existing)

        now = local_to_utc(datetime)
        company_id = employee.company_id.id or user.company_id.id

        vals = {
            "user_id": user.id,
            "employee_id": employee.id,
            "type": pointage_type,
            "datetime": now,
            "gps_latitude": gps_latitude,
            "gps_longitude": gps_longitude,
            "gps_accuracy": gps_accuracy,
            "nfc_tag_id": nfc_tag_id,
            "commentaire": commentaire,
            "client_ref": client_ref,
            "source": "mobile",
            "company_id": company_id,
        }
        order = env["fsm.order"].browse(False)
        if fsm_order_id:
            try:
                fsm_order_id = int(fsm_order_id)
            except (TypeError, ValueError):
                return {"error": "invalid fsm_order_id", "code": 400}
            order = env["fsm.order"].sudo().browse(fsm_order_id)
            if not order.exists():
                return {"error": "fsm_order not found", "code": 404}
            # Ownership check: a worker may only clock on FSM orders assigned
            # to their own fsm.person — without this, any authenticated user
            # could pass an arbitrary fsm_order_id and clock (and, on
            # "depart", close) another employee's job.
            person = self._get_fsm_person(env, user)
            if not person or order.person_id.id != person.id:
                return {"error": "forbidden: fsm_order does not belong to this worker", "code": 403}
            vals["fsm_order_id"] = order.id
            vals["fsm_location_id"] = order.location_id.id

        pointage = env["ocleaneo.mobile.pointage"].sudo().create(vals)

        # ---- Global attendance (hr.attendance) ----
        attendance_ids = self._manage_hr_attendance(env, employee, pointage_type, now)
        if attendance_ids:
            pointage.hr_attendance_id = attendance_ids[0]

        # ---- Job timesheet (account.analytic.line with fsm_order_id) ----
        timesheet_ids = self._manage_timesheet(env, employee, pointage, pointage_type, now, description)
        if timesheet_ids:
            pointage.timesheet_line_ids = [(6, 0, timesheet_ids)]

        # ---- Close FSM order on depart ----
        if pointage_type == "depart" and order and order.exists():
            completed_stage = env["fsm.stage"].sudo().search([
                ("name", "ilike", "completed"),
                ("is_closed", "=", True),
            ], limit=1)
            if completed_stage:
                try:
                    order.write({"stage_id": completed_stage.id, "is_button": True})
                except Exception as e:
                    _logger.warning("Could not set FSM order %s to Completed: %s", order.id, e)

        return self._pointage_response(pointage, timesheet_ids)

    def _pointage_response(self, pointage, timesheet_ids=None):
        """Build the /api/mobile/pointage response payload for a pointage
        record — shared by the normal create path and the client_ref
        idempotent-replay path, so a retried request gets back exactly the
        same shape as the original.
        """
        if timesheet_ids is None:
            timesheet_ids = pointage.timesheet_line_ids.ids
        return {
            "id": pointage.id,
            "type": pointage.type,
            "datetime": pointage.datetime.isoformat(),
            "attendance_id": pointage.hr_attendance_id.id,
            "timesheet_ids": timesheet_ids,
            "fsm_order_id": pointage.fsm_order_id.id if pointage.fsm_order_id else False,
        }

    def _get_project_pointage_chantiers(self, env, company_id):
        """Return the generic 'Pointage chantiers' project for the given company.

        Prefers an explicit ir.config_parameter (set once, e.g. from the
        Odoo shell: `env['ir.config_parameter'].set_param(
        'ocleaneo_mobile_pointage.project_id', str(project.id))`) so
        renaming the project from the UI — a completely normal action — no
        longer silently breaks timesheet creation for every worker. Falls
        back to the name search only when no id has been configured.
        """
        Project = env["project.project"].sudo()
        project_id = env["ir.config_parameter"].sudo().get_param("ocleaneo_mobile_pointage.project_id")
        if project_id:
            try:
                project = Project.browse(int(project_id))
            except (TypeError, ValueError):
                project = Project.browse()
            if project.exists():
                return project
            _logger.warning(
                "ocleaneo_mobile_pointage.project_id=%s does not exist; falling back to name search",
                project_id,
            )

        project = Project.search([
            ("name", "ilike", "pointage chantiers"),
            ("company_id", "=", company_id),
        ], limit=1)
        if not project and company_id:
            # Fallback: any project named Pointage chantiers regardless of company
            project = Project.search([("name", "ilike", "pointage chantiers")], limit=1)
        return project

    def _manage_hr_attendance(self, env, employee, pointage_type, now):
        """Create or update hr.attendance records.

        Rule:
        - arrivee: open a new attendance.
        - depart: close the open attendance.
        - pause_debut: close the current morning attendance.
        - pause_fin: open an afternoon attendance.

        If a pause has been recorded, there must be at least two attendances for the day.
        """
        Attendance = env["hr.attendance"].sudo()
        today = fields.Date.today()

        open_attendance = Attendance.search([
            ("employee_id", "=", employee.id),
            ("check_out", "=", False),
        ], limit=1, order="check_in desc")

        if pointage_type == "arrivee":
            if open_attendance and open_attendance.check_in.date() == today:
                return [open_attendance.id]
            attendance = Attendance.create({
                "employee_id": employee.id,
                "check_in": now,
            })
            return [attendance.id]

        if pointage_type == "pause_debut":
            if open_attendance:
                open_attendance.check_out = now
                return [open_attendance.id]
            # Edge case: no open attendance; create a morning-only stub
            attendance = Attendance.create({
                "employee_id": employee.id,
                "check_in": now,
                "check_out": now,
            })
            return [attendance.id]

        if pointage_type == "pause_fin":
            attendance = Attendance.create({
                "employee_id": employee.id,
                "check_in": now,
            })
            return [attendance.id]

        if pointage_type == "depart":
            if open_attendance:
                open_attendance.check_out = now
                return [open_attendance.id]
            # Edge case: depart without open attendance
            attendance = Attendance.create({
                "employee_id": employee.id,
                "check_in": now,
                "check_out": now,
            })
            return [attendance.id]

        return []

    def _manage_timesheet(self, env, employee, pointage, pointage_type, now, description=None):
        """Create or update account.analytic.line records linked to the FSM order.

        The partner on the timesheet is the billed customer of the FSM location.
        The project is the generic 'Pointage chantiers' project for the worker's company.
        """
        Timesheet = env["account.analytic.line"].sudo()
        fsm_order = pointage.fsm_order_id
        if not fsm_order:
            return []

        # Resolve billed customer. fsm.location (OCA fieldservice) has no
        # customer_id field — confirmed against the real module source and
        # by reproducing this exact call against a live Odoo 14 instance,
        # where it raised AttributeError on every pointage carrying an
        # fsm_order_id (i.e. on every normal clocking). owner_id is the
        # actual "Related Owner"/billed-customer field on fsm.location.
        location = fsm_order.location_id
        partner_id = location.owner_id.id if location and location.owner_id else False

        # Project: generic 'Pointage chantiers' for the company
        company_id = fsm_order.company_id.id or employee.company_id.id or env.company.id
        project = self._get_project_pointage_chantiers(env, company_id)
        if not project:
            _logger.warning("No 'Pointage chantiers' project found for company %s; cannot create timesheet line", company_id)
            return []

        # Find the open timesheet (unit_amount=0, still running) for this
        # order/employee. No date filter here — confirmed against a live
        # Odoo 14 instance that project_timesheet_time_control's create()/
        # write() override (_eval_date) silently replaces whatever `date`
        # we pass with the date derived from `date_time` itself, in the
        # request's timezone. A same-day filter compares against
        # fields.Date.today() (server wall-clock date), which does not
        # equal that stored date for the exact shifts this app targets:
        # a night shift starting before midnight and ending after it, or
        # any offline-queued pointage replayed on a later calendar day
        # (see frontend's offline queue + retry). Either one would make
        # "depart" silently fail to find the line "arrivee" opened, and
        # unit_amount would stay 0 forever — the same end symptom as the
        # date_time_end field-merging bug fixed earlier on this branch,
        # but from a completely different cause. _manage_hr_attendance
        # already gets this right (no date filter on its own open-record
        # search); this brings the timesheet lookup in line with it.
        open_line = Timesheet.search([
            ("employee_id", "=", employee.id),
            ("fsm_order_id", "=", fsm_order.id),
            ("unit_amount", "=", 0),
        ], limit=1, order="date_time desc")

        created_ids = []
        line_name = description or pointage.commentaire or f"Pointage {pointage_type} {employee.name}"

        if pointage_type in ("arrivee", "pause_fin"):
            if open_line:
                return [open_line.id]
            line = Timesheet.create({
                "name": line_name,
                "project_id": project.id,
                "fsm_order_id": fsm_order.id,
                "employee_id": employee.id,
                "partner_id": partner_id,
                "date": now.date(),
                "date_time": now,
                "unit_amount": 0,
                "company_id": company_id,
            })
            created_ids.append(line.id)

        elif pointage_type in ("depart", "pause_debut"):
            if open_line:
                open_line.date_time_end = now
                created_ids.append(open_line.id)
        return created_ids
