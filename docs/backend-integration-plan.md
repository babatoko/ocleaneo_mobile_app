# Plan d'intégration du backend Odoo 14 dans le repo GitHub

> Point de friction n°1 : le repo GitHub `babatoko/ocleaneo_mobile_app` ne contient que le frontend. Il faut y intégrer le backend Odoo 14 développé localement.

## Objectif

Transformer `ocleaneo_mobile_app` en un **repo monorepo** contenant :
- `frontend/` — l'app Vue 3/Ionic/Capacitor existante (déjà dans le repo)
- `odoo/` — les modules Odoo 14 custom et la configuration Docker de dev
- docs/runbooks d'intégration front/back

À la fin, un nouveau développeur pourra faire `docker compose up` et obtenir :
1. le backend Odoo 14 avec les modules Ocleaneo installés
2. le frontend Vite en mode mock ou branché sur le backend local

---

## Phases

### Phase 0 — Fondations du monorepo (1/2 journée)

#### 0.1 Créer la structure `odoo/`

```
ocleaneo_mobile_app/
├── frontend/                  # existant
├── odoo/
│   ├── addons/                # modules custom Ocleaneo
│   │   ├── ocleaneo_mobile_api/
│   │   ├── ocleaneo_mobile_pointage/
│   │   ├── ocleaneo_mobile_api_planning/
│   │   ├── ocleaneo_mobile_api_chantiers/      # nouveau
│   │   ├── ocleaneo_mobile_api_stock/            # nouveau (phase 2)
│   │   └── ocleaneo_mobile_api_commandes/        # nouveau (phase 2)
│   ├── dev/
│   │   ├── docker-compose.yml
│   │   ├── Dockerfile
│   │   ├── odoo-dev.conf
│   │   └── .env.example
│   └── README.md
├── docs/
│   └── backend-integration.md
├── .github/
│   └── workflows/
│       └── ci.yml             # à étendre
├── docker-compose.yml         # existant (PWA) → ajouter le backend
└── README.md                  # existant → mettre à jour
```

#### 0.2 Migrer les modules existants

Depuis `/home/martial/odoo_migration/addons_v14/custom_addons_v14/` vers `odoo/addons/` :
- `ocleaneo_mobile_api`
- `ocleaneo_mobile_pointage`
- `ocleaneo_mobile_api_planning`

#### 0.3 Migrer la configuration de dev Docker

Depuis `/home/martial/odoo_dev/` vers `odoo/dev/` :
- `docker-compose.yml`
- `odoo14-dev.conf`

Adapter les volumes pour pointer vers `../addons/` (monorepo) et vers le Barman restore existant sur la machine de Martial.

#### 0.4 Mettre à jour le `.gitignore` racine

Ajouter :
```gitignore
# Odoo
odoo/dev/filestore/
odoo/dev/odoo14-dev-restore/
odoo/dev/*.log
odoo/dev/.env
odoo/addons/**/__pycache__/
odoo/addons/**/*.pyc
```

---

### Phase 1 — Aligner le contrat API DataProvider (1 semaine)

Le frontend GitHub s'attend à un contrat REST `DataProvider`. Notre backend expose actuellement un JSON-RPC Odoo custom (`/api/mobile/*`).

#### 1.1 Créer un module pont `ocleaneo_mobile_api_contract`

Ce module centralise la normalisation des réponses au format attendu par le frontend.

Responsabilités :
- Serializer `fsm.order` → `Shift`
- Serializer `fsm.location` → `Chantier`
- Serializer `ocleaneo.mobile.pointage` → `TimeEntry`
- Normaliser les types de pointage : `arrivee`→`in`, `depart`→`out`, `pause_debut`→`pause_start`, `pause_fin`→`pause_end`
- Exposer les endpoints REST via `base_rest` **ou** controllers Odoo HTTP classiques

#### 1.2 Décision technique : base_rest vs controllers Odoo

| Option | Avantage | Inconvénient |
|--------|----------|--------------|
| **A. Controllers Odoo HTTP/JSON (`type='json'`)** | Déjà en place, rapide à étendre, pas de dépendance OCA supplémentaire | Réponses enveloppées JSON-RPC par défaut ; il faut gérer CORS et format manuel |
| **B. OCA `base_rest`** | REST propre, contrôle des chemins, documentation automatique, aligné avec le README GitHub | Nouvelle dépendance à installer/migrer ; learning curve |

**Recommandation** : Option A à court terme pour brancher vite, Option B comme cible à moyen terme. Le `RestProvider.ts` du frontend peut être adapté si nécessaire.

#### 1.3 Endpoints backend à implémenter

| Frontend DataProvider | Méthode HTTP | Endpoint backend | Source Odoo |
|-----------------------|--------------|------------------|-------------|
| `login(username, password)` | POST | `/api/mobile/auth/login` | `res.users` + `mobile.api.token` |
| `fetchMe()` | GET | `/api/mobile/me` | `hr.employee` |
| `fetchChantiers()` | GET | `/api/mobile/chantiers/mine` | `fsm.location` du worker |
| `fetchShifts({from,to})` | GET | `/api/mobile/shifts/mine` | `fsm.order` assignés au worker sur la période |
| `fetchTodayTimeEntries()` | GET | `/api/mobile/time-entries/today` | `ocleaneo.mobile.pointage` du jour |
| `fetchTimeEntries({from,to})` | GET | `/api/mobile/time-entries/mine` | `ocleaneo.mobile.pointage` sur la période |
| `createTimeEntry(payload)` | POST | `/api/mobile/time-entries` | crée pointage + attendance + timesheet |
| `fetchProducts()` | GET | `/api/mobile/products` | `product.product` + packaging |
| `fetchInventoryLatest(id)` | GET | `/api/mobile/inventory/chantier/:id/latest` | stock chantier |
| `submitInventory(payload)` | POST | `/api/mobile/inventory` | enregistre inventaire |
| `createOrder(payload)` | POST | `/api/mobile/orders` | crée commande |
| `fetchOrder(id)` | GET | `/api/mobile/orders/:id` | détail commande |
| `fetchMyOrders()` | GET | `/api/mobile/orders/mine` | commandes du salarié |
| `getOrderPdfUrl(id)` | GET | `/api/mobile/orders/:id/pdf` | génération PDF |

#### 1.4 Créer le provider Odoo côté frontend

Ajouter `frontend/src/providers/OdooProvider.ts` qui étend `DataProvider` et appelle les endpoints ci-dessus.

Ajouter dans `frontend/src/providers/index.ts` :
```ts
const factories: Record<string, () => DataProvider> = {
  rest: () => new RestProvider(),     // base_rest (cible future)
  mock: () => new MockProvider(),
  odoo: () => new OdooProvider(),     // backend Odoo 14 custom actuel
};
```

---

### Phase 2 — Développer les modules Odoo manquants (1-2 semaines)

#### 2.1 `ocleaneo_mobile_api_chantiers`

- Modèle `mobile.api.chantier.config` (config multi-société)
- Endpoint `/api/mobile/chantiers/mine`
- Ajouter `nfc_tag_id` sur `fsm.location`
- Exposer latitude/longitude depuis `res.partner` (`partner_latitude`/`partner_longitude`)

#### 2.2 `ocleaneo_mobile_api_pointage` (extension)

- Endpoint `/api/mobile/time-entries/today`
- Endpoint `/api/mobile/time-entries/mine?from&to`
- Endpoint `/api/mobile/time-entries` (create)
- Mapping types `in/out/pause_start/pause_end`
- Conserver la logique existante : attendance + timesheet + fermeture FSM

#### 2.3 `ocleaneo_mobile_api_planning` (extension)

- Endpoint `/api/mobile/shifts/mine?from&to`
- Sérialiser les `fsm.order` en `Shift[]`
- Fermeture FSM order au départ (déjà implémentée via `/api/mobile/pointage`)

#### 2.4 `ocleaneo_mobile_api_stock` (nouveau)

- Modèles : `mobile.stock.product`, `mobile.stock.packaging`, `mobile.stock.inventory`
- Endpoints `/api/mobile/products`, `/api/mobile/inventory/*`

#### 2.5 `ocleaneo_mobile_api_commandes` (nouveau)

- Modèle `mobile.sale.order` ou réutilisation `sale.order`
- Endpoints `/api/mobile/orders/*`
- Génération PDF commande

---

### Phase 3 — Branchement et tests bout-en-bout (1 semaine)

#### 3.1 Configuration dev

Dans `odoo/dev/.env` :
```env
ODOO_DB_NAME=odoo14_dev
ODOO_HTTP_PORT=8074
PG_PORT=5438
ADDONS_PATH=/opt/oca_addons_v14,/odoo/addons
```

#### 3.2 Lancer le backend

```bash
cd odoo/dev
docker compose up -d
```

#### 3.3 Lancer le frontend branché sur le backend

```bash
cd frontend
cp .env.example .env
# VITE_DATA_PROVIDER=odoo
# VITE_API_URL=http://127.0.0.1:8074/api/mobile
npm run dev
```

#### 3.4 Scénarios de test

1. Login avec `r.velasco@entretien-maconnais.fr`
2. Affichage planning jour/semaine
3. Lecture badge NFC → pointage arrivée
4. Pause manuelle
5. Départ → fermeture FSM order
6. Historique pointage
7. Compteur heures hebdo
8. Commande produits (phase 2)

---

### Phase 4 — Documentation et CI/CD (1/2 semaine)

#### 4.1 Documentation

- `odoo/README.md` : structure, installation, modules
- `docs/backend-integration.md` : mapping DataProvider ↔ endpoints Odoo
- Mettre à jour `README.md` racine avec la nouvelle architecture

#### 4.2 CI/CD

Étendre `.github/workflows/ci.yml` pour :
- Linter Python des modules Odoo
- Build Docker backend
- Build frontend avec `VITE_DATA_PROVIDER=mock` (test sans backend)
- Tests backend (optionnel, plus tard)

---

## Décisions à trancher

1. **Repo cible** : on pousse tout dans `babatoko/ocleaneo_mobile_app` ? On renomme le dossier local ?
2. **base_rest** : on reste sur les controllers Odoo existants ou on migre vers OCA `base_rest` ?
3. **Docker dev** : on intègre PostgreSQL + Odoo dans le `docker-compose.yml` racine ou on garde un compose séparé dans `odoo/dev/` ?
4. **Données de test** : on garde le restore Barman ou on crée un jeu de fixtures plus léger ?

---

## Prochaine action immédiate

Je te propose de commencer par :
1. Copier les modules Odoo existants dans `odoo/addons/`
2. Créer le provider `OdooProvider.ts` côté frontend
3. Implémenter `/api/mobile/chantiers/mine` et `/api/mobile/shifts/mine`
4. Tester le planning avec l'utilisateur Ronny VELASCO

Tu valides ce plan ? Je peux lancer la Phase 0 immédiatement.
