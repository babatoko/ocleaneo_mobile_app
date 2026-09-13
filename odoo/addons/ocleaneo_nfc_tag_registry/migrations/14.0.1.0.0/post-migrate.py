# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import api, SUPERUSER_ID


def migrate(cr, version):
    """Move legacy nfc_tag_id Char values into the central registry."""
    env = api.Environment(cr, SUPERUSER_ID, {})
    Location = env["fsm.location"]
    Tag = env["ocleaneo.nfc.tag"]

    cr.execute(
        """
        SELECT id, nfc_tag_id
        FROM fsm_location
        WHERE nfc_tag_id IS NOT NULL AND nfc_tag_id != ''
        """
    )
    rows = cr.fetchall()
    for loc_id, raw in rows:
        uid = str(raw).strip()
        if not uid or uid.isdigit():
            continue
        location = Location.browse(loc_id)
        tag = Tag.search([("uid", "=", uid)], limit=1)
        if not tag:
            tag = Tag.create({
                "uid": uid,
                "location_id": location.id,
                "state": "active",
                "company_id": location.company_id.id or env.company.id,
            })
        else:
            tag.write({"location_id": location.id})
        location.write({"nfc_tag_id": tag.id})
