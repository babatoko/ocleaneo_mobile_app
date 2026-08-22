<script setup>
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../services/api';
import { useCartStore } from '../../stores/cart';
import AppHeader from '../../components/AppHeader.vue';
import ProductCard from '../../components/ProductCard.vue';

const products = ref([]);
const categories = ref([]);
const activeCategory = ref('');
const selected = ref(null);
const quantity = ref(1);
const selectedPackagingId = ref(null);

const cart = useCartStore();
const router = useRouter();

onMounted(async () => {
  const [{ data: cats }, { data: prods }] = await Promise.all([
    api.get('/products/categories'),
    api.get('/products'),
  ]);
  categories.value = cats;
  products.value = prods;
  activeCategory.value = cats[0] || '';
});

const filtered = computed(() =>
  products.value.filter((p) => !activeCategory.value || p.category === activeCategory.value)
);

function openProduct(product) {
  selected.value = product;
  selectedPackagingId.value = product.packagings[0]?.id ?? null;
  quantity.value = 1;
}

function addToCart() {
  const packaging = selected.value.packagings.find((p) => p.id === selectedPackagingId.value);
  cart.addItem({
    productId: selected.value.id,
    productName: selected.value.name,
    productEmoji: selected.value.emoji,
    packagingId: packaging.id,
    packagingLabel: packaging.label,
    quantity: quantity.value,
  });
  selected.value = null;
}
</script>

<template>
  <AppHeader title="Catalogue produits" />

  <div class="categories">
    <button
      v-for="cat in categories"
      :key="cat"
      :class="{ active: activeCategory === cat }"
      @click="activeCategory = cat"
    >
      {{ cat }}
    </button>
  </div>

  <div class="grid">
    <ProductCard v-for="p in filtered" :key="p.id" :product="p" @select="openProduct" />
  </div>

  <button v-if="cart.totalItems" class="cart-fab" @click="router.push('/commande/panier')">
    🛒 Panier ({{ cart.totalItems }})
  </button>

  <div v-if="selected" class="sheet-backdrop" @click.self="selected = null">
    <div class="sheet">
      <h2>{{ selected.emoji }} {{ selected.name }}</h2>
      <label>Conditionnement</label>
      <select v-model="selectedPackagingId">
        <option v-for="pk in selected.packagings" :key="pk.id" :value="pk.id">{{ pk.label }}</option>
      </select>
      <label>Quantité</label>
      <input v-model.number="quantity" type="number" min="1" />
      <button class="confirm" @click="addToCart">Ajouter au panier</button>
    </div>
  </div>
</template>

<style scoped>
.categories {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  overflow-x: auto;
}

.categories button {
  flex-shrink: 0;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
}

.categories button.active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 8px 16px;
}

.cart-fab {
  position: fixed;
  bottom: 84px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--primary);
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 999px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet {
  width: 100%;
  max-width: 480px;
  background: var(--surface);
  border-radius: 16px 16px 0 0;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sheet select,
.sheet input {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.confirm {
  margin-top: 8px;
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: white;
  font-weight: 600;
}
</style>
