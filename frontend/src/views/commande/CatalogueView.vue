<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../services/api';
import { useCartStore } from '../../stores/cart';
import { useChantiersStore } from '../../stores/chantiers';

const CATEGORY_ICONS = {
  Sol: 'ti-spray',
  Vitres: 'ti-droplet',
  Sanitaires: 'ti-toilet-paper',
  Consommables: 'ti-package',
};

const chantiers = useChantiersStore();
const cart = useCartStore();
const router = useRouter();

const products = ref([]);
const stockByProduct = reactive({}); // productId -> { status: 'ok'|'low'|'out', quantityRemaining }
const orderQty = reactive({}); // productId -> quantity to order

function defaultPackaging(product) {
  return product.packagings.find((pk) => pk.is_default) || product.packagings[0];
}

function iconFor(product) {
  return CATEGORY_ICONS[product.category] || 'ti-flask';
}

function statusLabel(status) {
  if (status === 'out') return 'Rupture';
  if (status === 'low') return 'Stock faible';
  if (status === 'ok') return 'Stock suffisant';
  return '';
}

function suggestedQty(status) {
  if (status === 'out') return 2;
  if (status === 'low') return 1;
  return 0;
}

async function loadStock() {
  if (!chantiers.selectedId) return;
  try {
    const { data } = await api.get(`/inventory/chantier/${chantiers.selectedId}/latest`);
    const byProductPackaging = {};
    for (const item of data.items) {
      byProductPackaging[`${item.product_id}-${item.packaging_id}`] = item.quantity_remaining;
    }
    for (const p of products.value) {
      const pkg = defaultPackaging(p);
      const remaining = pkg ? byProductPackaging[`${p.id}-${pkg.id}`] : undefined;
      const status = remaining === undefined ? null : remaining <= 0 ? 'out' : remaining <= 2 ? 'low' : 'ok';
      stockByProduct[p.id] = { status, quantityRemaining: remaining };
      if (orderQty[p.id] === undefined) orderQty[p.id] = suggestedQty(status);
    }
  } catch {
    // Pas d'inventaire enregistré pour ce chantier : aucun statut affiché.
    for (const p of products.value) {
      stockByProduct[p.id] = { status: null, quantityRemaining: undefined };
      if (orderQty[p.id] === undefined) orderQty[p.id] = 0;
    }
  }
}

onMounted(async () => {
  await chantiers.fetchMine();
  if (!chantiers.selectedId) chantiers.select(chantiers.list[0]?.id ?? null);
  const { data } = await api.get('/products');
  products.value = data;
  await loadStock();
});

watch(() => chantiers.selectedId, loadStock);

const selectedCount = computed(() => Object.values(orderQty).filter((q) => q > 0).length);

function step(productId, delta) {
  orderQty[productId] = Math.max(0, (orderQty[productId] || 0) + delta);
}

function goToOrder() {
  cart.clear();
  for (const p of products.value) {
    const qty = orderQty[p.id];
    if (!qty) continue;
    const pkg = defaultPackaging(p);
    cart.addItem({
      productId: p.id,
      productName: p.name,
      productEmoji: p.emoji,
      packagingId: pkg.id,
      packagingLabel: pkg.label,
      quantity: qty,
    });
  }
  router.push('/commande/panier');
}
</script>

<template>
  <div class="header">
    <div>
      <p class="hello">Stock</p>
      <p class="name sub-name">Produits sur site</p>
    </div>
  </div>

  <div class="site-select">
    <i class="ti ti-building-warehouse"></i>
    <select v-model="chantiers.selectedId">
      <option v-for="c in chantiers.list" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>
    <i class="ti ti-chevron-down chev"></i>
  </div>

  <div class="stock-grid">
    <div v-for="p in products" :key="p.id" class="stock-item">
      <div class="icon-wrap"><i class="ti" :class="iconFor(p)"></i></div>
      <p class="pname">{{ p.name }}</p>
      <p class="plevel" :class="stockByProduct[p.id]?.status">
        {{ statusLabel(stockByProduct[p.id]?.status) }}
      </p>
      <div class="stepper">
        <button type="button" @click="step(p.id, -1)">−</button>
        <span class="qty">{{ orderQty[p.id] || 0 }}</span>
        <button type="button" @click="step(p.id, 1)">+</button>
      </div>
    </div>
  </div>

  <button v-if="selectedCount" class="stock-cart-bar" @click="goToOrder">
    <span>{{ selectedCount }} produit{{ selectedCount > 1 ? 's' : '' }} sélectionné{{ selectedCount > 1 ? 's' : '' }}</span>
    <span class="cta">Commander <i class="ti ti-arrow-right"></i></span>
  </button>
</template>

<style scoped>
.sub-name {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 400;
}

.stock-grid {
  padding-bottom: 16px;
}
</style>
