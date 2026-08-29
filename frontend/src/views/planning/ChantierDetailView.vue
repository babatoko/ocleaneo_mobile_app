<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonButton, IonCard, IonCardContent, IonContent, IonIcon, IonItem, IonLabel, IonPage, IonRefresher, IonRefresherContent } from '@ionic/vue';
import { alertCircleOutline, chevronForwardOutline, clipboardOutline, cubeOutline, locationOutline, mapOutline } from 'ionicons/icons';
import { provider } from '../../providers';
import { ProviderNetworkError } from '../../providers/DataProvider';
import { useChantiersStore } from '../../stores/chantiers';
import { usePlanningStore } from '../../stores/planning';
import { iconForProduct } from '../../utils/productIcons';
import { turnByTurnHref } from '../../services/navigation';
import { todayIso } from '../../utils/date';
import AppHeader from '../../components/AppHeader.vue';
import DataState from '../../components/DataState.vue';
import type { Shift } from '../../types/models';

const props = defineProps({
  id: { type: String, required: true },
});

type StockStatus = 'ok' | 'low' | 'out' | null;

interface StockPreviewItem {
  name: string;
  icon: string;
  status: StockStatus;
}

const route = useRoute();
const router = useRouter();
const chantiers = useChantiersStore();
const planning = usePlanningStore();

const shift = ref<Shift | null>(null);
const loading = ref(true);
const error = ref('');
const stockPreview = ref<StockPreviewItem[]>([]);
// Le détail d'une vacation relève du planning (supporté partout), mais
// l'aperçu de stock et les raccourcis Stock/Inventaire dépendent de
// domaines qu'un backend peut ne pas couvrir. Sans ce garde-fou, un
// backend sans stock faisait échouer TOUTE la fiche — planning compris —
// pour une section secondaire.
const stockSupported = provider.supports('products') && provider.supports('inventory');

function timeRange(s: Shift): string {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(s.start_at)} - ${fmt(s.end_at)}`;
}

function itineraryHref(s: Shift): string {
  const chantier = chantiers.list.find((c) => c.id === s.chantier_id);
  return turnByTurnHref({
    latitude: chantier?.latitude,
    longitude: chantier?.longitude,
    address: s.chantier_address || s.chantier_name,
  });
}

function statusLabel(status: StockStatus): string {
  if (status === 'out') return 'Rupture';
  if (status === 'low') return 'Faible';
  if (status === 'ok') return 'OK';
  return '';
}

function goToStock() {
  if (!shift.value) return;
  chantiers.select(shift.value.chantier_id);
  router.push('/commande/catalogue');
}

// L'inventaire se fait sur place, sur le chantier où l'on se trouve : c'est
// depuis la vacation en cours qu'il est le plus naturel de le lancer.
function goToInventaire() {
  if (!shift.value) return;
  chantiers.select(shift.value.chantier_id);
  router.push({ name: 'inventaire', query: { chantier: String(shift.value.chantier_id) } });
}

async function loadStockPreview(chantierId: number) {
  const [products, inventory] = await Promise.all([
    provider.fetchProducts(),
    provider.fetchInventoryLatest(chantierId),
  ]);
  if (!inventory) {
    stockPreview.value = [];
    return;
  }
  const byProductPackaging: Record<string, number> = {};
  for (const item of inventory.items) {
    byProductPackaging[`${item.product_id}-${item.packaging_id}`] = item.quantity_remaining;
  }
  stockPreview.value = products.slice(0, 4).map((p) => {
    const pkg = p.packagings.find((pk) => pk.is_default) || p.packagings[0];
    const remaining = pkg ? byProductPackaging[`${p.id}-${pkg.id}`] : undefined;
    const status: StockStatus = remaining === undefined ? null : remaining <= 0 ? 'out' : remaining <= 2 ? 'low' : 'ok';
    return { name: p.name, icon: iconForProduct(p), status };
  });
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await chantiers.fetchMine(); // pour le lien Itinéraire avec guidage direct (coordonnées)
    if (planning.selectedShift && String(planning.selectedShift.id) === props.id) {
      shift.value = planning.selectedShift;
    } else {
      const date = typeof route.query.date === 'string' ? route.query.date : todayIso();
      const data = await provider.fetchShifts({ from: date, to: date });
      shift.value = data.find((s) => String(s.id) === props.id) || null;
    }
    if (shift.value && stockSupported) await loadStockPreview(shift.value.chantier_id);
  } catch (e) {
    // Sans ce catch, une panne serveur (pas seulement une coupure réseau)
    // laissait shift.value à null et affichait « Vacation introuvable » —
    // message qui laisse croire à une vacation supprimée, pas à une panne.
    error.value = e instanceof ProviderNetworkError
      ? "Pas de connexion — le détail du chantier n'a pas pu être chargé."
      : (e instanceof Error && e.message) || 'Détail du chantier indisponible.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// Pull-to-refresh : recharge la fiche complète (chantier + aperçu stock).
async function refreshFromPull(event: CustomEvent) {
  try {
    await load();
  } finally {
    (event.target as HTMLIonRefresherElement).complete();
  }
}
</script>

<template>
  <ion-page>
    <AppHeader title="Détail du chantier" />
    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="refreshFromPull">
        <ion-refresher-content pulling-text="Tire pour rafraîchir" refreshing-spinner="crescent"></ion-refresher-content>
      </ion-refresher>
      <DataState :loading="loading" :error="error" :empty="!shift" @retry="load">
        <template #empty>Vacation introuvable.</template>

        <ion-card class="detail-hero">
          <ion-card-content>
            <p class="dtime">{{ timeRange(shift!) }}</p>
            <p class="dclient">{{ shift!.chantier_name }}</p>
            <p class="daddr"><ion-icon :icon="locationOutline"></ion-icon> {{ shift!.chantier_address || shift!.chantier_name }}</p>
          </ion-card-content>
        </ion-card>

        <div class="detail-actions">
          <ion-button class="dbtn" fill="clear" :href="itineraryHref(shift!)" target="_blank" rel="noopener">
            <div><ion-icon :icon="mapOutline"></ion-icon><span>Itinéraire</span></div>
          </ion-button>
          <ion-button v-if="stockSupported" class="dbtn" fill="clear" @click="goToStock">
            <div><ion-icon :icon="cubeOutline"></ion-icon><span>Stock</span></div>
          </ion-button>
          <ion-button v-if="stockSupported" class="dbtn" fill="clear" @click="goToInventaire">
            <div><ion-icon :icon="clipboardOutline"></ion-icon><span>Inventaire</span></div>
          </ion-button>
        </div>

        <ion-item v-if="shift!.note" class="note-box" color="warning" lines="none">
          <ion-icon slot="start" :icon="alertCircleOutline"></ion-icon>
          <ion-label class="ion-text-wrap">{{ shift!.note }}</ion-label>
        </ion-item>

        <div v-if="stockPreview.length" class="detail-block">
          <div class="block-head">
            <p class="section-title" style="padding: 0; margin: 14px 0 6px">Stock du site</p>
            <ion-button fill="clear" size="small" @click="goToStock">
              Tout voir <ion-icon slot="end" :icon="chevronForwardOutline"></ion-icon>
            </ion-button>
          </div>
          <div class="stock-mini-row">
            <ion-card class="stock-mini" v-for="p in stockPreview" :key="p.name">
              <ion-icon :icon="p.icon"></ion-icon>
              <p class="sname">{{ p.name }}</p>
              <p class="slevel" :class="p.status">{{ statusLabel(p.status) }}</p>
            </ion-card>
          </div>
        </div>
      </DataState>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.detail-hero {
  margin: 10px 18px;
  --background: var(--surface-1);
  border-radius: 14px;
  box-shadow: none;
}

.dtime {
  font-size: 18px;
  font-weight: 500;
  margin: 0 0 2px;
}

.dclient {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0 0 10px;
}

.daddr {
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.detail-actions {
  display: flex;
  gap: 10px;
  margin: 0 18px 6px;
}

.dbtn {
  flex: 1;
  --background: var(--surface-1);
  --background-hover: var(--surface-1);
  --border-radius: 12px;
  --box-shadow: none;
  --padding-top: 10px;
  --padding-bottom: 10px;
  height: auto;
  margin: 0;
}

.dbtn div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: none;
}

.dbtn ion-icon {
  font-size: 19px;
  color: var(--text-primary);
}

.note-box {
  margin: 6px 18px;
  border-radius: 10px;
  font-size: 12px;
  --padding-start: 12px;
  --inner-padding-end: 12px;
}

.note-box ion-icon {
  font-size: 15px;
}

.stock-mini-row {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.stock-mini {
  flex-shrink: 0;
  min-width: 76px;
  --background: var(--surface-1);
  border-radius: 10px;
  padding: 8px;
  text-align: center;
  margin: 0;
  box-shadow: none;
}

.stock-mini ion-icon {
  font-size: 16px;
  color: var(--text-secondary);
}

.stock-mini .sname {
  font-size: 10px;
  margin: 4px 0 2px;
}

.stock-mini .slevel {
  font-size: 10px;
  font-weight: 500;
}

.slevel.ok {
  color: var(--success-text);
}

.slevel.low {
  color: var(--warn-text);
}

.slevel.out {
  color: var(--danger);
}
</style>
