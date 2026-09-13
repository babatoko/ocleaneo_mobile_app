# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

FLAG_TECHNICAL_NAME = "ocleaneo_tag_commissioning"


def ensure_flags_for_companies(env, company_ids=None):
    """Idempotent: create ocleaneo_tag_commissioning config rows for the
    given companies (default: all), keeping an existing row untouched —
    a manager's is_active/targeting choices are never overwritten by an
    upgrade or a later company creation. Called by the module's
    post_init_hook and reusable for companies created later.
    """
    Config = env["mobile.module.config"].sudo()
    companies = env["res.company"].sudo().search(
        company_ids and [("id", "in", company_ids)] or []
    )
    for company in companies:
        existing = Config.search([
            ("technical_name", "=", FLAG_TECHNICAL_NAME),
            ("company_id", "=", company.id),
        ], limit=1)
        if existing:
            continue
        Config.create({
            "technical_name": FLAG_TECHNICAL_NAME,
            "label": "Commissionner un tag",
            "icon": "nfc",
            "route_path": "/tag-commissioning",
            "is_active": False,
            "offline_capable": False,
            "phase": "mvp",
            "company_id": company.id,
        })


def commission_tag(env, employee, raw_uid):
    """Resolve (and create when unknown) the registry tag for a scanned UID.

    Returns (tag, existing). The payload normalisation is done here, on the
    server, so the app sends the raw string exactly as the NFC plugin read
    it — no client-side normalisation to get wrong.

    The create runs as sudo because the registry's write ACL is reserved
    for FSM managers while commissioning is a field-agent action; the
    escape hatch is bounded: company = the agent's, state = draft, name =
    the sequence — nothing else is touchable from this path, and a
    concurrent duplicate is caught by the registry's uid_uniq constraint
    (re-search instead of crashing).
    """
    from odoo.addons.ocleaneo_nfc_tag_registry.models.ocleaneo_nfc_tag import (
        canonical_nfc_uid,
    )

    uid = canonical_nfc_uid(raw_uid)
    if not uid:
        return None, False

    Tag = env["ocleaneo.nfc.tag"].sudo()
    tag = Tag.search([("uid", "=", uid)], limit=1)
    if tag:
        return tag, True
    try:
        with env.cr.savepoint():
            tag = Tag.create({
                "uid": uid,
                "state": "draft",
                "company_id": employee.company_id.id,
                "commissioned_by_employee_id": employee.id,
            })
    except Exception:
        # uid_uniq lost a race against a concurrent scan of the same badge.
        env.cr.rollback()
        tag = Tag.search([("uid", "=", uid)], limit=1)
        if not tag:
            raise
        return tag, True
    tag.message_post(body="Commissionné par %s via l'app mobile." % employee.name)
    return tag, False