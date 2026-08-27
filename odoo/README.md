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

Prérequis : Docker. Les modules OCA ne sont pas versionnés ici (voir § Dépendances OCA) — il faut donc les cloner une fois avant le premier démarrage :

```bash
cd odoo/dev
mkdir -p oca-addons && cd oca-addons
for r in field-service project timesheet web; do
  git clone --depth 1 -b 14.0 "https://github.com/OCA/$r.git"
done
cd ..
docker compose up -d
```

Odoo est accessible sur `http://127.0.0.1:8074`.

Le compose utilise l'image officielle `odoo:14` par défaut, pour démarrer chez n'importe qui. L'image de prod (construite à partir de celle de Martial) reste utilisable en posant `ODOO_IMAGE=odoo-14-custom:latest` dans `odoo/dev/.env` — elle n'est nécessaire que pour reproduire des paquets Python spécifiques à la prod.

La base de données cible est `odoo14_dev`. La restaurer depuis Barman (machine de Martial) donne les données réelles ; à défaut, une base vierge suffit pour installer les modules et faire tourner les tests.

## Tests

```bash
odoo-bin -d <base> --addons-path=<...>,odoo/addons \
  -i ocleaneo_mobile_api,ocleaneo_mobile_pointage \
  --test-enable --test-tags '/ocleaneo_mobile_api,/ocleaneo_mobile_pointage' \
  --stop-after-init
```

Le job `odoo` de `.github/workflows/ci.yml` exécute exactement cette procédure à chaque push (clonage d'Odoo 14 et des quatre dépôts OCA, Postgres en service, lint `pyflakes` puis tests). `odoo-bin` propage l'échec dans son code retour, le job échoue donc si un test casse.

**Quand la CI se déclenche.** Sur un push vers **n'importe quelle branche**, et sur chaque pull request. Le réglage d'origine ne couvrait que `main` : une branche poussée sans PR ne déclenchait rien, et les 21 commits de l'intégration Odoo n'ont ainsi jamais été vus par la CI avant l'ouverture de la PR — qui a immédiatement révélé un échec au démarrage d'Odoo, invisible en local où l'environnement datait d'avant la suppression de `pkg_resources`.

L'évènement `pull_request` est conservé en plus du `push`, et ce n'est pas un doublon inutile : il teste le résultat de la **fusion** avec la base, là où `push` ne teste que la branche seule. C'est ce qui attrape « ma branche passe, mais elle casse une fois fusionnée avec `main` ». Le coût est une exécution supplémentaire par PR ; un bloc `concurrency` annule en contrepartie les runs rendus caducs par un push plus récent — sauf sur `main`, dont l'historique de CI doit rester la trace de ce qui a été validé.

**Ce que la CI ne fait pas.** Elle n'empêche pas un `main` rouge : rien ne bloque un push direct. Seule la protection de branche côté GitHub (checks verts obligatoires avant fusion) transforme l'intention en contrainte.

**`setuptools` y est épinglé sous 81**, et ce n'est pas cosmétique : Odoo 14 fait `import pkg_resources` dès son démarrage (`odoo/modules/module.py`), or setuptools a retiré ce paquet en **82.0.0** (mesuré : 81.x l'a encore, 82.0.0 ne l'a plus). Un `pip install --upgrade setuptools` sans borne prend la dernière version et `odoo-bin` meurt sur `ModuleNotFoundError` avant de charger le moindre module — donc avant le premier test, sans qu'aucun test ne soit en cause. C'est exactement ce qui est arrivé au premier run de CI de la branche d'intégration. 81.x avertit déjà lui-même « pin to Setuptools<81 » ; on suit cette consigne amont plutôt que la seule limite technique. À lever le jour où le backend passera à une version d'Odoo qui n'importe plus `pkg_resources`.

Le même piège attend toute reconstruction d'environnement local : un venv créé aujourd'hui sans borne ne démarrera pas Odoo 14.

## Intégration avec le frontend

Voir `docs/backend-integration-plan.md` à la racine du repo, et `frontend/src/providers/OdooProvider.ts` pour l'adaptateur qui consomme ces routes.

### Périmètre couvert, et ce que l'app en fait

Ce backend couvre le **planning**, le **pointage**, les **chantiers** et l'**authentification**. Il n'expose aujourd'hui **aucune route** pour trois domaines que l'app sait pourtant afficher : catalogue produits, inventaire, commandes.

Ces trois-là ne sont pas laissés à échouer à l'exécution. Le contrat `DataProvider` porte une déclaration de capacités (`supports(feature)`, cf. `frontend/src/providers/DataProvider.ts`) ; `OdooProvider` déclare les trois domaines non couverts, et les écrans concernés (`CatalogueView`, `InventaireView`, `HistoriqueView`) interrogent cette déclaration **avant** d'appeler. Ils affichent alors une explication en français — sans bouton « Réessayer », puisque réessayer ne peut rien y changer — au lieu d'un spinner suivi du nom de la méthode manquante. `ChantierDetailView` dégrade de la même façon : la vacation s'affiche normalement, seuls les boutons Stock et Inventaire disparaissent.

Conséquence pratique : quand les routes manquantes existeront côté Odoo, il suffira de retirer le domaine correspondant de `UNSUPPORTED_FEATURES` dans `OdooProvider.ts` pour rallumer l'onglet — rien à changer côté écrans. Le comportement est verrouillé par `frontend/src/providers/__tests__/capabilities.test.ts`.

## Configuration

Comme le frontend (`frontend/.env.example`), la configuration se fait par variable d'environnement plutôt que par valeur codée en dur, pour permettre des valeurs différentes en dev/staging/prod sans changement de code :

| Variable | Défaut | Rôle |
|----------|--------|------|
| `OCLEANEO_MOBILE_CORS_ORIGIN` | `http://127.0.0.1:5173` | Origine autorisée en CORS sur les routes `/api/mobile/*`. Le défaut (serveur de dev Vite) convient à l'app native : Capacitor appelle l'API depuis une WebView, où le CORS ne s'applique pas. Il est en revanche faux pour un déploiement **PWA**, où le navigateur l'applique — à régler alors sur l'origine du site. Un `info` est journalisé au démarrage quand la variable n'est pas définie, pour que l'oubli se voie dans le log plutôt qu'en mur de requêtes bloquées. |
| `OCLEANEO_MOBILE_TOKEN_TTL_DAYS` | `30` | Durée de validité d'un token API mobile généré par `/api/mobile/auth/login`. |
| `OCLEANEO_MOBILE_AUTH_MAX_ATTEMPTS` | `10` | Échecs d'authentification tolérés par identifiant (login ou badge) sur la fenêtre, avant refus. |
| `OCLEANEO_MOBILE_AUTH_MAX_IP_ATTEMPTS` | `50` | Idem par adresse source. Volontairement plus large : une équipe entière partage souvent une seule connexion (wifi de site, NAT 4G). |
| `OCLEANEO_MOBILE_AUTH_WINDOW_MINUTES` | `15` | Fenêtre glissante des deux compteurs ci-dessus. |
| `OCLEANEO_MOBILE_AUTH_RETENTION_HOURS` | `24` | Durée de conservation des tentatives échouées avant purge (`@api.autovacuum`), pour rester consultables après coup. |

Le rate limiting ne remplace pas le cooldown natif d'Odoo (`base.login_cooldown_after`) mais le complète : le natif ne couvre que `res.users.authenticate()` — donc pas `login_badge` — ne compte que par adresse, et garde son compteur en mémoire de chaque worker. Détail du raisonnement dans la docstring de `models/mobile_auth_attempt.py`.

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
- **Rate limiting sur la vérification de token** : volontairement absent, contrairement aux routes d'identifiants (`login`, `login_badge`) qui, elles, sont limitées. Un token fait 256 bits d'entropie (`secrets.token_urlsafe(32)`) : le deviner n'est pas une attaque réaliste, alors qu'écrire une ligne par requête non authentifiée offrirait à n'importe qui un moyen simple de saturer la table des tentatives. Décision documentée dans `tools/mobile_auth.check_auth_rate_limit`.

### Connexion par badge (`POST /api/mobile/auth/login_badge`)

Le téléphone lui-même fait office de badge NFC/RFID, identifié par un numéro unique par salarié (potentiellement synchronisé avec l'ID du logiciel de paie, ex. Silae). Réutilise `hr.employee.barcode` — le même champ « Badge ID » qu'Odoo utilise nativement pour les scans physiques ailleurs (Attendance, PoS) — plutôt qu'un nouveau champ dédié.

```
POST /api/mobile/auth/login_badge
{ "barcode": "<numéro unique du badge>" }
→ { "token": "...", "user_id": ..., "employee_id": ..., ... }  (même forme que /auth/login)
```

Contrairement à `/api/mobile/auth/login` (login + mot de passe, deux facteurs), `login_badge` n'a qu'un seul facteur : la possession/connaissance du numéro de badge suffit à obtenir un token API mobile complet. C'est un choix produit assumé (pas un oubli d'implémentation) — mais ça veut dire que ce numéro doit être traité avec la même prudence qu'un mot de passe : pas de diffusion en clair non nécessaire, pas de valeur prévisible (l'unicité seule ne suffit pas — voir la synchronisation Silae ci-dessous, à ne pas faire à partir d'un identifiant séquentiel devinable). Si `barcode` correspond à plusieurs `hr.employee` (erreur de saisie), la connexion est refusée (409) plutôt que de choisir arbitrairement l'un des deux.

La synchronisation avec l'ID Silae (ou tout autre identifiant du logiciel de paie) n'est pas implémentée ici — ce module se contente de lire `hr.employee.barcode` tel qu'il est renseigné ; l'import/synchronisation de cette valeur depuis Silae reste à faire séparément (import manuel, ou connecteur dédié).

## Dépendances OCA

Non versionnées ici (voir § Notes) : à monter via volume dans `docker-compose.yml` (`/opt/oca_addons_v14`) ou à cloner localement pour du dev/test hors Docker.

| Dépôt | Branche | Modules requis |
|-------|---------|-----------------|
| [OCA/field-service](https://github.com/OCA/field-service) | 14.0 | `fieldservice`, `base_territory` (dépendance directe) |
| [OCA/project](https://github.com/OCA/project) | 14.0 | `project_timesheet_time_control` |
| [OCA/timesheet](https://github.com/OCA/timesheet) | 14.0 | `hr_timesheet_task_domain`, `hr_timesheet_task_stage` (dépendances de `project_timesheet_time_control`, absentes d'`OCA/project` lui-même) |
| [OCA/web](https://github.com/OCA/web) | 14.0 | `web_ir_actions_act_multi`, `web_ir_actions_act_view_reload` (idem) |

Cette liste complète (`OCA/project` seul ne suffit pas) n'est apparue qu'en installant réellement les modules sur un Odoo 14 — voir § Vérification.

## Vérification

Les correctifs successifs sur ce module ont d'abord été validés par lecture de code, `py_compile` et des tests isolés sur objets factices (pas de runtime Odoo disponible dans l'environnement d'audit initial). Une installation Odoo 14 réelle (Python 3.10, PostgreSQL 16, les 4 dépôts OCA ci-dessus, hors Docker faute de démon disponible) a ensuite permis une vérification bout en bout : installation propre des 5 modules, puis appels HTTP réels sur `/api/mobile/*` (login, login_badge, pointage arrivée/départ, planning, chantiers du jour, logout) contre une vraie base Postgres. Deux bugs invisibles à l'analyse statique en sont ressortis et ont été corrigés :

- `fsm.location` n'a pas de champ `customer_id` (seulement `owner_id`) — provoquait un crash 500 sur tout pointage avec un chantier assigné, et un `customer` toujours vide côté planning.
- `_manage_timesheet()` cherchait la ligne de timesheet à clôturer par `date = fields.Date.today()`, alors que `project_timesheet_time_control` réécrit silencieusement `date` à partir de `date_time` — un pointage traversant minuit (équipe de nuit) ou rejoué plus tard via la file hors-ligne du frontend ne retrouvait jamais sa ligne ouverte.

Cette installation de test n'est pas conservée dans le repo (faite dans un environnement jetable) ; à refaire pour toute modification future touchant à l'interaction avec les modules OCA.

### Règles d'accès (`ir.rule`) et portée de l'API mobile

**Ce qu'une `ir.rule` ne peut pas faire ici.** Il est tentant de vouloir remplacer les filtres écrits à la main dans les contrôleurs (`("user_id", "=", user.id)`, contrôle de propriété des `fsm.order`) par des règles d'accès. Ce n'est pas possible, et essayer reproduit la régression `res.users` décrite plus bas :

- `ir_rule._eval_context()` ne fournit que `user`, `time`, `company_id(s)`, et son commentaire est explicite : *« use an empty context for 'user' to make the domain evaluation independent from the context »*. Une règle **ne peut pas savoir** que la requête arrive par l'API mobile.
- Le salarié mobile est le même `res.users` que dans le backoffice. Restreindre un modèle partagé par une règle le restreint donc **partout**, backoffice compris.
- Les règles se combinent en `AND(globales, OU(groupes))` (`ir_rule._compute_domain`). Une règle attachée à un groupe « mobile » supplémentaire serait soit OU-ée avec celle de `base.group_user` — donc diluée —, soit, si elle est seule, restrictive partout. Aucune combinaison ne donne une portée par canal.

**Conclusion appliquée** : la portée de l'API mobile est assurée par ses contrôleurs, et les `ir.rule` ne servent qu'à exprimer ce qui est vrai sur *tous* les canaux. Sur `ocleaneo.mobile.pointage`, c'est le cas : un salarié ne voit que ses propres pointages, quel que soit le canal.

**Ce qui a été corrigé.** L'ACL « manager » du modèle était lettre morte. La règle « ses propres pointages » était attachée à `base.group_user` et était la **seule** règle du modèle — elle s'appliquait donc aussi aux gestionnaires, membres de `base.group_user` comme tout le monde. L'ACL leur accordait tout, la règle leur reprenait tout. Mesuré sur Odoo 14 : un utilisateur Settings comme un responsable Présences voyaient **0 pointage sur 2**, alors que le modèle sert précisément à contrôler la paie. Une règle permissive (`[(1,'=',1)]`) attachée à `hr_attendance.group_hr_attendance_manager` et `base.group_system` rétablit leur visibilité par le OU, sans rien changer pour le salarié.

**La règle est désormais porteuse, plus décorative.** Les lectures côté salarié (`/api/mobile/pointage/mine`, la recherche d'idempotence `client_ref`) ne passent plus par `sudo()` : elles s'exécutent avec les droits du salarié, si bien que la règle constitue une seconde ligne réelle. Le filtre `user_id` reste la protection principale — la règle ne peut pas le remplacer — mais elle rattrape le jour où quelqu'un l'oublie. Le `sudo()` est conservé sur le chemin d'écriture, et documenté : la requête ouvre aussi une `hr.attendance` et une ligne de timesheet, droits qu'un agent d'entretien n'a pas.

Le tout est verrouillé par `ocleaneo_mobile_pointage/tests/test_record_rules.py`, confronté aux deux régressions : sans la règle gestionnaire, 2 échecs ; sans la règle « ses propres pointages », 4.

### Audit de sécurité — deux régressions `res.users` corrigées

Un second passage sur la même installation réelle a mis au jour deux problèmes créés par les fichiers de sécurité livrés au commit initial. Tous deux datent de l'époque où le token mobile vivait sur `res.users` ; le token a depuis été déplacé sur `hr.employee`, mais les deux enregistrements de sécurité sont restés.

- **Escalade de privilèges.** L'ACL `access_res_users_mobile_api` donnait le droit d'**écriture** sur `res.users` à `base.group_user`. Le garde-fou `SELF_WRITEABLE_FIELDS` de `res.users.write()` ne *bloque* pas les champs sensibles — il décide seulement si une écriture sur soi-même peut passer en `sudo`. Ce qui empêche normalement un salarié d'ajouter `groups_id` est l'ACL, qu'Odoo standard ne donne pas. Vérifié sur instance réelle : n'importe quel utilisateur interne pouvait s'ajouter à `base.group_system`.
- **Backoffice cassé pour tout le monde.** La règle `ir_rule_mobile_api_self_user` (`[('id','=',user.id)]`) s'appliquait à `base.group_user` sur **toute l'instance**, pas seulement à l'API mobile. Un utilisateur interne ne pouvait plus lire aucun autre utilisateur — or les listes d'assignation, les abonnés, les mentions et les activités passent toutes par `res.users`. Mesuré : 1 utilisateur visible avec la règle, 7 sans.

Aucun des deux n'était nécessaire : tous les contrôleurs mobiles passent par `sudo()`. Les deux ont été supprimés, et `tests/test_security.py` échoue si l'un ou l'autre revient.

**Point d'exploitation important** : supprimer le fichier XML ne suffit pas sur une instance déjà installée. La règle était déclarée dans `<data noupdate="1">`, et le nettoyage des données orphelines d'Odoo ignore délibérément les enregistrements `noupdate`. Vérifié : après `-u ocleaneo_mobile_api`, l'ACL obsolète avait disparu mais la règle était toujours là et toujours active. D'où `migrations/14.0.1.0.10/post-migration.py`, qui la supprime explicitement — testé sur le vrai chemin de production (installation en 14.0.1.0.9 puis upgrade).

### Idempotence des pointages (`client_ref`)

L'app génère un `client_ref` par pointage physique et le renvoie inchangé à chaque nouvelle tentative (rejeu de la file hors-ligne, réponse perdue après traitement côté serveur). La recherche faite en tête de `POST /api/mobile/pointage` couvre le cas séquentiel, mais c'est un *check-then-act* : deux tentatives simultanées ne trouvent rien toutes les deux et créent chacune un pointage — l'arrivée du salarié est enregistrée deux fois, et ses heures comptées deux fois.

L'arbitrage est donc confié à la base, via un index unique `(user_id, client_ref)`. Postgres autorisant autant de `NULL` qu'on veut dans un index unique, les pointages sans clé (saisie backoffice, imports) ne sont pas concernés.

Le perdant de la course **ne peut pas** simplement relire la ligne gagnante : les curseurs Odoo tournent en `REPEATABLE READ` (`sql_db.Cursor`, `serialized=True` par défaut), donc le snapshot de la transaction précède le commit concurrent et une relecture après `ROLLBACK TO SAVEPOINT` ne trouve toujours rien — vérifié sur PostgreSQL 16. Le pattern « catch + re-read », qui paraît évident, est silencieusement faux ici.

Ce qui marche est le mécanisme de reprise d'Odoo lui-même : `service/model.check` rejoue la requête entière sur une erreur de sérialisation, et `http.py:checked_call` fait un `rollback()` du curseur avant chaque tentative (« the request cursor is unusable… to create a new one »). Le rejeu repart donc sur un snapshot neuf, où le court-circuit `client_ref` retrouve la ligne gagnante et renvoie la réponse d'origine. L'insert perdant est donc relevé en erreur de sérialisation pour rendre la main à cette machinerie (voir `_create_pointage`).

**Point d'exploitation** : sur une instance portant déjà des doublons, l'`ALTER TABLE` échoue — et Odoo **laisse l'upgrade se terminer** (`post_constraint` rétrograde l'échec en `info` puis `finalize_constraints` en `warning`, « this is not a deployment showstopper »). Mesuré : sortie 0, contrainte absente, protection inactive, rien au-dessus de `debug` pour le signaler. D'où `migrations/14.0.1.0.8/pre-migration.py`, qui journalise en `ERROR` les groupes fautifs avec leurs ids. Il ne supprime rien : ces lignes alimentent la paie, choisir laquelle des deux est parasite n'est pas une décision de script. Cycle vérifié de bout en bout (doublons → contrainte absente → nettoyage → re-run → contrainte posée).

Un troisième point, plus discret, a été corrigé au passage : la date « aujourd'hui » utilisée par défaut quand l'app n'envoie pas de `?date=` venait de `fields.Date.today()`, c'est-à-dire du fuseau du **serveur** (UTC en déploiement normal), alors que la fenêtre de journée est ensuite découpée dans le fuseau du **salarié**. Entre minuit local et le décalage UTC (00h–01h à Paris, 00h–02h l'été), les deux calendriers divergent et la fenêtre tombait sur la veille : un salarié pointant son arrivée à 00h30 ne voyait pas son propre pointage dans `/pointage/mine`. C'est exactement la fenêtre horaire des équipes qui démarrent avant l'aube. Remplacé par `today_local()` (équivalent de `fields.Date.context_today` d'Odoo), verrouillé par `TestTodayLocal`.

## Notes

- Les modules OCA (Field Service, etc. — voir § Dépendances OCA) ne sont pas versionnés ici : ils doivent être montés via volume dans `docker-compose.yml` (`/opt/oca_addons_v14`).
- Les mots de passe et tokens de dev ne doivent jamais être commités.
