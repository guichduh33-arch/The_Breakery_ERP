import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  addComboItem as domainAddComboItem,
  addItem as domainAddItem,
  removeItem as domainRemoveItem,
  updateQuantity as domainUpdateQuantity,
} from '@breakery/domain';
import type { CartItem, ComboComponent, Product, SelectedModifiers } from '@breakery/domain';

export interface TabletCartState {
  items: CartItem[];
  tableNumber: string | null;
  orderType: 'dine_in' | 'take_out';
  /** Session 59 (17 D1.1) — order-level free-text note (allergy, "no gluten"...). */
  notes: string | null;
  /**
   * Mode AJOUT (2026-08-01) — commande de salle que ce panier vient compléter.
   * `null` = commande neuve. Quand il est posé, la table et le type viennent de
   * la commande visée : on ne les redemande pas, et le serveur ne les relit pas.
   */
  appendToOrderId: string | null;
  /** Numéro affichable de cette commande (#0042) — bandeau de mode ajout. */
  appendToOrderNumber: string | null;
  addItem: (product: Product, modifiers?: SelectedModifiers) => void;
  /**
   * Lot D (2026-09-05) — ajoute une ligne combo CONFIGURÉE, miroir de
   * `cartStore.addCombo` côté comptoir. La ligne porte toujours
   * `product_type: 'combo'` et la composition choisie (`components`), que le
   * serveur relit pour résoudre le prix et déduire le stock des composants.
   * `unitPrice` est le prix émis par `ComboConfigModal` (base_price ; les
   * surcharges voyagent dans `modifiers`).
   */
  addCombo: (
    product: Product,
    modifiers: SelectedModifiers,
    components: ComboComponent[],
    unitPrice: number,
  ) => void;
  updateQuantity: (itemId: string, qty: number) => void;
  removeItem: (itemId: string) => void;
  setTableNumber: (name: string | null) => void;
  setOrderType: (type: 'dine_in' | 'take_out') => void;
  setNotes: (notes: string | null) => void;
  /** Entre en mode ajout sur une commande, ou en sort (null). */
  setAppendTarget: (target: { id: string; orderNumber: string; tableNumber: string | null } | null) => void;
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
      appendToOrderId: null,
      appendToOrderNumber: null,

      addItem: (product, modifiers = []) => {
        const fakeCart = { items: get().items, order_type: get().orderType };
        const updated = domainAddItem(fakeCart, product, modifiers);
        set({ items: updated.items });
      },

      // Lot D (2026-09-05) — même « fakeCart » que `addItem`. Ce store n'émet
      // aucun événement POS (contrairement au panier caisse) : rien à ajouter ici.
      addCombo: (product, modifiers, components, unitPrice) => {
        const fakeCart = { items: get().items, order_type: get().orderType };
        const updated = domainAddComboItem(fakeCart, product, modifiers, components, 1, unitPrice);
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

      // Entrer en mode ajout REMET le panier à zéro : on compose la 2ᵉ tournée,
      // pas une copie de la première. La table vient de la commande visée pour
      // que l'en-tête et le KOT restent cohérents.
      setAppendTarget: (target) =>
        set(
          target === null
            ? { appendToOrderId: null, appendToOrderNumber: null }
            : {
                items: [],
                notes: null,
                appendToOrderId: target.id,
                appendToOrderNumber: target.orderNumber,
                tableNumber: target.tableNumber,
                orderType: 'dine_in',
              },
        ),

      clearCart: () =>
        set({
          items: [],
          tableNumber: null,
          orderType: 'dine_in',
          notes: null,
          appendToOrderId: null,
          appendToOrderNumber: null,
        }),
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
        // La cible d'ajout survit au rechargement comme le reste de la saisie :
        // sans elle, un panier repris après un reload repartirait en commande
        // NEUVE et la table recevrait deux additions.
        appendToOrderId: state.appendToOrderId,
        appendToOrderNumber: state.appendToOrderNumber,
      }),
    },
  ),
);
