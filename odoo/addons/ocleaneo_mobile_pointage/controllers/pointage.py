# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import logging
from datetime import datetime

from psycopg2 import IntegrityError, OperationalError, errorcodes

from odoo import fields, http
from odoo.http import request
from odoo.exceptions import ValidationError

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import (
    MOBILE_CORS_ORIGIN,
    mobile_routes,
    authenticate_mobile_request,
)
from odoo.addons.ocleaneo_mobile_api.tools.mobile_time import (
    MAX_RECORDS,
    DateRangeError,
    check_range,
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

    @http.route(mobile_routes("chantiers/aujourdhui"), type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
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

        # date_start ("Actual Start") is only set once work actually begins —
        # it is empty on every order the worker hasn't badged into yet,
        # including today's, right up until their first scan of the day.
        # fieldservice_recurring pre-generates future orders for the same
        # fsm.location well ahead of time (left open until their own day),
        # and a worker who forgot to close a past one (see the forgotten-
        # checkout reminder feature) leaves it open too — so several orders
        # sharing the same nfc_tag_id can all be "not yet started" at once,
        # some scheduled ahead, some overdue from days ago. A single SQL
        # ORDER BY can only break that tie in one direction (e.g. soonest
        # first), which then loses to whichever open order sits on the
        # *other* side of today — first verified as a future-recurring-order
        # win, then, from real production data, as a stale overdue order
        # winning instead. Ranked in Python against the worker's own "today"
        # (local_day_bounds_utc, used the same way elsewhere in this file):
        # an order actually in progress wins outright; among the rest, one
        # scheduled for today outranks any other day, past or future;
        # failing that, whichever is scheduled closest to right now wins.
        # Reproduced and fixed against a live Odoo 14 instance (see
        # test_chantiers_ranks_todays_order_before_a_future_recurring_one
        # and test_chantiers_ranks_todays_order_before_a_stale_overdue_one).
        orders = env["fsm.order"].sudo().search(domain, limit=200, order="id desc")
        now = fields.Datetime.now()
        today_start, today_end = local_day_bounds_utc(today_local(user.tz), user.tz)
        epoch = datetime(1970, 1, 1)

        def _rank(order):
            if order.date_start:
                return (0, -(order.date_start - epoch).total_seconds())
            scheduled = order.scheduled_date_start
            if not scheduled:
                return (3, 0)
            if today_start <= scheduled <= today_end:
                return (1, 0)
            return (2, abs((scheduled - now).total_seconds()))

        orders = orders.sorted(key=_rank)[:50]
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
                "nfc_tag_id": order.location_id.get_nfc_tag_uid_for_mobile() if order.location_id else False,
                "person_id": order.person_id.id,
                "person_name": order.person_id.name,
                "stage": order.stage_id.name,
                "date_start": order.date_start.isoformat() if order.date_start else False,
                "date_end": order.date_end.isoformat() if order.date_end else False,
                "completion_ratio": order.completion_ratio or False,
                "completion_state": order.completion_state or False,
            })
        return {"count": len(result), "orders": result}

    @http.route(mobile_routes("pointage/mine"), type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
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

        # Refuse an unbounded or inverted window before touching the ORM.
        # On payroll-adjacent data, silently returning a truncated list would
        # be worse than an error: the client would believe it had everything.
        try:
            check_range(range_start, range_end)
        except DateRangeError as e:
            return e.payload

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
        # limit=MAX_RECORDS + 1 : un de plus que la limite annoncée, seulement
        # pour savoir si la liste a été coupée — sinon un résultat pile à la
        # limite serait indiscernable d'un résultat complet.
        # Les pointages annulés sont exclus de la lecture : un annulé est un
        # événement qui ne compte pas (timbrage erroné annulé par le bureau),
        # l'afficher ferait croire l'agent qu'il est pointé alors que ni
        # attendance ni timesheet n'en découle. La traçabilité reste complète
        # côté back-office (le record existe, state='annule').
        records = Pointage.search([
            ("user_id", "=", user.id),
            ("datetime", ">=", date_start),
            ("datetime", "<=", date_end),
            ("state", "!=", "annule"),
        ], order="datetime asc", limit=MAX_RECORDS + 1)
        truncated = len(records) > MAX_RECORDS
        if truncated:
            records = records[:MAX_RECORDS]
            _logger.warning(
                "pointage/mine: %s dépassé pour l'utilisateur %s sur %s..%s",
                MAX_RECORDS, user.login, range_start, range_end)

        entries = [{
            "id": p.id,
            "type": p.type,
            "datetime": p.datetime.isoformat() if p.datetime else False,
            "fsm_order_id": p.fsm_order_id.id if p.fsm_order_id else False,
            # sudo: the pointage search above is deliberately run as the
            # worker (see comment above), but a worker's own fsm.order/
            # fsm.location group does not necessarily grant read on the
            # *linked* records (e.g. an order no longer assigned to them) —
            # this is presentational metadata, not the row-level scoping.
            "fsm_order_name": p.fsm_order_id.sudo().display_name if p.fsm_order_id else False,
            "fsm_location_id": p.fsm_location_id.id if p.fsm_location_id else False,
            "fsm_location_name": p.fsm_location_id.sudo().display_name if p.fsm_location_id else False,
            "commentaire": p.commentaire or False,
            "client_ref": p.client_ref or False,
        } for p in records]

        return {
            "date_from": str(range_start),
            "date_to": str(range_end),
            "count": len(entries),
            "truncated": truncated,
            "entries": entries,
        }

    @http.route(mobile_routes("pointage/sync"), type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def pointage_sync(self, date=None, date_from=None, date_to=None, include_attendance=False, include_timesheet=False, **kwargs):
        """Return the authenticated worker's complete pointage-related state.

        This endpoint is the server side of a bidirectional refresh:
        the caller first pushes its offline queue (via the normal pointage
        POST endpoint), then calls this endpoint to pull back the current
        server truth.  The response includes mobile pointage records, the
        underlying hr.attendance slices, the related timesheet lines, and the
        worker's shifts for the requested day(s).

        Query parameters (all optional):
        - date: YYYY-MM-DD, single day. Defaults to today in the worker's TZ.
        - date_from / date_to: YYYY-MM-DD inclusive range. Overrides `date`.
        - include_attendance: also return hr.attendance rows for the period.
        - include_timesheet: also return account.analytic.line rows for the period.
        """
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        date_from = kwargs.get("date_from", date_from)
        date_to = kwargs.get("date_to", date_to)
        include_attendance = kwargs.get("include_attendance", include_attendance)
        include_timesheet = kwargs.get("include_timesheet", include_timesheet)

        if date_from or date_to:
            range_start = parse_date(date_from, user.tz) if date_from else today_local(user.tz)
            range_end = parse_date(date_to, user.tz) if date_to else range_start
        else:
            range_start = range_end = parse_date(kwargs.get("date", date), user.tz)

        try:
            check_range(range_start, range_end)
        except DateRangeError as e:
            return e.payload

        date_start, _ = local_day_bounds_utc(range_start, user.tz)
        _, date_end = local_day_bounds_utc(range_end, user.tz)

        Pointage = env["ocleaneo.mobile.pointage"]
        pointages = Pointage.search([
            ("user_id", "=", user.id),
            ("datetime", ">=", date_start),
            ("datetime", "<=", date_end),
            ("state", "!=", "annule"),
        ], order="datetime asc", limit=MAX_RECORDS + 1)
        truncated = len(pointages) > MAX_RECORDS
        if truncated:
            pointages = pointages[:MAX_RECORDS]
            _logger.warning(
                "pointage/sync: %s dépassé pour l'utilisateur %s sur %s..%s",
                MAX_RECORDS, user.login, range_start, range_end)

        entries = [self._pointage_response(p) for p in pointages]

        result = {
            "server_time": fields.Datetime.now().isoformat(),
            "date_from": str(range_start),
            "date_to": str(range_end),
            "count": len(entries),
            "truncated": truncated,
            "entries": entries,
        }

        if include_attendance and employee:
            attendances = env["hr.attendance"].sudo().search([
                ("employee_id", "=", employee.id),
                ("check_in", ">=", date_start),
                ("check_in", "<=", date_end),
            ], order="check_in asc", limit=MAX_RECORDS + 1)
            att_truncated = len(attendances) > MAX_RECORDS
            if att_truncated:
                attendances = attendances[:MAX_RECORDS]
            result["attendances"] = [{
                "id": a.id,
                "check_in": a.check_in.isoformat() if a.check_in else False,
                "check_out": a.check_out.isoformat() if a.check_out else False,
                "employee_id": a.employee_id.id,
            } for a in attendances]
            result["attendance_count"] = len(attendances)
            result["attendance_truncated"] = att_truncated

        if include_timesheet and employee:
            timesheets = env["account.analytic.line"].sudo().search([
                ("employee_id", "=", employee.id),
                ("date_time", ">=", date_start),
                ("date_time", "<=", date_end),
            ], order="date_time asc", limit=MAX_RECORDS + 1)
            ts_truncated = len(timesheets) > MAX_RECORDS
            if ts_truncated:
                timesheets = timesheets[:MAX_RECORDS]
            result["timesheets"] = [{
                "id": t.id,
                "name": t.name,
                "date_time": t.date_time.isoformat() if t.date_time else False,
                "date_time_end": t.date_time_end.isoformat() if t.date_time_end else False,
                "unit_amount": t.unit_amount or 0.0,
                "fsm_order_id": t.fsm_order_id.id if t.fsm_order_id else False,
                "project_id": t.project_id.id if t.project_id else False,
            } for t in timesheets]
            result["timesheet_count"] = len(timesheets)
            result["timesheet_truncated"] = ts_truncated

        return result

    @http.route(mobile_routes("pointage"), type="json", auth="none", methods=["POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def pointage(self, type=None, fsm_order_id=None, fsm_location_id=None, gps_latitude=None, gps_longitude=None,
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

        # ocleaneo_mobile_clocking marks every record touched during this
        # request (the pointage itself, and any hr.attendance it opens or
        # closes) as coming from the mobile clocking flow — not a backoffice
        # edit. HrAttendance._ocleaneo_sync_departure_pointage() reads this to
        # skip its own "backfill a missing mobile departure" mirror, which
        # otherwise fired mid-request (on the attendance close, and again
        # when the pointage gets linked via hr_attendance_id a few lines
        # below) and fabricated a spurious "depart" pointage for what was
        # only ever a pause_debut.
        env = request.env(
            user=user.id,
            context=dict(request.env.context, ocleaneo_mobile_clocking=True),
        )
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
            # "depart", close) another employee's job. The check must never
            # silently swallow the clocking itself; if it fails, the mobile
            # pointage is still created and the exception is logged.
            person = self._get_fsm_person(env, user)
            if not person or order.person_id.id != person.id:
                _logger.warning(
                    "User %s (%s) attempted to clock on fsm_order %s assigned to person %s; "
                    "creating mobile pointage but skipping order-side side effects",
                    user.login, user.id, order.id, order.person_id.id,
                )
                # Keep the location context but do not link the workorder, so
                # the pointage is preserved without order-owned side effects.
                vals["fsm_location_id"] = order.location_id.id
                order = env["fsm.order"].browse(False)
            else:
                vals["fsm_order_id"] = order.id
                vals["fsm_location_id"] = order.location_id.id
                if pointage_type == "arrivee":
                    # Best-effort: a manager alert must never block the clocking
                    # itself, exactly like the timesheet/attendance mirrors above.
                    try:
                        self._warn_if_workorder_date_mismatch(env, order, employee, now)
                    except Exception as e:
                        _logger.warning(
                            "Could not check/post workorder date mismatch for fsm_order %s: %s",
                            order.id, e,
                        )
        elif fsm_location_id:
            # Badge NFC dont la localisation est connue (pointage_with_tag.py)
            # mais qui n'a matché aucun fsm.order ouvert — "location-only
            # clocking" (cas 4 documenté dans pointage_with_tag.py). Sans ce
            # repli, fsm_location_id restait vide ici même quand l'appelant
            # le connaissait déjà, et le pointage ne portait plus aucun repère
            # de chantier (ni fsm_order_id, ni fsm_location_id) : l'agent
            # voyait "Présent —" sans nom, malgré un badge parfaitement
            # reconnu.
            try:
                fsm_location_id = int(fsm_location_id)
            except (TypeError, ValueError):
                fsm_location_id = None
            if fsm_location_id:
                location = env["fsm.location"].sudo().browse(fsm_location_id)
                if location.exists():
                    vals["fsm_location_id"] = location.id

        pointage = self._create_pointage(env, vals, client_ref)

        # ---- Global attendance (hr.attendance) ----
        attendance_ids = self._manage_hr_attendance(env, employee, pointage_type, now)
        if attendance_ids:
            pointage.hr_attendance_id = attendance_ids[0]

        # ---- Job timesheet (account.analytic.line with fsm_order_id) ----
        timesheet_ids = self._manage_timesheet(env, employee, pointage, pointage_type, now, description)
        if timesheet_ids:
            pointage.timesheet_line_ids = [(6, 0, timesheet_ids)]

        # ---- Update FSM order completion on depart ----
        # Closing on depart used to be unconditional: clocking in and
        # immediately back out marked a job "Completed" the same as an
        # honest full visit. update_completion_from_worked_time() only
        # closes when >= 90% of scheduled_duration was actually spent.
        if pointage_type == "depart" and order and order.exists():
            order.sudo().update_completion_from_worked_time(employee)
            # Only actually close the order when the completion rule says it
            # is done (>= 90% of scheduled time) OR when there is no
            # scheduled_duration to compare against (preserve pre-rule
            # unconditional close behavior).
            if order.completion_state != "done":
                _logger.info(
                    "FSM order %s left open after depart: completion_state=%s",
                    order.id, order.completion_state,
                )
            else:
                completed_stage = env.ref("fieldservice.fsm_stage_completed", raise_if_not_found=False)
                if not completed_stage:
                    # Last resort, for a deployment where that base OCA record
                    # was somehow removed.
                    completed_stage = env["fsm.stage"].sudo().search([
                        ("name", "ilike", "completed"),
                        ("is_closed", "=", True),
                    ], limit=1)
                if completed_stage:
                    try:
                        order.write({"stage_id": completed_stage.id, "is_button": True})
                    except Exception as e:
                        _logger.warning("Could not set FSM order %s to Completed: %s", order.id, e)
                else:
                    _logger.warning(
                        "No 'Completed' fsm.stage found (external id "
                        "fieldservice.fsm_stage_completed, nor name match); "
                        "fsm_order %s not closed on depart",
                        order.id,
                    )

        return self._pointage_response(pointage, timesheet_ids)

    @http.route(mobile_routes("pointage/compte-rendu"), type="json", auth="none", methods=["POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def compte_rendu(self, client_ref=None, commentaire=None, activities=None, **kwargs):
        """Attach the end-of-job report to an already-recorded departure.

        A "depart" pointage is always created immediately when the badge is
        scanned (see pointage() above) — the clocking itself must never wait
        on, or be lost because of, the report. This endpoint only fills in
        the report afterwards: the free-text compte-rendu, plus which of the
        job's planned fsm.activity records were validated. Unlike
        _create_pointage, there is no idempotency concern here — resubmitting
        just rewrites the same values, which is harmless.
        """
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}
        if not client_ref:
            return {"error": "missing client_ref", "code": 400}

        env = request.env(user=user.id)
        # Read as the worker, not sudo — same reasoning as pointage_mine: the
        # user_id filter is the primary scoping, record rule is the backstop.
        pointage = env["ocleaneo.mobile.pointage"].search([
            ("user_id", "=", user.id),
            ("client_ref", "=", client_ref),
        ], limit=1)
        if not pointage:
            return {"error": "pointage introuvable", "code": 404}
        if pointage.type != "depart":
            return {"error": "ce pointage n'est pas un départ", "code": 400}

        pointage.sudo().commentaire = commentaire

        order = pointage.fsm_order_id
        if activities and order:
            for entry in activities:
                try:
                    activity_id = int(entry.get("id"))
                    completed = bool(entry.get("completed"))
                except (TypeError, ValueError, AttributeError):
                    continue
                activity = env["fsm.activity"].sudo().browse(activity_id)
                if not activity.exists() or activity.fsm_order_id.id != order.id:
                    _logger.warning(
                        "compte-rendu: activity %s does not belong to fsm_order %s "
                        "for pointage %s; ignored",
                        activity_id, order.id, pointage.id,
                    )
                    continue
                if completed:
                    activity.action_done()
                else:
                    activity.write({"completed": False, "completed_on": False, "completed_by": False})

        if order:
            try:
                self._alert_manager_required_activity_pending(env, employee, pointage, order)
            except Exception as e:
                _logger.warning(
                    "Could not check/post pending required activities for pointage %s: %s",
                    pointage.id, e,
                )

        return self._pointage_response(pointage)

    def _alert_manager_required_activity_pending(self, env, employee, pointage, order):
        """Schedule a mail.activity for the employee's manager when a
        required fsm.activity is still not completed once the compte-rendu
        is submitted — mirrors _alert_manager_stale_attendance below: best
        effort, never blocks the compte-rendu itself.
        """
        # order came from pointage.fsm_order_id, read under the worker's own
        # rights (see compte_rendu) — a plain worker has no ACL on fsm.order
        # or fsm.activity themselves (see the ownership check in pointage(),
        # which is the real gate here, not the ACL — same rationale as the
        # .sudo() reads throughout this controller).
        order = order.sudo()
        missing = order.order_activity_ids.filtered(lambda a: a.required and not a.completed)
        if not missing:
            return
        note = (
            "Le compte-rendu de fin de chantier de %(employee)s pour %(order)s "
            "mentionne %(count)s activité(s) obligatoire(s) non validée(s) : "
            "%(names)s."
        ) % {
            "employee": employee.name,
            "order": order.name,
            "count": len(missing),
            "names": ", ".join(missing.mapped("name")),
        }
        manager_user = employee.parent_id.user_id if employee.parent_id else False
        if manager_user:
            env["mail.activity"].sudo().create({
                "res_model_id": env.ref("hr.model_hr_employee").id,
                "res_id": employee.id,
                "activity_type_id": env.ref("mail.mail_activity_data_todo").id,
                "summary": "Compte-rendu — activité(s) obligatoire(s) non validée(s)",
                "note": note,
                "user_id": manager_user.id,
                "date_deadline": fields.Date.today(),
            })
        else:
            _logger.warning(
                "Pointage %s: required activities left uncompleted for employee "
                "%s (%s) but no manager (hr.employee.parent_id) to alert",
                pointage.id, employee.name, employee.id,
            )

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
            # sudo: see pointage_mine() above — same presentational read.
            "fsm_order_name": pointage.fsm_order_id.sudo().display_name if pointage.fsm_order_id else False,
            "fsm_location_id": pointage.fsm_location_id.id if pointage.fsm_location_id else False,
            "fsm_location_name": pointage.fsm_location_id.sudo().display_name if pointage.fsm_location_id else False,
            "commentaire": pointage.commentaire or False,
            # Only meaningful once a 'depart' has run
            # update_completion_from_worked_time() at least once — False/absent
            # completion_state on an order that was never departed from is
            # normal and should not be interpreted as an error by the app.
            "completion_ratio": pointage.fsm_order_id.completion_ratio or False,
            "completion_state": pointage.fsm_order_id.completion_state or False,
            "nfc_tag_id": pointage.nfc_tag_id or False,
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
        - The first arrival of the day opens a new hr.attendance.
        - The last departure of the day closes the open hr.attendance.
        - pause_debut closes the current attendance; pause_fin opens a new one.
        - An arrival following pause_debut (without an explicit pause_fin)
          implicitly closes the pause and starts a new attendance slice.
        - A departure with no open attendance is an anomaly and should not
          create a zero-length record unless configured to.

        Stale open attendances from previous days are left to the installed
        OCA module ``hr_attendance_autoclose`` (cron + company setting
        ``attendance_maximum_hours_per_day``). This method only makes sure a
        new arrival does not reuse a stale attendance, which would merge two
        working days into one slice. If a stale attendance is detected while
        the employee is clocking, the manager is alerted via a mail.activity.

        hr.attendance enforces two invariants of its own: at most one open
        record per employee, and no overlapping slices. The logic below
        respects those while implementing the business rule above.
        """
        # env already carries ocleaneo_mobile_clocking (set by pointage(),
        # above) — see HrAttendance._ocleaneo_sync_departure_pointage() for
        # why that mirror must stay out of the way for the whole request.
        Attendance = env["hr.attendance"].sudo()

        open_attendance = Attendance.search([
            ("employee_id", "=", employee.id),
            ("check_out", "=", False),
        ], limit=1, order="check_in desc")

        if pointage_type in ("arrivee", "pause_fin"):
            if open_attendance:
                # A stale attendance from a previous day must not be reused.
                # The OCA autoclose module will close it based on the configured
                # maximum hours per day. Here we only prevent merging it with
                # today's clocking and alert the manager.
                if open_attendance.check_in and open_attendance.check_in.date() != now.date():
                    _logger.warning(
                        "Employee %s (%s) clocked '%s' while attendance #%s from %s is still open "
                        "— leaving it for hr_attendance_autoclose, opening a fresh slice today",
                        employee.name, employee.id, pointage_type,
                        open_attendance.id, open_attendance.check_in,
                    )
                    self._alert_manager_stale_attendance(env, employee, open_attendance)
                else:
                    # Normal reuse: double tap, pause_fin reopening, etc.
                    return [open_attendance.id]
            return self._create_attendance(Attendance, employee, {"check_in": now})

        if pointage_type in ("pause_debut", "depart"):
            if open_attendance:
                open_attendance.check_out = now
                return [open_attendance.id]
            # No open attendance to close: anomaly. Record only if explicitly
            # allowed; otherwise log and return empty so the caller still
            # records the mobile pointage itself.
            _logger.warning(
                "Employee %s (%s) clocked '%s' at %s with no open attendance — "
                "depart/pause_debut without matching arrivee/pause_fin",
                employee.name, employee.id, pointage_type, now,
            )
            return self._create_attendance(
                Attendance, employee, {"check_in": now, "check_out": now}
            )

        return []

    def _alert_manager_stale_attendance(self, env, employee, attendance):
        """Schedule a mail.activity for the employee's manager when an open
        attendance from a previous day is detected at clock-in time.

        The OCA module will close the attendance via its cron; this alert
        makes sure a human reviews the case.
        """
        if not attendance or attendance.check_in.date() == fields.Date.today():
            return
        note = (
            "La présence #%(attendance)s de %(employee)s n'a pas été clôturée "
            "le %(day)s. Elle sera fermée automatiquement par le module OCA "
            "hr_attendance_autoclose. Veuillez vérifier les heures et la "
            "raison de fermeture auprès du salarié."
        ) % {
            "attendance": attendance.id,
            "employee": employee.name,
            "day": attendance.check_in.date(),
        }
        manager_user = employee.parent_id.user_id if employee.parent_id else False
        if manager_user:
            # Anchored on the employee, not the attendance: hr.attendance
            # does not inherit mail.thread, so a mail.activity assigned
            # against it fails outright the moment Odoo tries to notify the
            # manager (action_notify() calls record.message_notify(), which
            # only exists on models with that mixin — hr.employee has it).
            env["mail.activity"].sudo().create({
                "res_model_id": env.ref("hr.model_hr_employee").id,
                "res_id": employee.id,
                "activity_type_id": env.ref("mail.mail_activity_data_todo").id,
                "summary": "Présence non clôturée — détectée au pointage mobile",
                "note": note,
                "user_id": manager_user.id,
                "date_deadline": fields.Date.today(),
            })
        else:
            _logger.warning(
                "Stale attendance #%s for employee %s (%s) detected but no "
                "manager (hr.employee.parent_id) to alert",
                attendance.id, employee.name, employee.id,
            )

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

        Its own @api.constrains raises *after* the row is already inserted
        in the current transaction — catching that exception in Python does
        not undo the insert by itself. Without the explicit savepoint below,
        the rejected attendance stays behind as a second, invalid open
        record (reproduced: two open attendances for the same employee at
        once), silently defeating the very invariant this whole method
        exists to protect.
        """
        try:
            with Attendance.env.cr.savepoint():
                attendance = Attendance.create(dict(vals, employee_id=employee.id))
            return [attendance.id]
        except ValidationError as e:
            _logger.warning(
                "Could not mirror clocking into hr.attendance for employee %s (%s) at %s: %s",
                employee.name, employee.id, vals.get("check_in"), e,
            )
            return []

    # A clocking landing exactly on the workorder's own scheduled day is
    # never flagged. Outside that day, only flag it while it is still
    # plausibly the "same round" of work — the current calendar month, or
    # within this many days either side — so a random unrelated order from
    # months ago cannot trigger this by some other coincidence.
    WORKORDER_MISMATCH_SURROUNDING_DAYS = 7

    def _warn_if_workorder_date_mismatch(self, env, order, employee, now):
        """Alert the worker's manager when a clocking lands on a different
        day than its workorder's own schedule.

        A recurring job (e.g. "vitres 1x/mois") is routinely *done* on a
        different day than its scheduled_date_start — the crew visits when
        it visits, not necessarily on the day fsm.recurring picked when it
        pre-generated the order. That drift is legitimate day-to-day, but
        worth a human's attention, not silent acceptance: it's exactly the
        kind of mismatch issue #6 was first mistaken for (there, the order
        itself was wrong; here it is correctly linked, only its date is
        off).

        fsm.location carries no "responsible" field of its own (checked
        against the real module source — OCA fieldservice and every
        Ocleaneo module). The worker's own manager (hr.employee.parent_id)
        is used instead, per instruction, since that hierarchy already
        exists on the employee record.
        """
        scheduled = order.scheduled_date_start
        if not scheduled:
            return
        delta_days = (now.date() - scheduled.date()).days
        if delta_days == 0:
            return
        same_month = (now.year, now.month) == (scheduled.year, scheduled.month)
        if not same_month and abs(delta_days) > self.WORKORDER_MISMATCH_SURROUNDING_DAYS:
            return

        summary = "Pointage hors planning"
        # An activity already pending for this exact order is enough of a
        # "someone was already told" signal — Odoo removes a mail.activity
        # once marked done, so a *new* occurrence (a different fsm.order,
        # e.g. next month's) is never silently suppressed by this check.
        if env["mail.activity"].sudo().search_count([
            ("res_model", "=", "fsm.order"),
            ("res_id", "=", order.id),
            ("summary", "=", summary),
        ]):
            return

        note = (
            "%s a pointé son arrivée sur %s le %s, alors que ce workorder "
            "est planifié le %s."
        ) % (employee.name, order.name, now.date(), scheduled.date())

        order_sudo = order.sudo()
        order_sudo.message_post(body=note)

        manager_user = employee.parent_id.user_id
        if manager_user:
            order_sudo.activity_schedule(
                "mail.mail_activity_data_todo",
                summary=summary,
                note=note,
                user_id=manager_user.id,
            )
        else:
            _logger.warning(
                "Pointage hors planning sur fsm_order %s (employé %s) mais aucun "
                "responsable (hr.employee.parent_id) à alerter",
                order.id, employee.id,
            )

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
        # _get_project_pointage_chantiers can hand back a project outside
        # `company_id` (its cross-company name-search fallback, or a stale
        # ir.config_parameter). Align on the project's own company so the
        # line we are about to create is not asking for a company_id that
        # disagrees with the project it belongs to.
        company_id = project.company_id.id or company_id

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
            # account.analytic.line rejects a create() whose company_id
            # disagrees with account_id.company_id (Odoo's own
            # _check_company_id) — reachable here whenever the 'Pointage
            # chantiers' project's analytic account and the project itself
            # have drifted onto different companies, a multi-company data
            # state this module does not control (and, per a live Odoo 14
            # instance, the ORM's own _check_company already blocks the
            # normal UI path that would create it — so this is a defense
            # against however production data actually got there, not a
            # theoretical case). account.analytic.line here is only a
            # *mirror* of the clocking, exactly like hr.attendance in
            # _create_attendance above: losing it must never mean losing
            # the pointage record itself.
            try:
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
            except ValidationError as e:
                _logger.warning(
                    "Could not mirror clocking into account.analytic.line for employee %s (%s) "
                    "on fsm_order %s: %s — project/analytic account company mismatch needs review",
                    employee.name, employee.id, fsm_order.id, e,
                )

        elif pointage_type in ("depart", "pause_debut"):
            if open_line:
                try:
                    open_line.date_time_end = now
                    created_ids.append(open_line.id)
                except ValidationError as e:
                    _logger.warning(
                        "Could not close account.analytic.line %s for employee %s (%s): %s",
                        open_line.id, employee.name, employee.id, e,
                    )
        return created_ids
