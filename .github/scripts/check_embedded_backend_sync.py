#!/usr/bin/env python3
"""Vérifie que le backend embarqué (odoo/addons/) est synchronisé avec le repo
backend (majavi-software/ocleaneo).

La copie embarquée a déjà dérivé une fois (sync 13/09/2026 : 11 versions de
retard, 2 modules entiers manquants — un `docker compose up` démarrait un
backend incapable de servir l'app du même repo). Ce check évite que ça revienne :

  1. chaque module embarqué doit exister côté backend (pas de module fantôme) ;
  2. la version de chaque module embarqué doit être identique à celle du backend ;
  3. réciproquement, chaque module "mobile" du backend doit être embarqué
     (nfc_tag_registry, tag_commissioning — les deux oubliés la première fois).

En CI, le repo backend est cloné à côté (voir ci.yml, job odoo, step « Cloner
le repo backend »). En local :
    python .github/scripts/check_embedded_backend_sync.py /path/to/ocleaneo

Exit 0 = synchronisé ; exit 1 = dérive, avec la liste précise.
"""

import argparse
import re
import sys
from pathlib import Path

# Modules qui vivent SEULEMENT dans le repo backend ( rien à embarquer ) :
# factor, employee_portal, portail salarié, compta… — périmètre back-office.
BACKEND_ONLY_MODULES = {
    "ocleaneo_employee_portal", "ocleaneo_factor", "ocleaneo_factor_overdue_reminder",
    "ocleaneo_account_journal_dashboard_filter", "ocleaneo_account_move_tier_validation",
    "ocleaneo_account_payment_default_method", "ocleaneo_fieldservice_contract_invoice",
    "ocleaneo_fieldservice_contract_invoice_recurring", "ocleaneo_fieldservice_last_month_filter",
    "ocleaneo_fieldservice_orders_list", "ocleaneo_fsm_calendar_color",
    "ocleaneo_fsm_calendar_enhanced", "ocleaneo_fsm_customer_absence",
    "ocleaneo_fsm_tier_validation", "ocleaneo_geocode", "ocleaneo_invoice_footer_fr",
    "ocleaneo_invoice_overdue_reminder", "ocleaneo_project_tasks_list",
    "ocleaneo_sms_gateway", "maj_foreign_workers",
}

VERSION_RE = re.compile(r'"version"\s*:\s*"([^"]+)"')


def module_version(manifest: Path) -> str | None:
    if not manifest.is_file():
        return None
    m = VERSION_RE.search(manifest.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "backend_repo", nargs="?", default="ocleaneo-backend",
        help="chemin du clone du repo backend (défaut : ocleaneo-backend, comme en CI)",
    )
    args = parser.parse_args()

    backend = Path(args.backend_repo)
    embedded = Path(__file__).resolve().parents[2] / "odoo" / "addons"

    if not backend.is_dir():
        print(f"ERREUR: repo backend introuvable : {backend}", file=sys.stderr)
        return 1
    if not embedded.is_dir():
        print(f"ERREUR: dossier embarqué introuvable : {embedded}", file=sys.stderr)
        return 1

    # Les modules mobiles côté backend : prefix ocleaneo_mobile_* + nfc + les
    # deux supports (fieldservice_timesheet, timesheet_duration_compute).
    mobile_prefixes = ("ocleaneo_mobile_", "ocleaneo_nfc_")
    backend_mobiles = {
        d.name for d in backend.iterdir()
        if d.is_dir() and d.name.startswith(mobile_prefixes)
    }
    backend_mobiles |= {
        "ocleaneo_fieldservice_timesheet", "ocleaneo_timesheet_duration_compute",
    }
    backend_mobiles -= BACKEND_ONLY_MODULES

    embedded_modules = {d.name for d in embedded.iterdir() if d.is_dir()}

    errors = []

    # 1. modules embarqués fantômes (n'existent plus côté backend)
    for name in sorted(embedded_modules - backend_mobiles):
        errors.append(f"module embarqué '{name}' n'existe pas dans le repo backend")

    # 2. modules backend manquants côté embarqué
    for name in sorted(backend_mobiles - embedded_modules):
        errors.append(f"module backend '{name}' n'est pas embarqué dans odoo/addons/")

    # 3. versions divergentes (None = manifest illisible : signalé aussi)
    for name in sorted(embedded_modules & backend_mobiles):
        v_emb = module_version(embedded / name / "__manifest__.py")
        v_bck = module_version(backend / name / "__manifest__.py")
        if v_emb is None or v_bck is None:
            errors.append(f"manifest introuvable ou sans version : '{name}'")
        elif v_emb != v_bck:
            errors.append(
                f"version divergente '{name}' : embarqué {v_emb} vs backend {v_bck}"
            )

    if errors:
        print("DÉRIVE du backend embarqué — resynchroniser depuis majavi-software/ocleaneo :")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK : {len(embedded_modules)} modules embarqués synchronisés avec le backend "
          f"({', '.join(sorted(embedded_modules))})")
    return 0


if __name__ == "__main__":
    sys.exit(main())