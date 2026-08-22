import { defineStore } from 'pinia';

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: [], // { productId, productName, productEmoji, packagingId, packagingLabel, quantity }
  }),
  getters: {
    totalItems: (state) => state.items.reduce((sum, i) => sum + i.quantity, 0),
  },
  actions: {
    addItem(item) {
      const existing = this.items.find(
        (i) => i.productId === item.productId && i.packagingId === item.packagingId
      );
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        this.items.push({ ...item });
      }
    },
    updateQuantity(productId, packagingId, quantity) {
      const item = this.items.find(
        (i) => i.productId === productId && i.packagingId === packagingId
      );
      if (!item) return;
      if (quantity <= 0) {
        this.removeItem(productId, packagingId);
      } else {
        item.quantity = quantity;
      }
    },
    removeItem(productId, packagingId) {
      this.items = this.items.filter(
        (i) => !(i.productId === productId && i.packagingId === packagingId)
      );
    },
    clear() {
      this.items = [];
    },
  },
});
