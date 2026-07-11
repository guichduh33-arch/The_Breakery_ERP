// apps/pos/src/stores/cartStore.ts
//
// Session 2 extension: lockedItemIds + canEdit guard + sendCurrentBatch helper.
// Session 3 extension: customerId + loyaltyPointsToRedeem + redemptionAmount.
// Session 4 extension: tableNumber + setTableNumber + restoreCart.
// Session 5 extension: pickedUpOrderId + setPickedUpOrderId (tablet pickup flow).
// Session 6 extension: cartDiscount + setCartDiscount + setLineDiscount.
// Session 7 extension: attachedCustomer includes optional category for pricing tier display.
// Session 9 extension: appliedPromotions + dismissedPromotionIds + auto gift sync.
// Session 34 extension: printedItemIds + markPrinted + unprintedItems/unprintedItemIds (ticket de-dup).
// Persisted in sessionStorage so a tab reload doesn't drop the lock state.
// (`appliedPromotions` and `dismissedPromotionIds` are intentionally in-memory
//  only — they are recomputed at every cart change and a fresh tab should
//  start from a clean slate.)
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  addItem,
  addComboItem,
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
import { usePosSettingsStore } from './posSettingsStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';

export type CustomerWithCategory = Customer & { category?: CustomerCategory | null };

export interface ReopenOrderItem {
  id: string;
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  modifiers: unknown;
  is_locked: boolean;
  kitchen_status: string | null;
}
export interface ReopenOrderPayload {
  order_id: string;
  order_type: string;
  customerId: string | null;
  tableNumber: string | null;
  notes: string | null;
  items: ReopenOrderItem[];
}

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
  /** Line ids whose ticket has already been printed — prevents re-printing on reconnect / re-render. */
  printedItemIds: string[];
  /** Full customer object for display — mirrors cart.customerId. */
  attachedCustomer: CustomerWithCategory | null;
  /** Set when a tablet order is picked up; directs checkout to pay_existing_order RPC. */
  pickedUpOrderId: string | null;
  /**
   * Session 13 / Phase 4.A — true when the device has lost network. Drives
   * read-only graceful degradation in the UI (browse cached products,
   * disable order completion). Updated via {@link initNetworkListener}.
   */
  isOffline: boolean;
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
  /**
   * Session 47 — add a configured combo line. Unlike `add`, this always
   * creates a combo cart line carrying the cashier's chosen `components`
   * (for server-side stock deduction) and the resolved `modifiers` snapshot
   * (for cart-line display). `unitPrice` is the configured price emitted by
   * `ComboConfigModal` (base_price; surcharges ride in `modifiers`).
   */
  addCombo: (
    product: Product,
    modifiers: SelectedModifiers,
    components: { product_id: string; quantity: number }[],
    unitPrice: number,
  ) => void;
  update: (lineId: string, quantity: number) => void;
  remove: (lineId: string) => void;
  /**
   * Cart redesign v2 — re-insert a line that was just removed, at its former
   * index. Backs the 5s "undo" toast on the delete gesture (no blocking
   * confirm on a frequent action). No-op if a line with the same id already
   * exists (double-undo / race safety).
   */
  restoreLine: (item: CartItem, index: number) => void;
  clear: () => void;
  /**
   * Session 36 — full order void. Unlike {@link clear} (which keeps locked /
   * already-sent lines), this wipes EVERY line including those fired to the
   * kitchen, plus all per-order transient state (locks, print flags, promos,
   * cart discount, redemption). Used by the bottom-bar "Void Order" action,
   * which gates this behind a manager PIN once anything has been sent.
   */
  voidOrder: () => void;
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

  // Print tracking
  markPrinted: (lineIds: string[]) => void;
  unprintedItems: () => CartItem[];
  unprintedItemIds: () => string[];

  /**
   * Session 10 — flip a locked item to cancelled state. Called after a
   * successful cancel-item EF round-trip; mirrors the server's is_cancelled flag
   * on the local CartItem so the cart panel renders strikethrough + CANCELLED
   * badge and excludes the line from totals (calculateTotals ignores cancelled).
   */
  markCancelled: (lineId: string) => void;

  // Held orders restore (session 4)
  restoreCart: (cart: Cart) => void;

  /**
   * Spec A (held-order lifecycle) — rehydrate a REOPENED fired order. Unlike
   * `restoreCart` (draft, fresh ids, no locks), this reuses each
   * `order_items.id` as the cart line id and pushes already-fired
   * (`is_locked`) lines into BOTH `lockedItemIds` (non-editable, excluded from
   * the next fire's RPC) AND `printedItemIds` (never reprinted). Sets
   * `pickedUpOrderId` so the next fire appends and checkout pays the existing
   * order.
   */
  reopenOrder: (payload: ReopenOrderPayload) => void;

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

  /**
   * Session 13 / Phase 4.A — toggle the offline flag explicitly. Used by
   * {@link initNetworkListener} when `online`/`offline` events fire, and by
   * tests that simulate split-network conditions.
   */
  setOffline: (offline: boolean) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      // Session 43 / P2-6 — default order type is take_out (counter bakery
      // flow ; D9, owner to ratify). Resets (clear/voidOrder/checkout) keep the
      // current order_type via spread, so this is the only default site.
      // Audit 2026-06-25 — the literal is now the per-terminal Behavior setting
      // (posSettingsStore.defaultOrderType): a fresh tab/session boots into the
      // configured default. localStorage is hydrated synchronously, so the
      // getState() read here resolves to the persisted value at store creation.
      cart: { items: [], order_type: usePosSettingsStore.getState().defaultOrderType },
      lockedItemIds: [],
      printedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
      // Initialise pessimistically from navigator.onLine when available so
      // the first render reflects the real state even if the listener hasn't
      // been wired up yet. Default to `false` in non-browser test envs.
      isOffline:
        typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
          ? !navigator.onLine
          : false,

      add: (product, modifiers = [], unitPriceOverride) => {
        // S72 audit — a fresh cart's first line is the operational start of a
        // ticket. Detected BEFORE the set so an empty→non-empty transition maps
        // to order_opened exactly once.
        const wasEmpty = get().cart.items.length === 0;
        set((s) => {
          // Offline guard — pre-checkout edits are allowed (the cart is local
          // state and we want the cashier to keep ringing items up) but the
          // payment flow will block. This keeps the UX consistent with the
          // CLAUDE.md "read-only graceful degradation" rule : you can BROWSE
          // and BUILD a cart offline, but you cannot complete an order until
          // connectivity is back. We do NOT short-circuit add() here ; the
          // ProcessPayment button reads `isOffline` and disables itself.
          return { cart: addItem(s.cart, product, modifiers, 1, unitPriceOverride) };
        });
        if (wasEmpty) emitPosEvent('order_opened', { payload: { order_type: get().cart.order_type } });
        emitPosEvent('item_added', { payload: { product_id: product.id, name: product.name } });
      },

      // Session 47 — add a configured combo line after ComboConfigModal confirms.
      addCombo: (product, modifiers, components, unitPrice) => {
        const wasEmpty = get().cart.items.length === 0;
        set((s) => ({ cart: addComboItem(s.cart, product, modifiers, components, 1, unitPrice) }));
        if (wasEmpty) emitPosEvent('order_opened', { payload: { order_type: get().cart.order_type } });
        emitPosEvent('item_added', {
          amount: unitPrice,
          payload: { product_id: product.id, name: product.name, combo: true },
        });
      },

      update: (id, qty) => {
        if (!get().canEdit(id)) return; // no-op if locked — no state change, no event
        set((s) => ({ cart: updateQuantity(s.cart, id, qty) }));
        emitPosEvent('item_qty_changed', { order_item_id: id, payload: { qty } });
      },

      remove: (id) => {
        if (!get().canEdit(id)) return; // no-op if locked — no state change, no event
        const removedItem = get().cart.items.find((i) => i.id === id);
        set((s) => {
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
        });
        // S72 audit — a pre-fire line removal (remove() only touches editable,
        // i.e. un-fired lines; post-fire voids go through markCancelled).
        emitPosEvent('item_removed_pre_fire', {
          order_item_id: id,
          ...(removedItem ? { payload: { product_id: removedItem.product_id, name: removedItem.name } } : {}),
        });
      },

      restoreLine: (item, index) =>
        set((s) => {
          if (s.cart.items.some((i) => i.id === item.id)) return s; // already back
          const items = [...s.cart.items];
          const at = Math.max(0, Math.min(index, items.length));
          items.splice(at, 0, item);
          return { cart: { ...s.cart, items } };
        }),

      clear: () =>
        set((s) => {
          // `Clear` only wipes unlocked items; locked items survive until
          // checkout completes. This matches K3 (incremental send) so that the
          // cashier can't accidentally drop already-sent items.
          const lockedItems = s.cart.items.filter((i) => s.lockedItemIds.includes(i.id));
          const hasLocked = lockedItems.length > 0;
          // S44 P1-B — without any in-flight fired line, the client/table context
          // must leave with the cart. Otherwise the NEXT sale credits points and
          // category pricing to the previous customer (Hold → "empty" cart → sale).
          // With locked lines (same fired order still in flight), keep the context.
          const { customerId: _c, tableNumber: _t, ...restCart } = s.cart;
          return {
            cart: { ...(hasLocked ? s.cart : restCart), items: lockedItems },
            // Session 9 — wipe promotion state too so a fresh ring-up starts clean.
            appliedPromotions: [],
            dismissedPromotionIds: new Set<string>(),
            // Session 34 — keep print status only for surviving (locked) items.
            printedItemIds: s.printedItemIds.filter((id) => s.lockedItemIds.includes(id)),
            ...(hasLocked ? {} : { attachedCustomer: null }),
          };
        }),

      voidOrder: () =>
        set((s) => {
          // Drop order-specific monetary state ; keep order_type / customer /
          // table so the cashier can immediately re-ring if needed.
          const { cartDiscount: _cd, loyaltyPointsToRedeem: _l, ...rest } = s.cart;
          return {
            cart: { ...rest, items: [] },
            lockedItemIds: [],
            printedItemIds: [],
            appliedPromotions: [],
            dismissedPromotionIds: new Set<string>(),
            // S44 P1-A — a void of a FIRED order must not leave the next cart
            // routing append/pay to the voided order (P0002 loop, persisted in
            // sessionStorage → reload inoperant). The DB order is gone.
            pickedUpOrderId: null,
          };
        }),

      setOrderType: (type) => {
        const prev = get().cart.order_type;
        set((s) => ({ cart: setOrderType(s.cart, type) }));
        if (prev !== type) emitPosEvent('order_type_changed', { payload: { from: prev, to: type } });
      },

      setTableNumber: (name) => {
        const prev = get().cart.tableNumber ?? null;
        set((s) => {
          const { tableNumber: _t, ...rest } = s.cart;
          if (name) return { cart: { ...rest, tableNumber: name } };
          return { cart: rest };
        });
        // S72 audit — table assignment / reassignment / clear on the ticket.
        if (prev !== (name ?? null)) {
          emitPosEvent('table_assigned', { payload: { from: prev, to: name ?? null } });
        }
      },

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

      // Session 34 — print tracking
      markPrinted: (lineIds) =>
        set((s) => ({
          printedItemIds: Array.from(
            new Set([...s.printedItemIds, ...lineIds]),
          ),
        })),

      unprintedItems: () => {
        const { cart, printedItemIds } = get();
        return cart.items.filter((i) => !i.is_cancelled && !printedItemIds.includes(i.id));
      },

      unprintedItemIds: () =>
        get()
          .cart.items.filter((i) => !get().printedItemIds.includes(i.id))
          .map((i) => i.id),

      // Session 10 — mark a previously-locked item as cancelled (server side has
      // is_cancelled=true after cancel_order_item_rpc). The line stays in the
      // cart so it can render with a strikethrough + badge ; calculateTotals and
      // the checkout payload exclude is_cancelled lines.
      markCancelled: (lineId) => {
        const cancelled = get().cart.items.find((i) => i.id === lineId);
        set((s) => ({
          cart: {
            ...s.cart,
            items: s.cart.items.map((it) =>
              it.id === lineId ? { ...it, is_cancelled: true } : it,
            ),
          },
        }));
        // S72 audit — a fired line voided after it reached the kitchen (mirrors
        // the server's cancel_order_item_rpc round-trip that precedes this).
        emitPosEvent('item_voided_post_fire', {
          order_item_id: lineId,
          ...(cancelled ? { payload: { product_id: cancelled.product_id, name: cancelled.name } } : {}),
        });
      },

      restoreCart: (restoredCart) =>
        set((s) => ({
          cart: restoredCart,
          lockedItemIds: [],
          printedItemIds: [],
          attachedCustomer: null,
          pickedUpOrderId: s.pickedUpOrderId,
          // Session 9 — restoring a held / picked-up order resets the
          // promotions slate ; the orchestrator will recompute on next mount.
          appliedPromotions: [],
          dismissedPromotionIds: new Set<string>(),
        })),

      reopenOrder: (payload) =>
        set(() => {
          const items: CartItem[] = payload.items.map((it) => ({
            id: it.id,
            product_id: it.product_id,
            name: it.name,
            unit_price: it.unit_price,
            quantity: it.quantity,
            modifiers: (it.modifiers ?? []) as SelectedModifiers,
          }));
          const lockedIds = payload.items.filter((it) => it.is_locked).map((it) => it.id);

          const cart: Cart = { items, order_type: payload.order_type as OrderType };
          if (payload.customerId !== null) cart.customerId = payload.customerId;
          if (payload.tableNumber !== null) cart.tableNumber = payload.tableNumber;

          return {
            cart,
            // Locked = already fired → non-editable AND non-reprinted.
            lockedItemIds: lockedIds,
            printedItemIds: lockedIds,
            attachedCustomer: null,
            pickedUpOrderId: payload.order_id,
            appliedPromotions: [],
            dismissedPromotionIds: new Set<string>(),
          };
        }),

      setPickedUpOrderId: (id) => set({ pickedUpOrderId: id }),

      setCartDiscount: (d) => {
        set((s) => ({
          cart: d
            ? { ...s.cart, cartDiscount: d }
            : (() => { const { cartDiscount: _cd, ...rest } = s.cart; return rest; })(),
        }));
        // S72 audit — order-level discount applied / removed (fraud signal:
        // unauthorized or repeated discounting).
        emitPosEvent(d ? 'discount_applied' : 'discount_removed', {
          ...(d ? { amount: d.amount, reason: d.authorized_by ? 'authorized' : null } : {}),
          payload: { scope: 'order' },
        });
      },

      setLineDiscount: (itemId, d) => {
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
        }));
        emitPosEvent(d ? 'discount_applied' : 'discount_removed', {
          order_item_id: itemId,
          ...(d ? { amount: d.amount, reason: d.authorized_by ? 'authorized' : null } : {}),
          payload: { scope: 'line' },
        });
      },

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

        // Session 36 / Bug 1 fix — idempotent reconcile. When no gift line was
        // added or removed, `nextItems` is content-identical to the current
        // cart (only a fresh array instance). Preserve the EXISTING `cart`
        // reference in that case so `usePromotionsAutoEval` (whose effect
        // depends on `cart`) does NOT re-fire and re-call `evaluate_promotions_v2`
        // on a 200ms loop. `appliedPromotions` is not in that effect's deps, so
        // refreshing it is safe and keeps the totals display in sync.
        const giftsChanged = addedGifts.length > 0 || removedGifts.length > 0;
        set({
          cart: giftsChanged ? { ...state.cart, items: nextItems } : state.cart,
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

      setOffline: (offline) => set({ isOffline: offline }),
    }),
    {
      name: 'breakery.cart.v2',
      storage: createJSONStorage(() => sessionStorage),
      // We persist `cart` + lock state + customer + pickup so a StrictMode
      // double-mount / tab reload / realtime reconnect doesn't drop pending
      // edits. `isOffline` is intentionally NOT persisted — it is recomputed
      // from `navigator.onLine` on rehydrate (and live-updated by the listener).
      partialize: (state) => ({
        cart: state.cart,
        lockedItemIds: state.lockedItemIds,
        printedItemIds: state.printedItemIds,
        attachedCustomer: state.attachedCustomer,
        pickedUpOrderId: state.pickedUpOrderId,
      }),
    },
  ),
);

/**
 * Wire `window.online` / `window.offline` listeners onto the cart store so the
 * `isOffline` flag tracks connectivity. Returns a cleanup function — callers
 * should invoke it on unmount (typically wired once at the app root).
 *
 * Safe to call in non-browser envs (no-op) ; safe to call multiple times — the
 * cleanup returned by the latest call should be used to detach.
 */
export function initNetworkListener(): () => void {
  if (typeof window === 'undefined') return () => { /* no-op cleanup */ };
  const onOnline = (): void => useCartStore.getState().setOffline(false);
  const onOffline = (): void => useCartStore.getState().setOffline(true);
  // Sync immediately in case the page loaded while offline.
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    useCartStore.getState().setOffline(!navigator.onLine);
  }
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

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
      printedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      // Session 9 — wipe promotion state on checkout completion.
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
    };
  });
}
