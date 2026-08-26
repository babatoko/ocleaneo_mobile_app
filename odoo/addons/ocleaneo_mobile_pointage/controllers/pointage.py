# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import http, fields
from odoo.http import request
from odoo.exceptions import ValidationError, AccessError
import logging
import dateutil.parser
import pytz

_logger = logging.getLogger(__name__)

MOBILE_CORS_ORIGIN = "http://127.0.0.1:5173"


class MobilePointageController(http.Controller):

    def _authenticate_mobile(self):
        auth_header = request.httprequest.headers.get("Authorization", "")
        token = ""
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        if not token:
            token = request.httprequest.headers.get("X-Mobile-Token", "")
        if not token:
            return None
        env = request.env
        users = env["res.users"].sudo().search([("mobile_api_token", "!=", False)])
        for user in users:
            if user.verify_mobile_api_token(token):
                return user
        return None

    def _local_to_utc(self, datetime_iso, fallback_tz=None):
        """Convert an ISO8601 local datetime string (with or without offset) to UTC Datetime.

        If no timezone is provided, the user's own timezone is assumed.
        Returns the current UTC time if parsing fails.
        """
        if not datetime_iso:
            return fields.Datetime.now()
        try:
            dt = dateutil.parser.isoparse(datetime_iso)
            if dt.tzinfo is None:
                tz = fallback_tz or request.env.user.tz or "Europe/Paris"
                local_tz = pytz.timezone(tz)
                dt = local_tz.localize(dt)
            return dt.astimezone(pytz.utc).replace(tzinfo=None)
        except Exception as e:
            _logger.warning("Failed to parse datetime '%s': %s", datetime_iso, e)
            return fields.Datetime.now()

    @http.route("/api/mobile/chantiers/aujourdhui", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def chantiers_aujourdhui(self, **kwargs):
        """Return today's FSM orders for the connected employee."""
        user = self._authenticate_mobile()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        employee = user.get_employee_for_mobile()
        if not employee:
            return {"error": "no employee linked to user", "code": 400}

        today = fields.Date.today()
        # Find fsm.person linked to the user's partner
        person = env["fsm.person"].sudo().search([("partner_id", "=", user.partner_id.id)], limit=1)
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
                "person_id": order.person_id.id,
                "person_name": order.person_id.name,
                "stage": order.stage_id.name,
                "date_start": order.date_start.isoformat() if order.date_start else False,
                "date_end": order.date_end.isoformat() if order.date_end else False,
            })
        return {"count": len(result), "orders": result}

    @http.route("/api/mobile/pointage", type="json", auth="none", methods=["POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def pointage(self, type=None, fsm_order_id=None, gps_latitude=None, gps_longitude=None,
                 gps_accuracy=None, nfc_tag_id=None, photo=None, commentaire=None,
                 datetime=None, description=None, **kwargs):
        """Record a mobile clocking and update Odoo attendance/timesheet.

        datetime: ISO8601 local time sent by the mobile app.
        description: free text entered by the worker (used as timesheet line name).
        """
        user = self._authenticate_mobile()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        employee = user.get_employee_for_mobile()
        if not employee:
            return {"error": "no employee linked to user", "code": 400}

        pointage_type = type
        if pointage_type not in ("arrivee", "depart", "pause_debut", "pause_fin"):
            return {"error": "invalid type", "code": 400}

        now = self._local_to_utc(datetime)
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
            "source": "mobile",
            "company_id": company_id,
        }
        order = env["fsm.order"].browse(False)
        if fsm_order_id:
            order = env["fsm.order"].sudo().browse(int(fsm_order_id))
            if order.exists():
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

        return {
            "id": pointage.id,
            "type": pointage.type,
            "datetime": pointage.datetime.isoformat(),
            "attendance_id": pointage.hr_attendance_id.id,
            "timesheet_ids": timesheet_ids,
            "fsm_order_id": pointage.fsm_order_id.id if pointage.fsm_order_id else False,
        }

    def _get_project_pointage_chantiers(self, env, company_id):
        """Return the generic 'Pointage chantiers' project for the given company."""
        Project = env["project.project"].sudo()
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
        today = fields.Date.today()
        fsm_order = pointage.fsm_order_id
        if not fsm_order:
            return []

        # Resolve billed customer
        location = fsm_order.location_id
        partner_id = False
        if location and location.customer_id:
            partner_id = location.customer_id.id
        elif location and location.owner_id:
            partner_id = location.owner_id.id

        # Project: generic 'Pointage chantiers' for the company
        company_id = fsm_order.company_id.id or employee.company_id.id or env.company.id
        project = self._get_project_pointage_chantiers(env, company_id)
        if not project:
            _logger.warning("No 'Pointage chantiers' project found for company %s; cannot create timesheet line", company_id)
            return []

        # Find open timesheet for this order/employee today with unit_amount=0 (running)
        open_line = Timesheet.search([
            ("employee_id", "=", employee.id),
            ("fsm_order_id", "=", fsm_order.id),
            ("date", "=", today),
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
                "date": today,
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
