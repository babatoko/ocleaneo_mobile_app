# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    """One-time repair for fsm.location.nfc_tag_ref_id becoming a computed
    field derived from ocleaneo.nfc.tag.location_id (see
    models/fsm_location.py for why: reassigning a tag to a different
    location, by editing the TAG's own location_id, left the location it
    used to belong to with a stale nfc_tag_ref_id still pointing at it —
    reproduced against a live Odoo 14 instance, where the same physical
    badge then resolved via /chantiers/aujourdhui for two different
    locations at once).

    _auto_init does not retroactively recompute a field that merely
    *gained* a compute method on an already-existing, already-correctly-
    typed stored column (there is no schema change for it to notice) —
    verified empirically: upgrading straight to this version left every
    stale nfc_tag_ref_id exactly as it was. This runs the fix once, by
    hand, so existing data is healed on upgrade rather than only future
    writes.
    """
    cr.execute(
        """
        UPDATE fsm_location loc
        SET nfc_tag_ref_id = tag.id
        FROM ocleaneo_nfc_tag tag
        WHERE tag.location_id = loc.id
          AND loc.nfc_tag_ref_id IS DISTINCT FROM tag.id
        """
    )
    relinked = cr.rowcount

    cr.execute(
        """
        UPDATE fsm_location loc
        SET nfc_tag_ref_id = NULL
        WHERE loc.nfc_tag_ref_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM ocleaneo_nfc_tag tag WHERE tag.location_id = loc.id
          )
        """
    )
    cleared = cr.rowcount

    _logger.info(
        "ocleaneo_nfc_tag_registry migration 14.0.1.0.7: relinked %s location(s), "
        "cleared %s stale nfc_tag_ref_id reference(s)",
        relinked, cleared,
    )
