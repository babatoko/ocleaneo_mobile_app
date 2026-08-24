<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { provider } from '../../providers';
import { useChantiersStore } from '../../stores/chantiers';
import { usePlanningStore } from '../../stores/planning';
import { iconForProduct } from '../../utils/productIcons';
import { turnByTurnHref } from '../../services/navigation';
import { todayIso } from '../../utils/date';
import AppHeader from '../../components/AppHeader.vue';

const props = defineProps({
  id: { type: String, required: true },
});

const route = useRoute();
const router = useRouter();
const chantiers = useChantiersStore();
const planning = usePlanningStore();

const shift = ref(null);
const loading = ref(true);
const stockPreview = ref([]); // [{ name, icon, status }]

function timeRange(s) {
  const fmt = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(s.start_at)} - ${fmt(s.end_at)}`;
}

function itineraryHref(s) {
  const chantier = chantiers.list.find((c) => c.id === s.chantier_id);
  return turnByTurnHref({
    latitude: chantier?.latitude,
    longitude: chantier?.longitude,
    address: s.chantier_address || s.chantier_name,
  });
}

function statusLabel(status) {
  if (status === 'out') return 'Rupture';
  if (status === 'low') return 'Faible';
  if (status === 'ok') return 'OK';
  return '';
}

function goToStock() {
  chantiers.select(shift.value.chantier_id);
  router.push('/commande/catalogue');
}

// L'inventaire se fait sur place, sur le chantier où l'on se trouve : c'est
// depuis la vacation en cours qu'il est le plus naturel de le lancer.
function goToInventaire() {
  chantiers.select(shift.value.chantier_id);
  router.push({ name: 'inventaire', query: { chantier: shift.value.chantier_id } });
}

async function loadStockPreview(chantierId) {
  const [products, inventory] = await Promise.all([
    provider.fetchProducts(),
    provider.fetchInventoryLatest(chantierId),
  ]);
  if (!inventory) {
    stockPreview.value = [];
    return;
  }
  const byProductPackaging = {};
  for (const item of inventory.items) {
    byProductPackaging[`${item.product_id}-${item.packaging_id}`] = item.quantity_remaining;
  }
  stockPreview.value = products.slice(0, 4).map((p) => {
    const pkg = p.packagings.find((pk) => pk.is_default) || p.packagings[0];
    const remaining = pkg ? byProductPackaging[`${p.id}-${pkg.id}`] : undefined;
    const status = remaining === undefined ? null : remaining <= 0 ? 'out' : remaining <= 2 ? 'low' : 'ok';
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
      const date = route.query.date || todayIso();
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
  <AppHeader title="Détail du chantier" />

  <template v-if="shift">
    <div class="detail-hero">
      <p class="dtime">{{ timeRange(shift) }}</p>
      <p class="dclient">{{ shift.chantier_name }}</p>
      <p class="daddr"><i class="ti ti-map-pin"></i> {{ shift.chantier_address || shift.chantier_name }}</p>
    </div>

    <div class="detail-actions">
      <a class="dbtn" :href="itineraryHref(shift)" target="_blank" rel="noopener">
        <i class="ti ti-map-2"></i> Itinéraire
      </a>
      <button type="button" class="dbtn" @click="goToStock">
        <i class="ti ti-box"></i> Stock
      </button>
      <button type="button" class="dbtn" @click="goToInventaire">
        <i class="ti ti-clipboard-list"></i> Inventaire
      </button>
    </div>

    <div v-if="shift.note" class="detail-block">
      <div class="note-box">
        <i class="ti ti-alert-circle"></i>
        <span>{{ shift.note }}</span>
      </div>
    </div>

    <div v-if="stockPreview.length" class="detail-block">
      <div class="block-head">
        <p class="section-title" style="padding: 0; margin: 14px 0 6px">Stock du site</p>
        <button type="button" class="see-all" @click="goToStock">Tout voir <i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="stock-mini-row">
        <div class="stock-mini" v-for="p in stockPreview" :key="p.name">
          <i class="ti" :class="p.icon"></i>
          <p class="sname">{{ p.name }}</p>
          <p class="slevel" :class="p.status">{{ statusLabel(p.status) }}</p>
        </div>
      </div>
    </div>
  </template>

  <p v-else-if="!loading" class="trip-empty">Vacation introuvable.</p>
</template>
