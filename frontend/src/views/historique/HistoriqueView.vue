<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { provider } from '../../providers';
import { ProviderNetworkError } from '../../providers/DataProvider';
import AppHeader from '../../components/AppHeader.vue';
import DataState from '../../components/DataState.vue';
import type { Order } from '../../types/models';

const orders = ref<Order[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    orders.value = await provider.fetchMyOrders();
  } catch (e) {
    error.value = e instanceof ProviderNetworkError
      ? "Pas de connexion — l'historique n'a pas pu être chargé."
      : (e instanceof Error && e.message) || 'Historique indisponible.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AppHeader title="Historique des commandes" />
  <DataState :loading="loading" :error="error" :empty="!orders.length" @retry="load">
    <template #empty>Aucune commande pour le moment.</template>
    <div class="list">
      <RouterLink
        v-for="o in orders"
        :key="o.id"
        :to="`/commande/${o.id}/recap`"
        class="order"
      >
        <strong>Commande n°{{ o.id }} — {{ o.chantier_name }}</strong>
        <span>{{ new Date(o.created_at).toLocaleDateString('fr-FR') }} · {{ o.status }}</span>
      </RouterLink>
    </div>
  </DataState>
</template>

<style scoped>
.list {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.order {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  text-decoration: none;
  color: var(--text);
}

.order span {
  font-size: 12px;
  color: var(--text-muted);
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}
</style>
