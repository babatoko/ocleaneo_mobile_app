# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Remove the res.users record rule this module used to ship.

security/record_rules.xml is gone from the source (see
tests/test_security.py for what it did and why), but deleting the file is
not enough for an instance that already has it: the record was declared
inside <data noupdate="1">, and Odoo's orphaned-data cleanup deliberately
skips noupdate records — it treats them as data the user may have edited.
Measured on a live Odoo 14: after `-u ocleaneo_mobile_api`, the obsolete
ACL was gone but the rule was still there and still active, and an
internal user could still see only their own res.users record.

So the rule has to be removed explicitly, once, here. Written to be safe
to re-run and to do nothing on an instance that never had it.
"""

import logging

_logger = logging.getLogger(__name__)

XMLID_MODULE = "ocleaneo_mobile_api"
XMLID_NAME = "ir_rule_mobile_api_self_user"


def migrate(cr, version):
    if not version:
        # Fresh install: the rule never existed here.
        return

    cr.execute(
        """
        SELECT res_id FROM ir_model_data
         WHERE module = %s AND name = %s AND model = 'ir.rule'
        """,
        (XMLID_MODULE, XMLID_NAME),
    )
    row = cr.fetchone()
    if not row:
        return

    rule_id = row[0]
    # Delete the rule itself, then its ir.model.data pointer. Order matters
    # only for readability — both rows go, and an ir.model.data row left
    # dangling would make a later reinstall of the same xmlid confusing.
    cr.execute("DELETE FROM ir_rule WHERE id = %s", (rule_id,))
    cr.execute(
        """
        DELETE FROM ir_model_data
         WHERE module = %s AND name = %s AND model = 'ir.rule'
        """,
        (XMLID_MODULE, XMLID_NAME),
    )
    _logger.info(
        "Removed obsolete res.users record rule %s.%s (id=%s): it restricted "
        "base.group_user to their own user record across the whole instance, "
        "breaking assignment, followers and mentions in the backoffice",
        XMLID_MODULE, XMLID_NAME, rule_id,
    )
