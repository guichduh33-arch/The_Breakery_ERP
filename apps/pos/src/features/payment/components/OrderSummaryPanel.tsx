// apps/pos/src/features/payment/components/OrderSummaryPanel.tsx
// Iso-behaviour extraction of PaymentTerminal's LEFT order-summary column.
// Pure render. Loyalty multiplier math stays inline (was already inline in PT).

import { Currency, LoyaltyBadge, PromotionLineRow, cn } from '@breakery/ui';
import { tierFromLifetime, resolveLoyaltyMultiplier, earnPointsFor, lineTotalOf } from '@breakery/domain';
import type { Cart, AppliedPromotion, CartTotals } from '@breakery/domain';
import type { CustomerWithCategory } from '@/stores/cartStore';

// Mirror the shape PaymentTerminal builds (CartTotals + overridden total/tax_amount).
type Totals = CartTotals & { total: number; tax_amount: number };

export interface OrderSummaryPanelProps {
  cart: Cart;
  attachedCustomer: CustomerWithCategory | null;
  appliedPromotions: AppliedPromotion[];
  totals: Totals;
  /** Mode taxe serveur (useTaxConfig) — même libellé conditionnel que le panier. */
  taxInclusive: boolean;
}

export function OrderSummaryPanel({
  cart,
  attachedCustomer,
  appliedPromotions,
  totals,
  taxInclusive,
}: OrderSummaryPanelProps) {
  return (
    <section className="bg-bg-base p-6 overflow-y-auto max-md:overflow-visible">
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
            // Critique 2026-08-29 P1 — the line total is lineTotalOf (base +
            // surcharges + combo component adjustments, ADR-017), the same
            // formula calculateTotals bills; recomputing it here understated
            // combos and the lines no longer summed to the Subtotal below.
            const lineTotal = lineTotalOf(it);
            const cancelled = it.is_cancelled === true;
            return (
              <tr key={it.id} className="border-b border-border-subtle align-top">
                <td className="py-3">
                  {/* Critique 2026-08-29 P1 — a cancelled line rendered at full
                      price with no distinction while calculateTotals excludes
                      it: struck through + badged, like CartLineRow and the
                      receipt, so the client sees it is not billed. */}
                  <div className={cn(cancelled && 'line-through text-text-muted')}>
                    {it.name}
                    {cancelled && (
                      <span className="ml-1.5 inline-flex items-center rounded-full border border-red bg-red-soft px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-as-text no-underline">
                        Cancelled
                      </span>
                    )}
                  </div>
                  {it.modifiers.length > 0 && (
                    <div className={cn('text-xs mt-0.5', cancelled ? 'line-through text-text-muted' : 'text-text-secondary')}>
                      {it.modifiers.map((m) => m.option_label).join(' · ')}
                    </div>
                  )}
                </td>
                {/* Règle du Chiffre Immobile — quantities are numbers too. */}
                <td className={cn('text-right py-3 font-mono tabular-nums', cancelled && 'text-text-muted')}>{it.quantity}</td>
                {/* Remise de ligne visible (audit 2026-08-27) — même présentation
                    que CartLineRow : total de ligne brut + remise en dessous,
                    pour que le récapitulatif se recoupe face au client. */}
                <td className="text-right py-3">
                  <Currency amount={lineTotal} className={cn(cancelled && 'line-through text-text-muted')} />
                  {it.discount && !cancelled && (
                    <div className="text-xs text-red-as-text font-mono tabular-nums">
                      {it.discount.type === 'percentage' ? (
                        `-${it.discount.value}%`
                      ) : (
                        <span>-<Currency amount={it.discount.amount} /></span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-6 space-y-1 text-sm">
        {attachedCustomer && (() => {
          const tier = tierFromLifetime(attachedCustomer.lifetime_points);
          // S72: shared multiplier + points helpers (single source of truth,
          // identical to the cart line's LoyaltyPointsLine).
          const cumulMultiplier = resolveLoyaltyMultiplier(
            attachedCustomer.lifetime_points,
            attachedCustomer.category?.points_multiplier ?? 1.0,
          );
          const ptsToEarn = earnPointsFor(totals.total, cumulMultiplier);
          return (
            <div className="mb-3 pb-3 border-b border-border-subtle">
              <div className="flex items-center justify-between">
                <LoyaltyBadge tier={tier} points={attachedCustomer.loyalty_points} />
                <span className="text-xs text-text-secondary font-mono tabular-nums">
                  +{ptsToEarn} pts to earn ({cumulMultiplier.toFixed(2)}x)
                </span>
              </div>
              {/* ADR-013 Lot 4 — solde d'avoir (snapshot v4, optionnel). */}
              {(attachedCustomer.store_credit_balance ?? 0) > 0 && (
                <div
                  className="mt-1.5 flex items-center justify-between text-xs"
                  data-testid="summary-store-credit"
                >
                  <span className="text-text-secondary">Store Credit</span>
                  <span className="font-mono text-gold">
                    <Currency amount={attachedCustomer.store_credit_balance ?? 0} />
                  </span>
                </div>
              )}
            </div>
          );
        })()}
        <div className="flex justify-between text-text-secondary">
          <span>Subtotal</span><Currency amount={totals.subtotal} />
        </div>
        {totals.redemption_amount > 0 && (
          <div className="flex justify-between text-text-secondary">
            <span>Loyalty redeem ({cart.loyaltyPointsToRedeem} pts)</span>
            <span className="font-mono text-red-as-text">-<Currency amount={totals.redemption_amount} /></span>
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
            <span className="font-mono text-red-as-text">-<Currency amount={cart.cartDiscount.amount} /></span>
          </div>
        )}
        <div className="flex justify-between text-text-secondary">
          <span>{taxInclusive ? 'Tax (PB1 incl.)' : 'Tax (PB1)'}</span><Currency amount={totals.tax_amount} />
        </div>
        <div className="flex justify-between pt-3 border-t border-border-subtle">
          <span className="uppercase tracking-wide font-semibold">Total Amount</span>
          <Currency amount={totals.total} emphasis="gold" className="text-lg" />
        </div>
      </div>
    </section>
  );
}
