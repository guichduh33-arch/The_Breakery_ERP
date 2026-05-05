// apps/pos/src/stores/cartStore.ts
//
// Session 2 extension: lockedItemIds + canEdit guard + sendCurrentBatch helper.
// Session 3 extension: customerId + loyaltyPointsToRedeem + redemptionAmount.
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

  // Actions
  add: (product: Product, modifiers?: SelectedModifiers) => void;
  update: (lineId: string, quantity: number) => void;
  remove: (lineId: string) => void;
  clear: () => void;
  setOrderType: (type: OrderType) => void;

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
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cart: { items: [], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,

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
    }),
    {
      name: 'breakery.cart.v2',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        cart: state.cart,
        lockedItemIds: state.lockedItemIds,
        attachedCustomer: state.attachedCustomer,
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
    const { customerId: _c, loyaltyPointsToRedeem: _l, ...rest } = cleared;
    return { cart: rest, lockedItemIds: [], attachedCustomer: null };
  });
}
