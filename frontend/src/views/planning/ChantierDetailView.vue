<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonContent, IonIcon, IonPage } from '@ionic/vue';
import { alertCircleOutline, chevronForwardOutline, clipboardOutline, cubeOutline, locationOutline, mapOutline } from 'ionicons/icons';
import { provider } from '../../providers';
import { useChantiersStore } from '../../stores/chantiers';
import { usePlanningStore } from '../../stores/planning';
import { iconForProduct } from '../../utils/productIcons';
import { turnByTurnHref } from '../../services/navigation';
import { todayIso } from '../../utils/date';
import AppHeader from '../../components/AppHeader.vue';
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
const stockPreview = ref<StockPreviewItem[]>([]);

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

onMounted(async () => {
  loading.value = true;
  try {
    await chantiers.fetchMine(); // pour le lien Itinéraire avec guidage direct (coordonnées)
    if (planning.selectedShift && String(planning.selectedShift.id) === props.id) {
      shift.value = planning.selectedShift;
    } else {
      const date = typeof route.query.date === 'string' ? route.query.date : todayIso();
      const data = await provider.fetchShifts({ from: date, to: date });
      shift.value = data.find((s) => String(s.id) === props.id) || null;
    }
    if (shift.value) await loadStockPreview(shift.value.chantier_id);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <ion-page>
    <AppHeader title="Détail du chantier" />
    <ion-content>
      <template v-if="shift">
        <div class="detail-hero">
          <p class="dtime">{{ timeRange(shift) }}</p>
          <p class="dclient">{{ shift.chantier_name }}</p>
          <p class="daddr"><ion-icon :icon="locationOutline"></ion-icon> {{ shift.chantier_address || shift.chantier_name }}</p>
        </div>

        <div class="detail-actions">
          <a class="dbtn" :href="itineraryHref(shift)" target="_blank" rel="noopener">
            <ion-icon :icon="mapOutline"></ion-icon> Itinéraire
          </a>
          <button type="button" class="dbtn" @click="goToStock">
            <ion-icon :icon="cubeOutline"></ion-icon> Stock
          </button>
          <button type="button" class="dbtn" @click="goToInventaire">
            <ion-icon :icon="clipboardOutline"></ion-icon> Inventaire
          </button>
        </div>

        <div v-if="shift.note" class="detail-block">
          <div class="note-box">
            <ion-icon :icon="alertCircleOutline"></ion-icon>
            <span>{{ shift.note }}</span>
          </div>
        </div>

        <div v-if="stockPreview.length" class="detail-block">
          <div class="block-head">
            <p class="section-title" style="padding: 0; margin: 14px 0 6px">Stock du site</p>
            <button type="button" class="see-all" @click="goToStock">Tout voir <ion-icon :icon="chevronForwardOutline"></ion-icon></button>
          </div>
          <div class="stock-mini-row">
            <div class="stock-mini" v-for="p in stockPreview" :key="p.name">
              <ion-icon :icon="p.icon"></ion-icon>
              <p class="sname">{{ p.name }}</p>
              <p class="slevel" :class="p.status">{{ statusLabel(p.status) }}</p>
            </div>
          </div>
        </div>
      </template>

      <p v-else-if="!loading" class="trip-empty">Vacation introuvable.</p>
    </ion-content>
  </ion-page>
</template>
