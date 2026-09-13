# Copyright 2026 Ocleaneo
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

# FLAG_TECHNICAL_NAME vit dans tools/commissioning (et non ici) : le package
# racine importe controllers, qui lit la constante — la définir ici créait un
# import circulaire (controllers chargé avant la définition de la constante).

from . import controllers
from . import models
from .tools.commissioning import (
    FLAG_TECHNICAL_NAME,
    commission_tag,
    ensure_flags_for_companies,
)


def post_init_hook(cr, registry):
    """Odoo 14 post_init_hook signature: (cr, registry).

    Create the feature flag for every existing company, disabled by
    default. The feature only reaches the agents once a manager activates
    it in App Mobile > Feature Flags — installing the module must never
    switch anything on for the field. New companies created later get the
    flag from the same code path when their config is needed (see
    ensure_flags_for_companies in tools/commissioning.py).
    """
    import odoo

    with odoo.api.Environment.manage():
        env = odoo.api.Environment(cr, 1, {})
        ensure_flags_for_companies(env)