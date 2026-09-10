import type { AppliedPromotion, Cart, CartItem, ComboComponent, Customer, CustomerCategory, Discount, OrderType, Product, SelectedModifiers } from '@breakery/domain';
import type { OrderItemSnapshot, OrderSnapshot } from './orderSnapshot';
export type CustomerWithCategory = Customer & { category?: CustomerCategory | null };

export type ReopenOrderItem = OrderItemSnapshot;
export type ReopenOrderPayload = OrderSnapshot;

export interface CartState {
  cart: Cart;
  /** Line ids that have been "sent to kitchen" — read-only afterwards. */
  lockedItemIds: string[];
  /** Line ids whose ticket has already been printed — prevents re-printing on reconnect / re-render. */
  printedItemIds: string[];
  /** Full customer object for display — mirrors cart.customerId. */
  attachedCustomer: CustomerWithCategory | null;
  /** Set when a tablet order is picked up; directs checkout to pay_existing_order RPC. */
  pickedUpOrderId: string | null;
  orderNumber: string | null;
  orderSnapshotVersion: number;
  orderOrigin: 'pos' | 'tablet' | null;
  applyOrderSnapshot: (snapshot: OrderSnapshot, replace?: boolean) => void;
  /**
   * Spec 006x lot 4 — identité de la commande LOCALE quand le cart a été firé
   * en mode OFFLINE (bus LAN) : client_uuid racine (idempotence du fire au
   * replay) + numéro local `L-<seq>`. Miroir offline de `pickedUpOrderId` :
   * un re-fire APPEND au lieu de minter une 2ᵉ commande locale, et le cash
   * offline sait quelle commande il encaisse. Persisté (sessionStorage) pour
   * survivre à un reload en pleine coupure. Effacé quand le replay raccorde
   * la commande au cloud (setPickedUpOrderId prend le relais).
   */
  offlineOrder: { clientUuid: string; localNumber: string } | null;
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
    components: ComboComponent[],
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

  // Commande locale offline (spec 006x lot 4)
  setOfflineOrder: (o: { clientUuid: string; localNumber: string } | null) => void;

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
