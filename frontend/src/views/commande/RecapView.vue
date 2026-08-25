<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { provider } from '../../providers';
import { ProviderNetworkError } from '../../providers/DataProvider';
import AppHeader from '../../components/AppHeader.vue';
import DataState from '../../components/DataState.vue';
import type { Order } from '../../types/models';

const props = defineProps({ id: { type: [String, Number], required: true } });
const order = ref<Order | null>(null);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    order.value = await provider.fetchOrder(props.id);
  } catch (e) {
    error.value = e instanceof ProviderNetworkError
      ? 'Pas de connexion — le récapitulatif n\'a pas pu être chargé. La commande, elle, est bien partie.'
      : (e instanceof Error && e.message) || 'Récapitulatif indisponible.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const pdfUrl = computed(() => provider.getOrderPdfUrl(props.id));

function downloadPdf() {
  if (pdfUrl.value) window.open(pdfUrl.value, '_blank');
}
</script>

<template>
  <AppHeader title="Commande confirmée" />
  <DataState :loading="loading" :error="error" :empty="!order" :skeleton-count="2" @retry="load">
    <template #empty>Commande introuvable.</template>
    <div class="recap">
      <p class="success"><i class="ti ti-circle-check"></i> Commande n°{{ order!.id }} envoyée pour {{ order!.chantier_name }}</p>
      <ul>
        <li v-for="item in order!.items" :key="item.id">
          {{ item.product_emoji }} {{ item.product_name }} — {{ item.packaging_label }} × {{ item.quantity }}
        </li>
      </ul>
      <button v-if="pdfUrl" class="pdf" @click="downloadPdf"><i class="ti ti-file-download"></i> Télécharger le récapitulatif PDF</button>
      <RouterLink to="/planning" class="home-link">Retour au planning</RouterLink>
    </div>
  </DataState>
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
  display: flex;
  align-items: center;
  gap: 6px;
}

.success i {
  color: var(--success-text);
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
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: var(--surface);
  color: var(--accent-text);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.home-link {
  text-align: center;
  color: var(--text-muted);
}
</style>
