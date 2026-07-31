import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
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
  /** Session 59 (17 D1.1) — order-level free-text note (allergy, "no gluten"...). */
  notes: string | null;
  addItem: (product: Product, modifiers?: SelectedModifiers) => void;
  updateQuantity: (itemId: string, qty: number) => void;
  removeItem: (itemId: string) => void;
  setTableNumber: (name: string | null) => void;
  setOrderType: (type: 'dine_in' | 'take_out') => void;
  setNotes: (notes: string | null) => void;
  clearCart: () => void;
}

// Le panier de salle survit à un remount / rechargement d'onglet : une tablette
// se met en veille ou recharge en plein service, et la commande en cours était
// jusqu'ici perdue — à ressaisir devant le client. Même véhicule que le panier
// caisse (`breakery.cart.v2`) : sessionStorage, pas localStorage — la commande
// d'hier ne doit surtout pas ressusciter au service suivant.
export const useTabletCartStore = create<TabletCartState>()(
  persist(
    (set, get) => ({
      items: [],
      tableNumber: null,
      orderType: 'dine_in',
      notes: null,

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

      setNotes: (notes) => set({ notes }),

      clearCart: () => set({ items: [], tableNumber: null, orderType: 'dine_in', notes: null }),
    }),
    {
      name: 'breakery.tablet-cart.v1',
      storage: createJSONStorage(() => sessionStorage),
      // Tout l'état est de la saisie en cours : il n'y a rien de dérivé ni de
      // volatile à exclure ici.
      partialize: (state) => ({
        items: state.items,
        tableNumber: state.tableNumber,
        orderType: state.orderType,
        notes: state.notes,
      }),
    },
  ),
);
