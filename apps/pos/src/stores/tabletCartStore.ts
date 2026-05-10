// apps/pos/src/stores/tabletCartStore.ts
// Session 8 extension: appliedPromotion + previewItems (promotions engine live preview).
// Persisted in sessionStorage so a tab reload doesn't drop the cart state.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  addItem as domainAddItem,
  removeItem as domainRemoveItem,
  updateQuantity as domainUpdateQuantity,
} from '@breakery/domain';
import type { AppliedPromotion, CartItem, ItemToAdd, Product, SelectedModifiers } from '@breakery/domain';

export interface TabletCartState {
  items: CartItem[];
  tableNumber: string | null;
  orderType: 'dine_in' | 'take_out';
  // Promotions live preview (session 8)
  appliedPromotion: AppliedPromotion | null;
  previewItems: ItemToAdd[];
  addItem: (product: Product, modifiers?: SelectedModifiers) => void;
  updateQuantity: (itemId: string, qty: number) => void;
  removeItem: (itemId: string) => void;
  setTableNumber: (name: string | null) => void;
  setOrderType: (type: 'dine_in' | 'take_out') => void;
  clearCart: () => void;
  setAppliedPromotion: (p: AppliedPromotion | null) => void;
  setPreviewItems: (items: ItemToAdd[]) => void;
  clearPromotionPreview: () => void;
}

export const useTabletCartStore = create<TabletCartState>()(
  persist(
    (set, get) => ({
      items: [],
      tableNumber: null,
      orderType: 'dine_in',
      appliedPromotion: null,
      previewItems: [],

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

      clearCart: () =>
        set({ items: [], tableNumber: null, orderType: 'dine_in', appliedPromotion: null, previewItems: [] }),

      setAppliedPromotion: (p) => set({ appliedPromotion: p }),

      setPreviewItems: (items) => set({ previewItems: items }),

      clearPromotionPreview: () => set({ appliedPromotion: null, previewItems: [] }),
    }),
    {
      name: 'breakery.tablet-cart.v2',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        items: state.items,
        tableNumber: state.tableNumber,
        orderType: state.orderType,
      }),
    },
  ),
);
