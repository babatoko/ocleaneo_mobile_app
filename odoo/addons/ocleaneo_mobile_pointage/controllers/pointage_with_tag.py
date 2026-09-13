# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from datetime import timedelta

from odoo import http
from odoo.http import request
import logging

from odoo.addons.ocleaneo_mobile_api.tools.mobile_auth import (
    MOBILE_CORS_ORIGIN,
    mobile_routes,
    authenticate_mobile_request,
)
from odoo.addons.ocleaneo_mobile_api.tools.mobile_time import local_to_utc, today_local, local_day_bounds_utc
from .pointage import MobilePointageController

_logger = logging.getLogger(__name__)


class MobilePointageWithTagController(http.Controller):

    @http.route(mobile_routes("pointage/with-tag"), type="json", auth="none", methods=["POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def pointage_with_tag(self, nfc_tag_id=None, type=None, gps_latitude=None, gps_longitude=None,
                          gps_accuracy=None, commentaire=None, datetime=None, description=None,
                          client_ref=None, **kwargs):
        """Record a clocking from a scanned NFC badge.

        Resolves the tag in the central NFC registry, then tries to attach
        the clocking to an open FSM order in this priority order:

        1. Order assigned to the worker, scheduled today at the tag's location.
        2. Order assigned to the worker at the tag's location, nearest in time.
        3. Any open order at the tag's location, nearest in time.
        4. If no order exists, a location-only clocking is created.

        This lets agents clock on extra jobs that were not pushed to their
        daily planning view.
        """
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}
        if type not in ("arrivee", "depart", "pause_debut", "pause_fin"):
            return {"error": "invalid type", "code": 400}
        if not nfc_tag_id:
            return {"error": "missing nfc_tag_id", "code": 400}

        env = request.env(user=user.id)
        uid = nfc_tag_id.upper().replace(":", "")
        if len(uid) % 2 == 0:
            # Normalise vers le format Odoo avec deux-points si ce n'est déjà le cas
            formatted_uid = ":".join(uid[i:i+2] for i in range(0, len(uid), 2))
        else:
            formatted_uid = nfc_tag_id.upper()

        tag = env["ocleaneo.nfc.tag"].sudo().search([
            "|",
            ("uid", "=", formatted_uid),
            ("uid", "=", uid),
        ], limit=1)
        if not tag:
            return {"error": "badge non reconnu", "code": 404}
        if tag.state != "active":
            return {"error": "badge non actif", "code": 403}

        location = tag.location_id
        if not location:
            return {"error": "tag sans location", "code": 400}

        person = env["fsm.person"].sudo().search([("partner_id", "=", user.partner_id.id)], limit=1)
        now = local_to_utc(datetime)
        tz = user.tz
        today_start, today_end = local_day_bounds_utc(today_local(tz), tz)

        Order = env["fsm.order"].sudo()
        order = Order.browse(False)

        # 1. WO assigné à l'agent aujourd'hui sur cette location
        if person:
            order = Order.search([
                ("person_id", "=", person.id),
                ("location_id", "=", location.id),
                ("stage_id.is_closed", "!=", True),
                ("scheduled_date_start", "<=", today_end),
                "|",
                ("scheduled_date_end", ">=", today_start),
                ("scheduled_date_end", "=", False),
            ], order="scheduled_date_start asc", limit=1)

        # 2. WO assigné à l'agent sur cette location, le plus proche dans le temps
        if not order and person:
            candidates = Order.search([
                ("person_id", "=", person.id),
                ("location_id", "=", location.id),
                ("stage_id.is_closed", "!=", True),
            ], order="scheduled_date_start asc", limit=200)
            order = self._nearest_order(candidates, now)

        # 3. N'importe quel WO ouvert sur cette location, le plus proche dans le temps
        if not order:
            candidates = Order.search([
                ("location_id", "=", location.id),
                ("stage_id.is_closed", "!=", True),
            ], order="scheduled_date_start asc", limit=200)
            order = self._nearest_order(candidates, now)

        fsm_order_id = order.id if order else None

        # ---- Resolve the real clocking type from the worker's history ----
        # The mobile app used to send 'arrivee' on every badge tap because it
        # had no local state machine. The backend is the authoritative
        # place for this decision: it knows the matched location and the
        # worker's last non-cancelled clocking there, so it toggles
        # arrivee <-> depart. This keeps a second badge tap at the same
        # site from opening a second attendance.
        resolved_type = self._resolve_clocking_type(env, user, location, order, type)
        if resolved_type != type:
            _logger.info(
                "pointage/with-tag: resolved type changed for user=%s: %s -> %s",
                user.login, type, resolved_type,
            )
        type = resolved_type

        _logger.info(
            "pointage/with-tag: user=%s tag=%s location=%s matched_order=%s type=%s",
            user.login, tag.name, location.name, fsm_order_id, type,
        )

        # Delegate to the existing pointage controller to keep all
        # attendance/timesheet logic in one place. fsm_location_id is passed
        # even when an order was matched (pointage() then ignores it, since
        # the fsm_order_id branch already sets fsm_location_id from the
        # order) — the one case it actually matters for is #4 above, where no
        # order matched at all: without it, the pointage recorded no chantier
        # reference whatsoever, even though the tag lookup above already knew
        # exactly which location it was.
        return MobilePointageController().pointage(
            type=type,
            fsm_order_id=fsm_order_id,
            fsm_location_id=location.id,
            gps_latitude=gps_latitude,
            gps_longitude=gps_longitude,
            gps_accuracy=gps_accuracy,
            nfc_tag_id=nfc_tag_id,
            commentaire=commentaire,
            datetime=datetime,
            description=description,
            client_ref=client_ref,
        )

    def _resolve_clocking_type(self, env, user, location, order, incoming_type):
        """Toggle arrivee/depart based on the worker's last clocking at this site.

        A badge is a simple switch: in -> out, out -> in. Pauses are not
        expressed by a badge tap, so if the worker is paused we let the
        incoming type through (the mobile app uses manual buttons for pause).
        """
        Pointage = env["ocleaneo.mobile.pointage"].sudo()
        if order:
            # Site history covers both location-only clockings (fsm_location_id
            # set directly) and order clockings (fsm_order_id -> same location).
            location_domain = [
                "|",
                ("fsm_location_id", "=", location.id),
                ("fsm_order_id", "=", order.id),
            ]
        else:
            location_domain = [("fsm_location_id", "=", location.id)]
        domain = [
            ("user_id", "=", user.id),
            ("state", "!=", "annule"),
        ] + location_domain
        # Two badge taps a few dozen milliseconds apart share the same
        # datetime second here, so `datetime desc` alone can return the
        # older record (Postgres ties are not ordered) — that made a third
        # badge tap reopen an attendance instead of staying on depart/arrivee
        # (test_third_badge_tap_becomes_arrival_again). `id desc` is the
        # deterministic tie-break: newest row wins.
        last = Pointage.search(domain, order="datetime desc, id desc", limit=1)
        if not last:
            return "arrivee"
        if last.type in ("arrivee", "pause_fin"):
            return "depart"
        if last.type == "pause_debut":
            # Paused: the badge means "resume". The app normally handles
            # pause via buttons, but if a badge is tapped while paused we
            # treat it as the explicit action the worker is trying to take
            # (the incoming type, usually arrivee from the app).
            return incoming_type if incoming_type != "arrivee" else "pause_fin"
        return "arrivee"

    def _nearest_order(self, orders, now):
        """Return the order whose scheduled_date_start is closest to now."""
        if not orders:
            return orders.browse(False)
        best = orders[0]
        best_delta = timedelta.max
        for order in orders:
            scheduled = order.scheduled_date_start
            if not scheduled:
                continue
            delta = abs(scheduled - now)
            if delta < best_delta:
                best_delta = delta
                best = order
        return best
