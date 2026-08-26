# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Tests for the local-time <-> UTC helpers.

Odoo stores Datetime fields in UTC; the app works in the worker's local
time. Cleaning crews routinely start before dawn and finish after
midnight, so a day window built naively in UTC drops or misplaces exactly
the shifts this product exists for. These tests pin the boundary
behaviour, including across a DST change.
"""

from datetime import date, datetime

from odoo.addons.ocleaneo_mobile_api.tools.mobile_time import (
    local_day_bounds_utc,
    local_to_utc,
    parse_date,
)
from odoo.tests.common import TransactionCase


class TestLocalDayBounds(TransactionCase):

    def test_winter_day_bounds_are_utc_plus_one(self):
        start, end = local_day_bounds_utc(date(2026, 1, 15), "Europe/Paris")
        self.assertEqual(start, datetime(2026, 1, 14, 23, 0, 0))
        self.assertEqual(end, datetime(2026, 1, 15, 22, 59, 59, 999999))

    def test_summer_day_bounds_are_utc_plus_two(self):
        """DST must be resolved from the date, not assumed constant."""
        start, end = local_day_bounds_utc(date(2026, 7, 15), "Europe/Paris")
        self.assertEqual(start, datetime(2026, 7, 14, 22, 0, 0))
        self.assertEqual(end, datetime(2026, 7, 15, 21, 59, 59, 999999))

    def test_shift_just_after_local_midnight_falls_in_the_right_day(self):
        """The bug a naive UTC window produces, stated as an assertion.

        A shift starting 00:15 local on the 16th is stored as 23:15 UTC on
        the 15th. A window built as "2026-01-16 00:00 .. 23:59" in UTC
        excludes it; the timezone-aware window includes it.
        """
        shift_utc = datetime(2026, 1, 15, 23, 15, 0)  # 00:15 local on the 16th

        naive_start, naive_end = datetime(2026, 1, 16, 0, 0, 0), datetime(2026, 1, 16, 23, 59, 59)
        self.assertFalse(naive_start <= shift_utc <= naive_end)

        start, end = local_day_bounds_utc(date(2026, 1, 16), "Europe/Paris")
        self.assertTrue(start <= shift_utc <= end)

    def test_late_evening_shift_stays_in_its_local_day(self):
        shift_utc = datetime(2026, 1, 15, 22, 30, 0)  # 23:30 local on the 15th
        start, end = local_day_bounds_utc(date(2026, 1, 15), "Europe/Paris")
        self.assertTrue(start <= shift_utc <= end)


class TestLocalToUtc(TransactionCase):

    def test_naive_local_time_is_converted(self):
        self.assertEqual(
            local_to_utc("2026-01-15T05:30:00", "Europe/Paris"),
            datetime(2026, 1, 15, 4, 30, 0),
        )

    def test_explicit_offset_is_honoured(self):
        self.assertEqual(
            local_to_utc("2026-01-15T05:30:00+01:00", "Europe/Paris"),
            datetime(2026, 1, 15, 4, 30, 0),
        )

    def test_utc_suffix_is_honoured(self):
        self.assertEqual(
            local_to_utc("2026-01-15T04:30:00Z", "Europe/Paris"),
            datetime(2026, 1, 15, 4, 30, 0),
        )

    def test_unparseable_input_falls_back_to_now_instead_of_raising(self):
        """A malformed timestamp must not cost the worker their clocking."""
        self.assertIsInstance(local_to_utc("pas une date", "Europe/Paris"), datetime)

    def test_empty_input_falls_back_to_now(self):
        self.assertIsInstance(local_to_utc(None, "Europe/Paris"), datetime)


class TestParseDate(TransactionCase):

    def test_iso_date(self):
        self.assertEqual(parse_date("2026-03-10"), date(2026, 3, 10))

    def test_empty_defaults_to_today(self):
        self.assertEqual(parse_date(None), date.today())

    def test_unparseable_defaults_to_today(self):
        self.assertEqual(parse_date("n'importe quoi"), date.today())
