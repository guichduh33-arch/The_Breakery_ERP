import { create } from 'zustand';
import {
  addItem as domainAddItem,
  removeItem as domainRemoveItem,
  updateQuantity as domainUpdateQuantity,
} from '@breakery/domain';
import type { CartItem, Product, SelectedModifiers } from '@breakery/domain';

export interface TabletCartState {
  items: CartItem[];
  tableNumber: string | null;
  orderType: 'dine_in' | 'take_out';
  addItem: (product: Product, modifiers?: SelectedModifiers) => void;
  updateQuantity: (itemId: string, qty: number) => void;
  removeItem: (itemId: string) => void;
  setTableNumber: (name: string | null) => void;
  setOrderType: (type: 'dine_in' | 'take_out') => void;
  clearCart: () => void;
}

export const useTabletCartStore = create<TabletCartState>()((set, get) => ({
  items: [],
  tableNumber: null,
  orderType: 'dine_in',

  addItem: (product, modifiers = []) => {
    const fakeCart = { items: get().items, order_type: get().orderType };
    const updated = domainAddItem(fakeCart, product, modifiers);
    set({ items: updated.items });
  },

  updateQuantity: (itemId, qty) => {
    const fakeCart = { items: get().items, order_type: get().orderType };
    const updated = domainUpdateQuantity(fakeCart, itemId, qty);
    set({ items: updated.items });
  },

  removeItem: (itemId) => {
    const fakeCart = { items: get().items, order_type: get().orderType };
    const updated = domainRemoveItem(fakeCart, itemId);
    set({ items: updated.items });
  },

  setTableNumber: (name) => set({ tableNumber: name }),

  setOrderType: (type) => set({ orderType: type }),

  clearCart: () => set({ items: [], tableNumber: null, orderType: 'dine_in' }),
}));
