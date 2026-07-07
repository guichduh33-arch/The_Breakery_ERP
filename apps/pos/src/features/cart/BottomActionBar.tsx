// apps/pos/src/features/cart/BottomActionBar.tsx
//
// Global POS action bar (bottom of the shell, full width). It concentrates ALL
// order actions that used to live inside the Active Order panel:
//
//   left  : Held Orders · Tablet inbox · Customer · Table · Print Bill · More(▾) · Void Order
//   right : Send to Kitchen · Checkout (+ total)
//   (Void lives LEFT of the spacer — destructive stays out of the rush reflex
//   zone next to Send/Checkout. Below md the bar wraps and the validation pair
//   becomes a full-width bottom row, Checkout stretched — waiter one-hand use.)
//
// It is a *connected* component — it reuses the existing hooks / self-contained
// button components (no business logic is rewritten here):
//   - SendToKitchenButton / PrintBillButton / TableSelectorButton / HoldOrderButton
//     are rendered restyled (className/variant overrides).
//   - useApplyCartDiscount drives the cart-discount modal (+ manager PIN).
//   - RedeemPointsModal / HeldOrdersModal are owned here.
//   - Checkout opens the payment terminal (paymentStore.open).
//   - Void Order maps to cartStore.clear (wipes unlocked items) — see the
//     deviation note in the PR description (no dedicated POS "void order" flow).

import { useEffect, useRef, useState, type JSX } from 'react';
import {
  ChevronUp,
  Clock,
  CreditCard,
  MoreHorizontal,
  PauseCircle,
  Percent,
  Star,
  User,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  CenterModal,
  Currency,
  DiscountModal,
  PinVerificationModal,
  RedeemPointsModal,
  cn,
} from '@breakery/ui';
import { calculateTotals } from '@breakery/domain';
import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useTaxRate } from '@/features/settings/hooks/useTaxRate';
import { useHeldOrdersQuery } from '@/features/heldOrders/hooks/useHeldOrdersQuery';
import { HoldOrderButton } from '@/features/heldOrders/components/HoldOrderButton';
import { useHoldFiredOrder } from './hooks/useHoldFiredOrder';
import { useApplyCartDiscount } from '@/features/discounts/hooks/useApplyCartDiscount';
import { useVerifyManagerPin } from '@/features/discounts/hooks/useVerifyManagerPin';
import { useVoidServerOrder } from './hooks/useVoidServerOrder';
import { TableSelectorButton } from '@/features/tables/components/TableSelectorButton';
import { useDineInTableGuard } from '@/features/tables/hooks/useDineInTableGuard';
import { TabletInboxButton } from '@/features/inbox/components/TabletInboxButton';
import { SendToKitchenButton } from './SendToKitchenButton';
import { PrintBillButton } from './PrintBillButton';
import { HeldOrdersModal } from './HeldOrdersModal';

/** Shared "ghost" management-button styling (left group). */
const GHOST_BTN =
  'flex items-center gap-2 h-11 px-3.5 rounded-md bg-bg-overlay border border-border-subtle ' +
  'text-text-primary text-[13px] font-semibold hover:bg-bg-input ' +
  'transition-[color,background-color,transform] duration-fast ease-motion-out active:scale-[0.98] motion-reduce:active:scale-100 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ' +
  'disabled:opacity-50 disabled:pointer-events-none';

const MENU_ITEM =
  'w-full flex items-center gap-3 px-3 h-10 text-sm text-text-primary hover:bg-bg-input ' +
  'disabled:opacity-50 disabled:pointer-events-none rounded-md transition-colors';

interface BottomActionBarProps {
  /** Opens the customer search/attach modal (owned by the POS shell). */
  onOpenCustomerSearch?: () => void;
}

export function BottomActionBar({ onOpenCustomerSearch }: BottomActionBarProps): JSX.Element {
  const cart = useCartStore((s) => s.cart);
  const lockedItemIds = useCartStore((s) => s.lockedItemIds);
  const pickedUpOrderId = useCartStore((s) => s.pickedUpOrderId);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const appliedPromotions = useCartStore((s) => s.appliedPromotions);
  const setRedeemPoints = useCartStore((s) => s.setRedeemPoints);
  const voidOrder = useCartStore((s) => s.voidOrder);
  const openPayment = usePaymentStore((s) => s.open);

  const heldCount = useHeldOrdersQuery().data?.length ?? 0;
  const holdFired = useHoldFiredOrder();
  // Fiche 02 D2.5 — a dine-in order can be paid directly without a fire; the
  // checkout CTA carries the same mandatory-table guard as Send to Kitchen.
  const checkoutTableGuard = useDineInTableGuard({ onSelected: () => openPayment() });
  const discount = useApplyCartDiscount();
  const rawVoidVerifyFn = useVerifyManagerPin();
  const voidServerOrder = useVoidServerOrder();

  // Capture the PIN entered during the void flow so we can forward it to the
  // void-order EF (which requires x-manager-pin). The PIN is available in the
  // verifyFn call but onVerified only carries userId.
  const voidPinRef = useRef<string>('');

  // S55 — one x-idempotency-key per void-PIN-modal opening. Regenerated each time
  // the modal opens (handleVoid, fired-order branch) so reopen rotates the key,
  // yet it stays stable across PIN retries within the same open and across any
  // React-Query auto-retry inside a single voidServerOrder call.
  const voidIdempotencyKeyRef = useRef<string>(crypto.randomUUID());

  // Wrap the raw verifyFn to intercept the PIN before it's consumed.
  const voidVerifyFn = async (pin: string) => {
    voidPinRef.current = pin;
    return rawVoidVerifyFn(pin);
  };

  const [heldOpen, setHeldOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [voidPinOpen, setVoidPinOpen] = useState(false);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close the More popover on outside click + Escape.
  useEffect(() => {
    if (!moreOpen) return;
    function onDocClick(e: MouseEvent) {
      // S43 P2-2: dialogs opened from menu items (e.g. the hold-note modal)
      // are portaled to <body>. Clicking inside them must NOT close the menu
      // — that would unmount the menu item that owns the dialog.
      const target = e.target as Element | null;
      if (target?.closest?.('[role="dialog"], [role="alertdialog"]')) return;
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  // total is tax-inclusive (rate-independent); pass the SERVER rate so no
  // hardcoded 0.10 remains on the checkout bar.
  const taxRate = useTaxRate();
  const baseTotals = calculateTotals(cart, taxRate);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  const total = Math.max(0, baseTotals.total - promotionTotal);

  const hasItems = cart.items.some((i) => !i.is_cancelled);
  const hasSentItems = lockedItemIds.length > 0;

  // Spec A fix — re-hold a reopened FIRED order ("addition ouverte") even when
  // nothing changed. After reopen_held_order_v1 the order sits on the terminal
  // (pickedUpOrderId set, all lines locked); Send-to-Kitchen is disabled with no
  // new items to fire, and the draft Hold path would orphan the live DB row. So
  // when a fired order is open with no unfired lines, "Hold" re-parks it via
  // hold_fired_order_v1 and frees the terminal. New unfired lines must go through
  // Send to Kitchen first (it fires + parks).
  const hasFiredOrderOpen = pickedUpOrderId !== null;
  const hasUnfiredItems = cart.items.some(
    (i) => !i.is_cancelled && !lockedItemIds.includes(i.id),
  );

  async function handleReholdFired(): Promise<void> {
    if (!pickedUpOrderId) return;
    setMoreOpen(false);
    try {
      await holdFired.mutateAsync(pickedUpOrderId);
      resetCartAfterCheckout();
      toast.success('Order held');
    } catch {
      toast.error('Could not hold order');
    }
  }

  // Void Order — once anything has been fired to the kitchen, require a manager
  // PIN before wiping the order (waste / fraud control). Before any send, the
  // cashier confirms via an alertdialog (S43 P2-1 — no more one-tap wipe).
  function handleVoid(): void {
    if (!hasItems) return;
    if (hasSentItems) {
      // Fresh idempotency key for this void attempt (server-void path).
      voidIdempotencyKeyRef.current = crypto.randomUUID();
      setVoidPinOpen(true);
      return;
    }
    setVoidConfirmOpen(true);
  }

  function handleVoidConfirmed(): void {
    setVoidConfirmOpen(false);
    voidOrder();
    toast.info('Order voided');
  }

  return (
    <div
      className="shrink-0 bg-bg-elevated border-t border-border-subtle px-4 py-2.5 flex max-md:flex-wrap items-center gap-2 shadow-[0_-4px_16px_rgba(0,0,0,0.25)] z-50"
      role="toolbar"
      aria-label="Order actions"
    >
      {/* ── Left group : management ─────────────────────────────────────── */}
      <button
        type="button"
        className={GHOST_BTN}
        onClick={() => setHeldOpen(true)}
        disabled={heldCount === 0}
      >
        <Clock className="h-4 w-4 text-gold" aria-hidden />
        <span>Held Orders</span>
        {heldCount > 0 && (
          <span
            className="ml-0.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-gold text-bg-base text-[10px] font-bold"
            aria-label={`${heldCount} held order${heldCount === 1 ? '' : 's'}`}
          >
            {heldCount}
          </span>
        )}
      </button>

      <TabletInboxButton className={GHOST_BTN} />

      <button type="button" className={GHOST_BTN} onClick={() => onOpenCustomerSearch?.()}>
        {attachedCustomer ? (
          <User className="h-4 w-4 text-gold" aria-hidden />
        ) : (
          <UserPlus className="h-4 w-4 text-gold" aria-hidden />
        )}
        <span className="max-w-[140px] truncate">
          {attachedCustomer ? attachedCustomer.name : 'Customer'}
        </span>
      </button>

      <TableSelectorButton variant="secondary" className={GHOST_BTN} />

      <PrintBillButton variant="secondary" className={GHOST_BTN} />

      {/* More popover */}
      <div className="relative" ref={moreRef}>
        <button
          type="button"
          className={GHOST_BTN}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <MoreHorizontal className="h-4 w-4 text-gold" aria-hidden />
          <span>More</span>
        </button>
        {moreOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-56 p-1 rounded-md bg-bg-elevated border border-border-subtle shadow-lg z-50"
          >
            {/* Hold. A fresh cart → draft hold (HoldOrderButton, hold_order_v1).
                A reopened FIRED order (pickedUpOrderId set) already has a live DB
                row, so the draft path would orphan it — instead re-park it via
                hold_fired_order_v1. New unfired lines must be fired first (Send
                to Kitchen fires + parks), so re-hold is gated on hasUnfiredItems. */}
            {hasFiredOrderOpen ? (
              <button
                type="button"
                role="menuitem"
                className={cn(MENU_ITEM, 'justify-start')}
                disabled={hasUnfiredItems || holdFired.isPending}
                {...(hasUnfiredItems
                  ? { title: 'Send the new items to the kitchen first' }
                  : {})}
                onClick={() => { void handleReholdFired(); }}
              >
                <PauseCircle className="h-4 w-4 text-gold" aria-hidden />
                <span>Hold</span>
              </button>
            ) : (
              <div role="menuitem">
                <HoldOrderButton
                  variant="ghost"
                  className={cn(MENU_ITEM, 'justify-start')}
                />
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM}
              disabled={!hasItems}
              onClick={() => {
                setMoreOpen(false);
                discount.openDiscountModal();
              }}
            >
              <Percent className="h-4 w-4 text-gold" aria-hidden />
              <span>Apply discount</span>
            </button>
            {attachedCustomer && (
              <button
                type="button"
                role="menuitem"
                className={MENU_ITEM}
                onClick={() => {
                  setMoreOpen(false);
                  setRedeemOpen(true);
                }}
              >
                <Star className="h-4 w-4 text-gold" aria-hidden />
                <span>Redeem points</span>
              </button>
            )}
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-text-muted flex items-center gap-1">
              <ChevronUp className="h-3 w-3" aria-hidden />
              More options
            </div>
          </div>
        )}
      </div>

      {/* Void Order — destructive: kept in the LEFT (management) group, the
          full flex-1 spacer away from Send/Checkout. It used to sit 8px from
          Send to Kitchen (the most-tapped rush button) — one greasy mis-tap
          from wiping the order. Destructive actions stay out of the reflex
          zone (pos-design-craft P1, 2026-07-06). */}
      <Button
        variant="ghostDestructive"
        className="h-12 px-3.5 gap-2 text-[13px] text-red-fg border border-red-fg/30"
        onClick={handleVoid}
        disabled={!hasItems}
        title={hasSentItems ? 'Already sent to kitchen — manager PIN required' : undefined}
      >
        <XCircle className="h-4 w-4" aria-hidden />
        <span>Void Order</span>
      </Button>

      {/* min-w guarantees ≥24px between the destructive Void and the
          validation pair even on a crowded bar (spacing floor, rush). */}
      <div className="flex-1 min-w-[24px] max-md:hidden" />

      {/* ── Right group : validation ────────────────────────────────────── */}
      {/* LOT 7 (audit 2026-06-25) — visual hierarchy by touch size:
          Checkout (h-14/56px) dominates ▸ Send (h-12/48px) ▸ ghosts (h-11).
          Bigger = more important = faster to hit during the rush. */}
      {/* Below md the validation pair stacks full-width: Send+Checkout side by
          side can't fit 390px without horizontal scroll (measured 403px), and
          the total must never be truncated. Two stacked full-width rows give
          the waiter maximal one-thumb targets. */}
      <div className="flex items-center gap-2 max-md:w-full max-md:flex-col max-md:items-stretch">
        <SendToKitchenButton
          variant="outlineGold"
          className="h-12 px-4 rounded-md text-[13px] font-bold uppercase tracking-wide"
        />

        {/* CTA colour rule (intentional, do NOT "fix" to match the terminal):
            GOLD = "navigate toward the money" (Checkout opens the payment terminal).
            GREEN = "commit the money" (PaymentTerminal's Process Payment — the
            irreversible final action, where green reads as the universal "go"). */}
        <Button
          variant="gold"
          size="lg"
          className="h-14 shrink-0 px-7 gap-2.5 text-base font-bold active:bg-gold-pressed max-md:px-4"
          onClick={() => { if (checkoutTableGuard.ensureTable()) openPayment(); }}
          disabled={!hasItems}
          data-testid="checkout-cta"
        >
          <CreditCard className="h-5 w-5" aria-hidden />
          <span>Checkout</span>
          <Currency amount={total} className="font-mono" />
        </Button>
      </div>

      {/* ── Owned modals ────────────────────────────────────────────────── */}
      {checkoutTableGuard.modal}
      <HeldOrdersModal open={heldOpen} onClose={() => setHeldOpen(false)} />

      {/* Void Order — local confirmation (cart not yet fired). S43 P2-1:
          a one-tap Void wiped the whole cart with no way back — confirm first. */}
      <CenterModal
        open={voidConfirmOpen}
        onOpenChange={setVoidConfirmOpen}
        title="Void order"
        className="w-[min(420px,92vw)]"
        data-testid="void-confirm-modal"
      >
        <div role="alertdialog" aria-labelledby="void-confirm-title" className="p-6 space-y-5">
          <header className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-fg" aria-hidden />
            <h2 id="void-confirm-title" className="font-serif text-xl text-text-primary">
              Void this order?
            </h2>
          </header>
          <p className="text-sm text-text-secondary">
            All items in the current cart will be removed. This cannot be undone.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" size="lg" onClick={() => setVoidConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="ghostDestructive"
              size="lg"
              className="border border-red-fg/30"
              onClick={handleVoidConfirmed}
              data-testid="void-confirm-button"
            >
              Confirm Void
            </Button>
          </div>
        </div>
      </CenterModal>

      <DiscountModal
        open={discount.discountModalOpen}
        onClose={discount.closeDiscountModal}
        onConfirm={discount.onConfirm}
        base={discount.base}
        onRequireAuthorization={discount.onRequireAuthorization}
      />
      <PinVerificationModal
        open={discount.pinModalOpen}
        onClose={discount.onPinClose}
        onVerified={discount.onPinVerified}
        verifyFn={discount.verifyFn}
      />

      {/* Void Order — manager PIN once items were sent to the kitchen.
          Session 37 B4: if this is a tablet pickup order (pickedUpOrderId set),
          the server row is voided via the void-order EF before local reset. */}
      <PinVerificationModal
        open={voidPinOpen}
        onClose={() => { setVoidPinOpen(false); voidPinRef.current = ''; }}
        onVerified={() => {
          const pin = voidPinRef.current;
          voidPinRef.current = '';
          const idempotencyKey = voidIdempotencyKeyRef.current;
          setVoidPinOpen(false);
          // Fire-and-forget with toast feedback; voidServerOrder handles routing:
          // tablet pickup → EF void-order (server first); counter → client only.
          void voidServerOrder(pin, idempotencyKey)
            .then(() => {
              toast.success('Order voided (manager approved)');
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : 'void_failed';
              toast.error(`Void failed: ${msg}`);
            });
        }}
        verifyFn={voidVerifyFn}
      />

      {attachedCustomer && (
        <RedeemPointsModal
          open={redeemOpen}
          onClose={() => setRedeemOpen(false)}
          onConfirm={(points) => {
            setRedeemPoints(points);
            setRedeemOpen(false);
          }}
          customerBalance={attachedCustomer.loyalty_points}
          itemsTotal={baseTotals.subtotal}
        />
      )}
    </div>
  );
}
