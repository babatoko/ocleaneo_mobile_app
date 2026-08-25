<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonButton, IonContent, IonItem, IonLabel, IonList, IonNote, IonPage, IonSpinner } from '@ionic/vue';
import { provider } from '../../providers';
import { useCartStore } from '../../stores/cart';
import { useChantiersStore } from '../../stores/chantiers';
import AppHeader from '../../components/AppHeader.vue';
import QuantityStepper from '../../components/QuantityStepper.vue';

const cart = useCartStore();
const chantiers = useChantiersStore();
const router = useRouter();
const submitting = ref(false);
const error = ref('');

async function submit() {
  error.value = '';
  if (!chantiers.selectedId) {
    error.value = 'Aucun chantier sélectionné.';
    return;
  }
  submitting.value = true;
  try {
    const { id } = await provider.createOrder({
      chantierId: chantiers.selectedId,
      items: cart.items.map((i) => ({
        productId: i.productId,
        packagingId: i.packagingId,
        quantity: i.quantity,
      })),
    });
    cart.clear();
    router.replace(`/commande/${id}/recap`);
  } catch (e) {
    error.value = (e instanceof Error && e.message) || 'Erreur lors de la commande';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ion-page>
    <AppHeader title="Panier" />
    <ion-content>
      <div class="cart">
        <ion-list v-if="cart.items.length" lines="none">
          <ion-item v-for="item in cart.items" :key="item.productId + '-' + item.packagingId" class="row">
            <ion-label>
              <strong>{{ item.productEmoji }} {{ item.productName }}</strong>
              <ion-note>{{ item.packagingLabel }}</ion-note>
            </ion-label>
            <QuantityStepper
              slot="end"
              :model-value="item.quantity"
              :min="1"
              :label="item.productName"
              @update:model-value="(q) => cart.updateQuantity(item.productId, item.packagingId, q)"
            />
          </ion-item>
        </ion-list>
        <p v-if="!cart.items.length" class="empty">Votre panier est vide.</p>

        <ion-button v-if="cart.items.length" class="submit" expand="block" :disabled="submitting" @click="submit">
          <ion-spinner v-if="submitting" name="crescent"></ion-spinner>
          <template v-else>Valider la commande</template>
        </ion-button>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.cart {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row {
  --background: var(--surface);
  --padding-start: 16px;
  --inner-padding-end: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 10px;
  overflow: hidden;
}

.row ion-note {
  display: block;
  font-size: 12px;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}

.submit {
  --border-radius: 8px;
  --background: var(--primary);
  --color: var(--on-accent);
  --box-shadow: none;
  font-weight: 600;
  text-transform: none;
  margin: 0;
}

.error {
  color: var(--danger);
}
</style>
