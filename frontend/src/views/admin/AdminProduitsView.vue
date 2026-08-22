<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../services/api';
import AppHeader from '../../components/AppHeader.vue';

const products = ref([]);
const form = ref({ name: '', emoji: '', category: '', packagings: '' });

async function refresh() {
  const { data } = await api.get('/products');
  products.value = data;
}

onMounted(refresh);

async function create() {
  if (!form.value.name.trim()) return;
  await api.post('/products', {
    name: form.value.name.trim(),
    emoji: form.value.emoji.trim(),
    category: form.value.category.trim(),
    packagings: form.value.packagings
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  form.value = { name: '', emoji: '', category: '', packagings: '' };
  await refresh();
}

async function deactivate(p) {
  await api.delete(`/products/${p.id}`);
  await refresh();
}
</script>

<template>
  <AppHeader title="Produits" />
  <div class="content">
    <form class="new" @submit.prevent="create">
      <input v-model="form.name" placeholder="Nom du produit" />
      <input v-model="form.emoji" placeholder="Emoji (ex: 🧴)" />
      <input v-model="form.category" placeholder="Catégorie" />
      <input v-model="form.packagings" placeholder="Conditionnements (ex: 5L, 1L)" />
      <button type="submit">Ajouter</button>
    </form>

    <div v-for="p in products" :key="p.id" class="row">
      <div>
        <strong>{{ p.emoji }} {{ p.name }}</strong>
        <span>{{ p.category }} · {{ p.packagings.map((pk) => pk.label).join(', ') }}</span>
      </div>
      <button class="danger" @click="deactivate(p)">Désactiver</button>
    </div>
  </div>
</template>

<style scoped>
.content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.new {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.new input {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.new button {
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: white;
  font-weight: 600;
}

.row {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.row div {
  display: flex;
  flex-direction: column;
}

.row span {
  font-size: 12px;
  color: var(--text-muted);
}

.danger {
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 6px;
  background: white;
  font-size: 12px;
  padding: 6px 8px;
}
</style>
