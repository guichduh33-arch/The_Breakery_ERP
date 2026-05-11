// apps/pos/src/features/cart/ActiveOrderPanel.tsx
import { useState } from 'react';
import { ShoppingBag, CreditCard } from 'lucide-react';
import { Button, Currency, OrderTypeTabs, RedeemPointsModal, DiscountModal, PinVerificationModal } from '@breakery/ui';
import { calculateTotals } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { CustomerAttachButton } from '@/features/customers/components/CustomerAttachButton';
import { CustomerAttachedBadge } from '@/features/customers/components/CustomerAttachedBadge';
import { LoyaltyPointsLine } from '@/features/loyalty/components/LoyaltyPointsLine';
import { RedeemButton } from '@/features/loyalty/components/RedeemButton';
import { HeldOrdersInboxButton } from '@/features/heldOrders/components/HeldOrdersInboxButton';
import { HoldOrderButton } from '@/features/heldOrders/components/HoldOrderButton';
import { TabletInboxButton } from '@/features/inbox/components/TabletInboxButton';
import { TableSelectorButton } from '@/features/tables/components/TableSelectorButton';
import { DiscountButton } from '@/features/discounts/components/DiscountButton';
import { useApplyCartDiscount } from '@/features/discounts/hooks/useApplyCartDiscount';
import { useApplyLineDiscount, lineDiscountBase } from '@/features/discounts/hooks/useApplyLineDiscount';
import { PromotionsList } from '@/features/promotions/components/PromotionsList';
import { usePromotionsAutoEval } from '@/features/promotions/hooks/usePromotionsAutoEval';
import { usePromotionsRealtime } from '@/features/promotions/hooks/usePromotionsRealtime';
import { CartItemRow } from './CartItemRow';
import { SendToKitchenButton } from './SendToKitchenButton';
import { CancelItemModal } from './CancelItemModal';
import { useCancelOrderItem } from './hooks/useCancelOrderItem';
import type { CartItem } from '@breakery/domain';
import { toast } from 'sonner';

const TAX_RATE = 0.10;

interface ActiveOrderPanelProps {
  onOpenCustomerSearch?: () => void;
  onDetachCustomer?: () => void;
}

export function ActiveOrderPanel({ onOpenCustomerSearch, onDetachCustomer }: ActiveOrderPanelProps) {
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

  // Session 9 — keep the cart panel as the single mount point for the
  // promotions orchestrator + realtime subscription.
  usePromotionsAutoEval();
  usePromotionsRealtime();

  const [redeemOpen, setRedeemOpen] = useState(false);
  // Session 10 — manager-PIN cancel-after-send. Only available when the cart
  // came from a tablet pickup (item.id is a real DB UUID).
  const [cancelTarget, setCancelTarget] = useState<CartItem | null>(null);
  const cancelMutation = useCancelOrderItem();

  const cartDiscount = useApplyCartDiscount();
  const lineDiscount = useApplyLineDiscount();

  const baseTotals = calculateTotals(cart, TAX_RATE);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  // Spec §4.4 step 5: total = items - redemption - manual_discount - Σ promo.
  // Tax is recomputed on the post-promo total to mirror RPC v7.
  const total = Math.max(0, baseTotals.total - promotionTotal);
  const tax_amount = Math.round((total * TAX_RATE) / (1 + TAX_RATE));
  const totals = { ...baseTotals, total, tax_amount };
  const isEmpty = cart.items.length === 0;
  const hasUnlocked = cart.items.some((i) => !lockedIds.includes(i.id));

  return (
    <aside className="w-[340px] bg-bg-elevated border-l border-border-subtle flex flex-col">
      <header className="p-4 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs uppercase tracking-widest font-semibold text-text-primary">Active Order</h2>
          <span className="text-xs text-text-secondary">#NEW</span>
        </div>
        <OrderTypeTabs value={cart.order_type} onChange={setOrderType} />
        <div className="mt-3 flex gap-2">
          <HeldOrdersInboxButton />
          <TabletInboxButton />
          <Button
            variant="ghostDestructive"
            size="sm"
            onClick={clear}
            disabled={!hasUnlocked}
            title={!hasUnlocked ? 'No unlocked items to clear' : undefined}
          >
            Clear
          </Button>
        </div>
        {cart.order_type === 'dine_in' && (
          <div className="mt-2">
            <TableSelectorButton />
          </div>
        )}
        <div className="mt-2">
          {attachedCustomer ? (
            <CustomerAttachedBadge customer={attachedCustomer} onDetach={onDetachCustomer ?? detachCustomer} />
          ) : (
            <CustomerAttachButton onClick={() => onOpenCustomerSearch?.()} />
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="h-full grid place-items-center text-text-muted">
            <div className="text-center space-y-2">
              <ShoppingBag className="h-12 w-12 mx-auto opacity-50" aria-hidden />
              <div className="text-sm uppercase tracking-widest">Empty Bag</div>
              <div className="text-xs">Select products to begin</div>
            </div>
          </div>
        ) : (
          cart.items.map((item) => (
            <CartItemRow
              key={item.id}
              item={item}
              locked={lockedIds.includes(item.id)}
              onChangeQty={(q) => update(item.id, q)}
              onRemove={() => remove(item.id)}
              onApplyLineDiscount={lineDiscount.openForItem}
              {...(pickedUpOrderId
                ? { onRequestCancel: (it) => setCancelTarget(it) }
                : {})}
            />
          ))
        )}
      </div>

      {!isEmpty && (
        <footer className="p-4 border-t border-border-subtle space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Subtotal</span>
              <Currency amount={totals.subtotal} />
            </div>
            {totals.redemption_amount > 0 && (
              <div className="flex justify-between text-text-secondary">
                <span>Loyalty discount ({cart.loyaltyPointsToRedeem} pts)</span>
                <span className="font-mono text-red-400">-<Currency amount={totals.redemption_amount} /></span>
              </div>
            )}
            {/* Session 9 — auto-applied promotions live between modifiers/redeem and discount. */}
            <PromotionsList applied={appliedPromotions} />
            {cart.cartDiscount && (
              <div className="flex justify-between text-text-secondary">
                <span>
                  Discount ({cart.cartDiscount.type === 'percentage' ? `${cart.cartDiscount.value}%` : 'fixed'})
                </span>
                <span className="font-mono text-red-400">-<Currency amount={cart.cartDiscount.amount} /></span>
              </div>
            )}
            <div className="flex justify-between text-text-secondary">
              <span>Tax included (10%)</span>
              <Currency amount={totals.tax_amount} />
            </div>
            <div className="flex justify-between pt-2 border-t border-border-subtle">
              <span className="uppercase tracking-wide font-semibold">Total</span>
              <Currency amount={totals.total} emphasis="gold" className="text-lg" />
            </div>
            {attachedCustomer && <LoyaltyPointsLine total={totals.total} />}
          </div>
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
          <SendToKitchenButton />
          <Button variant="primary" size="lg" className="w-full" onClick={openPayment}>
            <CreditCard className="h-4 w-4 mr-2" aria-hidden /> Checkout · <Currency amount={totals.total} className="ml-1" />
          </Button>
        </footer>
      )}
      {attachedCustomer && (
        <RedeemPointsModal
          open={redeemOpen}
          onClose={() => setRedeemOpen(false)}
          onConfirm={(points) => { setRedeemPoints(points); setRedeemOpen(false); }}
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
              throw err;  // Re-throw so CancelItemModal clears PIN for retry
            }
          }}
        />
      )}
    </aside>
  );
}
