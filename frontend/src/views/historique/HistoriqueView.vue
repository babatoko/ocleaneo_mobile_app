<script setup>
import { onMounted, ref } from 'vue';
import { provider } from '../../providers';
import AppHeader from '../../components/AppHeader.vue';

const orders = ref([]);

onMounted(async () => {
  orders.value = await provider.fetchMyOrders();
});
</script>

<template>
  <AppHeader title="Historique des commandes" />
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
    <p v-if="!orders.length" class="empty">Aucune commande pour le moment.</p>
  </div>
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
