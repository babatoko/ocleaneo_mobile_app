# Plan de développement : synchronisation bidirectionnelle Pointage

> Issue : https://github.com/babatoko/ocleaneo_mobile_app/issues/88
> Objectif : permettre un rafraîchissement de la vue Pointage qui synchronise l'état local et le serveur dans les deux sens.

---

## 1. Contexte

L'application mobile enregistre les pointages :
- en **ligne** : appel direct `POST /api/mobile/v1/pointage`
- en **hors ligne** : mise en file d'attente locale (`services/offlineQueue.ts`), puis rejeu automatique à la reconnexion

Le backend expose déjà :
- `GET /api/mobile/v1/pointage/mine` : pointages du worker sur une plage de dates
- `GET /api/mobile/v1/chantiers/aujourdhui` : chantiers/vacations du jour

Actuellement, la vue Pointage charge les données au montage mais ne propose pas d'action de resynchronisation explicite. Si un gestionnaire RH modifie une présence dans le back-office, l'app ne le reflète pas tant qu'elle n'est pas relancée.

---

## 2. Objectifs fonctionnels

### 2.1 Local → Serveur
- Pousser les pointages enregistrés localement en mode offline vers Odoo.
- Garantir l'idempotence grâce au `client_ref` déjà généré côté frontend.
- Afficher l'état d'avancement de la synchro (nombre d'éléments restants, erreurs).

### 2.2 Serveur → Local
- Interroger le serveur pour obtenir l'état actuel :
  - pointages (`ocleaneo.mobile.pointage`)
  - présences (`hr.attendance`)
  - timesheets (`account.analytic.line`)
  - chantiers et vacations (`fsm.order`, planning)
- Mettre à jour le store local et l'affichage avec les données serveur.
- Préserver les données locales plus récentes qu'une donnée serveur plus ancienne.

### 2.3 UX
- **Pull-to-refresh** sur la vue Pointage.
- Indicateur visuel pendant la synchronisation.
- Snackbar / toast en cas d'erreur réseau.
- Pas de double appel si une synchro est déjà en cours.
- Fonctionnement dégradé offline : on pousse ce qui est possible, on garde les données locales pour le reste.

---

## 3. Architecture cible

```
┌─────────────────────────────────────┐
│           Vue PointageView.vue        │
│  pull-to-refresh  ──▶  pointageStore.refresh()
└─────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│      stores/pointage.ts               │
│  refresh() :                          │
│    1. flushOfflineQueue()              │
│    2. pullServerState()                │
│    3. mergeAndApply()                   │
└─────────────────────────────────────┘
                   │
     ┌─────────────┴─────────────┐
     ▼                           ▼
┌─────────────┐          ┌─────────────────┐
│ offlineQueue │          │  provider (Odoo) │
│   (push)     │          │ fetchTodayTimeEntries()
└─────────────┘          │ fetchTimeEntries()
                         │ fetchShifts()
                         └─────────────────┘
```

---

## 4. Découpage technique

### Étape 1 — Backend : endpoint d'état consolidé
**Repo : `majavi-software/ocleaneo`**

Ajouter un endpoint `POST /api/mobile/v1/pointage/sync` (ou enrichir `pointage/mine`) qui retourne pour une plage de dates :

| Donnée | Source | Champs clés |
|--------|--------|-------------|
| Pointages | `ocleaneo.mobile.pointage` | `id`, `type`, `datetime`, `fsm_order_id`, `fsm_location_id`, `commentaire`, `client_ref` |
| Présences | `hr.attendance` | `id`, `check_in`, `check_out`, `employee_id` |
| Timesheets | `account.analytic.line` | `id`, `date_time`, `date_time_end`, `unit_amount`, `fsm_order_id` |
| Chantiers du jour | `fsm.order` | `id`, `name`, `location_id`, `scheduled_date_start`, `scheduled_date_end`, `stage`, `completion_state`, `completion_ratio` |

**Contraintes :**
- Résolution dans le **fuseau horaire du worker** (`user.tz`).
- Filtrage par `user_id` / `employee_id`.
- Limite de records (pagination ou MAX_RECORDS).

**Fichiers concernés :**
- `ocleaneo_mobile_pointage/controllers/pointage.py`
- `ocleaneo_mobile_pointage/controllers/__init__.py` (si nouvelle route)
- tests dans `ocleaneo_mobile_pointage/tests/`

---

### Étape 2 — Provider : méthode de sync
**Repo : `babatoko/ocleaneo_mobile_app`**

Dans `providers/DataProvider.ts`, ajouter :

```ts
abstract async syncPointageState(range: DateRange): Promise<PointageSyncResult>;
```

Avec `PointageSyncResult` :

```ts
interface PointageSyncResult {
  entries: TimeEntry[];        // pointages serveur
  attendances: Attendance[];     // présences hr.attendance
  timesheets: Timesheet[];       // lignes de temps
  shifts: Shift[];              // vacations du jour
  serverTime: string;           // ISO, pour résoudre conflits horodatés
}
```

Implémenter dans :
- `providers/OdooProvider.ts`
- `providers/RestProvider.ts` (stub ou vraie route REST)
- `providers/MockProvider.ts` (simulation pour tests)

---

### Étape 3 — Store : action `refresh()`
**Repo : `babatoko/ocleaneo_mobile_app`**

Dans `stores/pointage.ts`, ajouter :

```ts
async refresh(options?: { silent?: boolean }): Promise<void> {
  if (this.syncing) return;  // garde réentrance
  this.syncing = true;
  try {
    // 1. Push local → serveur
    await this.flushOfflineQueue();

    // 2. Pull serveur → local
    const today = todayIso();
    const sync = await provider.syncPointageState({ from: today, to: today });

    // 3. Fusion
    this.entries = mergeTimeEntries(this.entries, sync.entries, sync.serverTime);
    this.todayShifts = mergeShifts(this.todayShifts, sync.shifts, sync.serverTime);
    this.weekEntries = mergeTimeEntries(this.weekEntries, sync.entries, sync.serverTime);
    this.weekShifts = mergeShifts(this.weekShifts, sync.shifts, sync.serverTime);

    // 4. Optionnel : notifier les écarts détectés
    const conflicts = detectConflicts(this.entries, sync.entries);
    if (conflicts.length > 0 && !options?.silent) {
      this.lastMessage = { type: 'warn', text: `${conflicts.length} écart(s) détecté(s) avec le serveur.` };
    }
  } catch (e) {
    if (e instanceof ProviderNetworkError) {
      this.lastMessage = { type: 'warn', text: 'Connexion impossible. Les données locales sont conservées.' };
    } else {
      throw e;
    }
  } finally {
    this.syncing = false;
  }
}
```

**Nouvelles dépendances dans le store :**
- `syncing: boolean`
- fonction utilitaire `mergeTimeEntries(local, server, serverTime)`
- fonction utilitaire `mergeShifts(local, server, serverTime)`
- fonction utilitaire `detectConflicts(local, server)`

---

### Étape 4 — Fusion locale / serveur

**Principes :**
- Un pointage **serveur** avec un `client_ref` correspondant à un pointage local pending remplace ce dernier (il est désormais confirmé).
- Un pointage **local pending** sans correspondance serveur est conservé (pas encore synchronisé).
- Un pointage **serveur** plus récent (datetime > local) prend le pas.
- Une présence ou timesheet modifiée dans le back-office remplace la version locale si son `write_date` / `serverTime` est postérieur.
- Les vacations serveur remplacent les vacations locales si elles sont différentes (source de vérité = planning).

**Fichier :** `stores/pointageSync.ts` (nouveau)

---

### Étape 5 — UI : pull-to-refresh
**Repo : `babatoko/ocleaneo_mobile_app`**

Dans `views/pointage/PointageView.vue` :

```vue
<ion-refresher slot="fixed" @ionRefresh="onRefresh">
  <ion-refresher-content />
</ion-refresher>
```

```ts
async onRefresh(event: RefresherCustomEvent) {
  try {
    await pointageStore.refresh();
  } finally {
    event.target.complete();
  }
}
```

**Comportements :**
- L'indicateur de rafraîchissement reste visible tant que `syncing` est true.
- Un toast apparaît si erreur réseau.
- Le badge "file offline" reste visible si des pointages sont toujours en attente.

---

### Étape 6 — Tests

#### Backend
- `test_pointage_sync.py` :
  - sync retourne les bons enregistrements
  - `client_ref` permet d'identifier un pointage
  - fuseau horaire worker respecté
  - filtrage par user_id

#### Frontend
- `stores/__tests__/pointageSync.test.ts` :
  - mergeTimeEntries gère pending + serveur
  - mergeShifts remplace par le serveur
  - detectConflicts signale les écarts
- `views/pointage/PointageView.test.ts` :
  - pull-to-refresh déclenche `refresh()`
  - spinner lié à `syncing`
  - toast sur erreur réseau

---

## 5. Plan de commits / PR

### PR A — Backend : endpoint `sync`
- `ocleaneo_mobile_pointage/controllers/pointage.py` : ajout `sync_pointage_state()`
- `ocleaneo_mobile_pointage/__manifest__.py` : bump version
- tests

### PR B — Frontend : contrat provider + types
- `types/models.ts` : `PointageSyncResult`, `Attendance`, `Timesheet`
- `providers/DataProvider.ts` : méthode abstraite
- `providers/OdooProvider.ts`, `RestProvider.ts`, `MockProvider.ts` : implémentations

### PR C — Frontend : logique de fusion
- `stores/pointageSync.ts`
- `stores/pointage.ts` : action `refresh()` + état `syncing`

### PR D — Frontend : UI pull-to-refresh
- `views/pointage/PointageView.vue`
- styles / composants toast
- tests

### PR E — Intégration + tests bout en bout
- build + déploiement
- validation sur environnement de test

---

## 6. Risques et mitigations

| Risque | Mitigation |
|--------|-----------|
| Données locales écrasées par le serveur | Fusion basée sur `client_ref` + horodatage ; préservations des pending |
| Doublons de pointages | `client_ref` déjà en place côté backend |
| Boucle de sync infinie | Garde `syncing` dans le store |
| Perf sur gros historique | Limitation à la journée par défaut ; plage extensible |
| Conflit back-office vs local | UI montrant un badge "écart" + message explicatif |

---

## 7. Prochaine étape recommandée

Commencer par la **PR A backend** : l'endpoint `sync_pointage_state` est le prerequis de tout le reste. Elle est isolée, testable en CI, et ne touche pas à l'UI.
