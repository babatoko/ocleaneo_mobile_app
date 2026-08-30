# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import logging
import re

from odoo import http
from odoo.http import request
from odoo.tools.mail import html2plaintext

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
    parse_date,
    today_local,
)

_logger = logging.getLogger(__name__)

# order.todo (fieldservice) est un fields.Text — censé être du texte brut —
# mais certaines commandes y stockent en réalité du HTML (vraisemblablement
# copié depuis fsm.template.instructions ou saisi via un widget enrichi côté
# formulaire Odoo, alors que ce champ reste un Text ordinaire). Le mobile
# affichait ce contenu tel quel : les balises apparaissaient littéralement à
# l'écran ("<p>...</p>") au lieu d'un texte lisible. Ne repérer que du texte
# qui RESSEMBLE à du HTML avant de le convertir laisse inchangé le cas normal
# (texte brut sans balises, la grande majorité des commandes).
_HTML_TAG_RE = re.compile(r"<[a-zA-Z/][^>]*>")


def _plain_instructions(text):
    if not text or not _HTML_TAG_RE.search(text):
        return text
    return html2plaintext(text)


class MobilePlanningController(http.Controller):

    @http.route(mobile_routes("planning"), type="json", auth="none", methods=["GET", "POST"], csrf=False, cors=MOBILE_CORS_ORIGIN)
    def planning(self, date=None, date_from=None, date_to=None, view=None, **kwargs):
        """Return the worker's FSM orders for a date or a date range.

        Query parameters:
        - date: YYYY-MM-DD, single day (defaults to today). Ignored if
          date_from/date_to are given.
        - date_from, date_to: YYYY-MM-DD, inclusive range — for the
          Semaine/Mois frontend views, so they don't have to make one
          request per day.
        - view: 'day' | 'week' | 'route' (informational, defaults to config)
        """
        user, employee = authenticate_mobile_request()
        if not user:
            return {"error": "unauthorized", "code": 401}

        env = request.env(user=user.id)
        date_from = kwargs.get("date_from", date_from)
        date_to = kwargs.get("date_to", date_to)
        # Resolved in the worker's timezone, not the server's — same reason
        # as the local day boundaries just below (see today_local()).
        if date_from or date_to:
            range_start = parse_date(date_from, user.tz) if date_from else today_local(user.tz)
            range_end = parse_date(date_to, user.tz) if date_to else range_start
        else:
            range_start = range_end = parse_date(kwargs.get("date", date), user.tz)

        # Refuse an unbounded or inverted window before touching the ORM.
        try:
            check_range(range_start, range_end)
        except DateRangeError as e:
            return e.payload

        # Day boundaries in the worker's local timezone, converted to UTC —
        # not a naive "00:00-23:59 in UTC" window, which would drop or
        # misplace shifts starting before dawn or ending late at night
        # (see frontend/src/utils/date.ts for the equivalent frontend fix).
        date_start, _ = local_day_bounds_utc(range_start, user.tz)
        _, date_end = local_day_bounds_utc(range_end, user.tz)

        # Resolve worker via fsm.person
        person = env["fsm.person"].sudo().search([("partner_id", "=", user.partner_id.id)], limit=1)
        if not person:
            # `truncated` figure aussi ici : une clé présente dans un cas et
            # absente dans l'autre obligerait chaque client à la tester avant
            # de la lire, et le premier qui l'oublierait lirait `undefined`.
            return {
                "count": 0,
                "date_from": str(range_start),
                "date_to": str(range_end),
                "truncated": False,
                "orders": [],
            }

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

        # limit=MAX_RECORDS + 1 : un enregistrement de plus que la limite
        # annoncée, uniquement pour SAVOIR si la liste a été coupée. Sans lui,
        # un résultat pile à la limite serait indiscernable d'un résultat
        # complet, et le client afficherait une liste tronquée sans le dire.
        orders = env["fsm.order"].sudo().search(
            domain, order="scheduled_date_start asc, id asc", limit=MAX_RECORDS + 1)
        truncated = len(orders) > MAX_RECORDS
        if truncated:
            orders = orders[:MAX_RECORDS]
            _logger.warning(
                "planning: %s dépassé pour l'utilisateur %s sur %s..%s",
                MAX_RECORDS, user.login, range_start, range_end)
        result = []
        for order in orders:
            loc = order.location_id
            # fsm.location (OCA fieldservice) has no customer_id field —
            # confirmed against the real module source and a live Odoo 14
            # instance. hasattr() here was always False (Odoo model
            # instances don't dynamically gain attributes for undeclared
            # fields), so `customer` was always empty even when the order
            # did have a billed owner. owner_id is the actual field.
            customer = loc.owner_id if loc and loc.owner_id else False
            partner_contact = customer
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
                # order.todo (module fieldservice) : instructions libres pour
                # cette commande, saisies à la planification ou reprises du
                # modèle. order_activity_ids (module fieldservice_activity) :
                # checklist de tâches, chacune avec son état required/completed.
                "instructions": _plain_instructions(order.todo) or False,
                "activities": [{
                    "id": activity.id,
                    "name": activity.name,
                    "required": activity.required,
                    "completed": activity.completed,
                } for activity in order.order_activity_ids],
            })

        return {
            "date": str(range_start),
            "date_from": str(range_start),
            "date_to": str(range_end),
            "view": view or default_view,
            "count": len(result),
            "truncated": truncated,
            "orders": result,
        }
