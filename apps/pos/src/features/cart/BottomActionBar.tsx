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
  Clock,
  CreditCard,
  MoreHorizontal,
  PauseCircle,
  Percent,
  Star,
  Trash2,
  User,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Currency,
  DiscountModal,
  PinVerificationModal,
  RedeemPointsModal,
  cn,
} from '@breakery/ui';
import { calculateTotals, splitPb1 } from '@breakery/domain';
import { useCartStore, resetCartAfterCheckout } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';
import { usePOSPresets } from '@/features/settings/hooks/usePOSPresets';
import { useHeldOrdersQuery } from '@/features/heldOrders/hooks/useHeldOrdersQuery';
import { HoldOrderButton } from '@/features/heldOrders/components/HoldOrderButton';
import { useHoldFiredOrder } from './hooks/useHoldFiredOrder';
import { useApplyCartDiscount } from '@/features/discounts/hooks/useApplyCartDiscount';
import { useVerifyManagerPin } from '@/features/discounts/hooks/useVerifyManagerPin';
import { useVoidServerOrder } from './hooks/useVoidServerOrder';
import { TableSelectorButton } from '@/features/tables/components/TableSelectorButton';
import { useDineInTableGuard } from '@/features/tables/hooks/useDineInTableGuard';
import { TabletInboxButton } from '@/features/inbox/components/TabletInboxButton';
import { usePendingTabletOrders } from '@/features/inbox/hooks/usePendingTabletOrders';
import { SendToKitchenButton } from './SendToKitchenButton';
import { PrintBillButton } from './PrintBillButton';
import { HeldOrdersModal } from './HeldOrdersModal';
import { VoidOrderModal } from './VoidOrderModal';

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
  const { presets: posPresets } = usePOSPresets();
  const verifyManagerPin = useVerifyManagerPin();
  const voidServerOrder = useVoidServerOrder();
  const pendingTablet = usePendingTabletOrders().data?.length ?? 0;

  const [heldOpen, setHeldOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidPending, setVoidPending] = useState(false);
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

  // Amount due on the checkout bar — pre-tax base (calculateTotals inclusive
  // default) minus promos, then ONE PB1 split at the server config (mirror of
  // _pb1_split_v1); no hardcoded 0.10 remains on this path.
  const { taxRate, taxInclusive } = useTaxConfig();
  const baseTotals = calculateTotals(cart, taxRate);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  const { total } = splitPb1(
    Math.max(0, baseTotals.total - promotionTotal), taxRate, taxInclusive,
  );

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
    try {
      await holdFired.mutateAsync(pickedUpOrderId);
      resetCartAfterCheckout();
      toast.success('Order held');
    } catch {
      toast.error('Could not hold order');
    }
  }

  // Void Order (owner decision 2026-07-10) — lives under "More" and ALWAYS
  // requires a manager PIN + a mandatory reason, whether or not anything was
  // fired. Accidental voids become impossible and every void is attributable.
  //   - fired (server row exists) → void-order EF verifies the PIN + records the
  //     reason server-side (useVoidServerOrder).
  //   - never fired → verify the PIN client-side, then wipe the local cart.
  // Throws propagate so VoidOrderModal keeps the modal open + clears the PIN.
  async function handleVoidSubmit({
    reason,
    managerPin,
    idempotencyKey,
  }: {
    reason: string;
    managerPin: string;
    idempotencyKey: string;
  }): Promise<void> {
    setVoidPending(true);
    try {
      if (pickedUpOrderId) {
        // Server row exists (tablet pickup OR fired counter order) → the
        // void-order EF verifies the PIN + records the reason server-side.
        await voidServerOrder(managerPin, reason, idempotencyKey);
        toast.success('Order voided (manager approved)');
      } else {
        // No server row → verify the PIN client-side, then wipe locally.
        await verifyManagerPin(managerPin); // throws on invalid PIN
        voidOrder();
        toast.info(`Order voided — ${reason}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'void_failed';
      toast.error(`Void failed: ${msg}`);
      throw err;
    } finally {
      setVoidPending(false);
    }
  }

  return (
    <div
      className="shrink-0 bg-bg-elevated border-t border-border-subtle px-4 py-2.5 flex items-center gap-2 max-md:flex-wrap shadow-[0_-4px_16px_rgba(0,0,0,0.25)] z-50"
      role="toolbar"
      aria-label="Order actions"
    >
      {/* ── Left group : management ─────────────────────────────────────────
          Wraps to a second row before it can push the validation pair off the
          right edge — this is what fixes the Checkout/total truncation (#14):
          the group is `min-w-0 flex-wrap`, the validation pair is `shrink-0`. */}
      <div className="flex flex-wrap items-center gap-2 min-w-0 max-md:w-full">
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

        {/* HOLD — first-class (owner decision 2026-07-10: a cashier who reopens
            an order to check it must be able to re-park it without hunting a
            submenu). Reopened FIRED order → hold_fired_order_v1; fresh cart →
            draft hold via HoldOrderButton. */}
        {hasFiredOrderOpen ? (
          <button
            type="button"
            className={GHOST_BTN}
            disabled={hasUnfiredItems || holdFired.isPending}
            {...(hasUnfiredItems ? { title: 'Send the new items to the kitchen first' } : {})}
            onClick={() => { void handleReholdFired(); }}
          >
            <PauseCircle className="h-4 w-4 text-gold" aria-hidden />
            <span>Hold</span>
          </button>
        ) : (
          <HoldOrderButton variant="ghost" className={GHOST_BTN} />
        )}

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

        {/* More — lower-frequency + destructive actions consolidated here so the
            bar stays scannable and never overflows (#13/#14). A badge surfaces
            pending tablet orders so the signal isn't lost inside the menu. */}
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
            {pendingTablet > 0 && (
              <span
                className="ml-0.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-gold text-bg-base text-[10px] font-bold"
                aria-label={`${pendingTablet} pending tablet order${pendingTablet === 1 ? '' : 's'}`}
              >
                {pendingTablet}
              </span>
            )}
          </button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-0 mb-2 w-60 p-1 rounded-md bg-bg-elevated border border-border-subtle shadow-lg z-50"
            >
              {/* Self-contained buttons restyled as menu rows (own their modals). */}
              <TabletInboxButton className={MENU_ITEM} />
              <PrintBillButton variant="ghost" className={cn(MENU_ITEM, 'justify-start')} />
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
              <div className="my-1 border-t border-border-subtle" aria-hidden />
              {/* Void order — destructive, under More, always PIN + reason. */}
              <button
                type="button"
                role="menuitem"
                className={cn(MENU_ITEM, 'text-red-fg hover:bg-red-soft')}
                disabled={!hasItems}
                onClick={() => {
                  setMoreOpen(false);
                  setVoidOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                <span>Void order</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Spacer — collapses first; the left group wraps before Checkout clips. */}
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
          className="h-14 shrink-0 px-7 gap-2.5 text-base font-bold uppercase tracking-wide active:bg-gold-pressed max-md:px-4"
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

      {/* Void Order — single reason+PIN gate for BOTH paths (owner decision
          2026-07-10). Fired → void-order EF (server-side PIN + reason). Never
          fired → PIN verified client-side then local wipe. */}
      <VoidOrderModal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        fired={hasSentItems}
        isPending={voidPending}
        onSubmit={handleVoidSubmit}
      />

      <DiscountModal
        open={discount.discountModalOpen}
        onClose={discount.closeDiscountModal}
        onConfirm={discount.onConfirm}
        base={discount.base}
        onRequireAuthorization={discount.onRequireAuthorization}
        presets={posPresets.discountPresets}
      />
      <PinVerificationModal
        open={discount.pinModalOpen}
        onClose={discount.onPinClose}
        onVerified={discount.onPinVerified}
        verifyFn={discount.verifyFn}
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
