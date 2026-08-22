# Ocleaneo Mobile App

Application mobile (PWA) Ocleaneo pour la gestion terrain : planning, pointage, commande de produits d'entretien, inventaire de chantier, historique et administration.

## Stack

- **Frontend** : Vue 3 + Vite, Vue Router, Pinia, Axios, PWA installable (`vite-plugin-pwa`)
- **Backend : Odoo 14 + modules OCA** (instance existante, à connecter — voir [Intégration Odoo](#intégration-odoo) ci-dessous)
- **Déploiement frontend** : Docker + Nginx

> ⚠️ Le backend Node.js/Express + SQLite qui existait dans une version précédente de ce projet a été retiré : le backend réel est une instance Odoo 14. Le frontend décrit ci-dessous appelait cette ancienne API (`/api/...`) et doit être rebranché sur Odoo — voir la section Intégration Odoo.

## Structure

```
ocleaneo_mobile_app/
├── frontend/                  # Application Vue 3 + Vite (PWA)
│   ├── src/
│   │   ├── views/
│   │   │   ├── planning/       # Planning jour/semaine
│   │   │   ├── pointage/       # Badge virtuel arrivée/départ
│   │   │   ├── commande/       # Choix chantier → catalogue → panier → récap
│   │   │   ├── inventaire/    # Saisie du stock restant
│   │   │   ├── historique/    # Historique des commandes
│   │   │   └── admin/         # Gestion salariés / chantiers / produits / planning
│   │   ├── components/        # BottomNav, ProductCard, QuantityStepper, AppHeader
│   │   ├── stores/             # Pinia : auth, chantiers, panier
│   │   ├── router/             # Vue Router + garde d'authentification
│   │   └── services/api.js     # Client Axios — À REBRANCHER sur Odoo
│   └── Dockerfile / nginx.conf
├── docs/
│   └── mockup-pointage-planning.html   # Mockup de référence (17 écrans, vision produit complète)
└── docker-compose.yml          # Sert uniquement le frontend (VITE_API_URL → Odoo)
```

## Intégration Odoo

Le backend est une **instance Odoo 14 existante**, avec des modules **OCA**. Décisions encore ouvertes avant de rebrancher le frontend :

1. **URL et accès de l'instance** — à fournir (endpoint, identifiants/API key de service).
2. **Protocole d'API** entre l'app Vue et Odoo :
   - **OCA `base_rest`** (repo `rest-framework`) : expose des endpoints REST/JSON propres, plus simple à consommer depuis Axios que le JSON-RPC natif. Recommandé pour une app mobile/SPA.
   - **JSON-RPC natif** (`/web/dataset/call_kw`) : zéro dépendance supplémentaire côté Odoo mais payloads plus rigides, moins adapté à un client REST classique.
   - **Authentification** : à coupler avec un module OCA comme `auth_api_key` (repo `server-auth`) ou `auth_jwt` si on veut garder un flux proche de l'actuel (code salarié → token Bearer).
3. **Mapping métier** — le domaine (chantiers, salariés, planning, pointage, stock par site) correspond de près à la suite **OCA Field Service Management** (repo `field-service`) :
   - `fsm.location` ↔ chantier
   - `fsm.person` / `hr.employee` ↔ salarié
   - `fsm.order` ↔ intervention/vacation
   - `fsm.route` ↔ tournée/planning
   - `fieldservice_stock` ↔ stock produits par site (commande/inventaire)
   - `hr.attendance` ↔ pointage (arrivée/départ)
   - `hr.holidays` ↔ congés
   - À confirmer si l'instance existante utilise déjà ces modules ou une autre organisation.

Une fois ces points tranchés, `frontend/src/services/api.js` et les stores Pinia seront réécrits pour appeler Odoo directement (ou via une fine couche `base_rest`), et les vues n'auront normalement pas besoin de changer en profondeur (elles consomment déjà des listes chantiers/produits/shifts/entries via l'API).

## Fonctionnalités (vues déjà scaffoldées, backend à rebrancher)

- **Planning** : vue Jour (vacations du jour par chantier) et Semaine
- **Pointage** : badge virtuel arrivée/départ, géolocalisation optionnelle, historique du jour
- **Commande par chantier** : catalogue par catégorie → panier avec quantités → validation → récapitulatif + PDF
- **Inventaire** : saisie du stock restant par produit/conditionnement
- **Historique** : commandes passées par le salarié connecté
- **Administration** : salariés, chantiers, produits, planning (création de vacations)
- **PWA** : installable sur écran d'accueil mobile (manifest + service worker)

## Mockup de référence

`docs/mockup-pointage-planning.html` présente la vision produit complète (17 écrans) : au-delà de planning/pointage déjà scaffoldés, elle couvre congés, dossier salarié RH, sécurité travailleur isolé (PTI/SOS), auto-contrôle qualité, déclaration d'anomalies, messagerie interne, formation, dashboard KPI. Priorisation à définir avec le mapping modules Odoo/OCA ci-dessus.

## Installation frontend (en local, sans backend fonctionnel pour l'instant)

```bash
cd frontend
cp .env.example .env    # VITE_API_URL doit pointer vers l'API Odoo une fois décidée
npm install
npm run dev              # démarre sur http://localhost:5173
```

## Relation avec le bot Telegram

Ce projet est un **repository séparé** du bot Telegram [`ocleaneo`](https://github.com/babatoko/ocleaneo). Le bot a sa propre base SQLite ; l'app mobile visera désormais Odoo comme source de vérité.
