<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { IonButton, IonContent, IonIcon, IonInput, IonPage, IonSelect, IonSelectOption, IonSpinner } from '@ionic/vue';
import { alertCircleOutline, businessOutline, checkmarkCircleOutline, chevronDownOutline } from 'ionicons/icons';
import { provider } from '../../providers';
import { ProviderNetworkError } from '../../providers/DataProvider';
import { useChantiersStore } from '../../stores/chantiers';
import { iconForProduct } from '../../utils/productIcons';
import AppHeader from '../../components/AppHeader.vue';
import DataState from '../../components/DataState.vue';
import type { Product } from '../../types/models';

const route = useRoute();
const chantiers = useChantiersStore();
const products = ref<Product[]>([]);
const quantities = ref<Record<number, string>>({}); // packagingId -> quantity (chaîne du champ, '' = non saisi)
const loading = ref(true);
const loadError = ref('');
const submitting = ref(false);
const submitError = ref('');
const done = ref(false);

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await chantiers.fetchMine();
    // Un chantier peut être imposé par l'écran appelant (détail de vacation) ;
    // sinon on garde celui déjà sélectionné dans l'app, ou le premier.
    const fromRoute = route.query.chantier ? Number(route.query.chantier) : null;
    if (fromRoute) chantiers.select(fromRoute);
    else if (!chantiers.selectedId && chantiers.list[0]) chantiers.select(chantiers.list[0].id);

    products.value = await provider.fetchProducts();
    await loadExisting();
  } catch (e) {
    loadError.value = (e instanceof Error && e.message) || 'Chargement impossible.';
  } finally {
    loading.value = false;
  }
}

// Préremplir avec le dernier inventaire connu : l'agent corrige ce qui a bougé
// plutôt que de ressaisir toute la liste à chaque passage.
async function loadExisting() {
  quantities.value = {};
  if (!chantiers.selectedId) return;
  const inventory = await provider.fetchInventoryLatest(chantiers.selectedId);
  if (!inventory) return;
  for (const item of inventory.items) {
    quantities.value[item.packaging_id] = String(item.quantity_remaining);
  }
}

onMounted(load);

watch(
  () => chantiers.selectedId,
  async () => {
    done.value = false;
    submitError.value = '';
    try {
      await loadExisting();
    } catch {
      quantities.value = {}; // repartir d'une saisie vierge plutôt que d'un mélange de deux sites
    }
  }
);

async function submit() {
  submitError.value = '';
  if (!chantiers.selectedId) {
    submitError.value = 'Aucun chantier sélectionné.';
    return;
  }
  const items = Object.entries(quantities.value)
    .filter(([, qty]) => qty !== '' && qty !== null && Number(qty) >= 0)
    .map(([packagingId, qty]) => {
      const product = products.value.find((p) =>
        p.packagings.some((pk) => pk.id === Number(packagingId))
      );
      return { productId: product?.id ?? 0, packagingId: Number(packagingId), quantityRemaining: Number(qty) };
    })
    .filter((item) => item.productId);

  if (!items.length) {
    submitError.value = 'Saisissez au moins une quantité avant de valider.';
    return;
  }

  submitting.value = true;
  try {
    await provider.submitInventory({ chantierId: chantiers.selectedId, items });
    done.value = true;
  } catch (e) {
    submitError.value = e instanceof ProviderNetworkError
      ? "Pas de connexion — l'inventaire n'a pas pu être envoyé."
      : (e instanceof Error && e.message) || "Envoi impossible.";
  } finally {
    submitting.value = false;
  }
}

function restart() {
  done.value = false;
  loadExisting().catch(() => {});
}

const filledCount = () =>
  Object.values(quantities.value).filter((q) => q !== '' && q !== null).length;
</script>

<template>
  <ion-page>
    <AppHeader title="Inventaire" />
    <ion-content>
      <div v-if="done" class="inv-done">
        <ion-icon :icon="checkmarkCircleOutline"></ion-icon>
        <p class="d-title">Inventaire enregistré</p>
        <p class="d-sub">Les niveaux de stock du site sont à jour.</p>
        <button type="button" class="d-again" @click="restart">Modifier la saisie</button>
      </div>

      <template v-else>
        <DataState :loading="loading" :error="loadError" :empty="!products.length" @retry="load">
          <template #empty>Aucun produit au catalogue.</template>

          <div class="site-select">
            <ion-icon :icon="businessOutline"></ion-icon>
            <ion-select v-model="chantiers.selectedId" interface="popover" aria-label="Chantier concerné">
              <ion-select-option v-for="c in chantiers.list" :key="c.id" :value="c.id">{{ c.name }}</ion-select-option>
            </ion-select>
            <ion-icon :icon="chevronDownOutline" class="chev"></ion-icon>
          </div>

          <p class="inv-hint">Indiquez ce qu'il reste sur place. Les valeurs du dernier inventaire sont préremplies.</p>

          <div class="inv-list">
            <div v-for="p in products" :key="p.id" class="inv-product">
              <div class="ip-head">
                <ion-icon :icon="iconForProduct(p)"></ion-icon>
                <span class="ip-name">{{ p.name }}</span>
              </div>
              <div v-for="pk in p.packagings" :key="pk.id" class="ip-row">
                <label :for="`pk-${pk.id}`">{{ pk.label }}</label>
                <ion-input
                  :id="`pk-${pk.id}`"
                  v-model="quantities[pk.id]"
                  type="number"
                  min="0"
                  inputmode="numeric"
                  fill="outline"
                  placeholder="—"
                ></ion-input>
              </div>
            </div>
          </div>

          <p v-if="submitError" class="inv-error"><ion-icon :icon="alertCircleOutline"></ion-icon> {{ submitError }}</p>

          <ion-button class="inv-submit" expand="block" :disabled="submitting" @click="submit">
            <ion-spinner v-if="submitting" name="crescent"></ion-spinner>
            <template v-else>Valider l'inventaire ({{ filledCount() }})</template>
          </ion-button>
        </DataState>
      </template>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.inv-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 18px 12px;
}

.inv-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 18px;
}

.inv-product {
  background: var(--surface-1);
  border-radius: 12px;
  padding: 12px 14px;
}

.ip-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.ip-head ion-icon {
  font-size: 17px;
  color: var(--text-secondary);
}

.ip-name {
  font-size: 13px;
  font-weight: 500;
}

.ip-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-top: 0.5px solid var(--border);
}

.ip-row label {
  font-size: 12px;
  color: var(--text-secondary);
}

.ip-row ion-input {
  width: 74px;
  --padding-start: 9px;
  --padding-end: 9px;
  --border-radius: 8px;
  --border-color: var(--border);
  --background: var(--surface-2);
  --color: var(--text-primary);
  text-align: right;
}

.inv-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 18px 0;
  font-size: 12px;
  color: var(--danger);
}

.inv-submit {
  margin: 14px 18px 8px;
  --border-radius: 12px;
  --background: var(--accent);
  --color: var(--on-accent);
  --box-shadow: none;
  font-size: 14px;
  font-weight: 500;
  text-transform: none;
}

.inv-done {
  padding: 56px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.inv-done ion-icon {
  font-size: 42px;
  color: var(--accent);
}

.d-title {
  font-size: 16px;
  font-weight: 500;
  margin: 8px 0 0;
}

.d-sub {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.d-again {
  margin-top: 16px;
  background: var(--surface-1);
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 13px;
  color: var(--text-primary);
}
</style>
