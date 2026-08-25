<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonContent, IonItem, IonLabel, IonList, IonNote, IonPage } from '@ionic/vue';
import { provider } from '../../providers';
import { ProviderNetworkError } from '../../providers/DataProvider';
import AppHeader from '../../components/AppHeader.vue';
import DataState from '../../components/DataState.vue';
import type { Order } from '../../types/models';

const router = useRouter();

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
  <ion-page>
    <AppHeader title="Historique des commandes" />
    <ion-content>
      <DataState :loading="loading" :error="error" :empty="!orders.length" @retry="load">
        <template #empty>Aucune commande pour le moment.</template>
        <ion-list class="list" lines="none">
          <ion-item
            v-for="o in orders"
            :key="o.id"
            class="order"
            button
            detail
            @click="router.push(`/commande/${o.id}/recap`)"
          >
            <ion-label class="ion-text-wrap">
              <strong>Commande n°{{ o.id }} — {{ o.chantier_name }}</strong>
              <ion-note>{{ new Date(o.created_at).toLocaleDateString('fr-FR') }} · {{ o.status }}</ion-note>
            </ion-label>
          </ion-item>
        </ion-list>
      </DataState>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.list {
  padding: 16px;
  background: transparent;
}

.order {
  --background: var(--surface);
  --color: var(--text);
  --padding-start: 16px;
  --inner-padding-end: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 10px;
  overflow: hidden;
}

.order strong {
  display: block;
  margin-bottom: 4px;
}

.order ion-note {
  font-size: 12px;
  color: var(--text-muted);
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}
</style>
