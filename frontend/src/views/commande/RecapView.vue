<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../services/api';
import AppHeader from '../../components/AppHeader.vue';

const props = defineProps({ id: { type: [String, Number], required: true } });
const order = ref(null);

onMounted(async () => {
  const { data } = await api.get(`/orders/${props.id}`);
  order.value = data;
});

function downloadPdf() {
  window.open(`${api.defaults.baseURL}/orders/${props.id}/pdf`, '_blank');
}
</script>

<template>
  <AppHeader title="Commande confirmée" />
  <div v-if="order" class="recap">
    <p class="success">✅ Commande n°{{ order.id }} envoyée pour {{ order.chantier_name }}</p>
    <ul>
      <li v-for="item in order.items" :key="item.id">
        {{ item.product_emoji }} {{ item.product_name }} — {{ item.packaging_label }} × {{ item.quantity }}
      </li>
    </ul>
    <button class="pdf" @click="downloadPdf">📄 Télécharger le récapitulatif PDF</button>
    <RouterLink to="/" class="home-link">Retour à l'accueil</RouterLink>
  </div>
</template>

<style scoped>
.recap {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.success {
  font-weight: 600;
}

ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

li {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}

.pdf {
  padding: 12px;
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: white;
  color: var(--primary);
  font-weight: 600;
}

.home-link {
  text-align: center;
  color: var(--text-muted);
}
</style>
