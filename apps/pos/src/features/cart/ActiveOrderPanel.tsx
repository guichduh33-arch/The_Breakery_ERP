// apps/pos/src/features/cart/ActiveOrderPanel.tsx
//
// Session 14 / Phase 2.B — visual rewrite of the right-hand "Active Order"
// panel. The functional surface (zustand cart store, RPC payloads, promotion
// orchestrator, discount + redeem modals, send-to-kitchen, checkout) is
// preserved 1:1 — only the layout, typography, and component composition
// were rebuilt to match the design references.
//
// Refs:
//   - 01-grid-bagel-empty-cart-dine-in.jpg     (empty state)
//   - 30-cart-active-2items-dine-in-totals.jpg (2 items + totals)
//   - 31-cart-takeout-customer-bronze.jpg      (customer attached)
//   - 32-cart-locked-items-after-kitchen-send.jpg (post-send lock state)
//   - 50-customer-attach-search-list.jpg       (customer picker)
//   - 51-held-orders-takeaway-list.jpg         (held orders modal)
//
// Composition:
//   <aside class="theme-pos">                                 ← gold spine on left
//     <header>                                                 ← SectionLabel "ACTIVE ORDER" + order# + mode sub-line
//       <OrderTypeTabs />                                      ← Dine-In / Take-Out / Delivery
//       <CustomerBadge | AttachCustomerButton />               ← gold-outlined pill
//       <CartActionsBar heldOrders / clear>                    ← grid of secondary CTAs
//       <TableSelector? />                                     ← only when order_type === dine_in
//     </header>
//     <ScrollArea>
//       <EmptyBag | CartLineRow[]>                             ← items list
//     </ScrollArea>
//     <footer>
//       <CartTotals />                                         ← subtotal/redeem/promo/discount/tax/total
//       <RedeemButton? /> <DiscountButton /> <HoldOrderButton />
//       <SendToKitchenButton /> <CheckoutButton />
//     </footer>
//   </aside>

import { useState, type JSX } from 'react';
import { CreditCard, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Currency,
  DiscountModal,
  OrderTypeTabs,
  PinVerificationModal,
  RedeemPointsModal,
  SectionLabel,
} from '@breakery/ui';
import { calculateTotals } from '@breakery/domain';
import type { CartItem } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useHeldOrdersStore } from '@/stores/heldOrdersStore';
import { CustomerAttachButton } from '@/features/customers/components/CustomerAttachButton';
import { LoyaltyPointsLine } from '@/features/loyalty/components/LoyaltyPointsLine';
import { RedeemButton } from '@/features/loyalty/components/RedeemButton';
import { HoldOrderButton } from '@/features/heldOrders/components/HoldOrderButton';
import { TabletInboxButton } from '@/features/inbox/components/TabletInboxButton';
import { TableSelectorButton } from '@/features/tables/components/TableSelectorButton';
import { DiscountButton } from '@/features/discounts/components/DiscountButton';
import { useApplyCartDiscount } from '@/features/discounts/hooks/useApplyCartDiscount';
import {
  useApplyLineDiscount,
  lineDiscountBase,
} from '@/features/discounts/hooks/useApplyLineDiscount';
import { usePromotionsAutoEval } from '@/features/promotions/hooks/usePromotionsAutoEval';
import { usePromotionsRealtime } from '@/features/promotions/hooks/usePromotionsRealtime';
import { CartLineRow } from './CartLineRow';
import { CartTotals } from './CartTotals';
import { CartActionsBar } from './CartActionsBar';
import { CustomerBadge } from './CustomerBadge';
import { HeldOrdersModal } from './HeldOrdersModal';
import { SendToKitchenButton } from './SendToKitchenButton';
import { CancelItemModal } from './CancelItemModal';
import { useCancelOrderItem } from './hooks/useCancelOrderItem';

const TAX_RATE = 0.1;

interface ActiveOrderPanelProps {
  onOpenCustomerSearch?: () => void;
  onDetachCustomer?: () => void;
}

/**
 * Display the order number for the active cart. For tablet pickups we keep
 * a deterministic POS-style suffix; otherwise we surface "#NEW" until the
 * order is persisted (mirrors ref 30 → ref 32 transition).
 */
function orderLabel(pickedUpOrderId: string | null): string {
  if (!pickedUpOrderId) return '#NEW';
  const tail = pickedUpOrderId.slice(-4).toUpperCase();
  return `POS-${tail}`;
}

function ORDER_MODE_LABEL(orderType: 'dine_in' | 'take_out' | 'delivery'): string {
  switch (orderType) {
    case 'dine_in':
      return 'Dine-In';
    case 'take_out':
      return 'Take-Out';
    case 'delivery':
      return 'Delivery';
  }
}

export function ActiveOrderPanel({
  onOpenCustomerSearch,
  onDetachCustomer,
}: ActiveOrderPanelProps): JSX.Element {
  // ── store reads ──────────────────────────────────────────────────────────
  const cart = useCartStore((s) => s.cart);
  const lockedIds = useCartStore((s) => s.lockedItemIds);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const pickedUpOrderId = useCartStore((s) => s.pickedUpOrderId);
  const detachCustomer = useCartStore((s) => s.detachCustomer);
  const setRedeemPoints = useCartStore((s) => s.setRedeemPoints);
  const update = useCartStore((s) => s.update);
  const remove = useCartStore((s) => s.remove);
  const setOrderType = useCartStore((s) => s.setOrderType);
  const clear = useCartStore((s) => s.clear);
  const appliedPromotions = useCartStore((s) => s.appliedPromotions);
  const openPayment = usePaymentStore((s) => s.open);
  const heldCount = useHeldOrdersStore((s) => s.entries.length);

  // ── promotion orchestrator (anchored here per spec) ──────────────────────
  usePromotionsAutoEval();
  usePromotionsRealtime();

  // ── local UI state ───────────────────────────────────────────────────────
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [heldOrdersOpen, setHeldOrdersOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CartItem | null>(null);
  const cancelMutation = useCancelOrderItem();

  const cartDiscount = useApplyCartDiscount();
  const lineDiscount = useApplyLineDiscount();

  // ── totals (Session 9 spec — promo applied after redeem/discount) ─────────
  const baseTotals = calculateTotals(cart, TAX_RATE);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  const total = Math.max(0, baseTotals.total - promotionTotal);
  const tax_amount = Math.round((total * TAX_RATE) / (1 + TAX_RATE));
  const totals = { ...baseTotals, total, tax_amount };

  const isEmpty = cart.items.length === 0;
  const hasUnlocked = cart.items.some((i) => !lockedIds.includes(i.id));
  const pickedUp = Boolean(pickedUpOrderId);

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <aside
      className="w-[360px] shrink-0 bg-bg-elevated border-l border-border-subtle flex flex-col h-full"
      aria-label="Active order"
    >
      {/* Header ──────────────────────────────────────────────────────── */}
      <header className="px-5 pt-5 pb-4 border-b border-border-subtle space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <SectionLabel as="h2" size="sm" className="text-text-primary">
                Active Order
              </SectionLabel>
              <span className="font-display italic text-sm text-gold">
                {orderLabel(pickedUpOrderId)}
              </span>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              {ORDER_MODE_LABEL(cart.order_type)}
            </p>
          </div>
        </div>

        <OrderTypeTabs value={cart.order_type} onChange={setOrderType} />

        {attachedCustomer ? (
          <CustomerBadge
            customer={attachedCustomer}
            onDetach={onDetachCustomer ?? detachCustomer}
          />
        ) : (
          <CustomerAttachButton onClick={() => onOpenCustomerSearch?.()} />
        )}

        <CartActionsBar
          heldCount={heldCount}
          onOpenHeldOrders={() => setHeldOrdersOpen(true)}
          onClear={clear}
          canClear={hasUnlocked}
          tabletInboxSlot={<TabletInboxButton />}
        />

        {cart.order_type === 'dine_in' && <TableSelectorButton />}
      </header>

      {/* Items list ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" data-testid="cart-items">
        {isEmpty ? (
          <EmptyBagState />
        ) : (
          cart.items.map((item) => (
            <CartLineRow
              key={item.id}
              item={item}
              locked={lockedIds.includes(item.id)}
              onChangeQty={(q) => update(item.id, q)}
              onRemove={() => remove(item.id)}
              onApplyLineDiscount={lineDiscount.openForItem}
              {...(pickedUp ? { onRequestCancel: (it) => setCancelTarget(it) } : {})}
            />
          ))
        )}
      </div>

      {/* Footer ──────────────────────────────────────────────────────── */}
      {!isEmpty && (
        <footer className="px-5 py-4 border-t border-border-subtle space-y-3 bg-bg-elevated">
          <CartTotals
            breakdown={{
              subtotal: totals.subtotal,
              redemption_amount: totals.redemption_amount,
              loyaltyPointsToRedeem: cart.loyaltyPointsToRedeem ?? 0,
              tax_amount: totals.tax_amount,
              total: totals.total,
              appliedPromotions,
              cartDiscount: cart.cartDiscount,
            }}
          />

          {attachedCustomer && <LoyaltyPointsLine total={totals.total} />}

          {/* Secondary buttons grouped */}
          <div className="space-y-2">
            {attachedCustomer && (
              <RedeemButton
                balance={attachedCustomer.loyalty_points}
                onClick={() => setRedeemOpen(true)}
                disabled={totals.redemption_amount > 0}
              />
            )}
            <DiscountButton
              onClick={cartDiscount.openDiscountModal}
              hasDiscount={Boolean(cart.cartDiscount)}
            />
            <HoldOrderButton disabled={isEmpty} />
          </div>

          {/* Primary CTAs */}
          <div className="space-y-2 pt-1">
            <SendToKitchenButton />
            <Button
              variant="gold"
              size="lg"
              className="w-full"
              onClick={openPayment}
              data-testid="checkout-cta"
            >
              <CreditCard className="h-4 w-4" aria-hidden />
              <span>Checkout</span>
              <span aria-hidden className="opacity-70">·</span>
              <Currency amount={totals.total} className="font-bold" />
            </Button>
          </div>
        </footer>
      )}

      {/* Empty-cart bottom rail — only Send-to-Kitchen / Checkout shells */}
      {isEmpty && (
        <footer className="px-5 py-4 border-t border-border-subtle space-y-2 bg-bg-elevated">
          <Button
            variant="secondary"
            size="lg"
            className="w-full opacity-50 pointer-events-none"
            disabled
          >
            <ShoppingBag className="h-4 w-4" aria-hidden />
            Send to Kitchen
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="w-full opacity-50 pointer-events-none"
            disabled
          >
            <CreditCard className="h-4 w-4" aria-hidden />
            Checkout
          </Button>
        </footer>
      )}

      {/* Modals ──────────────────────────────────────────────────────── */}
      {attachedCustomer && (
        <RedeemPointsModal
          open={redeemOpen}
          onClose={() => setRedeemOpen(false)}
          onConfirm={(points) => {
            setRedeemPoints(points);
            setRedeemOpen(false);
          }}
          customerBalance={attachedCustomer.loyalty_points}
          itemsTotal={totals.subtotal}
        />
      )}
      <DiscountModal
        open={cartDiscount.discountModalOpen}
        onClose={cartDiscount.closeDiscountModal}
        onConfirm={cartDiscount.onConfirm}
        base={cartDiscount.base}
        onRequireAuthorization={cartDiscount.onRequireAuthorization}
      />
      <PinVerificationModal
        open={cartDiscount.pinModalOpen}
        onClose={cartDiscount.onPinClose}
        onVerified={cartDiscount.onPinVerified}
        verifyFn={cartDiscount.verifyFn}
      />
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
      {cancelTarget && (
        <CancelItemModal
          open={Boolean(cancelTarget)}
          itemName={cancelTarget.name}
          onClose={() => setCancelTarget(null)}
          isPending={cancelMutation.isPending}
          onSubmit={async ({ reason, managerPin }) => {
            try {
              await cancelMutation.mutateAsync({
                orderItemId: cancelTarget.id,
                reason,
                managerPin,
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

      <HeldOrdersModal
        open={heldOrdersOpen}
        onClose={() => setHeldOrdersOpen(false)}
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
