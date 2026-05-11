// apps/pos/src/stores/cartStore.ts
//
// Session 2 extension: lockedItemIds + canEdit guard + sendCurrentBatch helper.
// Session 3 extension: customerId + loyaltyPointsToRedeem + redemptionAmount.
// Session 4 extension: tableNumber + setTableNumber + restoreCart.
// Session 5 extension: pickedUpOrderId + setPickedUpOrderId (tablet pickup flow).
// Session 6 extension: cartDiscount + setCartDiscount + setLineDiscount.
// Session 7 extension: attachedCustomer includes optional category for pricing tier display.
// Session 9 extension: appliedPromotions + dismissedPromotionIds + auto gift sync.
// Persisted in sessionStorage so a tab reload doesn't drop the lock state.
// (`appliedPromotions` and `dismissedPromotionIds` are intentionally in-memory
//  only — they are recomputed at every cart change and a fresh tab should
//  start from a clean slate.)
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
  AppliedPromotion,
  Cart,
  CartItem,
  Customer,
  CustomerCategory,
  Discount,
  OrderType,
  Product,
  SelectedModifiers,
} from '@breakery/domain';

export type CustomerWithCategory = Customer & { category?: CustomerCategory | null };

/**
 * Stable id for a promotion-driven gift line. Deterministic per promotion id
 * so duplicate `setAppliedPromotions` calls (e.g. from React strict-mode
 * double-invoke) cannot insert two gift rows for the same promo.
 */
function makeGiftLineId(promotionId: string): string {
  return `gift-${promotionId}`;
}

interface CartState {
  cart: Cart;
  /** Line ids that have been "sent to kitchen" — read-only afterwards. */
  lockedItemIds: string[];
  /** Full customer object for display — mirrors cart.customerId. */
  attachedCustomer: CustomerWithCategory | null;
  /** Set when a tablet order is picked up; directs checkout to pay_existing_order RPC. */
  pickedUpOrderId: string | null;
  /**
   * Session 9 — currently applied promotions (latest evaluator output).
   * In-memory only ; the auto-eval orchestrator recomputes this on every
   * cart/customer/dismissal change.
   */
  appliedPromotions: AppliedPromotion[];
  /**
   * Session 9 — promotion ids the user has manually dismissed during this
   * cart session (typically free-gift lines they removed). Skipped by the
   * evaluator until the cart is cleared. Anti-loop guard for spec §7 risk
   * "Gift product retiré accidentellement".
   */
  dismissedPromotionIds: Set<string>;

  // Actions
  add: (product: Product, modifiers?: SelectedModifiers, unitPriceOverride?: number) => void;
  update: (lineId: string, quantity: number) => void;
  remove: (lineId: string) => void;
  clear: () => void;
  setOrderType: (type: OrderType) => void;

  // Table selection (session 4)
  setTableNumber: (name: string | null) => void;

  // Customer + loyalty
  attachCustomer: (customer: Customer | CustomerWithCategory) => void;
  detachCustomer: () => void;
  setRedeemPoints: (points: number) => void;
  redemptionAmount: () => number;

  // Locking
  canEdit: (lineId: string) => boolean;
  markLocked: (lineIds: string[]) => void;
  unlockedItems: () => CartItem[];
  unlockedItemIds: () => string[];

  /**
   * Session 10 — flip a locked item to cancelled state. Called after a
   * successful cancel-item EF round-trip; mirrors the server's is_cancelled flag
   * on the local CartItem so the cart panel renders strikethrough + CANCELLED
   * badge and excludes the line from totals (calculateTotals ignores cancelled).
   */
  markCancelled: (lineId: string) => void;

  // Held orders restore (session 4)
  restoreCart: (cart: Cart) => void;

  // Tablet pickup (session 5)
  setPickedUpOrderId: (id: string | null) => void;

  // Discounts (session 6)
  setCartDiscount: (d: Discount | null) => void;
  setLineDiscount: (itemId: string, d: Discount | null) => void;

  // Promotions (session 9)
  /**
   * Replace the current applied promotions and reconcile gift lines:
   * for each AppliedPromotion with `gift_to_add`, add a unit_price=0 cart
   * line if not already present ; for each existing gift line whose
   * promotion_id is not in `next`, remove it. Returns the diff so callers
   * can surface toasts ("Free X added" / "Free X removed").
   */
  setAppliedPromotions: (
    next: AppliedPromotion[],
    productLookup?: Record<string, { name: string }>,
  ) => { addedGifts: { name: string; promotion_id: string }[]; removedGifts: { name: string; promotion_id: string }[] };
  /**
   * Mark a promotion id as dismissed so the evaluator skips it. Called
   * automatically when the user removes a gift line via `remove()`.
   */
  dismissPromotion: (promotionId: string) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cart: { items: [], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),

      add: (product, modifiers = [], unitPriceOverride) =>
        set((s) => ({ cart: addItem(s.cart, product, modifiers, 1, unitPriceOverride) })),

      update: (id, qty) =>
        set((s) => {
          if (!get().canEdit(id)) return s; // no-op if locked
          return { cart: updateQuantity(s.cart, id, qty) };
        }),

      remove: (id) =>
        set((s) => {
          if (!get().canEdit(id)) return s; // no-op if locked
          // Session 9 — manual gift removal: dismiss the corresponding promo so
          // the next eval doesn't immediately re-add it (anti-loop). Also drop
          // the promo from `appliedPromotions` to keep the cart panel in sync
          // until the orchestrator's next debounced run.
          const removed = s.cart.items.find((i) => i.id === id);
          if (removed?.is_promo_gift && removed.promotion_id) {
            const next = new Set(s.dismissedPromotionIds);
            next.add(removed.promotion_id);
            return {
              cart: removeItem(s.cart, id),
              dismissedPromotionIds: next,
              appliedPromotions: s.appliedPromotions.filter(
                (ap) => ap.promotion_id !== removed.promotion_id,
              ),
            };
          }
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
          // Session 9 — wipe promotion state too so a fresh ring-up starts
          // clean (dismissals from a previous session shouldn't leak).
          appliedPromotions: [],
          dismissedPromotionIds: new Set<string>(),
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

      // Session 10 — mark a previously-locked item as cancelled (server side has
      // is_cancelled=true after cancel_order_item_rpc). The line stays in the
      // cart so it can render with a strikethrough + badge ; calculateTotals and
      // the checkout payload exclude is_cancelled lines.
      markCancelled: (lineId) =>
        set((s) => ({
          cart: {
            ...s.cart,
            items: s.cart.items.map((it) =>
              it.id === lineId ? { ...it, is_cancelled: true } : it,
            ),
          },
        })),

      restoreCart: (restoredCart) =>
        set((s) => ({
          cart: restoredCart,
          lockedItemIds: [],
          attachedCustomer: null,
          pickedUpOrderId: s.pickedUpOrderId,
          // Session 9 — restoring a held / picked-up order resets the
          // promotions slate ; the orchestrator will recompute on next mount.
          appliedPromotions: [],
          dismissedPromotionIds: new Set<string>(),
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

      // Session 9 — promotions
      setAppliedPromotions: (next, productLookup = {}) => {
        const addedGifts: { name: string; promotion_id: string }[] = [];
        const removedGifts: { name: string; promotion_id: string }[] = [];

        const state = get();
        const nextById = new Map(next.map((ap) => [ap.promotion_id, ap]));

        // Index existing gift lines by promotion_id for fast lookup.
        const existingGiftPromoIds = new Set<string>();
        for (const it of state.cart.items) {
          if (it.is_promo_gift && it.promotion_id) {
            existingGiftPromoIds.add(it.promotion_id);
          }
        }

        // 1. Drop gift lines whose promotion is no longer applied.
        let nextItems: CartItem[] = state.cart.items.filter((it) => {
          if (!it.is_promo_gift || !it.promotion_id) return true;
          const stillApplied = nextById.has(it.promotion_id);
          if (!stillApplied) {
            removedGifts.push({ name: it.name, promotion_id: it.promotion_id });
          }
          return stillApplied;
        });

        // 2. Add gift lines for newly-applied free_product promos.
        for (const ap of next) {
          if (!ap.gift_to_add) continue;
          if (existingGiftPromoIds.has(ap.promotion_id)) continue;
          const giftName = productLookup[ap.gift_to_add.product_id]?.name ?? ap.name;
          const giftLine: CartItem = {
            id: makeGiftLineId(ap.promotion_id),
            product_id: ap.gift_to_add.product_id,
            name: giftName,
            unit_price: 0,
            quantity: ap.gift_to_add.qty,
            modifiers: [],
            is_promo_gift: true,
            promotion_id: ap.promotion_id,
          };
          nextItems = [...nextItems, giftLine];
          addedGifts.push({ name: giftName, promotion_id: ap.promotion_id });
        }

        set({
          cart: { ...state.cart, items: nextItems },
          appliedPromotions: next,
        });
        return { addedGifts, removedGifts };
      },

      dismissPromotion: (promotionId) =>
        set((s) => {
          const next = new Set(s.dismissedPromotionIds);
          next.add(promotionId);
          return { dismissedPromotionIds: next };
        }),
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
      // Session 9 — wipe promotion state on checkout completion.
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
    };
  });
}
