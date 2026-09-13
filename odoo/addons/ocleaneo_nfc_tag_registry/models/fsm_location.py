# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import api, fields, models


class FsmLocation(models.Model):
    _inherit = "fsm.location"

    # Deliberately NOT named nfc_tag_id: ocleaneo_mobile_pointage already
    # declares fsm.location.nfc_tag_id as a Char, and this module used to
    # redeclare the SAME field name as a Many2one to replace it. Odoo does
    # not merge conflicting types across an _inherit chain the way it
    # merges attributes like help/string — whichever module's _auto_init
    # runs last for a given upgrade wins, and it does so by renaming the
    # column that held the OTHER type's data to nfc_tag_id_moved0 (then
    # _moved1, _moved2, ... on every further flip) and creating a fresh,
    # EMPTY column under the live name. Reproduced against a live Odoo 14
    # instance: upgrading ocleaneo_mobile_pointage and
    # ocleaneo_nfc_tag_registry independently (not in the same -u command)
    # flips the column type back and forth, and each flip silently empties
    # every location's tag assignment from the app's point of view — the
    # data is not lost (it survives in the renamed column) but becomes
    # invisible until someone notices and re-syncs it by hand. See
    # migrations/14.0.1.0.2/post-migrate.py for the one-time repair and
    # why ocleaneo.nfc.tag.location_id, never subject to this churn, is
    # the field that migration trusts to rebuild from.
    #
    # compute/inverse/store rather than a second plain stored Many2one:
    # ocleaneo.nfc.tag.location_id (unique per tag.location_uniq) is the
    # single source of truth for this relationship. A plain stored field
    # here needs its own manual sync, and that sync (the old
    # _check_location_consistency constrain on ocleaneo.nfc.tag) only
    # ever ran when a TAG's own location_id changed — reassigning here,
    # from the location's own form, never touched the tag at all.
    # Reproduced against a live Odoo 14 instance: create tag T on
    # location A, then edit T.location_id to point at location B — A kept
    # showing nfc_tag_ref_id = T (stale) alongside B now also showing T,
    # so the SAME physical badge resolved for both A's and B's mobile
    # /chantiers/aujourdhui. Deriving this field from the tag's own
    # location_id instead of storing it a second time makes that
    # divergence structurally impossible: any write to a tag's
    # location_id (from anywhere — this form, the tag's own form, the
    # migration, the API) invalidates and recomputes nfc_tag_ref_id on
    # both the location losing the tag and the one gaining it, via Odoo's
    # native One2many/Many2one consistency (nfc_tag_ids below), not
    # hand-written sync code.
    nfc_tag_ids = fields.One2many(
        "ocleaneo.nfc.tag", "location_id",
        help="Technical: drives nfc_tag_ref_id below. At most one element — "
             "ocleaneo.nfc.tag.location_uniq guarantees it.",
    )
    nfc_tag_ref_id = fields.Many2one(
        "ocleaneo.nfc.tag",
        string="NFC Tag",
        compute="_compute_nfc_tag_ref_id",
        inverse="_inverse_nfc_tag_ref_id",
        store=True,
        index=True,
        help="Tag from the central NFC registry assigned to this location.",
    )

    @api.depends("nfc_tag_ids")
    def _compute_nfc_tag_ref_id(self):
        for location in self:
            location.nfc_tag_ref_id = location.nfc_tag_ids[:1]

    def _inverse_nfc_tag_ref_id(self):
        for location in self:
            # Detach whatever tag used to point here but isn't the newly
            # assigned one — otherwise it would keep claiming this
            # location (location_uniq only stops it claiming two at
            # once, not this one becoming a second claimant of it).
            location.nfc_tag_ids.filtered(
                lambda t, loc=location: t != loc.nfc_tag_ref_id
            ).location_id = False
            if location.nfc_tag_ref_id:
                location.nfc_tag_ref_id.location_id = location.id

    def get_nfc_tag_uid_for_mobile(self):
        """Override of the Char-passthrough base (ocleaneo_mobile_pointage):
        resolve the registered tag's physical UID instead of returning the
        Many2one field itself.

        Without this override, GET /chantiers/aujourdhui and /planning both
        serialize nfc_tag_id by putting the raw field value straight into
        a JSON dict — for a Char that is a UID string, but for this
        module's Many2one it is an ocleaneo.nfc.tag recordset. Odoo's
        JSON-RPC encoder does not reject that (confirmed against a live
        Odoo 14 instance): it silently stringifies it to something like
        "ocleaneo.nfc.tag(1,)", which the mobile app's badge scan
        (normalizeNfcId() in stores/pointage.ts) can never match against a
        real UID. Every location with a registered tag was unmatchable by
        badge scan, silently, with no error on either side.

        Restricted to state == "active": a tag still "draft" (registered
        but not yet physically deployed — see issue #67's own production
        log of NFC00002) or "lost"/"disabled" must not be scannable.
        """
        self.ensure_one()
        tag = self.nfc_tag_ref_id
        if tag and tag.state == "active":
            return tag.uid or False
        return False
