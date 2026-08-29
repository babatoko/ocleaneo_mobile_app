<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonButton, IonContent, IonIcon, IonItem, IonLabel, IonList, IonPage, IonRefresher, IonRefresherContent } from '@ionic/vue';
import { checkmarkCircleOutline, downloadOutline } from 'ionicons/icons';
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

async function refreshFromPull(event: CustomEvent) {
  try {
    await load();
  } finally {
    (event.target as HTMLIonRefresherElement).complete();
  }
}

const pdfUrl = computed(() => provider.getOrderPdfUrl(props.id));

function downloadPdf() {
  if (pdfUrl.value) window.open(pdfUrl.value, '_blank');
}
</script>

<template>
  <ion-page>
    <AppHeader title="Commande confirmée" />
    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="refreshFromPull">
        <ion-refresher-content pulling-text="Tire pour rafraîchir" refreshing-spinner="crescent"></ion-refresher-content>
      </ion-refresher>
      <DataState :loading="loading" :error="error" :empty="!order" :skeleton-count="2" @retry="load">
        <template #empty>Commande introuvable.</template>
        <div class="recap">
          <p class="success"><ion-icon :icon="checkmarkCircleOutline"></ion-icon> Commande n°{{ order!.id }} envoyée pour {{ order!.chantier_name }}</p>
          <ion-list class="items" lines="full">
            <ion-item v-for="item in order!.items" :key="item.id">
              <ion-label class="ion-text-wrap">
                {{ item.product_emoji }} {{ item.product_name }} — {{ item.packaging_label }} × {{ item.quantity }}
              </ion-label>
            </ion-item>
          </ion-list>
          <ion-button v-if="pdfUrl" class="pdf" fill="outline" expand="block" @click="downloadPdf">
            <ion-icon slot="start" :icon="downloadOutline"></ion-icon> Télécharger le récapitulatif PDF
          </ion-button>
          <RouterLink to="/planning" class="home-link">Retour au planning</RouterLink>
        </div>
      </DataState>
    </ion-content>
  </ion-page>
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

.success ion-icon {
  color: var(--success-text);
}

.items {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.pdf {
  --border-radius: 8px;
  --border-color: var(--accent);
  --background: var(--surface);
  --color: var(--accent-text);
  --box-shadow: none;
  font-weight: 600;
  text-transform: none;
  margin: 0;
}

.home-link {
  text-align: center;
  color: var(--text-muted);
}
</style>
