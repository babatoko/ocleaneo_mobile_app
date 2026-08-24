<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { provider } from '../../providers';
import { useCartStore } from '../../stores/cart';
import { useChantiersStore } from '../../stores/chantiers';
import { iconForProduct } from '../../utils/productIcons';
import DataState from '../../components/DataState.vue';

const chantiers = useChantiersStore();
const cart = useCartStore();
const router = useRouter();

const products = ref([]);
const stockByProduct = reactive({}); // productId -> { status: 'ok'|'low'|'out', quantityRemaining }
const orderQty = reactive({}); // productId -> quantity to order
const loading = ref(true);
const error = ref('');

function defaultPackaging(product) {
  return product.packagings.find((pk) => pk.is_default) || product.packagings[0];
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
  // Repartir de zéro à chaque site : sans ça, les quantités saisies pour le
  // chantier précédent restent affichées et partiraient dans la commande du
  // nouveau.
  for (const key of Object.keys(orderQty)) delete orderQty[key];

  const inventory = await provider.fetchInventoryLatest(chantiers.selectedId);
  if (!inventory) {
    // Pas d'inventaire enregistré pour ce chantier : aucun statut affiché.
    for (const p of products.value) {
      stockByProduct[p.id] = { status: null, quantityRemaining: undefined };
      orderQty[p.id] = 0;
    }
    return;
  }
  const byProductPackaging = {};
  for (const item of inventory.items) {
    byProductPackaging[`${item.product_id}-${item.packaging_id}`] = item.quantity_remaining;
  }
  for (const p of products.value) {
    const pkg = defaultPackaging(p);
    const remaining = pkg ? byProductPackaging[`${p.id}-${pkg.id}`] : undefined;
    const status = remaining === undefined ? null : remaining <= 0 ? 'out' : remaining <= 2 ? 'low' : 'ok';
    stockByProduct[p.id] = { status, quantityRemaining: remaining };
    orderQty[p.id] = suggestedQty(status);
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await chantiers.fetchMine();
    if (!chantiers.selectedId) chantiers.select(chantiers.list[0]?.id ?? null);
    products.value = await provider.fetchProducts();
    await loadStock();
  } catch (e) {
    error.value = e.isNetworkError
      ? 'Pas de connexion — le catalogue n\'a pas pu être chargé.'
      : e.message || 'Catalogue indisponible.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

watch(
  () => chantiers.selectedId,
  async () => {
    error.value = '';
    try {
      await loadStock();
    } catch (e) {
      error.value = e.isNetworkError
        ? 'Pas de connexion — le stock de ce site n\'a pas pu être chargé.'
        : e.message || 'Stock indisponible.';
    }
  }
);

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
    <select v-model="chantiers.selectedId" aria-label="Chantier">
      <option v-for="c in chantiers.list" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>
    <i class="ti ti-chevron-down chev"></i>
  </div>

  <RouterLink
    v-if="chantiers.selectedId"
    class="inventaire-link"
    :to="{ name: 'inventaire', query: { chantier: chantiers.selectedId } }"
  >
    <i class="ti ti-clipboard-list"></i>
    <span>Mettre à jour l'inventaire du site</span>
    <i class="ti ti-chevron-right chev"></i>
  </RouterLink>

  <DataState :loading="loading" :error="error" :empty="!products.length" @retry="load">
    <template #empty>Aucun produit au catalogue.</template>

    <div class="stock-grid">
      <div v-for="p in products" :key="p.id" class="stock-item">
        <div class="icon-wrap"><i class="ti" :class="iconForProduct(p)"></i></div>
        <p class="pname">{{ p.name }}</p>
        <p class="plevel" :class="stockByProduct[p.id]?.status">
          {{ statusLabel(stockByProduct[p.id]?.status) }}
        </p>
        <div class="stepper">
          <button type="button" :aria-label="`Retirer un ${p.name}`" @click="step(p.id, -1)">−</button>
          <span class="qty" aria-live="polite" :aria-label="`${orderQty[p.id] || 0} ${p.name}`">
            {{ orderQty[p.id] || 0 }}
          </span>
          <button type="button" :aria-label="`Ajouter un ${p.name}`" @click="step(p.id, 1)">+</button>
        </div>
      </div>
    </div>

    <button v-if="selectedCount" class="stock-cart-bar" @click="goToOrder">
      <span>{{ selectedCount }} produit{{ selectedCount > 1 ? 's' : '' }} sélectionné{{ selectedCount > 1 ? 's' : '' }}</span>
      <span class="cta">Commander <i class="ti ti-arrow-right"></i></span>
    </button>
  </DataState>
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

.inventaire-link {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 18px 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-1);
  color: var(--text-primary);
  text-decoration: none;
  font-size: 12.5px;
}

.inventaire-link > i:first-child {
  font-size: 16px;
  color: var(--text-secondary);
}

.inventaire-link span {
  flex: 1;
}

.inventaire-link .chev {
  font-size: 15px;
  color: var(--text-muted);
}
</style>
