# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import logging

from psycopg2 import sql

from odoo import api, SUPERUSER_ID
from odoo.tools import sql as tools_sql

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    """Repair fsm.location's NFC tag link after the nfc_tag_id/nfc_tag_ref_id
    rename (see models/fsm_location.py for why the field was renamed), and
    recover any legacy UID the original 14.0.1.0.0 migration never actually
    reached.

    ## The rename churn

    fsm.location.nfc_tag_id used to be redeclared as a Many2one by this
    module while ocleaneo_mobile_pointage still declared the same field
    name as a Char. Odoo does not merge conflicting field *types* across
    an _inherit chain: whichever module's _auto_init ran last for a given
    upgrade won, by renaming the column holding the OTHER type's data to
    nfc_tag_id_moved0 (then _moved1, _moved2, ... on every further flip)
    and creating a fresh, EMPTY column under the live name. Reproduced
    against a live Odoo 14 instance: upgrading these two modules
    independently (not in the same -u command, which is exactly how a
    module gets deployed by hand one at a time) flips the column type back
    and forth, and each flip silently empties every location's tag
    assignment from the app's point of view.

    ## Why 14.0.1.0.0's own migration could not have worked either

    That migration read fsm_location.nfc_tag_id to find legacy Char UIDs
    to move into the registry — but a *post*-migrate script runs after
    _auto_init has already applied the schema change for the version being
    installed. By the time it ran, the Char data was already sitting in
    nfc_tag_id_moved0 and the live nfc_tag_id column was already the
    fresh, empty Many2one one. Reproduced against a live Odoo 14 instance:
    its `WHERE nfc_tag_id IS NOT NULL` clause matched nothing, every time,
    regardless of whether the upgrade was atomic or partial. Any location
    that only ever had the legacy Char UID — never manually re-registered
    by hand afterward — was silently never migrated at all.

    ## The fix, in order

    1. Sweep every nfc_tag_id_moved* column still holding character data
       for values that look like a real UID (mirrors 14.0.1.0.0's own
       "not empty, not purely numeric" heuristic) and register them —
       reusing an existing tag by uid if one already exists, creating one
       otherwise — exactly what 14.0.1.0.0 intended to do.
    2. Rebuild nfc_tag_ref_id from ocleaneo.nfc.tag.location_id — the
       reverse link, on a column of its own on a different table, never
       subject to the rename churn above and carrying a unique constraint
       (location_uniq) guaranteeing at most one tag per location. This is
       what heals every location a tag was already correctly registered
       for (by hand, or by step 1 above), regardless of which column its
       stale nfc_tag_id_moved* data ended up parked in or how many times
       the type flipped.

    Finally, the moved columns are dropped: superseded by the above, they
    are otherwise dead weight that keeps accumulating on every further
    accidental flip.
    """
    env = api.Environment(cr, SUPERUSER_ID, {})
    Location = env["fsm.location"]
    Tag = env["ocleaneo.nfc.tag"]

    cr.execute(
        """
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'fsm_location' AND column_name LIKE 'nfc\\_tag\\_id\\_moved%'
        """
    )
    moved_columns = cr.fetchall()

    recovered = 0
    for column, data_type in moved_columns:
        if data_type not in ("character varying", "text"):
            continue
        cr.execute(
            sql.SQL("SELECT id, {col} FROM fsm_location WHERE {col} IS NOT NULL AND {col} != ''").format(
                col=sql.Identifier(column)
            )
        )
        for location_id, raw in cr.fetchall():
            candidate_uid = str(raw).strip()
            # Same heuristic as 14.0.1.0.0: a purely numeric value here is
            # near-certainly a stray Many2one id from an earlier flip, not
            # a genuine physical UID — Postgres would have typed a real
            # Many2one column as integer, not varchar, but a column that
            # went Many2one -> Char -> Many2one across several flips could
            # still carry one as text in an intermediate varchar slot.
            if not candidate_uid or candidate_uid.isdigit():
                continue
            location = Location.browse(location_id)
            tag = Tag.search([("uid", "=", candidate_uid)], limit=1)
            if tag:
                if tag.location_id and tag.location_id != location:
                    tag.write({"location_id": location.id})
            else:
                existing_for_loc = Tag.search([("location_id", "=", location.id)], limit=1)
                if existing_for_loc:
                    existing_for_loc.write({"uid": candidate_uid})
                else:
                    Tag.create({
                        "uid": candidate_uid,
                        "location_id": location.id,
                        "state": "active",
                        "company_id": location.company_id.id or env.company.id,
                    })
            recovered += 1
    if recovered:
        _logger.info(
            "ocleaneo_nfc_tag_registry migration 14.0.1.0.2: recovered %s legacy "
            "NFC UID(s) the 14.0.1.0.0 migration never actually reached",
            recovered,
        )

    cr.execute(
        """
        UPDATE fsm_location loc
        SET nfc_tag_ref_id = tag.id
        FROM ocleaneo_nfc_tag tag
        WHERE tag.location_id = loc.id
          AND loc.nfc_tag_ref_id IS DISTINCT FROM tag.id
        """
    )
    _logger.info(
        "ocleaneo_nfc_tag_registry migration 14.0.1.0.2: relinked %s location(s) "
        "to their registered NFC tag via ocleaneo_nfc_tag.location_id",
        cr.rowcount,
    )

    for column, _data_type in moved_columns:
        cr.execute(
            sql.SQL("ALTER TABLE fsm_location DROP COLUMN IF EXISTS {}").format(
                sql.Identifier(column)
            )
        )
    if moved_columns:
        _logger.info(
            "ocleaneo_nfc_tag_registry migration 14.0.1.0.2: dropped stale column(s) %s",
            [c for c, _ in moved_columns],
        )

    # 3. Drop the legacy Char nfc_tag_id column entirely. ocleaneo_mobile_pointage
    #    still declares it as a Char, but it is superseded by the central registry
    #    (ocleaneo.nfc.tag.location_id / nfc_tag_ref_id). Keeping it filled with
    #    legacy UIDs duplicates data and creates confusion in views and reports.
    if tools_sql.column_exists(cr, 'fsm_location', 'nfc_tag_id'):
        cr.execute(
            sql.SQL("ALTER TABLE fsm_location DROP COLUMN IF EXISTS {}").format(
                sql.Identifier('nfc_tag_id')
            )
        )
        _logger.info(
            "ocleaneo_nfc_tag_registry migration 14.0.1.0.2: dropped legacy "
            "nfc_tag_id column from fsm_location"
        )
