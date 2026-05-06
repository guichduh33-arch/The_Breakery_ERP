// apps/pos/src/stores/cartStore.ts
//
// Session 2 extension: lockedItemIds + canEdit guard + sendCurrentBatch helper.
// Session 3 extension: customerId + loyaltyPointsToRedeem + redemptionAmount.
// Session 4 extension: tableNumber + setTableNumber + restoreCart.
// Session 5 extension: pickedUpOrderId + setPickedUpOrderId (tablet pickup flow).
// Session 6 extension: cartDiscount + setCartDiscount + setLineDiscount.
// Persisted in sessionStorage so a tab reload doesn't drop the lock state.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  addItem,
  removeItem,
  updateQuantity,
  clearCart,
  setOrderType,
  attachCustomer as domainAttachCustomer,
  detachCustomer as domainDetachCustomer,
  setRedeemPoints as domainSetRedeemPoints,
  pointsToValue,
} from '@breakery/domain';
import type {
  Cart,
  CartItem,
  Customer,
  Discount,
  OrderType,
  Product,
  SelectedModifiers,
} from '@breakery/domain';

interface CartState {
  cart: Cart;
  /** Line ids that have been "sent to kitchen" — read-only afterwards. */
  lockedItemIds: string[];
  /** Full customer object for display — mirrors cart.customerId. */
  attachedCustomer: Customer | null;
  /** Set when a tablet order is picked up; directs checkout to pay_existing_order RPC. */
  pickedUpOrderId: string | null;

  // Actions
  add: (product: Product, modifiers?: SelectedModifiers) => void;
  update: (lineId: string, quantity: number) => void;
  remove: (lineId: string) => void;
  clear: () => void;
  setOrderType: (type: OrderType) => void;

  // Table selection (session 4)
  setTableNumber: (name: string | null) => void;

  // Customer + loyalty
  attachCustomer: (customer: Customer) => void;
  detachCustomer: () => void;
  setRedeemPoints: (points: number) => void;
  redemptionAmount: () => number;

  // Locking
  canEdit: (lineId: string) => boolean;
  markLocked: (lineIds: string[]) => void;
  unlockedItems: () => CartItem[];
  unlockedItemIds: () => string[];

  // Held orders restore (session 4)
  restoreCart: (cart: Cart) => void;

  // Tablet pickup (session 5)
  setPickedUpOrderId: (id: string | null) => void;

  // Discounts (session 6)
  setCartDiscount: (d: Discount | null) => void;
  setLineDiscount: (itemId: string, d: Discount | null) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cart: { items: [], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,

      add: (product, modifiers = []) =>
        set((s) => ({ cart: addItem(s.cart, product, modifiers) })),

      update: (id, qty) =>
        set((s) => {
          if (!get().canEdit(id)) return s; // no-op if locked
          return { cart: updateQuantity(s.cart, id, qty) };
        }),

      remove: (id) =>
        set((s) => {
          if (!get().canEdit(id)) return s; // no-op if locked
          return { cart: removeItem(s.cart, id) };
        }),

      clear: () =>
        set((s) => ({
          // `Clear` only wipes unlocked items; locked items survive until
          // checkout completes. This matches K3 (incremental send) so that the
          // cashier can't accidentally drop already-sent items.
          cart: {
            ...s.cart,
            items: s.cart.items.filter((i) => s.lockedItemIds.includes(i.id)),
          },
        })),

      setOrderType: (type) => set((s) => ({ cart: setOrderType(s.cart, type) })),

      setTableNumber: (name) =>
        set((s) => {
          const { tableNumber: _t, ...rest } = s.cart;
          if (name) return { cart: { ...rest, tableNumber: name } };
          return { cart: rest };
        }),

      attachCustomer: (customer) =>
        set((s) => ({ cart: domainAttachCustomer(s.cart, customer.id), attachedCustomer: customer })),

      detachCustomer: () =>
        set((s) => ({ cart: domainDetachCustomer(s.cart), attachedCustomer: null })),

      setRedeemPoints: (points) =>
        set((s) => ({ cart: domainSetRedeemPoints(s.cart, points) })),

      redemptionAmount: () => pointsToValue(get().cart.loyaltyPointsToRedeem ?? 0),

      canEdit: (lineId) => !get().lockedItemIds.includes(lineId),

      markLocked: (lineIds) =>
        set((s) => ({
          lockedItemIds: Array.from(
            new Set([...s.lockedItemIds, ...lineIds]),
          ),
        })),

      unlockedItems: () => {
        const { cart, lockedItemIds } = get();
        return cart.items.filter((i) => !lockedItemIds.includes(i.id));
      },

      unlockedItemIds: () =>
        get()
          .cart.items.filter((i) => !get().lockedItemIds.includes(i.id))
          .map((i) => i.id),

      restoreCart: (restoredCart) =>
        set((s) => ({
          cart: restoredCart,
          lockedItemIds: [],
          attachedCustomer: null,
          pickedUpOrderId: s.pickedUpOrderId,
        })),

      setPickedUpOrderId: (id) => set({ pickedUpOrderId: id }),

      setCartDiscount: (d) =>
        set((s) => ({
          cart: d
            ? { ...s.cart, cartDiscount: d }
            : (() => { const { cartDiscount: _cd, ...rest } = s.cart; return rest; })(),
        })),

      setLineDiscount: (itemId, d) =>
        set((s) => ({
          cart: {
            ...s.cart,
            items: s.cart.items.map((item) => {
              if (item.id !== itemId) return item;
              if (d === null) {
                const { discount: _disc, ...rest } = item;
                return rest;
              }
              return { ...item, discount: d };
            }),
          },
        })),
    }),
    {
      name: 'breakery.cart.v2',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        cart: state.cart,
        lockedItemIds: state.lockedItemIds,
        attachedCustomer: state.attachedCustomer,
        pickedUpOrderId: state.pickedUpOrderId,
      }),
    },
  ),
);

/**
 * Reset the entire cart and lock state. Called by the payment flow once an
 * order has been completed successfully.
 */
export function resetCartAfterCheckout(): void {
  useCartStore.setState((s) => {
    const cleared = clearCart(s.cart);
    const { customerId: _c, loyaltyPointsToRedeem: _l, tableNumber: _t, cartDiscount: _cd, ...rest } = cleared;
    return {
      cart: { ...rest, items: rest.items.map(({ discount: _d, ...i }) => i) },
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
    };
  });
}
