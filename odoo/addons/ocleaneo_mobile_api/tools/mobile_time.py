# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Shared local-time <-> UTC helpers for the mobile API.

Odoo stores Datetime fields in UTC. The mobile app works in the worker's
local time (typically Europe/Paris), including for cleaning crews that
start before dawn — a naive "00:00-23:59 in UTC" day window silently
shifts early-morning or late-evening shifts to the wrong day. This mirrors
the day-boundary handling already documented in
frontend/src/utils/date.ts.
"""

import logging
from datetime import datetime, time

import dateutil.parser
import pytz

from odoo import fields
from odoo.http import request

_logger = logging.getLogger(__name__)

DEFAULT_TZ = "Europe/Paris"


def _user_tz(fallback_tz=None):
    return fallback_tz or request.env.user.tz or DEFAULT_TZ


def local_to_utc(datetime_iso, fallback_tz=None):
    """Convert an ISO8601 local datetime string (with or without offset)
    to a naive UTC Datetime. If no timezone is provided, the requesting
    user's own timezone is assumed. Returns the current UTC time if
    parsing fails.
    """
    if not datetime_iso:
        return fields.Datetime.now()
    try:
        dt = dateutil.parser.isoparse(datetime_iso)
        if dt.tzinfo is None:
            local_tz = pytz.timezone(_user_tz(fallback_tz))
            dt = local_tz.localize(dt)
        return dt.astimezone(pytz.utc).replace(tzinfo=None)
    except Exception as e:
        _logger.warning("Failed to parse datetime '%s': %s", datetime_iso, e)
        return fields.Datetime.now()


def today_local(fallback_tz=None):
    """Current date as the *worker* sees it, not as the server does.

    fields.Date.today() is date.today(): the date in the server process's
    own timezone, which is UTC on any normal deployment. Every controller
    here then turns that date into a day window using the worker's
    timezone (local_day_bounds_utc). Seeding a local-time window with a
    UTC-dated "today" mixes two calendars: between local midnight and the
    UTC offset — 00:00-01:00 in Europe/Paris, 00:00-02:00 in summer — the
    two disagree and the window silently lands on the previous day.

    That is not a theoretical edge: cleaning crews start before dawn and
    work across midnight, which is the exact window this app targets. The
    frontend already had to fix the mirror image of this bug (see
    frontend/src/utils/date.ts, where Date.toISOString().slice(0, 10)
    dated in UTC). Equivalent to Odoo's own fields.Date.context_today.
    """
    local_tz = pytz.timezone(_user_tz(fallback_tz))
    return datetime.now(pytz.utc).astimezone(local_tz).date()


def parse_date(date_str, fallback_tz=None):
    """Parse a YYYY-MM-DD (or otherwise dateutil-parseable) date string,
    falling back to the worker's local today if missing or unparseable.
    Shared by every controller that accepts an optional ?date= style param.

    The fallback is today_local(), not fields.Date.today(): see that
    function for why a server-dated "today" is the wrong seed for a
    window that is then cut in local time.
    """
    if not date_str:
        return today_local(fallback_tz)
    try:
        return fields.Date.from_string(date_str)
    except Exception:
        try:
            return dateutil.parser.parse(date_str).date()
        except Exception as e:
            _logger.warning("Failed to parse date '%s': %s", date_str, e)
            return today_local(fallback_tz)


def local_day_bounds_utc(target_date, fallback_tz=None):
    """Return (start_utc, end_utc) naive Datetimes covering the full local
    day (00:00:00 to 23:59:59.999999) for target_date in the requesting
    user's timezone, converted to UTC.
    """
    local_tz = pytz.timezone(_user_tz(fallback_tz))
    local_start = local_tz.localize(datetime.combine(target_date, time.min))
    local_end = local_tz.localize(datetime.combine(target_date, time.max))
    return (
        local_start.astimezone(pytz.utc).replace(tzinfo=None),
        local_end.astimezone(pytz.utc).replace(tzinfo=None),
    )
