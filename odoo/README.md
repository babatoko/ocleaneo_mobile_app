# Ocleaneo Odoo 14 Backend — environnement de dev

> **Règle de répartition des repos** : les **modules Odoo vivent dans
> [`majavi-software/ocleaneo`](https://github.com/majavi-software/ocleaneo)**
> (repo backend, = ce qui tourne en prod). Ce dossier ne versionne **aucun
> module** : il ne contient que la configuration Docker de dev et la doc
> d'intégration front/back. Historique : ce repo a embarqué une copie des
> modules jusqu'au 13/09/2026, elle avait dérivé de 11 versions + 2 modules
> entiers — copie retirée, le compose clone maintenant le repo backend.

## Structure

```
odoo/
├── dev/                    # Environnement de développement Docker
│   ├── docker-compose.yml
│   └── odoo14-dev.conf
└── README.md
```

## Modules consommés par l'app (tous dans majavi-software/ocleaneo)

| Module | Rôle |
|--------|------|
| `ocleaneo_mobile_api` | Authentification, profil utilisateur, configuration modules |
| `ocleaneo_mobile_pointage` | Pointage mobile, attendance, feuilles de temps, fermeture FSM |
| `ocleaneo_mobile_api_planning` | Planning des vacations / chantiers |
| `ocleaneo_nfc_tag_registry` | Registre central des tags NFC : un tag = une fsm.location, UID canonisé |
| `ocleaneo_mobile_tag_commissioning` | Commissionnement d'un tag NFC depuis l'app (piloté par feature flag) |
| `ocleaneo_fieldservice_timesheet` | Liaison FSM order ↔ feuilles de temps |
| `ocleaneo_timesheet_duration_compute` | Calcul automatique des durées de timesheet |

Les tests de ces modules sont exécutés par la CI du repo backend
(`.github/workflows/ci.yml` de majavi-software/ocleaneo), qui installe les 7
modules + le factor sur une vraie instance Odoo 14 + Postgres à chaque push.

## Démarrage en dev

Prérequis : Docker. Les modules OCA et le repo backend ne sont pas versionnés
ici — le `docker-compose.yml` monte `./backend` (clone de
majavi-software/ocleaneo) dans `/opt/custom_addons_v14` :

```bash
cd odoo/dev

# 1. Cloner le repo backend (modules Odoo) à côté du compose
git clone git@github.com:majavi-software/ocleaneo.git backend

# 2. Cloner les dépendances OCA (voir § Dépendances OCA)
mkdir -p oca-addons && cd oca-addons
for r in field-service project timesheet web; do
  git clone --depth 1 -b 14.0 "https://github.com/OCA/$r.git"
done

# 3. Démarrer
cd .. && docker compose up
```

Le frontend : `cd frontend && npm ci && npm run dev` (Vite, ou
`VITE_DATA_PROVIDER=mock` pour développer sans backend), ou la variante PWA
du `docker-compose.yml` racine.

## Dépendances OCA

Non versionnées ici, comme le repo backend : à cloner dans `odoo/dev/oca-addons/`
(monté dans `/opt/oca_addons_v14`). Branches 14.0 de : `field-service`,
`project`, `timesheet`, `web`.

---

Le reste de ce README (contrat API, règles métier, sécurité, retour
d'intégration) documente l'API **telle qu'elle existe dans le repo backend** —
lire le code source des modules pour tout détail au-delà.

## Intégration Odoo (résumé)

- L'app parle au backend via **JSON-RPC Odoo natif** sous `/api/mobile/v1/*`
  (pas `base_rest`) — voir `frontend/src/providers/OdooProvider.ts` et les
  contrôleurs dans le repo backend.
- L'URL du serveur est configurable à l'exécution depuis le profil
  (`VITE_ODOO_API_URL` au build par défaut).
- Auth : token opaque Bearer émis à la connexion (`/auth/login` ou
  `/auth/login_badge`), TTL 30 j, invalidé au changement de mot de passe.

## Notes de sécurité (résumé)

- `login_badge` est mono-facteur par choix produit : le numéro de badge est à
  traiter comme un mot de passe (pas de diffusion, pas de valeur prévisible).
- Les règles d'accès (`ir.rule`, ACL) des modèles mobiles vivent dans les
  modules du repo backend — pointage limité au salarié lui-même, registre NFC
  en lecture seule pour les agents, flags en lecture seule.
- CORS : origine par défaut `https://localhost` (WebView Capacitor Android),
  configurable via `OCLEANEO_MOBILE_CORS_ORIGIN` côté serveur.