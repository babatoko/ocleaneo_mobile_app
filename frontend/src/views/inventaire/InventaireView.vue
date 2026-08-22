<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../services/api';
import { useChantiersStore } from '../../stores/chantiers';
import AppHeader from '../../components/AppHeader.vue';

const chantiers = useChantiersStore();
const products = ref([]);
const quantities = ref({}); // packagingId -> quantity
const submitting = ref(false);
const done = ref(false);

onMounted(async () => {
  await chantiers.fetchMine();
  const { data } = await api.get('/products');
  products.value = data;
});

function setQty(packagingId, value) {
  quantities.value[packagingId] = Number(value);
}

async function submit(chantierId) {
  const items = Object.entries(quantities.value)
    .filter(([, qty]) => qty >= 0 && qty !== '')
    .map(([packagingId, qty]) => {
      const product = products.value.find((p) =>
        p.packagings.some((pk) => pk.id === Number(packagingId))
      );
      return { productId: product.id, packagingId: Number(packagingId), quantityRemaining: qty };
    });

  if (!items.length) return;
  submitting.value = true;
  try {
    await api.post('/inventory', { chantierId, items });
    done.value = true;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AppHeader title="Inventaire" />
  <div v-if="done" class="done"><i class="ti ti-circle-check"></i> Inventaire enregistré, merci !</div>
  <div v-else class="inventory">
    <p class="hint">Saisissez le stock restant pour chaque produit avant de valider.</p>
    <div v-for="p in products" :key="p.id" class="product">
      <strong>{{ p.emoji }} {{ p.name }}</strong>
      <div v-for="pk in p.packagings" :key="pk.id" class="packaging">
        <span>{{ pk.label }}</span>
        <input
          type="number"
          min="0"
          placeholder="0"
          @input="setQty(pk.id, $event.target.value)"
        />
      </div>
    </div>

    <div class="chantier-buttons">
      <button
        v-for="c in chantiers.list"
        :key="c.id"
        :disabled="submitting"
        @click="submit(c.id)"
      >
        Valider pour {{ c.name }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.inventory {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hint {
  color: var(--text-muted);
  font-size: 13px;
}

.product {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.packaging {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.packaging input {
  width: 70px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  text-align: right;
}

.chantier-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chantier-buttons button {
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: white;
  font-weight: 600;
}

.done {
  padding: 48px 24px;
  text-align: center;
  font-weight: 600;
}
</style>
