# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from psycopg2 import IntegrityError, OperationalError, errorcodes

from odoo import http
from odoo.http import request
from odoo.exceptions import ValidationError
import logging

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import (
    MOBILE_CORS_ORIGIN,
    authenticate_mobile_request,
)
from odoo.addons.ocleaneo_mobile_api.tools.mobile_time import (
    local_day_bounds_utc,
    local_to_utc,
    parse_date,
    today_local,
)

_logger = logging.getLogger(__name__)

# Name Postgres gives the model's _sql_constraints entry (table + constraint
# name). Checked explicitly so an unrelated integrity error — a bad foreign
# key, a missing required column — is never mistaken for a duplicate retry
# and silently replayed.
CLIENT_REF_CONSTRAINT = "ocleaneo_mobile_pointage_client_ref_uniq"


class ConcurrentClientRef(OperationalError):
    """Losing side of a client_ref race, shaped so Odoo replays the request.

    service/model.check retries on pgcode in (LOCK_NOT_AVAILABLE,
    SERIALIZATION_FAILURE, DEADLOCK_DETECTED). Declaring pgcode as a class
    attribute shadows psycopg2's read-only descriptor, which is what lets a
    hand-raised error enter that path. See _create_pointage for why a retry
    is the only way to read the winning record.
    """

    pgcode = errorcodes.SERIALIZATION_FAILURE


class MobilePointageController(http.Controller):

    def _get_fsm_person(self, env, user):
        """Resolve the fsm.person linked to the authenticated user's partner."""
        return env["fsm.person"].sudo().search([("partner_id", "=", user.partner_id.id)], limit=1)

    @http.route("/api/mobile/chantiers/aujourdhui", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def chantiers_aujourdhui(self, **kwargs):
        """Return the connected worker's open FSM orders.

        Despite the route name, this does NOT filter on today's date: it
        returns every job assigned to the worker whose stage is not closed.
        That is what the frontend asks of it (OdooProvider.fetchChantiers
        feeds the site list and the geofence check, not a daily agenda) —
        /api/mobile/planning is the date-scoped endpoint. The name is kept
        for compatibility. A `today` local was computed here and never
        used, which is what made the mismatch easy to miss.
        """
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
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
        # Every date below is resolved in the *worker's* timezone, never the
        # server's — the day window is cut in local time just after, and
        # seeding it with a UTC-dated today lands it on the previous day
        # between local midnight and the UTC offset. See today_local().
        if date_from or date_to:
            range_start = parse_date(date_from, user.tz) if date_from else today_local(user.tz)
            range_end = parse_date(date_to, user.tz) if date_to else range_start
        else:
            range_start = range_end = parse_date(kwargs.get("date", date), user.tz)

        # Same local-day-boundary handling as chantiers/aujourdhui and
        # planning — a naive UTC window would misplace clockings for
        # shifts starting before dawn or crossing midnight.
        date_start, _ = local_day_bounds_utc(range_start, user.tz)
        _, date_end = local_day_bounds_utc(range_end, user.tz)

        # Read as the worker, NOT sudo. The user_id filter below is still the
        # primary scoping, but running under the worker's own rights makes
        # ir_rule_ocleaneo_mobile_pointage_self a real second line: a future
        # edit that drops or loosens that filter returns nothing extra
        # instead of leaking the whole company's clockings. The rule cannot
        # replace the filter (see the module's security/record_rules.xml for
        # why per-channel scoping is not expressible as a rule at all), but
        # it can catch the day someone forgets it.
        Pointage = env["ocleaneo.mobile.pointage"]
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
                 gps_accuracy=None, nfc_tag_id=None, commentaire=None,
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
            # Also read as the worker (see pointage_mine): a client_ref is
            # generated on the device and is not secret, so a lookup that
            # forgot to scope by user_id would let one worker's retry hand
            # back another worker's clocking.
            existing = env["ocleaneo.mobile.pointage"].search([
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

        pointage = self._create_pointage(env, vals, client_ref)

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

    def _create_pointage(self, env, vals, client_ref):
        """Create the clocking, letting the database settle a concurrent retry.

        The client_ref lookup at the top of pointage() is a check-then-act:
        two retries of the same clocking arriving together — an offline queue
        replay racing the original request, a double tap on a flaky
        connection — both find nothing and both create a record. The unique
        index on (user_id, client_ref) makes the database the arbiter, so
        exactly one insert wins.

        The loser cannot simply re-read the winner's row and return it: Odoo
        cursors run in REPEATABLE READ (sql_db.Cursor defaults to
        serialized=True), so this transaction's snapshot predates the
        concurrent commit and a re-read after ROLLBACK TO SAVEPOINT still
        finds nothing. Verified against PostgreSQL 16 — the naive
        catch-and-re-read is silently wrong here.

        What does work is Odoo's own concurrency retry: service/model.check
        replays the whole request on a serialization failure, and http.py's
        checked_call rolls the request cursor back before each attempt
        ("the request cursor is unusable... to create a new one"). The
        replay therefore starts on a fresh snapshot, where the client_ref
        short-circuit finds the winner's record and returns the original
        response — which is exactly the idempotency the key is for. So the
        losing insert is re-raised as a serialization failure to hand the
        request back to that machinery.

        sudo() is kept on the write path, unlike the reads in pointage() and
        pointage_mine(). The clocking is only half of what this records: the
        request goes on to open or close an hr.attendance and an
        account.analytic.line on the worker's behalf, and a cleaning agent
        holds neither the Attendance nor the Timesheet rights that would
        allow it. `vals` is built by the caller with user_id/employee_id
        taken from the authenticated token, never from the payload, so the
        elevation cannot be steered into writing someone else's row.
        """
        Pointage = env["ocleaneo.mobile.pointage"].sudo()
        if not client_ref:
            # Nothing to collide on: a NULL client_ref never violates the
            # unique index (Postgres allows any number of NULLs there).
            return Pointage.create(vals)

        try:
            # The savepoint keeps the cursor usable for the raise below; an
            # aborted transaction would reject every later statement.
            with env.cr.savepoint():
                return Pointage.create(vals)
        except IntegrityError as e:
            if e.diag.constraint_name != CLIENT_REF_CONSTRAINT:
                raise
            _logger.info(
                "Concurrent clocking with client_ref=%s for user %s; retrying "
                "the request so the idempotent replay returns the first one",
                client_ref, vals.get("user_id"),
            )
            raise ConcurrentClientRef(
                "concurrent clocking for client_ref=%s" % client_ref
            ) from e

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
        - arrivee / pause_fin: the worker is (back) on the clock — reuse the
          open attendance if there is one, otherwise open a new one.
        - depart / pause_debut: the worker is off the clock — close the open
          attendance if there is one.

        hr.attendance enforces two invariants of its own (see its
        _check_validity constraint, verified against the real Odoo 14
        source): at most ONE open record per employee, and no overlapping
        slices. Every create() below is therefore guarded by the
        open_attendance check — an unguarded create raises ValidationError
        rather than producing a second open record.

        This used to bite in two reachable ways:
        - "arrivee" only reused the open attendance when it started on the
          server's current date. A worker who forgot to clock out the day
          before (frequent enough that the app ships a dedicated
          forgotten-checkout reminder) had an open attendance dated
          yesterday, fell through to create(), and got a hard error — they
          could not clock in at all until someone fixed the data by hand.
        - "pause_fin" created unconditionally. In the normal flow
          pause_debut has just closed the attendance, so it worked; but a
          double tap, an offline replay arriving out of order, or any
          app/server state desync left an attendance open and produced the
          same hard error.
        """
        Attendance = env["hr.attendance"].sudo()

        open_attendance = Attendance.search([
            ("employee_id", "=", employee.id),
            ("check_out", "=", False),
        ], limit=1, order="check_in desc")

        if pointage_type in ("arrivee", "pause_fin"):
            if open_attendance:
                # Deliberately NOT closing a stale open attendance to open a
                # fresh one: we would have to invent a check_out time we
                # never observed, and this record feeds payroll. Reusing it
                # keeps the clocking working and leaves the anomaly visible
                # (and fixable) in Odoo rather than papering over it.
                if open_attendance.check_in and open_attendance.check_in.date() != now.date():
                    _logger.warning(
                        "Employee %s (%s) clocked '%s' while attendance #%s from %s is still open "
                        "— missing check-out, attendance data needs review",
                        employee.name, employee.id, pointage_type,
                        open_attendance.id, open_attendance.check_in,
                    )
                return [open_attendance.id]
            return self._create_attendance(Attendance, employee, {"check_in": now})

        if pointage_type in ("pause_debut", "depart"):
            if open_attendance:
                open_attendance.check_out = now
                return [open_attendance.id]
            # No open attendance to close (clock-out without a matching
            # clock-in, e.g. an offline queue replaying out of order): record
            # a zero-length slice so the event is not lost entirely.
            return self._create_attendance(
                Attendance, employee, {"check_in": now, "check_out": now}
            )

        return []

    def _create_attendance(self, Attendance, employee, vals):
        """Create an hr.attendance, converting a rejected write into a logged
        warning instead of an exception.

        hr.attendance's own constraints can still reject a write we cannot
        anticipate here — most plausibly the no-overlap rule, when an
        offline pointage is replayed carrying an old timestamp that lands
        inside an already-recorded slice. hr.attendance is a *derived*
        mirror of the clocking; ocleaneo.mobile.pointage is the record of
        what the worker actually did. Letting a bookkeeping conflict in the
        mirror propagate would fail the whole request and lose the
        clocking itself, which is the one thing that must never happen.
        """
        try:
            attendance = Attendance.create(dict(vals, employee_id=employee.id))
            return [attendance.id]
        except ValidationError as e:
            _logger.warning(
                "Could not mirror clocking into hr.attendance for employee %s (%s) at %s: %s",
                employee.name, employee.id, vals.get("check_in"), e,
            )
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
