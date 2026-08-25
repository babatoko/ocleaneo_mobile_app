import { defineStore } from 'pinia';

export interface CartItem {
  productId: number;
  productName: string;
  productEmoji?: string;
  packagingId: number;
  packagingLabel: string;
  quantity: number;
}

interface CartState {
  items: CartItem[];
}

export const useCartStore = defineStore('cart', {
  state: (): CartState => ({
    items: [],
  }),
  getters: {
    totalItems: (state): number => state.items.reduce((sum, i) => sum + i.quantity, 0),
  },
  actions: {
    addItem(item: CartItem): void {
      const existing = this.items.find(
        (i) => i.productId === item.productId && i.packagingId === item.packagingId
      );
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        this.items.push({ ...item });
      }
    },
    updateQuantity(productId: number, packagingId: number, quantity: number): void {
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
    removeItem(productId: number, packagingId: number): void {
      this.items = this.items.filter(
        (i) => !(i.productId === productId && i.packagingId === packagingId)
      );
    },
    clear(): void {
      this.items = [];
    },
  },
});
