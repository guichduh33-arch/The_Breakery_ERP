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
  calculateTotals,
} from '@breakery/domain';
import { reconcileOrderItems, snapshotCart } from './orderSnapshot';
import { usePosSettingsStore } from './posSettingsStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';

import type { CartState } from './cartTypes';
export type { CartState, CustomerWithCategory, ReopenOrderItem, ReopenOrderPayload } from './cartTypes';
import { reconcilePromotions } from './cartPromotions';
import { guardCartActions, isCartPaymentLocked } from './cartPaymentGuard';

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => guardCartActions({
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
      orderNumber: null,
      orderSnapshotVersion: 0,
      orderOrigin: null,
      offlineOrder: null,
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
          return { cart: addItem(s.cart, product, modifiers, 1, unitPriceOverride, [...s.lockedItemIds, ...s.printedItemIds]) };
        });
        if (wasEmpty) emitPosEvent('order_opened', { payload: { order_type: get().cart.order_type } });
        emitPosEvent('item_added', { payload: { product_id: product.id, name: product.name } });
      },

      // Session 47 — add a configured combo line after ComboConfigModal confirms.
      addCombo: (product, modifiers, components, unitPrice) => {
        const wasEmpty = get().cart.items.length === 0;
        set((s) => ({ cart: addComboItem(s.cart, product, modifiers, components, 1, unitPrice, [...s.lockedItemIds, ...s.printedItemIds]) }));
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
            const nextApplied = s.appliedPromotions.filter(
              (ap) => ap.promotion_id !== removed.promotion_id,
            );
            // ADR-013 D11 — recompute synchrone : `promotionTotal` doit suivre
            // `appliedPromotions` dans le même set (pas de fenêtre où le total
            // affiché porte encore la promo retirée, l'éval débouncée arrive
            // 200ms+RPC plus tard). Même clamp aux items que setAppliedPromotions.
            const cartAfterRemove = removeItem(s.cart, id);
            const remainingItemsTotal = calculateTotals(
              { items: cartAfterRemove.items, order_type: cartAfterRemove.order_type },
              0,
            ).subtotal;
            return {
              cart: {
                ...cartAfterRemove,
                promotionTotal: Math.min(
                  nextApplied.reduce((sum, ap) => sum + ap.amount, 0),
                  remainingItemsTotal,
                ),
              },
              dismissedPromotionIds: next,
              appliedPromotions: nextApplied,
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
          // ADR-013 D11 — `promotionTotal` suit `appliedPromotions` (vidé ici).
          const { promotionTotal: _pt, ...cartNoPromo } = s.cart;
          const { customerId: _c, tableNumber: _t, ...restCart } = cartNoPromo;
          return {
            cart: { ...(hasLocked ? cartNoPromo : restCart), items: lockedItems },
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
          // ADR-013 D11 — `promotionTotal` est monétaire, il part aussi.
          const { cartDiscount: _cd, loyaltyPointsToRedeem: _l, promotionTotal: _pt, ...rest } = s.cart;
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
      orderNumber: null,
      orderOrigin: null,
            // Lot 4 — void d'une commande locale offline : purge aussi ses
            // intents de l'outbox (rien ne doit être rejoué en DB). Le ticket
            // KDS déjà affiché reste (pas de topic cancel en lot 4).
            offlineOrder: (() => {
              const root = s.offlineOrder?.clientUuid;
              if (root !== undefined) {
                void import('@/features/lan/offlineOutbox')
                  .then((m) => m.removeIntentsByRoot(root))
                  .catch(() => undefined);
              }
              return null;
            })(),
          };
        }),

      setOrderType: (type) => {
        const prev = get().cart.order_type;
        const prevTable = get().cart.tableNumber ?? null;
        set((s) => {
          // Bug 2026-08-25 — invariant table ⇔ dine_in : une table attachée à un
          // panier take-out/delivery produisait une commande payée « take away »
          // avec numéro de table (chip table invisible hors dine-in).
          const next = setOrderType(s.cart, type);
          if (type === 'dine_in') return { cart: next };
          const { tableNumber: _t, ...rest } = next;
          return { cart: rest };
        });
        if (prev !== type) emitPosEvent('order_type_changed', { payload: { from: prev, to: type } });
        if (type !== 'dine_in' && prevTable !== null) {
          emitPosEvent('table_assigned', { payload: { from: prevTable, to: null } });
        }
      },

      setTableNumber: (name) => {
        const prev = get().cart.tableNumber ?? null;
        const prevType = get().cart.order_type;
        set((s) => {
          const { tableNumber: _t, ...rest } = s.cart;
          // Invariant table ⇔ dine_in (bug 2026-08-25) : poser une table depuis
          // le plan de salle engage un service à table — le type suit.
          if (name) return { cart: { ...rest, tableNumber: name, order_type: 'dine_in' } };
          return { cart: rest };
        });
        // S72 audit — table assignment / reassignment / clear on the ticket.
        if (prev !== (name ?? null)) {
          emitPosEvent('table_assigned', { payload: { from: prev, to: name ?? null } });
        }
        if (name && prevType !== 'dine_in') {
          emitPosEvent('order_type_changed', { payload: { from: prevType, to: 'dine_in' } });
        }
      },

      attachCustomer: (customer) =>
        set((s) => ({ cart: domainAttachCustomer(s.cart, customer.id), attachedCustomer: customer })),

      detachCustomer: () =>
        set((s) => ({ cart: domainDetachCustomer(s.cart), attachedCustomer: null })),

      setRedeemPoints: (points) =>
        set((s) => ({ cart: domainSetRedeemPoints(s.cart, points) })),

      redemptionAmount: () => pointsToValue(get().cart.loyaltyPointsToRedeem ?? 0),

      canEdit: (lineId) => !isCartPaymentLocked() && !get().lockedItemIds.includes(lineId) && !get().cart.items.find((item) => item.id === lineId)?.is_cancelled,

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
          orderSnapshotVersion: s.orderSnapshotVersion + 1,
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
        set(() => ({
          // ADR-013 D11 — un cart restauré (hold) repart sans promotionTotal :
          // `appliedPromotions` est remis à zéro juste en dessous, l'orchestrateur
          // recalculera les deux ensemble au prochain mount.
          cart: (() => {
            const { promotionTotal: _pt, ...restored } = restoredCart;
            return restored;
          })(),
          lockedItemIds: [],
          printedItemIds: [],
          attachedCustomer: null,
          pickedUpOrderId: null,
          orderOrigin: null,
          orderNumber: null,
          // Lot 4 — un restore installe un AUTRE contexte de commande : ne
          // jamais laisser le lien offline de l'ancien cart encaisser le
          // nouveau (le hold offline n'est pas un flux supporté, A1).
          offlineOrder: null,
          // Session 9 — restoring a held / picked-up order resets the
          // promotions slate ; the orchestrator will recompute on next mount.
          appliedPromotions: [],
          dismissedPromotionIds: new Set<string>(),
        })),

      applyOrderSnapshot: (snapshot, replace = false) =>
        set((state) => {
          if (replace && isCartPaymentLocked()) return state;
          if (!replace && state.pickedUpOrderId && state.pickedUpOrderId !== snapshot.order_id) return state;
          const items = replace ? snapshotCart(snapshot).items : reconcileOrderItems(state.cart.items, snapshot.items);
          const rowById = new Map(snapshot.items.map((item) => [item.id, item]));
          const locked = items.filter((item) => item.server_id && rowById.get(item.server_id)?.is_locked).map((item) => item.id);
          return {
            cart: replace ? snapshotCart(snapshot) : { ...state.cart, items },
            lockedItemIds: [...new Set([...(replace ? [] : state.lockedItemIds), ...locked])],
            printedItemIds: replace ? locked : state.printedItemIds,
            pickedUpOrderId: snapshot.order_id,
            orderSnapshotVersion: state.orderSnapshotVersion + 1,
            orderNumber: snapshot.order_number ?? state.orderNumber,
            orderOrigin: snapshot.created_via === 'tablet' ? 'tablet' : 'pos',
            offlineOrder: null,
            ...(replace ? { attachedCustomer: null, appliedPromotions: [], dismissedPromotionIds: new Set<string>() } : {}),
          };
        }),

      reopenOrder: (payload) => get().applyOrderSnapshot(payload, true),

      setPickedUpOrderId: (id) => set({ pickedUpOrderId: id }),

      setOfflineOrder: (o) => set({ offlineOrder: o }),

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
        const { patch, ...changes } = reconcilePromotions(get(), next, productLookup);
        set(patch);
        return changes;
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
        // ADR-013 D11 — `promotionTotal` est exclu du persist : il est dérivé
        // de `appliedPromotions` (mémoire seule) et serait STALE au rehydrate
        // (un tab frais repart promo à zéro jusqu'au premier auto-eval).
        cart: (() => {
          const { promotionTotal: _pt, ...cartPersisted } = state.cart;
          return cartPersisted;
        })(),
        lockedItemIds: state.lockedItemIds,
        printedItemIds: state.printedItemIds,
        attachedCustomer: state.attachedCustomer,
        pickedUpOrderId: state.pickedUpOrderId,
        orderNumber: state.orderNumber,
        orderOrigin: state.orderOrigin,
        // Lot 4 — la commande locale offline survit à un reload en coupure.
        offlineOrder: state.offlineOrder,
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
  if (isCartPaymentLocked()) return;
  useCartStore.setState((s) => {
    const cleared = clearCart(s.cart);
    const { customerId: _c, loyaltyPointsToRedeem: _l, tableNumber: _t, cartDiscount: _cd, promotionTotal: _pt, ...rest } = cleared;
    return {
      cart: { ...rest, items: rest.items.map(({ discount: _d, ...i }) => i) },
      lockedItemIds: [],
      printedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      orderNumber: null,
      orderOrigin: null,
      // Lot 4 — la commande locale est soldée (cash offline encaissé) ; son
      // devenir cloud appartient à l'outbox, plus au cart.
      offlineOrder: null,
      // Session 9 — wipe promotion state on checkout completion.
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
    };
  });
}
