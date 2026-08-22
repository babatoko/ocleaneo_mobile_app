# Ocleaneo Mobile App

Application mobile (PWA) Ocleaneo pour la commande de produits d'entretien, l'inventaire de chantier, l'historique des commandes et l'administration — pensée comme l'équivalent web/mobile du [bot Telegram Ocleaneo](https://github.com/babatoko/ocleaneo), avec le même métier (chantiers, salariés, catalogue produits, commandes, inventaire).

## Stack

- **Frontend** : Vue 3 + Vite, Vue Router, Pinia, Axios, PWA installable (`vite-plugin-pwa`)
- **Backend** : Node.js + Express, SQLite (`better-sqlite3`), authentification par JWT, génération de PDF (`pdfkit`)
- **Déploiement** : Docker + docker-compose (backend Node + frontend servi par Nginx)

## Structure

```
ocleaneo_mobile_app/
├── frontend/                  # Application Vue 3 + Vite (PWA)
│   ├── src/
│   │   ├── views/
│   │   │   ├── commande/      # Choix chantier → catalogue → panier → récap
│   │   │   ├── inventaire/    # Saisie du stock restant
│   │   │   ├── historique/    # Historique des commandes
│   │   │   └── admin/         # Gestion salariés / chantiers / produits
│   │   ├── components/        # BottomNav, ProductCard, QuantityStepper, AppHeader
│   │   ├── stores/             # Pinia : auth, chantiers, panier
│   │   ├── router/             # Vue Router + garde d'authentification
│   │   └── services/api.js     # Client Axios (JWT en header)
│   └── Dockerfile / nginx.conf
├── backend/                    # API REST Express
│   ├── src/
│   │   ├── routes/             # auth, chantiers, products, orders, inventory, employees
│   │   ├── controllers/
│   │   ├── middleware/         # requireAuth, requireAdmin
│   │   ├── services/           # pdf.service.js, jwt.service.js
│   │   └── db/                 # schema.sql + init/seed SQLite
│   ├── data/products.json      # Catalogue produits (identique au bot)
│   └── Dockerfile
└── docker-compose.yml
```

## Modèle de données

Repris à l'identique du bot Telegram : `employees`, `chantiers`, `employee_chantiers`, `products`, `product_packagings`, `orders`, `order_items`, `inventories`, `inventory_items`.

## Authentification

Chaque salarié se connecte avec un **code personnel** (`login_code`), généré côté admin (menu Admin → Salariés). Le premier lancement crée un compte administrateur par défaut avec le code `ADMIN`. Un JWT est ensuite stocké côté client et envoyé en `Authorization: Bearer <token>`.

## Installation

### 1. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev        # démarre sur http://localhost:3000
```

Au premier démarrage, la base SQLite est créée automatiquement (`data/ocleaneo.db`), le catalogue `data/products.json` est importé, et un compte admin (`ADMIN`) est créé.

### 2. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev         # démarre sur http://localhost:5173
```

### 3. Avec Docker

```bash
docker-compose up -d --build
```

- Frontend : http://localhost:8080
- Backend : http://localhost:3000

## Fonctionnalités

- **Connexion par code salarié** (JWT)
- **Commande par chantier** : sélection du chantier → catalogue par catégorie → panier avec quantités → validation → récapitulatif + PDF téléchargeable
- **Inventaire** : saisie du stock restant par produit/conditionnement, chantier par chantier
- **Historique** : liste des commandes passées par le salarié connecté
- **Administration** : gestion des salariés (codes, droits admin), des chantiers (création, désactivation, affectation), des produits (catalogue, conditionnements), et suivi de consommation par chantier
- **PWA** : installable sur écran d'accueil mobile (manifest + service worker via `vite-plugin-pwa`)

## Relation avec le bot Telegram

Ce projet est un **repository séparé** du bot Telegram [`ocleaneo`](https://github.com/babatoko/ocleaneo). Les deux partagent le même modèle métier (chantiers, produits, commandes, inventaire) mais ont chacun leur propre base de données pour l'instant. Une synchronisation ou un backend commun pourra être envisagée plus tard si besoin.

## À faire ensuite

- Ajouter les icônes PWA (`frontend/public/`) et les référencer dans le manifest (`vite.config.js`)
- Écran de suivi de consommation par chantier côté admin (l'API `GET /api/orders/consumption/:chantierId` existe déjà)
- Rappel mensuel (notification web push) équivalent au rappel Telegram du 15 du mois
- Tests automatisés (backend : Vitest/Jest ; frontend : Vitest + Vue Test Utils)
