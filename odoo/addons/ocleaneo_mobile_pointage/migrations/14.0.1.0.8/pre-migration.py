# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

"""Name the duplicate clockings before the new unique index refuses them.

This version adds `unique (user_id, client_ref)` on
ocleaneo.mobile.pointage. On an instance that already holds duplicates —
exactly what the constraint exists to prevent, recorded before the fix —
the ALTER TABLE cannot succeed, and Odoo does not stop for it: during an
upgrade Registry.post_constraint swallows the failure to an info line and
re-queues it, then finalize_constraints downgrades the second failure to
a warning ("this is not a deployment showstopper"). Measured: the upgrade
exits 0, and the constraint is simply absent. The race this release
fixes would stay wide open, with nothing in the log above debug level
saying so.

Hence this: one loud ERROR naming the rows, before that happens. Nothing
is deleted here on purpose — these rows feed attendance and timesheets,
and choosing which of two clockings is the spurious one is a payroll
decision, not a migration's. The log gives the ids needed to make it.
"""

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return

    cr.execute(
        """
        SELECT user_id, client_ref, array_agg(id ORDER BY id), count(*)
          FROM ocleaneo_mobile_pointage
         WHERE client_ref IS NOT NULL
      GROUP BY user_id, client_ref
        HAVING count(*) > 1
      ORDER BY count(*) DESC, user_id
        """
    )
    duplicates = cr.fetchall()
    if not duplicates:
        return

    _logger.error(
        "%d client_ref(s) are recorded more than once. The unique index this "
        "upgrade adds cannot be created while they exist, and Odoo will let "
        "the upgrade finish anyway with only a schema warning — so the "
        "duplicate-clocking protection will NOT be active. Each group below "
        "is one physical clocking saved twice: keep the first id, delete the "
        "rest once you have checked the attendance and timesheet lines "
        "hanging off them, then re-run the upgrade.",
        len(duplicates),
    )
    for user_id, client_ref, ids, count in duplicates:
        _logger.error(
            "  user_id=%s client_ref=%s recorded %d times: ids %s",
            user_id, client_ref, count, ids,
        )
