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

## Configuration

Comme le frontend (`frontend/.env.example`), la configuration se fait par variable d'environnement plutôt que par valeur codée en dur, pour permettre des valeurs différentes en dev/staging/prod sans changement de code :

| Variable | Défaut | Rôle |
|----------|--------|------|
| `OCLEANEO_MOBILE_CORS_ORIGIN` | `http://127.0.0.1:5173` | Origine autorisée en CORS sur les routes `/api/mobile/*`. À restreindre à l'origine réelle de l'app en production. |
| `OCLEANEO_MOBILE_TOKEN_TTL_DAYS` | `30` | Durée de validité d'un token API mobile généré par `/api/mobile/auth/login`. |

En complément, le paramètre système Odoo `ocleaneo_mobile_pointage.project_id` (`ir.config_parameter`) permet de figer l'ID du projet « Pointage chantiers » utilisé par le pointage mobile, pour ne plus dépendre d'une recherche par nom qui casse si le projet est renommé depuis l'UI :

```python
env['ir.config_parameter'].sudo().set_param('ocleaneo_mobile_pointage.project_id', str(project.id))
```

## Identité et authentification mobile

Séparation volontaire, cohérente avec le reste d'Odoo (champs `pin` / « PIN Code » et `barcode` / « Badge ID », déjà présents nativement sur `hr.employee` pour le kiosque de pointage) :

- **`res.users`** porte uniquement le contrôle d'accès : login, mot de passe, groupes/droits.
- **`hr.employee`** porte l'identité et les identifiants du salarié terrain : `mobile_api_token` / `mobile_api_token_expire` (ajoutés par `ocleaneo_mobile_api`), et à terme `pin` / `barcode` s'ils sont exploités par l'app mobile (ex. connexion par scan de badge NFC — l'app supporte déjà le NFC pour le pointage). D'autres champs d'identification pourront être ajoutés au même endroit selon les besoins.

Conséquence pratique : `POST /api/mobile/auth/login` exige que l'employé résolu pour l'utilisateur (`res.users.get_employee_for_mobile()`) soit lié **directement** via `hr.employee.user_id` — pas seulement via une résolution de repli (`fsm.person`, `address_home_id`). C'est ce lien qui permet à chaque requête authentifiée par token de retrouver le contexte utilisateur Odoo (`employee.user_id`) sans dépendre de `res.users` pour le stockage du token lui-même.

### Comparaison avec `res.users.apikeys` (natif, Odoo 14+)

Odoo dispose depuis la 14 d'un mécanisme natif de clés API (`res.users.apikeys`, menu Préférences → Sécurité du compte), qui authentifie les appels XML-RPC/JSON-RPC/REST via `Authorization: Bearer <clé>` à la place du mot de passe. Comparé à notre implémentation custom :

| | `res.users.apikeys` (natif) | `mobile_api_token` (ce module) |
|---|---|---|
| Porté par | `res.users` | `hr.employee` (voir ci-dessus, choix délibéré) |
| Clés simultanées | Plusieurs par utilisateur, nommées, révocables individuellement | Une seule par employé (une nouvelle connexion invalide l'ancienne) |
| Portée (`scope`) | Oui — restreint l'usage d'une clé à un contexte donné | Non — un seul usage possible (l'app mobile) |
| Recherche du token entrant | Colonne `index` (8 premiers caractères hex de la clé brute), indexée, pour éviter un scan complet | Idem depuis ce commit : `mobile_api_token_index` (8 premiers caractères de la clé brute), indexé |
| Hash du secret | `pbkdf2_sha512` (6000 rounds, via `passlib`) | SHA-256 — suffisant ici car la clé brute a 256 bits d'entropie (`secrets.token_urlsafe(32)`), contrairement à un mot de passe utilisateur à faible entropie où un KDF lent est nécessaire |
| Expiration max | Bornée par les rôles/groupes de l'utilisateur | Fixe, via `OCLEANEO_MOBILE_TOKEN_TTL_DAYS` |
| Rate limiting sur la vérification | Oui (`_assert_can_auth()`) | Non — reste un point ouvert |

Le point le plus concret que ce commit reprend : la recherche du token entrant n'est plus un scan de tous les employés ayant un jour eu un token (`env["hr.employee"].search([("mobile_api_token", "!=", False)])` puis vérification en boucle), mais une recherche indexée sur `mobile_api_token_index`, qui ne renvoie en pratique qu'une seule ligne candidate.

Décisions produit tranchées sur ces deux points :
- **Une seule session par employé** (confirmé) : cohérent avec « le téléphone est le badge » — un salarié = un appareil = un badge. Pas de modèle un-vers-plusieurs comme `res.users.apikeys`.
- **Rate limiting sur la vérification de token** : toujours un point ouvert, non traité dans ce module (chaque requête `/api/mobile/*` vérifie le token sans limite de tentatives, contrairement à `_assert_can_auth()` côté natif).

### Connexion par badge (`POST /api/mobile/auth/login_badge`)

Le téléphone lui-même fait office de badge NFC/RFID, identifié par un numéro unique par salarié (potentiellement synchronisé avec l'ID du logiciel de paie, ex. Silae). Réutilise `hr.employee.barcode` — le même champ « Badge ID » qu'Odoo utilise nativement pour les scans physiques ailleurs (Attendance, PoS) — plutôt qu'un nouveau champ dédié.

```
POST /api/mobile/auth/login_badge
{ "barcode": "<numéro unique du badge>" }
→ { "token": "...", "user_id": ..., "employee_id": ..., ... }  (même forme que /auth/login)
```

Contrairement à `/api/mobile/auth/login` (login + mot de passe, deux facteurs), `login_badge` n'a qu'un seul facteur : la possession/connaissance du numéro de badge suffit à obtenir un token API mobile complet. C'est un choix produit assumé (pas un oubli d'implémentation) — mais ça veut dire que ce numéro doit être traité avec la même prudence qu'un mot de passe : pas de diffusion en clair non nécessaire, pas de valeur prévisible (l'unicité seule ne suffit pas — voir la synchronisation Silae ci-dessous, à ne pas faire à partir d'un identifiant séquentiel devinable). Si `barcode` correspond à plusieurs `hr.employee` (erreur de saisie), la connexion est refusée (409) plutôt que de choisir arbitrairement l'un des deux.

La synchronisation avec l'ID Silae (ou tout autre identifiant du logiciel de paie) n'est pas implémentée ici — ce module se contente de lire `hr.employee.barcode` tel qu'il est renseigné ; l'import/synchronisation de cette valeur depuis Silae reste à faire séparément (import manuel, ou connecteur dédié).

## Notes

- Les modules OCA (Field Service, etc.) ne sont pas versionnés ici : ils doivent être montés via volume dans `docker-compose.yml` (`/opt/oca_addons_v14`).
- Les mots de passe et tokens de dev ne doivent jamais être commités.
