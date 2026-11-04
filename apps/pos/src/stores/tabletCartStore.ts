import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  addComboItem as domainAddComboItem,
  addItem as domainAddItem,
  removeItem as domainRemoveItem,
  updateQuantity as domainUpdateQuantity,
} from '@breakery/domain';
import type { CartItem, ComboComponent, Product, SelectedModifiers, TabletCart } from '@breakery/domain';
import { emitPosEvent, type PosEventFields, type PosEventType } from '@/features/audit/emitPosEvent';

function emitTabletEvent(type: PosEventType, fields: PosEventFields = {}): void {
  const state = useTabletCartStore.getState();
  emitPosEvent(type, {
    order_id: state.appendToOrderId,
    order_number_snap: state.appendToOrderNumber,
    ...fields,
    payload: { surface: 'tablet', table_number: state.tableNumber, ...fields.payload },
  });
}

export interface TabletSendAttempt {
  clientUuid: string;
  waiterId: string;
  cart: TabletCart;
  appendToOrderId?: string;
  online: boolean;
}

export interface TabletCartState {
  pendingSend: TabletSendAttempt | null;
  beginSend: (waiterId: string, online: boolean) => TabletSendAttempt;
  releaseSend: () => void;
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
      pendingSend: null,
      beginSend: (waiterId, online) => {
        const current = get();
        if (current.pendingSend) {
          if (current.pendingSend.waiterId !== waiterId) throw new Error('pending_order_other_waiter');
          return current.pendingSend;
        }
        const attempt: TabletSendAttempt = {
          clientUuid: crypto.randomUUID(), waiterId, online,
          cart: JSON.parse(JSON.stringify({ items: current.items, tableNumber: current.tableNumber,
            orderType: current.orderType, notes: current.notes })) as TabletCart,
          ...(current.appendToOrderId ? { appendToOrderId: current.appendToOrderId } : {}),
        };
        set({ pendingSend: attempt });
        return attempt;
      },
      releaseSend: () => set({ pendingSend: null }),
      items: [],
      tableNumber: null,
      orderType: 'dine_in',
      notes: null,
      appendToOrderId: null,
      appendToOrderNumber: null,

      addItem: (product, modifiers = []) => {
        if (get().pendingSend) return;
        const wasEmpty = get().items.length === 0;
        const fakeCart = { items: get().items, order_type: get().orderType };
        const updated = domainAddItem(fakeCart, product, modifiers);
        set({ items: updated.items });
        if (wasEmpty) emitTabletEvent('order_opened', { payload: { order_type: get().orderType } });
        emitTabletEvent('item_added', { payload: { product_id: product.id, name: product.name } });
      },

      // Même journal durable que le panier caisse, avec la surface tablette.
      addCombo: (product, modifiers, components, unitPrice) => {
        if (get().pendingSend) return;
        const wasEmpty = get().items.length === 0;
        const fakeCart = { items: get().items, order_type: get().orderType };
        const updated = domainAddComboItem(fakeCart, product, modifiers, components, 1, unitPrice);
        set({ items: updated.items });
        if (wasEmpty) emitTabletEvent('order_opened', { payload: { order_type: get().orderType } });
        emitTabletEvent('item_added', { amount: unitPrice,
          payload: { product_id: product.id, name: product.name, combo: true } });
      },

      updateQuantity: (itemId, qty) => {
        if (get().pendingSend) return;
        const item = get().items.find((row) => row.id === itemId);
        if (!item || item.quantity === qty) return;
        const fakeCart = { items: get().items, order_type: get().orderType };
        const updated = domainUpdateQuantity(fakeCart, itemId, qty);
        set({ items: updated.items });
        emitTabletEvent(qty <= 0 ? 'item_removed_pre_fire' : 'item_qty_changed', {
          order_item_id: itemId, payload: { name: item.name, old_qty: item.quantity, qty },
        });
      },

      removeItem: (itemId) => {
        if (get().pendingSend) return;
        const item = get().items.find((row) => row.id === itemId);
        if (!item) return;
        const fakeCart = { items: get().items, order_type: get().orderType };
        const updated = domainRemoveItem(fakeCart, itemId);
        set({ items: updated.items });
        emitTabletEvent('item_removed_pre_fire', { order_item_id: itemId,
          payload: { product_id: item.product_id, name: item.name } });
      },

      setTableNumber: (name) => {
        if (get().pendingSend || get().tableNumber === name) return;
        const previous = get().tableNumber;
        set({ tableNumber: name });
        emitTabletEvent('table_assigned', { payload: { previous_table: previous } });
      },

      setOrderType: (type) => {
        if (get().pendingSend || get().orderType === type) return;
        const previous = get().orderType;
        set({ orderType: type });
        emitTabletEvent('order_type_changed', { payload: { old_type: previous, new_type: type } });
      },

      setNotes: (notes) => {
        if (get().pendingSend || get().notes === notes) return;
        set({ notes });
        emitTabletEvent('note_added', { payload: { notes } });
      },

      // Entrer en mode ajout REMET le panier à zéro : on compose la 2ᵉ tournée,
      // pas une copie de la première. La table vient de la commande visée pour
      // que l'en-tête et le KOT restent cohérents.
      setAppendTarget: (target) => {
        if (get().pendingSend) return;
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
        );
        if (target) emitTabletEvent('order_resumed', { payload: { mode: 'append' } });
      },

      clearCart: () =>
        set({
          pendingSend: null,
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
        pendingSend: state.pendingSend,
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
