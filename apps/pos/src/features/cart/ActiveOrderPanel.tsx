// apps/pos/src/features/cart/ActiveOrderPanel.tsx
import { ShoppingBag, CreditCard } from 'lucide-react';
import { Button, Currency, OrderTypeTabs } from '@breakery/ui';
import { calculateTotals } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { CartItemRow } from './CartItemRow';
import { SendToKitchenButton } from './SendToKitchenButton';

const TAX_RATE = 0.10;

export function ActiveOrderPanel() {
  const cart = useCartStore((s) => s.cart);
  const lockedIds = useCartStore((s) => s.lockedItemIds);
  const update = useCartStore((s) => s.update);
  const remove = useCartStore((s) => s.remove);
  const setOrderType = useCartStore((s) => s.setOrderType);
  const clear = useCartStore((s) => s.clear);
  const openPayment = usePaymentStore((s) => s.open);

  const totals = calculateTotals(cart, TAX_RATE);
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
          <Button variant="outlineGold" size="sm" className="flex-1" disabled>Held Orders</Button>
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
            <div className="flex justify-between text-text-secondary">
              <span>Tax included (10%)</span>
              <Currency amount={totals.tax_amount} />
            </div>
            <div className="flex justify-between pt-2 border-t border-border-subtle">
              <span className="uppercase tracking-wide font-semibold">Total</span>
              <Currency amount={totals.total} emphasis="gold" className="text-lg" />
            </div>
          </div>
          <SendToKitchenButton />
          <Button variant="primary" size="lg" className="w-full" onClick={openPayment}>
            <CreditCard className="h-4 w-4 mr-2" aria-hidden /> Checkout · <Currency amount={totals.total} className="ml-1" />
          </Button>
        </footer>
      )}
    </aside>
  );
}
