# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import http, fields
from odoo.http import request
import logging
import dateutil.parser

_logger = logging.getLogger(__name__)

MOBILE_CORS_ORIGIN = "http://127.0.0.1:5173"


class MobilePlanningController(http.Controller):

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

    def _parse_date(self, date_str):
        if not date_str:
            return fields.Date.today()
        try:
            return fields.Date.from_string(date_str)
        except Exception:
            try:
                return dateutil.parser.parse(date_str).date()
            except Exception as e:
                _logger.warning("Failed to parse date '%s': %s", date_str, e)
                return fields.Date.today()

    @http.route("/api/mobile/planning", type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def planning(self, date=None, view=None, **kwargs):
        """Return the worker's FSM orders for a given date.

        Query parameters:
        - date: YYYY-MM-DD (defaults to today)
        - view: 'day' | 'week' | 'route' (informational, defaults to config)
        """
        user = self._authenticate_mobile()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        employee = user.get_employee_for_mobile()
        if not employee:
            return {"error": "no employee linked to user", "code": 400}

        target_date = self._parse_date(kwargs.get("date", date))
        date_start = fields.Datetime.from_string(target_date.isoformat() + " 00:00:00")
        date_end = fields.Datetime.from_string(target_date.isoformat() + " 23:59:59")

        # Resolve worker via fsm.person
        person = env["fsm.person"].sudo().search([("partner_id", "=", user.partner_id.id)], limit=1)
        if not person:
            return {"count": 0, "date": str(target_date), "orders": []}

        # Load planning config for the user's company
        config = env["mobile.api.planning.config"].sudo().search([
            ("company_id", "in", user.company_ids.ids or [user.company_id.id]),
        ], limit=1)
        default_view = config.default_view if config else "day"

        # Domain: orders assigned to the worker, not closed, scheduled on target date
        domain = [
            ("person_id", "=", person.id),
            ("stage_id.is_closed", "!=", True),
            ("company_id", "in", user.company_ids.ids or [user.company_id.id]),
            ("scheduled_date_start", "<=", date_end),
            "|",
            ("scheduled_date_end", ">=", date_start),
            ("scheduled_date_end", "=", False),
        ]

        orders = env["fsm.order"].sudo().search(domain, order="scheduled_date_start asc, id asc")
        result = []
        for order in orders:
            loc = order.location_id
            customer = loc.customer_id if loc and hasattr(loc, "customer_id") and loc.customer_id else False
            partner_contact = customer or (loc.owner_id if loc else False)
            result.append({
                "id": order.id,
                "name": order.name,
                "stage": order.stage_id.name if order.stage_id else False,
                "stage_id": order.stage_id.id if order.stage_id else False,
                "is_closed": order.stage_id.is_closed if order.stage_id else False,
                "scheduled_date_start": order.scheduled_date_start.isoformat() if order.scheduled_date_start else False,
                "scheduled_date_end": order.scheduled_date_end.isoformat() if order.scheduled_date_end else False,
                "date_start": order.date_start.isoformat() if order.date_start else False,
                "date_end": order.date_end.isoformat() if order.date_end else False,
                "location": {
                    "id": loc.id if loc else False,
                    "name": loc.name if loc else False,
                    "complete_name": loc.complete_name if loc else False,
                    "street": loc.street if loc else False,
                    "street2": loc.street2 if loc else False,
                    "zip": loc.zip if loc else False,
                    "city": loc.city if loc else False,
                    "country": loc.country_id.name if loc and loc.country_id else False,
                    "latitude": loc.partner_latitude if loc else False,
                    "longitude": loc.partner_longitude if loc else False,
                },
                "customer": {
                    "id": customer.id if customer else False,
                    "name": customer.name if customer else False,
                    "phone": partner_contact.phone if partner_contact else False,
                    "mobile": partner_contact.mobile if partner_contact else False,
                    "email": partner_contact.email if partner_contact else False,
                } if (config and config.show_customer_phone and partner_contact) else False,
                "person_id": order.person_id.id if order.person_id else False,
                "person_name": order.person_id.name if order.person_id else False,
                "company_id": order.company_id.id if order.company_id else False,
            })

        return {
            "date": str(target_date),
            "view": view or default_view,
            "count": len(result),
            "orders": result,
        }
