# Ocleaneo Odoo 14 Backend

Ce dossier contient le backend Odoo 14 de l'application mobile Ocleaneo : modules custom, configuration de développement Docker et documentation d'intégration.

## Structure

```
odoo/
├── addons/                 # Modules Odoo 14 custom
│   ├── ocleaneo_mobile_api/
│   ├── ocleaneo_mobile_pointage/
│   ├── ocleaneo_mobile_api_planning/
│   ├── ocleaneo_fieldservice_timesheet/
│   └── ocleaneo_timesheet_duration_compute/
├── dev/                    # Environnement de développement Docker
│   ├── docker-compose.yml
│   └── odoo14-dev.conf
└── README.md
```

## Modules

| Module | Rôle |
|--------|------|
| `ocleaneo_mobile_api` | Authentification, profil utilisateur, configuration modules |
| `ocleaneo_mobile_pointage` | Pointage mobile, attendance, feuilles de temps, fermeture FSM |
| `ocleaneo_mobile_api_planning` | Planning des vacations / chantiers |
| `ocleaneo_fieldservice_timesheet` | Liaison FSM order ↔ feuilles de temps |
| `ocleaneo_timesheet_duration_compute` | Calcul automatique des durées de timesheet |

## Démarrage en dev

Prérequis : Docker + image `odoo-14-custom:latest` disponible localement (construite à partir de l'image de prod de Martial).

```bash
cd odoo/dev
docker compose up -d
```

Odoo est accessible sur `http://127.0.0.1:8074`.

La base de données cible est `odoo14_dev` (restaurée depuis Barman sur la machine de Martial).

## Intégration avec le frontend

Voir `docs/backend-integration-plan.md` et `docs/backend-integration.md` à la racine du repo.

## Notes

- Les modules OCA (Field Service, etc.) ne sont pas versionnés ici : ils doivent être montés via volume dans `docker-compose.yml` (`/opt/oca_addons_v14`).
- Les mots de passe et tokens de dev ne doivent jamais être commités.
