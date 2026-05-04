// apps/pos/src/stores/cartStore.ts
import { create } from 'zustand';
import { addItem, removeItem, updateQuantity, clearCart, setOrderType } from '@breakery/domain';
import type { Cart, OrderType, Product } from '@breakery/domain';

interface CartState {
  cart: Cart;
  add: (product: Product) => void;
  update: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  setOrderType: (type: OrderType) => void;
}

export const useCartStore = create<CartState>((set) => ({
  cart: { items: [], order_type: 'dine_in' },
  add: (product) => set((s) => ({ cart: addItem(s.cart, product) })),
  update: (id, qty) => set((s) => ({ cart: updateQuantity(s.cart, id, qty) })),
  remove: (id) => set((s) => ({ cart: removeItem(s.cart, id) })),
  clear: () => set((s) => ({ cart: clearCart(s.cart) })),
  setOrderType: (type) => set((s) => ({ cart: setOrderType(s.cart, type) })),
}));
