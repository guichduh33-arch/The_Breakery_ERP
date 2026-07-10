// apps/pos/src/features/cart/ActiveOrderPanel.tsx
//
// Active Order panel — DISPLAY ONLY (cart redesign).
//
// All action buttons (Send to Kitchen, Checkout, Hold, Print Bill, Discount,
// Customer, Table, Clear/Void, Held Orders…) now live in the global
// <BottomActionBar> rendered by the POS shell. This panel renders:
//   - header  : "Order #NEW" + compact service-type tabs + condensed
//               table / customer info (read-only here ; edited from the bar).
//   - list    : the cart lines (delete-first rows), scrollable, fills height.
//   - footer  : subtotal / promotions / tax / TOTAL — no buttons.
//
// The promotion orchestrator + realtime + customer-display mirror stay anchored
// here (single source of truth for promo sync), and the per-line cancel flow
// (tablet pickups) remains because it is triggered from the rows themselves.

import { useState, type JSX } from 'react';
import { MapPin, ShoppingBag, User } from 'lucide-react';
import { toast } from 'sonner';
import { DiscountModal, PinVerificationModal, SectionLabel, cn } from '@breakery/ui';
import { calculateTotals } from '@breakery/domain';
import type { CartItem, OrderType } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { useTaxRate } from '@/features/settings/hooks/useTaxRate';
import { useApplyLineDiscount, lineDiscountBase } from '@/features/discounts/hooks/useApplyLineDiscount';
import { LoyaltyPointsLine } from '@/features/loyalty/components/LoyaltyPointsLine';
import { usePromotionsAutoEval } from '@/features/promotions/hooks/usePromotionsAutoEval';
import { usePromotionsRealtime } from '@/features/promotions/hooks/usePromotionsRealtime';
import { PromotionsList } from '@/features/promotions/components/PromotionsList';
import { useCartBroadcast } from '@/features/display/hooks/useCartBroadcast';
import { CartLineRow } from './CartLineRow';
import { CustomerBadge } from './CustomerBadge';
import { CancelItemModal } from './CancelItemModal';
import { QtyEditModal } from './QtyEditModal';
import { useCancelOrderItem } from './hooks/useCancelOrderItem';

const CurrencyFmt = new Intl.NumberFormat('en-US');
function rp(amount: number): string {
  return `Rp ${CurrencyFmt.format(Math.round(amount))}`;
}

interface ActiveOrderPanelProps {
  /** Kept for POS-shell wiring compatibility (the attach trigger lives in the bar). */
  onOpenCustomerSearch?: () => void;
  onDetachCustomer?: () => void;
}

const SERVICE_TABS: { value: OrderType; label: string }[] = [
  { value: 'dine_in', label: 'Dine-In' },
  { value: 'take_out', label: 'Take-Out' },
  { value: 'delivery', label: 'Delivery' },
];

function orderLabel(pickedUpOrderId: string | null): string {
  if (!pickedUpOrderId) return '#NEW';
  return `POS-${pickedUpOrderId.slice(-4).toUpperCase()}`;
}

export function ActiveOrderPanel({ onDetachCustomer }: ActiveOrderPanelProps): JSX.Element {
  // ── store reads ──────────────────────────────────────────────────────────
  const cart = useCartStore((s) => s.cart);
  const lockedIds = useCartStore((s) => s.lockedItemIds);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const pickedUpOrderId = useCartStore((s) => s.pickedUpOrderId);
  const detachCustomer = useCartStore((s) => s.detachCustomer);
  const update = useCartStore((s) => s.update);
  const remove = useCartStore((s) => s.remove);
  const restoreLine = useCartStore((s) => s.restoreLine);
  const setOrderType = useCartStore((s) => s.setOrderType);
  const appliedPromotions = useCartStore((s) => s.appliedPromotions);

  // Tax estimated at the SERVER rate (useTaxRate) — the money-path RPC charges
  // this same rate; no hardcoded 0.10 on the encaissement path. Also feeds the
  // customer-display mirror's "Tax included" line.
  const taxRate = useTaxRate();

  // ── orchestrators anchored here (single source of truth) ─────────────────
  usePromotionsAutoEval();
  usePromotionsRealtime();
  useCartBroadcast(taxRate);

  // ── per-line cancel (tablet pickups) ─────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<CartItem | null>(null);
  const cancelMutation = useCancelOrderItem();

  // ── per-line quantity edit (Numpad) ──────────────────────────────────────
  const [qtyTarget, setQtyTarget] = useState<CartItem | null>(null);

  // Remove with a 5s undo toast — no blocking confirm on this frequent gesture
  // (cart redesign v2, point #5). Snapshots the line + its index so "Annuler"
  // re-inserts it exactly where it was.
  function removeWithUndo(target: CartItem): void {
    const index = cart.items.findIndex((i) => i.id === target.id);
    remove(target.id);
    toast(`${target.name} retiré`, {
      duration: 5000,
      action: {
        label: 'Annuler',
        onClick: () => restoreLine(target, index < 0 ? 0 : index),
      },
    });
  }

  // Apply a Numpad-entered quantity; 0 routes to the same undo-safe removal.
  function applyQty(target: CartItem, qty: number): void {
    if (qty <= 0) {
      removeWithUndo(target);
      return;
    }
    update(target.id, qty);
  }

  // ── per-line discount (manager-PIN gated above threshold) ────────────────
  const lineDiscount = useApplyLineDiscount();

  // ── totals (promo applied after base, never negative) ────────────────────
  const baseTotals = calculateTotals(cart, taxRate);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  const total = Math.max(0, baseTotals.total - promotionTotal);
  const tax_amount = Math.round((total * taxRate) / (1 + taxRate));

  const isEmpty = cart.items.length === 0;
  const pickedUp = Boolean(pickedUpOrderId);

  return (
    <aside
      aria-label="Active order"
      className="w-[340px] shrink-0 bg-bg-elevated border-l border-border-subtle flex flex-col h-full max-md:w-full max-md:h-[42%] max-md:border-l-0 max-md:border-t"
    >
      {/* Header ──────────────────────────────────────────────────────────── */}
      <header className="px-4 pt-4 pb-3 border-b border-border-subtle space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-bold uppercase tracking-widest text-sm text-text-primary">
              Order
            </span>
            <span className="font-display italic text-base text-gold">
              {orderLabel(pickedUpOrderId)}
            </span>
          </div>
        </div>

        {/* Service-type tabs — frequent rush action: 44px touch targets on a
            dedicated full-width row (was h-7/10px inline, below the 44px floor). */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-bg-input rounded-md" role="tablist" aria-label="Service type">
          {SERVICE_TABS.map((tab) => {
            const active = cart.order_type === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setOrderType(tab.value)}
                className={cn(
                  'h-11 rounded text-[13px] font-semibold uppercase tracking-wide transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold',
                  active
                    ? 'bg-gold-soft text-gold border border-gold'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Condensed order info — read-only (edited from the bottom bar) */}
        {attachedCustomer ? (
          <CustomerBadge customer={attachedCustomer} onDetach={onDetachCustomer ?? detachCustomer} />
        ) : (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            {cart.order_type === 'dine_in' && (
              <>
                {/* Fiche 02 D2.5 — dine-in requires a table: missing state reads
                    as a warning, not a neutral fact (fire/checkout will block). */}
                {cart.tableNumber ? (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4 text-gold" aria-hidden />
                    Table {cart.tableNumber}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-warn font-semibold">
                    <MapPin className="h-4 w-4" aria-hidden />
                    Table required
                  </span>
                )}
                <span className="text-border-subtle" aria-hidden>•</span>
              </>
            )}
            <span className="flex items-center gap-1">
              <User className="h-4 w-4 text-gold" aria-hidden />
              Walk-in
            </span>
          </div>
        )}
      </header>

      {/* Items list ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2" data-testid="cart-items">
        {isEmpty ? (
          <EmptyBagState />
        ) : (
          cart.items.map((item) => (
            <CartLineRow
              key={item.id}
              item={item}
              locked={lockedIds.includes(item.id)}
              onChangeQty={(q) => update(item.id, q)}
              onEditQty={(it) => setQtyTarget(it)}
              onRemove={() => removeWithUndo(item)}
              onApplyLineDiscount={lineDiscount.openForItem}
              {...(pickedUp ? { onRequestCancel: (it) => setCancelTarget(it) } : {})}
            />
          ))
        )}
      </div>

      {/* Totals footer — no buttons ──────────────────────────────────────── */}
      {!isEmpty && (
        <footer className="px-4 py-3 border-t border-border-subtle space-y-1 bg-bg-elevated">
          {attachedCustomer && <LoyaltyPointsLine total={total} />}

          <div className="flex items-center justify-between text-[11px] text-text-muted">
            <span className="uppercase tracking-wide">Subtotal</span>
            <span className="font-mono tabular-nums">{rp(baseTotals.subtotal)}</span>
          </div>

          {appliedPromotions.length > 0 && (
            <div className="text-[11px] text-red-fg">
              <PromotionsList applied={appliedPromotions} />
            </div>
          )}

          {baseTotals.redemption_amount > 0 && (
            <div className="flex items-center justify-between text-[11px] text-red-fg">
              <span className="uppercase tracking-wide">
                Loyalty Discount ({cart.loyaltyPointsToRedeem ?? 0} pts)
              </span>
              <span className="font-mono tabular-nums">-{rp(baseTotals.redemption_amount)}</span>
            </div>
          )}

          {cart.cartDiscount && (
            <div className="flex items-center justify-between text-[11px] text-red-fg">
              <span className="uppercase tracking-wide">
                Discount ({cart.cartDiscount.type === 'percentage' ? `${cart.cartDiscount.value}%` : 'fixed'})
              </span>
              <span className="font-mono tabular-nums">-{rp(cart.cartDiscount.amount)}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-text-muted">
            <span className="uppercase tracking-wide">Tax Included ({Math.round(taxRate * 100)}%)</span>
            <span className="font-mono tabular-nums">{rp(tax_amount)}</span>
          </div>

          <div className="flex items-baseline justify-between pt-2.5 mt-1 border-t border-border-subtle">
            <span className="font-bold uppercase tracking-widest text-sm text-text-primary">
              Total
            </span>
            <span
              key={total}
              className="font-mono tabular-nums text-3xl font-bold tracking-tight text-gold motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in-0 motion-safe:duration-200"
            >
              {rp(total)}
            </span>
          </div>
        </footer>
      )}

      {/* Per-line cancel (tablet pickup) ─────────────────────────────────── */}
      {cancelTarget && (
        <CancelItemModal
          open={Boolean(cancelTarget)}
          itemName={cancelTarget.name}
          onClose={() => setCancelTarget(null)}
          isPending={cancelMutation.isPending}
          onSubmit={async ({ reason, managerPin, idempotencyKey }) => {
            try {
              await cancelMutation.mutateAsync({
                orderItemId: cancelTarget.id,
                reason,
                managerPin,
                idempotencyKey,
              });
              toast.success(`${cancelTarget.name} cancelled`);
            } catch (err: unknown) {
              const e = err as { details?: { error?: string }; status?: number };
              const msg = e.details?.error ?? 'cancel_failed';
              if (e.status === 401) toast.error('Wrong manager PIN');
              else if (e.status === 422) toast.error(`Cannot cancel: ${msg}`);
              else toast.error(`Cancel failed: ${msg}`);
              throw err;
            }
          }}
        />
      )}

      {/* Per-line quantity edit (triggered from the qty chip on each row) ─── */}
      {qtyTarget && (
        <QtyEditModal
          open={Boolean(qtyTarget)}
          itemName={qtyTarget.name}
          currentQty={qtyTarget.quantity}
          onClose={() => setQtyTarget(null)}
          onConfirm={(qty) => applyQty(qtyTarget, qty)}
        />
      )}

      {/* Per-line discount (triggered from the Tag button on each row) ────── */}
      {lineDiscount.targetItem && (
        <DiscountModal
          open={Boolean(lineDiscount.targetItem)}
          onClose={lineDiscount.closeDiscountModal}
          onConfirm={lineDiscount.onConfirm}
          base={lineDiscountBase(lineDiscount.targetItem)}
          onRequireAuthorization={lineDiscount.onRequireAuthorization}
        />
      )}
      <PinVerificationModal
        open={lineDiscount.pinModalOpen}
        onClose={lineDiscount.onPinClose}
        onVerified={lineDiscount.onPinVerified}
        verifyFn={lineDiscount.verifyFn}
      />
    </aside>
  );
}

function EmptyBagState(): JSX.Element {
  return (
    <div className="h-full grid place-items-center px-6">
      <div className="text-center space-y-3 max-w-[220px]">
        <div className="mx-auto h-16 w-16 rounded-full bg-bg-overlay/60 grid place-items-center">
          <ShoppingBag className="h-8 w-8 text-text-muted" aria-hidden />
        </div>
        <SectionLabel size="sm" className="text-text-secondary block">
          Empty Bag
        </SectionLabel>
        <p className="text-xs text-text-muted">Select products to begin</p>
      </div>
    </div>
  );
}
