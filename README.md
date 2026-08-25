# Ocleaneo Mobile App

Application mobile **Android et iOS** (via Capacitor) Ocleaneo pour le terrain : planning, pointage, commande de produits d'entretien, inventaire de chantier, historique. Le même code Vue est aussi packagé en PWA pour un accès web.

> Pas d'écran de gestion (salariés, chantiers, produits, planning) dans cette app : c'est un outil de terrain pour les salariés, pas un back-office. Toute la gestion se fait dans **Odoo**.

## Stack

- **Frontend** : Vue 3 + Vite, **TypeScript** (`strict: true`), Vue Router, Pinia, Axios
- **Apps natives** : [Capacitor](https://capacitorjs.com) 8 — enveloppe le build web dans un shell natif Android (`frontend/android/`) et iOS (`frontend/ios/`), donne accès aux API natives (caméra, géolocalisation, NFC, notifications push) nécessaires aux écrans du mockup (pointage NFC, photos d'anomalie, PTI/SOS)
- **PWA** : `vite-plugin-pwa` en plus, pour un accès web installable indépendant des stores
- **Backend : Odoo 14 + modules OCA**, exposé via **`base_rest`** (instance existante, à connecter — voir [Intégration Odoo](#intégration-odoo) ci-dessous)
- **Déploiement web** : Docker + Nginx (pour la variante PWA/navigateur)

> ⚠️ Le backend Node.js/Express + SQLite qui existait dans une version précédente de ce projet a été retiré : le backend réel est une instance Odoo 14. Voir la section Intégration Odoo, et surtout la section suivante — le frontend ne parle plus jamais directement à une API, il passe par un plugin de données.

## Architecture backend-agnostique (plugins de données)

Aucun store ni aucune vue n'appelle un client HTTP ou ne connaît la forme d'une réponse Odoo. Tout passe par **`frontend/src/providers/`**, une couche d'abstraction en forme de plugins :

- **`DataProvider.ts`** — le contrat : une classe abstraite listant toutes les opérations dont l'app a besoin (`login`, `fetchChantiers`, `fetchShifts`, `createTimeEntry`, `fetchProducts`, `createOrder`…), chaque méthode typée sur les interfaces de `types/models.ts` (forme exacte attendue en entrée/sortie, vérifiée à la compilation). Une méthode non implémentée par un provider concret échoue explicitement plutôt que silencieusement.
- **`RestProvider.ts`** — le plugin branché par défaut : traduit le contrat en appels HTTP JSON vers une URL de serveur (pensé pour une couche `base_rest` Odoo, voir § Intégration Odoo). C'est le seul fichier de l'app qui connaît des chemins d'URL, des query params ou la forme d'une erreur HTTP. Cette URL a une valeur par défaut (`VITE_API_URL`, fixée au build) mais reste **modifiable à l'exécution depuis le profil de l'utilisateur** (`ProfileView.vue` § Serveur) — utile pour changer d'instance sans reconstruire l'app ; le réglage est persisté (`@capacitor/preferences`) et rechargé au démarrage via `provider.init()` (voir `providers/index.ts`), avant tout appel réseau. Changer cette URL déconnecte l'utilisateur (un jeton de session n'est valable que sur le serveur qui l'a émis).
- **`MockProvider.ts`** — un second plugin réel, 100 % en mémoire, **zéro réseau**. Sert à développer ou faire une démo de l'app sans rien avoir à faire tourner, et sert aussi de preuve que le contrat est complet : l'app entière (connexion, planning, pointage, stock, commande, historique) tourne dessus de bout en bout — vérifié en la faisant tourner sans aucun mock d'API, juste `VITE_DATA_PROVIDER=mock`.
- **`index.ts`** — sélectionne le plugin actif selon `VITE_DATA_PROVIDER` (`rest` par défaut, `mock` sinon) et exporte l'instance unique `provider` que tout le reste de l'app importe.

**Ce que ça change concrètement pour brancher un backend différent** (une autre couche Odoo, un JSON-RPC direct, un tout autre ERP) : écrire un nouveau fichier `providers/XyzProvider.ts` qui étend `DataProvider` et implémente ses méthodes, l'ajouter à `providers/index.ts`, basculer `VITE_DATA_PROVIDER`. Aucune vue, aucun store, aucune logique métier (calcul d'heures, géofence, file hors ligne…) n'a besoin d'être touchée — ils ne connaissent que le contrat. Le compilateur TypeScript refuse de construire si un provider concret oublie un champ du contrat ou renvoie la mauvaise forme : c'est la frontière où le typage rapporte le plus, exactement celle qu'un provider mal aligné cassait en silence avant la conversion.

**Erreurs normalisées** : chaque provider doit lever `ProviderNetworkError` (exportée par `DataProvider.ts`, `instanceof ProviderNetworkError`) pour une coupure réseau — c'est ce que vérifient la file d'attente hors ligne du pointage et le cache du planning pour décider de mettre en attente plutôt que d'afficher un écran vide. Toute autre erreur métier normalisée est une `ProviderError` avec un `.message` déjà lisible et un `.status` optionnel (pas de `error.response.data.error` à décoder dans les vues).

**Limite assumée** : la persistance de session (`token` + `localStorage`, dans `stores/auth.ts`) reste un concept générique partagé par tous les providers — un jeton opaque à renvoyer par `login()` et à présenter ensuite. Un futur provider basé sur des cookies de session devrait quand même renvoyer un jeton logique pour ce mécanisme, ou `stores/auth.ts` devra évoluer en conséquence ; ce n'est pas poussé plus loin ici pour ne pas sur-abstraire un besoin hypothétique.

## Structure

```
ocleaneo_mobile_app/
├── frontend/                  # Application Vue 3 + Vite (PWA)
│   ├── src/
│   │   ├── views/
│   │   │   ├── planning/       # Planning Jour/Semaine/Mois/Tournée + détail chantier
│   │   │   ├── pointage/       # Badge NFC arrivée/départ/pause + historique
│   │   │   ├── commande/       # Écran Stock (site + catalogue + panier) → récap
│   │   │   ├── inventaire/    # Saisie du stock restant
│   │   │   └── historique/    # Historique des commandes
│   │   │   └── ProfileView.vue # Profil : notifications, biométrie, serveur, déconnexion
│   │   ├── components/        # BottomNav, QuantityStepper, AppHeader, DataState
│   │   ├── stores/             # Pinia : auth, chantiers, planning, pointage, panier
│   │   ├── providers/          # Couche données backend-agnostique — voir ci-dessus
│   │   ├── services/           # NFC, biométrie, notifications, hors ligne, navigation…
│   │   ├── router/             # Vue Router + garde d'authentification
│   │   ├── types/models.ts     # Interfaces du domaine (Shift, Chantier, TimeEntry, Product, Order…)
│   │   └── utils/              # Dates locales, semaine/mois, icônes produit
│   ├── tsconfig*.json          # TypeScript strict — voir § Qualité
│   ├── eslint.config.js        # Lint (préréglage vue/essential : vrais défauts, pas de mise en forme)
│   └── Dockerfile / nginx.conf
│   ├── android/                # Projet natif Android (généré par `cap add android`)
│   ├── ios/                    # Projet natif iOS (généré par `cap add ios`)
│   └── capacitor.config.json   # appId com.ocleaneo.mobile, webDir dist
├── .github/workflows/ci.yml    # lint + tests + build (dont un build en provider mock)
├── docs/
│   ├── mockup-pointage-planning.html   # Mockup de référence (24 écrans, vision produit complète)
│   └── retour-artefact.html            # Page publique (QR sur porte-clé/porte-carte) : procédure de retour
└── docker-compose.yml          # Sert la variante web/PWA (VITE_API_URL → Odoo)
```

## Qualité

```bash
cd frontend
npm run lint       # ESLint (préréglage vue/essential + règles TypeScript)
npm run typecheck  # vue-tsc -b — tout le projet est en TypeScript strict
npm run test       # Vitest — logique de calcul et contrat des providers
npm run check      # lint + typecheck + test + build, ce que lance la CI
```

**TypeScript** : tout le frontend (`.vue` en `<script setup lang="ts">`, tous les modules `.ts`) est typé en mode `strict`. Le domaine métier vit dans `types/models.ts` (`Shift`, `Chantier`, `TimeEntry`, `Product`, `Order`…) et c'est cette même forme que `DataProvider` impose à tout provider concret — voir § Architecture backend-agnostique pour ce que ça change à la frontière la plus fragile de l'app. `npm run build` fait tourner `vue-tsc -b` avant `vite build` : un provider ou une vue qui dévie du contrat casse le build, pas seulement l'écran en production.

Les tests ciblent la logique où une erreur coûte cher plutôt que la couverture pour elle-même :

- **`computeWorkedHours`** — le total d'heures de la semaine et l'alerte de dépassement. Couvre les pauses, une pause close par un départ (reprise oubliée), une session encore ouverte, les entrées désordonnées.
- **`utils/date`** — les dates seules doivent rester dans le fuseau du salarié. `toISOString().slice(0,10)` datait en UTC : en France, tout ce qui se passe entre minuit et 2h était rattaché à la veille, or les équipes démarrent avant l'aube.
- **`providers/errors`** — verrouille le contrat d'erreur (`.message` lisible, `.status`, `instanceof ProviderNetworkError`, jamais la forme axios `.response`). Une vue qui lisait encore `e.response.data.error` affichait « Identifiants incorrects » pour *toute* panne, y compris une coupure réseau ; ce test rend la régression impossible.
- **`services/geofence`** — distances et tolérance de l'anti-fraude au pointage.

### États d'écran

`components/DataState.vue` porte les quatre états d'un écran alimenté par des données distantes : chargement (squelettes), erreur (message + **Réessayer**), vide, contenu. Il existe pour qu'aucun écran ne puisse plus afficher « aucune vacation » alors que le chargement a échoué — un planning vide et un planning non chargé ne veulent pas dire la même chose pour un salarié.

### Thème sombre et accessibilité

Le thème est entièrement piloté par les tokens CSS de `style.css` : `prefers-color-scheme: dark` n'y redéfinit que les variables, aucun composant ne déclare de couleur en dur. Deux tokens méritent une mention — `--on-solid` et `--on-accent`, la couleur du texte posé sur un aplat plein : sans eux, un `#fff` codé en dur devient illisible en sombre, où ces fonds s'éclaircissent.

Côté accessibilité : `:focus-visible` global, cartes et lignes cliquables en vrais `<button>` (focusables et annoncés), libellés sur les commandes à icône seule, cibles tactiles de 44 px, et `prefers-reduced-motion` respecté. `viewport-fit=cover` étant actif, les en-têtes compensent `env(safe-area-inset-top)` et la zone de contenu `env(safe-area-inset-bottom)`, faute de quoi l'interface passe sous l'encoche et sous la barre gestuelle.

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

`frontend/src/services/biometric.ts` encapsule tous les appels au plugin ; `LoginView.vue` ne fait que consommer `isBiometricAvailable()` / `hasSavedCredentials()` / `getSavedCredentials()` / `saveCredentials()`.

## Pointage — sélection du chantier par badge NFC

Le chantier n'est **pas choisi manuellement** : il est déterminé par la lecture du badge NFC posé sur site, via [`@exxili/capacitor-nfc`](https://github.com/Exxili/capacitor-nfc). La logique de correspondance badge → chantier → type de pointage (arrivée/départ) vit dans **`frontend/src/stores/pointage.ts`** (`clockWithTag(uid)`), pas dans l'écran, pour pouvoir être déclenchée depuis n'importe où dans l'app (voir ci-dessous).

1. L'UID lu est comparé au champ `nfc_tag_id` de chaque chantier (`chantiers.list`, renvoyé par `/api/chantiers/mine`). Un badge non reconnu affiche une erreur claire plutôt que d'échouer silencieusement.
2. Le type de pointage est déduit du dernier pointage du jour **pour ce chantier précis** (un salarié peut visiter plusieurs sites dans la journée, chacun avec son propre badge).
3. L'écran Pointage vérifie `isNfcSupported()` au chargement ; si l'appareil n'a pas de lecteur (web, ou matériel sans puce NFC), le cercle affiche « NFC non disponible sur cet appareil » et reste désactivé — pas de sélecteur de repli.

### Flux : ouvrir l'app → s'authentifier → lire le badge, dans n'importe quel ordre

L'app ne demande pas d'ouvrir l'écran Pointage avant de scanner : **un badge lu n'importe quand déclenche le pointage**, où que soit le salarié dans l'app, y compris si l'app vient d'être relancée par ce même tap.

- `pointage.initGlobalListener(router)` est enregistré une seule fois, dès `main.ts` (avant même le montage de l'app), et écoute `NFC.onRead` pour toute la durée de vie du processus.
- Badge lu **et** salarié déjà authentifié → `clockWithTag()` s'exécute immédiatement et l'app navigue vers `/pointage` pour montrer le résultat, quel que soit l'écran affiché au moment du tap.
- Badge lu **et** salarié non authentifié (app tout juste relancée par le tap) → l'UID est gardé en attente (`pendingTagUid`) et l'app ouvre l'écran de connexion ; une fois authentifié, `LoginView.afterLogin()` traite ce badge en attente automatiquement — pas besoin de re-scanner.

**Android** : `AndroidManifest.xml` déclare un `<intent-filter>` `TECH_DISCOVERED` (+ `res/xml/nfc_tech_filter.xml` couvrant les technologies NFC courantes) sur l'activité principale, donc **approcher le badge relance l'app si elle est fermée**, sans action préalable. Le plugin active de plus un `enableForegroundDispatch` permanent tant que l'app est au premier plan : toute lecture y est automatique, `NFC.startScan()` n'est jamais appelé côté Android (il échoue systématiquement par conception du plugin — « Android NFC scanning does not require 'startScan' »).

**iOS** : Apple exige un geste explicite de l'utilisateur pour ouvrir une session de lecture NFC — impossible de relancer l'app silencieusement par un simple tap de badge brut (UID). Le bouton de l'écran Pointage appelle `startIosNfcSession()` (`frontend/src/services/nfc.ts`) pour ouvrir cette session ; le tag lu remonte ensuite par le même écouteur global `onRead`. Un vrai lancement d'app par tap sur iOS demanderait de reformater les badges en NDEF avec un enregistrement d'URI pointant vers un Universal Link (domaine associé + `apple-app-site-association` hébergé), ce qui n'est pas en place ici.

**Limite connue** : sur Android, l'événement de lecture au lancement à froid peut théoriquement arriver avant que le JS de l'app n'ait fini de s'initialiser et de s'abonner (le plugin ne fournit pas d'API de récupération a posteriori de l'intent de lancement) — le listener est enregistré le plus tôt possible dans `main.ts` pour minimiser cette fenêtre, mais ce n'est pas une garantie à 100 % sur tous les appareils.

**Côté Odoo** : chaque chantier (`fsm.location` / partenaire associé) doit exposer un `nfc_tag_id` (UID du badge programmé sur site) dans la réponse de `/api/chantiers/mine` — à ajouter comme champ personnalisé si la suite Field Service ne l'a pas nativement. L'association badge ↔ chantier (programmation des tags NFC) se fait dans Odoo, pas dans cette app.

**Permissions natives** : `android.permission.NFC` + `<uses-feature android:required="false">` ajoutés à `AndroidManifest.xml` (l'app reste installable sur un appareil sans NFC). Côté iOS : `NFCReaderUsageDescription` dans `Info.plist`, et un fichier `App.entitlements` avec `com.apple.developer.nfc.readersession.formats` — ce dernier nécessite en plus d'activer la capacité « Near Field Communication Tag Reading » dans Xcode (Signing & Capabilities) sur un compte développeur Apple payant, étape qui ne peut se faire que sur un Mac.

### Notification « chantier en cours »

Dès qu'un pointage d'arrivée réussit, `frontend/src/services/notifications.ts` affiche une notification locale ([`@capacitor/local-notifications`](https://capacitorjs.com/docs/apis/local-notifications)) tant que le salarié est présent :

- **Titre** : nom du chantier (« Cegetel Macon — en cours »).
- **Corps** : heure d'arrivée réelle + départ estimé (même calcul retard/avance que l'écran Pointage, via `pointage.estimatedDepartureFor()`).
- **Corps étendu** (`largeBody`, vue développée Android) : ajoute la prochaine vacation du jour si le salarié en a une (`pointage.nextShiftAfter()`), en plus petit dans la maquette — le rendu réel dépend du template de notification du système.
- **`ongoing: true`** (Android) : la notification ne peut pas être balayée tant que le salarié est pointé présent, pour rappeler l'état en cours.
- Elle est annulée (`clearClockedInNotification()`) dès le pointage de départ.

La permission est demandée au premier pointage (`ensurePermission()`), pas au démarrage de l'app. Le canal Android (`pointage`, importance par défaut) est créé une fois au boot (`main.ts`).

**Limite honnête** : la notification native ne reproduit pas exactement la maquette (carte à deux colonnes, badge « En cours », ligne « Prochain » en transparence) — c'est le système (iOS/Android) qui gère la mise en page réelle d'une notification, avec un gabarit beaucoup plus limité (titre/corps/corps étendu). Non testable dans ce bac à sable (pas de matériel Android/iOS) : à valider sur device.

### Fiabilité, confiance et suivi — vers un pointage « best in class »

Six axes ajoutés au-dessus du pointage NFC de base, tous dans `stores/pointage.ts` sauf mention contraire :

**Mode hors ligne** (`services/offlineQueue.ts`) — si `POST /time-entries` échoue par coupure réseau (pas une erreur métier — `!error.response`), le pointage est mis en file d'attente locale persistante (`@capacitor/preferences`) au lieu d'être perdu, avec une mise à jour optimiste immédiate de l'écran (marquée « en attente de synchronisation »). La file est rejouée dans l'ordre dès que `@capacitor/network` signale un retour de connexion ou que `@capacitor/app` signale un retour au premier plan (`watchConnectivity()`), en s'arrêtant à la première entrée qui échoue encore pour ne pas désynchroniser l'alternance arrivée/départ. `stores/chantiers.ts` met aussi en cache la liste des chantiers (même mécanisme) pour que le badge reste reconnaissable même hors ligne. *Limite* : sans avoir jamais eu de réseau au moins une fois dans la session (chantiers jamais mis en cache), un badge ne peut pas être matché — couvre le cas réel (perte de réseau sur site après une ouverture d'app le matin), pas un premier lancement hors ligne.

**Anti-fraude par géofence** (`services/geofence.ts`) — la position captée au scan est comparée aux `latitude`/`longitude` du chantier (distance de Haversine, tolérance `GEOFENCE_TOLERANCE_M = 150` m pour absorber l'imprécision GPS en intérieur). Un dépassement ne bloque **jamais** le pointage (un salarié ne doit pas être pénalisé par une dérive GPS) — il est seulement signalé (`outOfRange: true` envoyé au serveur, message à l'écran) pour permettre une revue a posteriori côté Odoo.

**Retour haptique + animation** (`services/haptics.ts`) — `Haptics.notification()` sur succès/échec de scan (guard `Capacitor.isNativePlatform()`, aucun effet web). Un check ✓ animé remplace brièvement l'icône NFC sur le cercle après un pointage réussi.

**Historique complet des pointages** — `/api/time-entries/mine?from&to` (nouveau contrat, à côté de `/time-entries/today`) alimente `views/pointage/PointageHistoryView.vue` (`/pointage/historique`), qui liste les 14 derniers jours groupés par date. L'écran Pointage n'affichait jusque-là que le jour même.

**Compteur d'heures hebdomadaire + alerte de dépassement** — `loadWeekSummary()` charge les vacations et pointages de la semaine calendaire en cours ; `weekWorkedHours` associe chronologiquement arrivées/départs (en déduisant les pauses) pour un total qui **avance en direct** tant qu'une session reste ouverte, pas seulement une fois le départ badgé. Comparé à `weekPlannedHours` (somme des vacations planifiées), un badge « Dépassement » et une barre de progression ambrée apparaissent si `weekOvertimeHours > 0`.

**Pauses** — le badge NFC ne peut pas à lui seul distinguer « je pars » de « je fais une pause » (c'est le même geste physique) : la pause est donc une action manuelle (bouton « Pause » / « Reprendre » sur l'écran Pointage), postant des entrées `pause_start` / `pause_end` sur le même endpoint `/time-entries`. Le statut du jour (`in` / `paused` / `out`) est dérivé du type du dernier pointage plutôt que d'un champ serveur séparé.

**Rappel d'oubli de départ** — `scheduleDepartureReminder()` programme une notification locale 20 min après le départ estimé, annulée au pointage de départ (`cancelDepartureReminder()`). En complément, l'écran affiche un bandeau si la vacation est dépassée de plus de 20 min et que le salarié est toujours pointé présent (filet de sécurité si la notification système est retardée ou manquée).

**Contrat Odoo à prévoir** pour tout ce qui précède : `POST /time-entries` doit accepter `recordedAt` (horodatage réel du scan, capturé côté client — important pour l'exactitude d'un pointage mis en file d'attente et synchronisé plus tard) et `outOfRange` (booléen, méta-donnée de revue) ; `type` doit accepter `pause_start`/`pause_end` en plus de `in`/`out` ; un nouvel endpoint `GET /time-entries/mine?from&to` doit renvoyer la liste des pointages sur une période.

**Non testable dans ce bac à sable** : file hors ligne, géofence, haptique et rappel programmé nécessitent du matériel réel (pas de GPS/vibreur/notifications système dans Chromium headless) — vérifiés par relecture de code et par la partie testable en navigateur (rendu des écrans, calculs d'heures, historique, bascule pause). À valider sur device.

## Planning — vues Jour / Semaine / Mois / Tournée

Le Planning a quatre onglets : Jour, Semaine, **Mois**, et **Tournée**. La Tournée calcule l'ordre de passage optimal sur les chantiers du jour et l'itinéraire associé via [OSRM](http://project-osrm.org/) (Open Source Routing Machine), affiché sur une carte [Leaflet](https://leafletjs.com/) / tuiles OpenStreetMap :

1. Récupère les vacations du jour (`/shifts/mine`) et croise chaque `chantier_id` avec `chantiers.list` pour obtenir ses coordonnées GPS (`latitude`/`longitude` — voir ci-dessous).
2. Récupère la position actuelle (`navigator.geolocation`) comme point de départ si l'utilisateur l'autorise ; sinon le départ est le premier chantier.
3. Appelle le service `/trip` d'OSRM (résolution du voyageur de commerce) : `frontend/src/services/osrm.ts`, fonction `getOptimizedTrip()`.
4. Affiche la carte (marqueurs numérotés + tracé), la distance/durée totale, et la liste des arrêts avec horaires estimés (arrivée/départ cumulés à partir des temps de trajet OSRM et de la durée de chaque vacation).

**Coordonnées GPS des chantiers** : champ obligatoire pour que la Tournée fonctionne, géré côté **Odoo**, pas dans cette app — `latitude`/`longitude` sont simplement consommées telles que renvoyées par `/api/chantiers`. Elles correspondent à `partner_latitude`/`partner_longitude` sur `res.partner` (géolocalisation native d'Odoo, ou module OCA `base_geolocalize`).

**⚠️ Serveur OSRM** : `frontend/src/services/osrm.ts` pointe par défaut vers le serveur de démo public `router.project-osrm.org`. Ce serveur est explicitement documenté par le projet OSRM comme **non destiné à la production** (pas de garantie de disponibilité, débit limité). Pour la prod, définir `VITE_OSRM_URL` vers une instance OSRM auto-hébergée (le binaire OSRM est open source, se déploie facilement en Docker avec un extrait OpenStreetMap de la région). Idem pour les tuiles de carte (`tile.openstreetmap.org`), à remplacer par un fournisseur de tuiles adapté à un usage production (la [politique d'usage OSM](https://operations.osmfoundation.org/policies/tiles/) interdit aussi l'usage intensif du serveur de tuiles public).

**Tournée — démarrer la navigation** : un bouton au-dessus de la liste des arrêts ouvre le guidage turn-by-turn natif (`services/navigation.ts`, `turnByTurnHref()`) vers le premier arrêt — Apple Plans sur iOS (`maps.apple.com`), Google Maps sinon (`google.com/maps/dir`). Ce sont des liens `https://` standards (Universal/App Links), pas un schéma personnalisé : ils ouvrent l'app native si installée, sinon fonctionnent quand même dans le navigateur. Même mécanisme derrière chaque lien « Itinéraire » (vues Jour et Semaine), avec repli sur une simple recherche par adresse si les coordonnées du chantier sont inconnues.

### Vue Mois

Grille calendaire classique (semaines lundi→dimanche, jours hors mois grisés), un point sous chaque jour ayant au moins une vacation. Un tap sur un jour bascule vers la vue Jour correspondante — même comportement que le clic sur un jour en vue Semaine. Navigation mois précédent/suivant, chargement via `planning.loadMonth()` (`GET /shifts/mine?from=<1er du mois>&to=<dernier jour>`).

### Fiabilité et proactivité — vers un planning « best in class »

Quatre axes ajoutés au-dessus des vues de base :

**Hors ligne** — `stores/planning.ts` met en cache chaque réponse `/shifts/mine` (`@capacitor/preferences`), clé par plage de dates exacte (`from`/`to`). Une coupure réseau retombe sur la dernière réponse connue pour cette même plage plutôt que sur un écran vide — même logique que le cache chantiers du pointage.

**Rappel avant une vacation** (`services/planningSync.ts`, `syncShifts()`) — appelée après chaque chargement de vacations (jour/semaine/mois), elle programme une notification locale 30 min avant le début de toute vacation dans les 48 h à venir (`scheduleShiftReminder()`, id dérivé de `shift.id` pour se remplacer sans doublon plutôt que de s'accumuler).

**Notification de changement de planning** — la même fonction compare chaque vacation proche (< 48 h) à sa dernière version connue (empreinte `start_at|end_at|status|note`) ; un écart déclenche une notification « Planning mis à jour ». *Portée volontairement limitée* : seules les vacations **proches** sont comparées — au-delà, une vacation absente d'un appel donné peut simplement être hors de la plage demandée (jour ≠ semaine ≠ mois), pas annulée ; détecter fiablement une nouvelle vacation ou une annulation sur l'ensemble du planning demanderait soit un flux de changement fourni par le serveur, soit une notification **push** envoyée par Odoo (FCM/APNs) — aucun des deux n'est en place ici. Ce qui existe est donc une détection **au moment où l'app est ouverte**, pas une vraie notification push en tâche de fond.

**Export vers le calendrier natif** (`services/calendarExport.ts`) — génère un fichier `.ics` standard (une vacation, ou toute la semaine d'un coup via le bouton dédié en vue Semaine) et ouvre la feuille de partage native (`@capacitor/share`) pour que le salarié l'ajoute à son agenda personnel. Écrit délibérément **pas** dans le calendrier du téléphone directement (`@capacitor/filesystem` + `Directory.Cache` seulement) — une écriture directe demanderait la permission « accès complet au calendrier », intrusive pour ce que ça apporte ici ; le `.ics` standard fait le même travail sans cette permission.

**Non testable dans ce bac à sable** : cache hors ligne, rappels programmés et notifications de changement nécessitent du matériel réel (pas de notifications système ni de vraie coupure réseau dans Chromium headless) — vérifiés par relecture de code et par tout ce qui est testable en navigateur (build propre, les 4 vues, export calendrier — son repli web affiche une erreur claire au lieu d'échouer silencieusement). À valider sur device.

**Dates seules** : toutes les conversions passent par `utils/date.ts` (`toLocalIso`, `todayIso`, `addDaysIso`), qui construit la chaîne à partir des composantes locales. L'ancienne forme `Date.toISOString().slice(0, 10)` datait en UTC et décalait d'un jour entre minuit et 2h du matin en Europe/Paris — un vrai problème pour des équipes qui démarrent avant l'aube. Ne pas la réintroduire : le comportement est verrouillé par `utils/__tests__/date.test.ts`.

## Intégration Odoo

Le backend est une **instance Odoo 14 existante**, avec des modules **OCA**. Décisions encore ouvertes avant de rebrancher le frontend :

1. **URL et accès de l'instance** — instance confirmée : `https://www.entretien-maconnais.fr/`. Reste à fournir des identifiants/API key de service, et à savoir si le module `base_rest` (point 2 ci-dessous) y est déjà installé.
2. **Protocole d'API** entre l'app Vue et Odoo : **tranché, ce sera OCA `base_rest`** (repo `rest-framework`). Il expose des endpoints REST/JSON propres (verbes HTTP, chemins d'URL clairs, forme de réponse contrôlée côté service plutôt que les champs bruts du modèle Odoo) — c'est ce que `RestProvider.ts` sait déjà consommer nativement avec Axios, alors que le JSON-RPC natif (`/web/dataset/call_kw`) aurait demandé un provider dédié pour construire ses enveloppes `call_kw` et déballer les dictionnaires internes d'Odoo. Reste à installer le module côté instance et à définir les services/chemins pour chaque endpoint du contrat `DataProvider`.
   - **Authentification** : Odoo doit vérifier identifiant + mot de passe (stockés sur la fiche employé) et renvoyer un token Bearer — via un module OCA comme `auth_api_key` (repo `server-auth`) ou `auth_jwt`. La biométrie (voir [Authentification](#authentification) ci-dessus) est gérée uniquement côté app, Odoo ne voit jamais que du login/mot de passe classique.
3. **Mapping métier** — **confirmé : l'instance utilise la suite OCA Field Service Management** (repo `field-service`) :
   - `fsm.location` ↔ chantier
   - `fsm.person` / `hr.employee` ↔ salarié
   - `fsm.order` ↔ intervention/vacation
   - `fsm.route` ↔ tournée/planning
   - `fieldservice_stock` ↔ stock produits par site (commande/inventaire)
   - `hr.attendance` ↔ pointage (arrivée/départ)
   - `hr.holidays` ↔ congés

### Contrat API attendu (services `base_rest` à exposer côté Odoo)

`frontend/src/providers/RestProvider.ts` appelle déjà ces chemins précis — c'est la spec à implémenter côté Odoo (services `base_rest`, un par ligne) pour que **rien ne change côté frontend**, juste `VITE_API_URL` à pointer vers l'instance :

| Méthode `DataProvider` | Endpoint `base_rest` | Modèle(s) Odoo source |
|---|---|---|
| `login` | `POST /auth/login` → `{ token, employee }` | `hr.employee` + `auth_api_key`/`auth_jwt` |
| `fetchMe` | `GET /auth/me` → employé courant | `hr.employee` |
| `fetchChantiers` | `GET /chantiers/mine` → `[{ id, name, address, nfc_tag_id, latitude, longitude }]` | `fsm.location` |
| `fetchShifts` | `GET /shifts/mine?from&to` → `[{ id, chantier_id, chantier_name, chantier_address, start_at, end_at, note }]` | `fsm.order` (+ `fsm.route` pour l'ordre de la tournée) |
| `fetchTodayTimeEntries` | `GET /time-entries/today` → `{ entries, status }` | `hr.attendance` |
| `fetchTimeEntries` | `GET /time-entries/mine?from&to` → `[{ id, type, recorded_at, chantier_name }]` | `hr.attendance` |
| `createTimeEntry` | `POST /time-entries` | `hr.attendance` (create) |
| `fetchProducts` | `GET /products` → `[{ id, name, packagings: [{ id, label, is_default }] }]` | `product.product` / `fieldservice_stock` |
| `fetchInventoryLatest` | `GET /inventory/chantier/:id/latest` → `{ items }` ou **404** si aucun inventaire | `fieldservice_stock` |
| `submitInventory` | `POST /inventory` | `fieldservice_stock` |
| `createOrder` | `POST /orders` → `{ id }` | à confirmer (commande de produits d'entretien — `fsm.order` dédié ou modèle propre) |
| `fetchOrder` | `GET /orders/:id` | idem |
| `fetchMyOrders` | `GET /orders/mine` | idem |
| PDF commande | `GET /orders/:id/pdf` (binaire) | rapport Odoo standard |

Le type de pointage (`in`/`out`/`pause_start`/`pause_end`) et le statut (`entries`/`status`) sont une couche au-dessus de `hr.attendance`, qui ne connaît nativement que in/out — la distinction pause vs départ définitif doit être portée par un champ ou une catégorie sur l'écriture `hr.attendance` (ou un modèle satellite), à trancher côté implémentation Odoo.

Une fois l'URL/les identifiants de l'instance connus (point 1 ci-dessus) et ces services `base_rest` implémentés avec cette forme exacte, il suffit de renseigner `VITE_API_URL` — aucun changement de code frontend n'est nécessaire. Si un chemin ou une forme de réponse doit différer, seul **`frontend/src/providers/RestProvider.ts`** (voir § Architecture backend-agnostique ci-dessus) a besoin d'être ajusté ; les stores et les vues ne connaissent que le contrat `DataProvider`.

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

`docs/mockup-pointage-planning.html` présente la vision produit complète (24 écrans) : au-delà de planning/pointage déjà scaffoldés, elle couvre congés, dossier salarié RH, sécurité travailleur isolé (PTI/SOS), auto-contrôle qualité, déclaration d'anomalies, messagerie interne, formation, dashboard KPI, et **gestion des artefacts** (porte-clés, badges/codes portail-porte, empreintes) — traçabilité de qui détient quoi (Mes artefacts, détail avec historique de détention, registre par site pour un responsable), déclaration de perte et de retrouvaille par l'agent. Priorisation à définir avec le mapping modules Odoo/OCA ci-dessus.

« Porte-clés » est le nom donné à l'objet physique remis à l'agent (par opposition à « clé » comme concept abstrait) — pas une unité de gestion à part qui regrouperait plusieurs sites. La gestion reste **par site** : chaque chantier a son propre porte-clés, avec son propre statut, sa propre déclaration de perte/retrouvaille et son propre historique de détention — même si le même agent en détient plusieurs. Badges/porte-cartes, codes et empreinte suivent le même principe : un artefact par site.

Côté Odoo, ce domaine correspondrait à un modèle type `fsm.equipment` ou `maintenance.equipment` (suite Field Service / Maintenance OCA) avec un salarié ou un site comme détenteur courant, un historique des transferts et un statut (en possession / perdu / retrouvé) — à confirmer une fois le reste de l'intégration Odoo en place. **Le backend doit être la source de vérité pour l'ensemble du parc** (tous les porte-clés, badges, codes et empreintes, tous agents et sites confondus) : l'écran "Registre" du mockup (vue responsable, filtrable par type) est une version de terrain simplifiée pour un chef d'équipe en déplacement, pas un remplacement de la vue Odoo — qui reste l'inventaire exhaustif et l'endroit où créer/désactiver un artefact.

**QR code de restitution** : chaque porte-clés et porte-carte physique porte une étiquette avec un QR code menant à une page publique (aucune authentification, utilisable par n'importe qui) expliquant la procédure de retour — prototypée dans `docs/retour-artefact.html`. La page affiche la référence de l'objet (ex. `PC-0142`, imprimée sur l'étiquette et associée à l'artefact dans Odoo) et les coordonnées de contact, sans jamais révéler quels sites les clés ouvrent. Vue dans le mockup mobile : écran "Détail du porte-clé" § Étiquette de retour.

## Installation frontend (en local, sans backend fonctionnel pour l'instant)

```bash
cd frontend
cp .env.example .env    # VITE_API_URL doit pointer vers l'API Odoo une fois décidée
npm install
npm run dev              # démarre sur http://localhost:5173
```

## Relation avec le bot Telegram

Ce projet est un **repository séparé** du bot Telegram [`ocleaneo`](https://github.com/babatoko/ocleaneo). Le bot a sa propre base SQLite ; l'app mobile visera désormais Odoo comme source de vérité.
