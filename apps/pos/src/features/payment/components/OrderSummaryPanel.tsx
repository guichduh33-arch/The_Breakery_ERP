// apps/pos/src/features/payment/components/OrderSummaryPanel.tsx
// Iso-behaviour extraction of PaymentTerminal's LEFT order-summary column.
// Pure render. Loyalty multiplier math stays inline (was already inline in PT).

import { Currency, LoyaltyBadge, PromotionLineRow } from '@breakery/ui';
import { tierFromLifetime, TIERS } from '@breakery/domain';
import type { Cart, AppliedPromotion, CartTotals } from '@breakery/domain';
import type { CustomerWithCategory } from '@/stores/cartStore';

// Mirror the shape PaymentTerminal builds (CartTotals + overridden total/tax_amount).
type Totals = CartTotals & { total: number; tax_amount: number };

export interface OrderSummaryPanelProps {
  cart: Cart;
  attachedCustomer: CustomerWithCategory | null;
  appliedPromotions: AppliedPromotion[];
  totals: Totals;
}

export function OrderSummaryPanel({
  cart,
  attachedCustomer,
  appliedPromotions,
  totals,
}: OrderSummaryPanelProps) {
  return (
    <section className="bg-bg-base p-6 overflow-y-auto">
      <h3 className="text-xs uppercase tracking-widest text-text-primary mb-4">Current Order</h3>
      <table className="w-full text-sm">
        <thead className="text-text-secondary text-xs uppercase tracking-wide border-b border-border-subtle">
          <tr>
            <th className="text-left py-2">Item</th>
            <th className="text-right py-2 w-12">Qty</th>
            <th className="text-right py-2 w-24">Price</th>
          </tr>
        </thead>
        <tbody>
          {cart.items.map((it) => {
            const adj = it.modifiers.reduce((s, m) => s + m.price_adjustment, 0);
            const lineTotal = (it.unit_price + adj) * it.quantity;
            return (
              <tr key={it.id} className="border-b border-border-subtle align-top">
                <td className="py-3">
                  <div>{it.name}</div>
                  {it.modifiers.length > 0 && (
                    <div className="text-xs text-text-secondary mt-0.5">
                      {it.modifiers.map((m) => m.option_label).join(' · ')}
                    </div>
                  )}
                </td>
                <td className="text-right py-3">{it.quantity}</td>
                <td className="text-right py-3"><Currency amount={lineTotal} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-6 space-y-1 text-sm">
        {attachedCustomer && (() => {
          const tier = tierFromLifetime(attachedCustomer.lifetime_points);
          const tierMultiplier = TIERS.find((t) => t.tier === tier)?.points_multiplier ?? 1.0;
          const categoryMultiplier = attachedCustomer.category?.points_multiplier ?? 1.0;
          const cumulMultiplier = tierMultiplier * categoryMultiplier;
          const ptsToEarn = Math.floor((totals.total * cumulMultiplier) / 1000);
          return (
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-border-subtle">
              <LoyaltyBadge tier={tier} points={attachedCustomer.loyalty_points} />
              <span className="text-xs text-text-secondary">
                +{ptsToEarn} pts to earn ({cumulMultiplier.toFixed(2)}x)
              </span>
            </div>
          );
        })()}
        <div className="flex justify-between text-text-secondary">
          <span>Subtotal</span><Currency amount={totals.subtotal} />
        </div>
        {totals.redemption_amount > 0 && (
          <div className="flex justify-between text-text-secondary">
            <span>Loyalty redeem ({cart.loyaltyPointsToRedeem} pts)</span>
            <span className="font-mono text-red-400">-<Currency amount={totals.redemption_amount} /></span>
          </div>
        )}
        {appliedPromotions.map((ap) => (
          <PromotionLineRow key={ap.promotion_id} applied={ap} />
        ))}
        {cart.cartDiscount && (
          <div className="flex justify-between text-text-secondary">
            <span>
              Manual discount ({cart.cartDiscount.type === 'percentage' ? `${cart.cartDiscount.value}%` : 'fixed'})
            </span>
            <span className="font-mono text-red-400">-<Currency amount={cart.cartDiscount.amount} /></span>
          </div>
        )}
        <div className="flex justify-between text-text-secondary">
          <span>Tax (PB1 incl.)</span><Currency amount={totals.tax_amount} />
        </div>
        <div className="flex justify-between pt-3 border-t border-border-subtle">
          <span className="uppercase tracking-wide font-semibold">Total Amount</span>
          <Currency amount={totals.total} emphasis="gold" className="text-lg" />
        </div>
      </div>
    </section>
  );
}
