<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
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
    error.value = e.message || 'Erreur lors de la commande';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AppHeader title="Panier" />
  <div class="cart">
    <div v-for="item in cart.items" :key="item.productId + '-' + item.packagingId" class="row">
      <div>
        <strong>{{ item.productEmoji }} {{ item.productName }}</strong>
        <span>{{ item.packagingLabel }}</span>
      </div>
      <QuantityStepper
        :model-value="item.quantity"
        :min="1"
        @update:model-value="(q) => cart.updateQuantity(item.productId, item.packagingId, q)"
      />
    </div>
    <p v-if="!cart.items.length" class="empty">Votre panier est vide.</p>

    <button v-if="cart.items.length" class="submit" :disabled="submitting" @click="submit">
      {{ submitting ? 'Envoi…' : 'Valider la commande' }}
    </button>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.cart {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
}

.row div {
  display: flex;
  flex-direction: column;
}

.row span {
  color: var(--text-muted);
  font-size: 12px;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}

.submit {
  padding: 14px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: var(--on-accent);
  font-weight: 600;
}

.error {
  color: var(--danger);
}
</style>
