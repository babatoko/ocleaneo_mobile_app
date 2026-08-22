# Ocleaneo Mobile App

Application mobile **Android et iOS** (via Capacitor) Ocleaneo pour le terrain : planning, pointage, commande de produits d'entretien, inventaire de chantier, historique. Le même code Vue est aussi packagé en PWA pour un accès web.

> Pas d'écran de gestion (salariés, chantiers, produits, planning) dans cette app : c'est un outil de terrain pour les salariés, pas un back-office. Toute la gestion se fait dans **Odoo**.

## Stack

- **Frontend** : Vue 3 + Vite, Vue Router, Pinia, Axios
- **Apps natives** : [Capacitor](https://capacitorjs.com) 8 — enveloppe le build web dans un shell natif Android (`frontend/android/`) et iOS (`frontend/ios/`), donne accès aux API natives (caméra, géolocalisation, NFC, notifications push) nécessaires aux écrans du mockup (pointage NFC, photos d'anomalie, PTI/SOS)
- **PWA** : `vite-plugin-pwa` en plus, pour un accès web installable indépendant des stores
- **Backend : Odoo 14 + modules OCA** (instance existante, à connecter — voir [Intégration Odoo](#intégration-odoo) ci-dessous)
- **Déploiement web** : Docker + Nginx (pour la variante PWA/navigateur)

> ⚠️ Le backend Node.js/Express + SQLite qui existait dans une version précédente de ce projet a été retiré : le backend réel est une instance Odoo 14. Le frontend décrit ci-dessous appelait cette ancienne API (`/api/...`) et doit être rebranché sur Odoo — voir la section Intégration Odoo.

## Structure

```
ocleaneo_mobile_app/
├── frontend/                  # Application Vue 3 + Vite (PWA)
│   ├── src/
│   │   ├── views/
│   │   │   ├── planning/       # Planning jour/semaine
│   │   │   ├── pointage/       # Badge virtuel arrivée/départ
│   │   │   ├── commande/       # Écran Stock (site + catalogue + panier) → récap
│   │   │   ├── inventaire/    # Saisie du stock restant
│   │   │   └── historique/    # Historique des commandes
│   │   ├── components/        # BottomNav, QuantityStepper, AppHeader
│   │   ├── stores/             # Pinia : auth, chantiers, panier
│   │   ├── router/             # Vue Router + garde d'authentification
│   │   ├── services/api.js     # Client Axios — À REBRANCHER sur Odoo
│   │   └── services/biometric.js  # Empreinte via @capgo/capacitor-native-biometric
│   └── Dockerfile / nginx.conf
│   ├── android/                # Projet natif Android (généré par `cap add android`)
│   ├── ios/                    # Projet natif iOS (généré par `cap add ios`)
│   └── capacitor.config.json   # appId com.ocleaneo.mobile, webDir dist
├── docs/
│   └── mockup-pointage-planning.html   # Mockup de référence (17 écrans, vision produit complète)
└── docker-compose.yml          # Sert la variante web/PWA (VITE_API_URL → Odoo)
```

## Apps natives (Capacitor)

```bash
cd frontend
npm install

# build web + synchronise vers android/ et ios/
npm run cap:sync

# ouvre le projet natif dans l'IDE correspondant
npm run cap:android   # nécessite Android Studio + Android SDK
npm run cap:ios        # nécessite macOS + Xcode (impossible à générer/builder depuis cet environnement Linux)
```

`android/` a été scaffoldé et peut être ouvert avec Android Studio. `ios/` a été scaffoldé (fichiers de projet Xcode) mais n'a **jamais été buildé** — CocoaPods et Xcode ne sont disponibles que sur macOS, donc `pod install` et l'ouverture dans Xcode devront se faire sur une machine Mac.

Après chaque changement du code Vue, relancer `npm run cap:sync` pour propager le nouveau build web vers les deux plateformes natives.

## Authentification

Identifiant + mot de passe, stockés sur la fiche employé (côté Odoo). L'empreinte n'est proposée que si l'appareil dispose d'un lecteur :

1. Premier login : formulaire identifiant/mot de passe (`POST /api/auth/login { username, password }`).
2. Si l'appareil a un capteur biométrique disponible (`NativeBiometric.isAvailable()`, via `@capgo/capacitor-native-biometric`), les identifiants sont enregistrés dans le stockage sécurisé natif (Keychain iOS / Keystore Android, `accessControl: BIOMETRY_ANY`) juste après une connexion réussie.
3. Aux connexions suivantes sur cet appareil, l'écran affiche directement le cercle d'empreinte (`getSecureCredentials`, qui déclenche le prompt biométrique du système) au lieu du formulaire ; un lien « Utiliser le mot de passe » reste disponible en repli.
4. Sur le web (PWA, pas de plateforme native), `isAvailable()` retourne `false` et l'app retombe simplement sur le formulaire — aucun crash, aucune dépendance à un lecteur.

`frontend/src/services/biometric.js` encapsule tous les appels au plugin ; `LoginView.vue` ne fait que consommer `isBiometricAvailable()` / `hasSavedCredentials()` / `getSavedCredentials()` / `saveCredentials()`.

## Pointage — sélection du chantier par badge NFC

Le chantier n'est **pas choisi manuellement** : il est déterminé par la lecture du badge NFC posé sur site, via [`@exxili/capacitor-nfc`](https://github.com/Exxili/capacitor-nfc). La logique de correspondance badge → chantier → type de pointage (arrivée/départ) vit dans **`frontend/src/stores/pointage.js`** (`clockWithTag(uid)`), pas dans l'écran, pour pouvoir être déclenchée depuis n'importe où dans l'app (voir ci-dessous).

1. L'UID lu est comparé au champ `nfc_tag_id` de chaque chantier (`chantiers.list`, renvoyé par `/api/chantiers/mine`). Un badge non reconnu affiche une erreur claire plutôt que d'échouer silencieusement.
2. Le type de pointage est déduit du dernier pointage du jour **pour ce chantier précis** (un salarié peut visiter plusieurs sites dans la journée, chacun avec son propre badge).
3. L'écran Pointage vérifie `isNfcSupported()` au chargement ; si l'appareil n'a pas de lecteur (web, ou matériel sans puce NFC), le cercle affiche « NFC non disponible sur cet appareil » et reste désactivé — pas de sélecteur de repli.

### Flux : ouvrir l'app → s'authentifier → lire le badge, dans n'importe quel ordre

L'app ne demande pas d'ouvrir l'écran Pointage avant de scanner : **un badge lu n'importe quand déclenche le pointage**, où que soit le salarié dans l'app, y compris si l'app vient d'être relancée par ce même tap.

- `pointage.initGlobalListener(router)` est enregistré une seule fois, dès `main.js` (avant même le montage de l'app), et écoute `NFC.onRead` pour toute la durée de vie du processus.
- Badge lu **et** salarié déjà authentifié → `clockWithTag()` s'exécute immédiatement et l'app navigue vers `/pointage` pour montrer le résultat, quel que soit l'écran affiché au moment du tap.
- Badge lu **et** salarié non authentifié (app tout juste relancée par le tap) → l'UID est gardé en attente (`pendingTagUid`) et l'app ouvre l'écran de connexion ; une fois authentifié, `LoginView.afterLogin()` traite ce badge en attente automatiquement — pas besoin de re-scanner.

**Android** : `AndroidManifest.xml` déclare un `<intent-filter>` `TECH_DISCOVERED` (+ `res/xml/nfc_tech_filter.xml` couvrant les technologies NFC courantes) sur l'activité principale, donc **approcher le badge relance l'app si elle est fermée**, sans action préalable. Le plugin active de plus un `enableForegroundDispatch` permanent tant que l'app est au premier plan : toute lecture y est automatique, `NFC.startScan()` n'est jamais appelé côté Android (il échoue systématiquement par conception du plugin — « Android NFC scanning does not require 'startScan' »).

**iOS** : Apple exige un geste explicite de l'utilisateur pour ouvrir une session de lecture NFC — impossible de relancer l'app silencieusement par un simple tap de badge brut (UID). Le bouton de l'écran Pointage appelle `startIosNfcSession()` (`frontend/src/services/nfc.js`) pour ouvrir cette session ; le tag lu remonte ensuite par le même écouteur global `onRead`. Un vrai lancement d'app par tap sur iOS demanderait de reformater les badges en NDEF avec un enregistrement d'URI pointant vers un Universal Link (domaine associé + `apple-app-site-association` hébergé), ce qui n'est pas en place ici.

**Limite connue** : sur Android, l'événement de lecture au lancement à froid peut théoriquement arriver avant que le JS de l'app n'ait fini de s'initialiser et de s'abonner (le plugin ne fournit pas d'API de récupération a posteriori de l'intent de lancement) — le listener est enregistré le plus tôt possible dans `main.js` pour minimiser cette fenêtre, mais ce n'est pas une garantie à 100 % sur tous les appareils.

**Côté Odoo** : chaque chantier (`fsm.location` / partenaire associé) doit exposer un `nfc_tag_id` (UID du badge programmé sur site) dans la réponse de `/api/chantiers/mine` — à ajouter comme champ personnalisé si la suite Field Service ne l'a pas nativement. L'association badge ↔ chantier (programmation des tags NFC) se fait dans Odoo, pas dans cette app.

**Permissions natives** : `android.permission.NFC` + `<uses-feature android:required="false">` ajoutés à `AndroidManifest.xml` (l'app reste installable sur un appareil sans NFC). Côté iOS : `NFCReaderUsageDescription` dans `Info.plist`, et un fichier `App.entitlements` avec `com.apple.developer.nfc.readersession.formats` — ce dernier nécessite en plus d'activer la capacité « Near Field Communication Tag Reading » dans Xcode (Signing & Capabilities) sur un compte développeur Apple payant, étape qui ne peut se faire que sur un Mac.

### Notification « chantier en cours »

Dès qu'un pointage d'arrivée réussit, `frontend/src/services/notifications.js` affiche une notification locale ([`@capacitor/local-notifications`](https://capacitorjs.com/docs/apis/local-notifications)) tant que le salarié est présent :

- **Titre** : nom du chantier (« Cegetel Macon — en cours »).
- **Corps** : heure d'arrivée réelle + départ estimé (même calcul retard/avance que l'écran Pointage, via `pointage.estimatedDepartureFor()`).
- **Corps étendu** (`largeBody`, vue développée Android) : ajoute la prochaine vacation du jour si le salarié en a une (`pointage.nextShiftAfter()`), en plus petit dans la maquette — le rendu réel dépend du template de notification du système.
- **`ongoing: true`** (Android) : la notification ne peut pas être balayée tant que le salarié est pointé présent, pour rappeler l'état en cours.
- Elle est annulée (`clearClockedInNotification()`) dès le pointage de départ.

La permission est demandée au premier pointage (`ensurePermission()`), pas au démarrage de l'app. Le canal Android (`pointage`, importance par défaut) est créé une fois au boot (`main.js`).

**Limite honnête** : la notification native ne reproduit pas exactement la maquette (carte à deux colonnes, badge « En cours », ligne « Prochain » en transparence) — c'est le système (iOS/Android) qui gère la mise en page réelle d'une notification, avec un gabarit beaucoup plus limité (titre/corps/corps étendu). Non testable dans ce bac à sable (pas de matériel Android/iOS) : à valider sur device.

## Planning — vue Tournée (itinéraire optimisé OSRM)

Le Planning a trois onglets : Jour, Semaine, et **Tournée**. La Tournée calcule l'ordre de passage optimal sur les chantiers du jour et l'itinéraire associé via [OSRM](http://project-osrm.org/) (Open Source Routing Machine), affiché sur une carte [Leaflet](https://leafletjs.com/) / tuiles OpenStreetMap :

1. Récupère les vacations du jour (`/shifts/mine`) et croise chaque `chantier_id` avec `chantiers.list` pour obtenir ses coordonnées GPS (`latitude`/`longitude` — voir ci-dessous).
2. Récupère la position actuelle (`navigator.geolocation`) comme point de départ si l'utilisateur l'autorise ; sinon le départ est le premier chantier.
3. Appelle le service `/trip` d'OSRM (résolution du voyageur de commerce) : `frontend/src/services/osrm.js`, fonction `getOptimizedTrip()`.
4. Affiche la carte (marqueurs numérotés + tracé), la distance/durée totale, et la liste des arrêts avec horaires estimés (arrivée/départ cumulés à partir des temps de trajet OSRM et de la durée de chaque vacation).

**Coordonnées GPS des chantiers** : champ obligatoire pour que la Tournée fonctionne, géré côté **Odoo**, pas dans cette app — `latitude`/`longitude` sont simplement consommées telles que renvoyées par `/api/chantiers`. Elles correspondent à `partner_latitude`/`partner_longitude` sur `res.partner` (géolocalisation native d'Odoo, ou module OCA `base_geolocalize`).

**⚠️ Serveur OSRM** : `frontend/src/services/osrm.js` pointe par défaut vers le serveur de démo public `router.project-osrm.org`. Ce serveur est explicitement documenté par le projet OSRM comme **non destiné à la production** (pas de garantie de disponibilité, débit limité). Pour la prod, définir `VITE_OSRM_URL` vers une instance OSRM auto-hébergée (le binaire OSRM est open source, se déploie facilement en Docker avec un extrait OpenStreetMap de la région). Idem pour les tuiles de carte (`tile.openstreetmap.org`), à remplacer par un fournisseur de tuiles adapté à un usage production (la [politique d'usage OSM](https://operations.osmfoundation.org/policies/tiles/) interdit aussi l'usage intensif du serveur de tuiles public).

## Intégration Odoo

Le backend est une **instance Odoo 14 existante**, avec des modules **OCA**. Décisions encore ouvertes avant de rebrancher le frontend :

1. **URL et accès de l'instance** — à fournir (endpoint, identifiants/API key de service).
2. **Protocole d'API** entre l'app Vue et Odoo :
   - **OCA `base_rest`** (repo `rest-framework`) : expose des endpoints REST/JSON propres, plus simple à consommer depuis Axios que le JSON-RPC natif. Recommandé pour une app mobile/SPA.
   - **JSON-RPC natif** (`/web/dataset/call_kw`) : zéro dépendance supplémentaire côté Odoo mais payloads plus rigides, moins adapté à un client REST classique.
   - **Authentification** : Odoo doit vérifier identifiant + mot de passe (stockés sur la fiche employé) et renvoyer un token Bearer — via un module OCA comme `auth_api_key` (repo `server-auth`) ou `auth_jwt`. La biométrie (voir [Authentification](#authentification) ci-dessus) est gérée uniquement côté app, Odoo ne voit jamais que du login/mot de passe classique.
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

- **Connexion** : identifiant/mot de passe avec bascule automatique vers l'empreinte si l'appareil en a un (voir [Authentification](#authentification))
- **Planning** : vue Jour, Semaine, et Tournée (itinéraire optimisé OSRM + carte, voir section dédiée ci-dessous)
- **Pointage** : chantier identifié par lecture de badge NFC (voir section dédiée ci-dessous), géolocalisation optionnelle, historique du jour tous chantiers confondus
- **Stock** : sélecteur de site, statut par produit (rupture/faible/suffisant), stepper de quantité, commande groupée → récapitulatif + PDF
- **Inventaire** : saisie du stock restant par produit/conditionnement
- **Historique** : commandes passées par le salarié connecté
- **PWA** : installable sur écran d'accueil mobile (manifest + service worker)

Aucun écran de gestion (création/édition de salariés, chantiers, produits, planning) : c'est le rôle d'Odoo. Cette app ne fait que consommer ces données pour le salarié sur le terrain.

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
