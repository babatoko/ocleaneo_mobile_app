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


def parse_date(date_str):
    """Parse a YYYY-MM-DD (or otherwise dateutil-parseable) date string,
    falling back to today (server date) if missing or unparseable. Shared
    by every controller that accepts an optional ?date= style param.
    """
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
