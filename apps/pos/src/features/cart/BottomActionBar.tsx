// apps/pos/src/features/cart/BottomActionBar.tsx
//
// Global POS action bar (bottom of the shell, full width). It concentrates ALL
// order actions that used to live inside the Active Order panel:
//
//   left  : Held Orders · Tablet inbox · Customer · Table · Print Bill · More(▾)
//   right : Void Order · Send to Kitchen · Checkout (+ total)
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
  Percent,
  Star,
  User,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Currency,
  DiscountModal,
  PinVerificationModal,
  RedeemPointsModal,
  cn,
} from '@breakery/ui';
import { calculateTotals, DEFAULT_TAX_RATE } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useHeldOrdersQuery } from '@/features/heldOrders/hooks/useHeldOrdersQuery';
import { HoldOrderButton } from '@/features/heldOrders/components/HoldOrderButton';
import { useApplyCartDiscount } from '@/features/discounts/hooks/useApplyCartDiscount';
import { useVerifyManagerPin } from '@/features/discounts/hooks/useVerifyManagerPin';
import { useVoidServerOrder } from './hooks/useVoidServerOrder';
import { TableSelectorButton } from '@/features/tables/components/TableSelectorButton';
import { TabletInboxButton } from '@/features/inbox/components/TabletInboxButton';
import { SendToKitchenButton } from './SendToKitchenButton';
import { PrintBillButton } from './PrintBillButton';
import { HeldOrdersModal } from './HeldOrdersModal';

/** Shared "ghost" management-button styling (left group). */
const GHOST_BTN =
  'flex items-center gap-2 h-11 px-3.5 rounded-md bg-bg-overlay border border-border-subtle ' +
  'text-text-primary text-[13px] font-semibold hover:bg-bg-input transition-colors ' +
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
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const appliedPromotions = useCartStore((s) => s.appliedPromotions);
  const setRedeemPoints = useCartStore((s) => s.setRedeemPoints);
  const voidOrder = useCartStore((s) => s.voidOrder);
  const openPayment = usePaymentStore((s) => s.open);

  const heldCount = useHeldOrdersQuery().data?.length ?? 0;
  const discount = useApplyCartDiscount();
  const rawVoidVerifyFn = useVerifyManagerPin();
  const voidServerOrder = useVoidServerOrder();

  // Capture the PIN entered during the void flow so we can forward it to the
  // void-order EF (which requires x-manager-pin). The PIN is available in the
  // verifyFn call but onVerified only carries userId.
  const voidPinRef = useRef<string>('');

  // Wrap the raw verifyFn to intercept the PIN before it's consumed.
  const voidVerifyFn = async (pin: string) => {
    voidPinRef.current = pin;
    return rawVoidVerifyFn(pin);
  };

  const [heldOpen, setHeldOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [voidPinOpen, setVoidPinOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close the More popover on outside click + Escape.
  useEffect(() => {
    if (!moreOpen) return;
    function onDocClick(e: MouseEvent) {
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

  const baseTotals = calculateTotals(cart, DEFAULT_TAX_RATE);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  const total = Math.max(0, baseTotals.total - promotionTotal);

  const hasItems = cart.items.some((i) => !i.is_cancelled);
  const hasSentItems = lockedItemIds.length > 0;

  // Void Order — once anything has been fired to the kitchen, require a manager
  // PIN before wiping the order (waste / fraud control). Before any send, the
  // cashier can void freely.
  function handleVoid(): void {
    if (!hasItems) return;
    if (hasSentItems) {
      setVoidPinOpen(true);
      return;
    }
    voidOrder();
    toast.info('Order voided');
  }

  return (
    <div
      className="bg-bg-elevated border-t border-border-subtle px-4 py-2.5 flex items-center gap-2 shadow-[0_-4px_16px_rgba(0,0,0,0.25)] z-50"
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
            {/* Hold reuses the existing self-contained component (its own logic). */}
            <div role="menuitem">
              <HoldOrderButton
                variant="ghost"
                className={cn(MENU_ITEM, 'justify-start')}
              />
            </div>
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

      <div className="flex-1" />

      {/* ── Right group : validation ────────────────────────────────────── */}
      <button
        type="button"
        className={cn(
          'flex items-center gap-2 h-11 px-3.5 rounded-md bg-transparent border border-red-400/30',
          'text-red-400 text-[13px] font-semibold hover:bg-red-400/10 transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
        onClick={handleVoid}
        disabled={!hasItems}
        title={hasSentItems ? 'Already sent to kitchen — manager PIN required' : undefined}
      >
        <XCircle className="h-4 w-4" aria-hidden />
        <span>Void Order</span>
      </button>

      <SendToKitchenButton
        variant="outlineGold"
        className="h-11 px-4 rounded-md text-[13px] font-bold uppercase tracking-wide"
      />

      <button
        type="button"
        className={cn(
          'flex items-center gap-2.5 h-11 px-6 rounded-md bg-gold text-bg-base uppercase tracking-wide',
          'text-sm font-bold hover:opacity-90 transition-opacity',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
        onClick={() => openPayment()}
        disabled={!hasItems}
        data-testid="checkout-cta"
      >
        <CreditCard className="h-4 w-4" aria-hidden />
        <span>Checkout</span>
        <Currency amount={total} className="font-mono" />
      </button>

      {/* ── Owned modals ────────────────────────────────────────────────── */}
      <HeldOrdersModal open={heldOpen} onClose={() => setHeldOpen(false)} />

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
          setVoidPinOpen(false);
          // Fire-and-forget with toast feedback; voidServerOrder handles routing:
          // tablet pickup → EF void-order (server first); counter → client only.
          void voidServerOrder(pin)
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
