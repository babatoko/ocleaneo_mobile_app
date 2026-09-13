# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo.tests.common import TransactionCase


class TestNfcTagRegistry(TransactionCase):

    def setUp(self):
        super().setUp()
        self.partner = self.env["res.partner"].create({"name": "Client NFC"})
        # owner_id is required=True on fsm.location (OCA fieldservice) —
        # without it, create() fails on a NOT NULL violation before any of
        # these tests get to run at all.
        self.location = self.env["fsm.location"].create({
            "name": "Site A",
            "partner_id": self.partner.id,
            "owner_id": self.partner.id,
        })
        self.location2 = self.env["fsm.location"].create({
            "name": "Site B",
            "partner_id": self.partner.id,
            "owner_id": self.partner.id,
        })

    def test_tag_number_is_generated(self):
        tag = self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id,
        })
        self.assertTrue(tag.name)
        self.assertTrue(tag.name.startswith("NFC"))

    def test_location_must_be_unique(self):
        self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id,
            "state": "active",
        })
        with self.assertRaises(Exception):
            self.env["ocleaneo.nfc.tag"].create({
                "location_id": self.location.id,
            })

    def test_uid_must_be_unique(self):
        uid = "04:17:79:C9:78:00:00"
        self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id,
            "uid": uid,
        })
        with self.assertRaises(Exception):
            self.env["ocleaneo.nfc.tag"].create({
                "location_id": self.location2.id,
                "uid": uid,
            })

    def test_partner_inferred_from_location(self):
        tag = self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id,
        })
        self.assertEqual(tag.partner_id, self.partner)

    def test_fsm_location_shows_tag(self):
        tag = self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id,
        })
        self.assertEqual(self.location.nfc_tag_ref_id, tag)

    def test_tag_field_is_many2one(self):
        tag = self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id,
            "uid": "04:17:79:C9:78:00:01",
        })
        self.location.nfc_tag_ref_id = tag
        self.assertEqual(tag.location_id, self.location)

    def test_mobile_uid_resolves_for_an_active_tag(self):
        """get_nfc_tag_uid_for_mobile() is what /chantiers/aujourdhui and
        /planning call — see ocleaneo_mobile_pointage/models/fsm_location.py.
        Before this override existed, both endpoints put the raw Many2one
        field into their JSON response and Odoo silently stringified the
        recordset (e.g. "ocleaneo.nfc.tag(1,)"), which a real badge scan
        can never match."""
        self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id,
            "uid": "04:17:79:C9:78:00:02",
            "state": "active",
        })
        self.assertEqual(self.location.get_nfc_tag_uid_for_mobile(), "04:17:79:C9:78:00:02")

    def test_mobile_uid_is_hidden_for_a_draft_tag(self):
        """A tag registered but not yet physically deployed (still 'draft'
        — see issue #67's own production log) must not be scannable."""
        self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id,
            "uid": "04:17:79:C9:78:00:03",
        })
        self.assertFalse(self.location.get_nfc_tag_uid_for_mobile())

    def test_mobile_uid_is_false_without_a_tag(self):
        self.assertFalse(self.location2.get_nfc_tag_uid_for_mobile())

    def test_group_by_partner_reports_one_bucket_per_customer(self):
        """Backs the "rapport par client" use case: group_partner in the
        search view, or the pivot's row axis, must give one bucket per
        customer with an accurate count."""
        other_partner = self.env["res.partner"].create({"name": "Autre Client"})
        other_location = self.env["fsm.location"].create({
            "name": "Site C", "partner_id": other_partner.id, "owner_id": other_partner.id,
        })
        self.env["ocleaneo.nfc.tag"].create({"location_id": self.location.id})
        self.env["ocleaneo.nfc.tag"].create({"location_id": self.location2.id})
        self.env["ocleaneo.nfc.tag"].create({"location_id": other_location.id})

        groups = self.env["ocleaneo.nfc.tag"].read_group(
            [], ["partner_id"], ["partner_id"]
        )
        counts = {g["partner_id"][0]: g["partner_id_count"] for g in groups if g["partner_id"]}
        self.assertEqual(counts[self.partner.id], 2)
        self.assertEqual(counts[other_partner.id], 1)

    def test_reassigning_via_the_tag_clears_the_old_location(self):
        """Reproduced against a live Odoo 14 instance: before
        nfc_tag_ref_id became a computed field, reassigning a tag to a
        new location by editing the TAG's own location_id left the OLD
        location with a stale nfc_tag_ref_id still pointing at it — the
        same physical badge then resolved (get_nfc_tag_uid_for_mobile)
        for both locations at once."""
        tag = self.env["ocleaneo.nfc.tag"].create({"location_id": self.location.id})
        self.assertEqual(self.location.nfc_tag_ref_id, tag)

        tag.location_id = self.location2.id

        self.assertFalse(self.location.nfc_tag_ref_id)
        self.assertEqual(self.location2.nfc_tag_ref_id, tag)

    def test_reassigning_via_the_location_updates_the_tag_and_clears_the_old_one(self):
        """The other direction of the same bug: editing nfc_tag_ref_id
        from the LOCATION's own form (it's a plain editable field there,
        see fsm_location_views.xml) used to leave ocleaneo.nfc.tag.
        location_id completely untouched, and the previous holder still
        showing the tag too."""
        tag = self.env["ocleaneo.nfc.tag"].create({"location_id": self.location.id})

        self.location2.nfc_tag_ref_id = tag

        self.assertFalse(self.location.nfc_tag_ref_id)
        self.assertEqual(self.location2.nfc_tag_ref_id, tag)
        self.assertEqual(tag.location_id, self.location2)

    def test_uid_is_canonicalized_on_create(self):
        """Mirrors formatNfcIdWithColons()/normalizeNfcId() in the mobile
        app (stores/pointage.ts): stored uppercase, colon-separated,
        regardless of how it was typed or scanned."""
        tag = self.env["ocleaneo.nfc.tag"].create({"uid": "aabbccddeeff"})
        self.assertEqual(tag.uid, "AA:BB:CC:DD:EE:FF")

    def test_uid_duplicate_is_caught_across_spellings(self):
        """Before canonicalization, uid_uniq only caught a literal
        re-entry of the exact same string — "04:17:79:C9:78:00:00" and
        "041779c9780000" registered as two different tags for what is
        physically the same badge."""
        self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id, "uid": "04:17:79:C9:78:00:00",
        })
        with self.assertRaises(Exception):
            self.env["ocleaneo.nfc.tag"].create({
                "location_id": self.location2.id, "uid": "041779c9780000",
            })

    def test_blank_uid_does_not_collide_with_another_blank_uid(self):
        """Postgres treats '' as a real value for uniqueness (unlike NULL,
        which it allows any number of) — a uid field merely cleared in
        the form must not collide with the next tag also left blank."""
        self.env["ocleaneo.nfc.tag"].create({"location_id": self.location.id, "uid": ""})
        tag2 = self.env["ocleaneo.nfc.tag"].create({"location_id": self.location2.id, "uid": ""})
        self.assertFalse(tag2.uid)

    def test_group_by_tag_type_reports_one_bucket_per_model(self):
        """Backs the "rapport par type de tag" use case."""
        self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location.id, "tag_type": "ntag213",
        })
        self.env["ocleaneo.nfc.tag"].create({
            "location_id": self.location2.id, "tag_type": "ntag215",
        })

        groups = self.env["ocleaneo.nfc.tag"].read_group(
            [], ["tag_type"], ["tag_type"]
        )
        counts = {g["tag_type"]: g["tag_type_count"] for g in groups if g["tag_type"]}
        self.assertEqual(counts["ntag213"], 1)
        self.assertEqual(counts["ntag215"], 1)
