// apps/pos/src/features/payment/PaymentTerminal.tsx
import { useState } from 'react';
import { X, ArrowLeft, Banknote, CreditCard, QrCode, Smartphone, ArrowRightLeft, Wallet } from 'lucide-react';
import { Button, Currency, FullScreenModal, LoyaltyBadge, Numpad, PromotionLineRow, cn } from '@breakery/ui';
import { calculateTotals, calculateChange, earnPointsForCustomer, tierFromLifetime, TIERS, type PaymentMethod } from '@breakery/domain';
import { resetCartAfterCheckout, useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';
import { useCheckout } from './hooks/useCheckout';
import { SuccessModal } from './SuccessModal';
import { toast } from 'sonner';
import type { LucideProps } from 'lucide-react';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';

const TAX_RATE = 0.10;

type IconComponent = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;

const METHODS: { value: PaymentMethod; label: string; icon: IconComponent }[] = [
  { value: 'cash',         label: 'Cash',         icon: Banknote },
  { value: 'card',         label: 'Card',         icon: CreditCard },
  { value: 'qris',         label: 'QRIS',         icon: QrCode },
  { value: 'edc',          label: 'EDC',          icon: Smartphone },
  { value: 'transfer',     label: 'Transfer',     icon: ArrowRightLeft },
  { value: 'store_credit', label: 'Store Credit', icon: Wallet },
];

const QUICK_AMOUNTS = [50000, 100000, 150000, 200000, 500000];

interface SuccessState {
  orderNumber: string;
  total: number;
  changeGiven: number | null;
  pointsEarned: number;
  customerName: string | undefined;
}

export function PaymentTerminal() {
  const isOpen = usePaymentStore((s) => s.isOpen);
  const close = usePaymentStore((s) => s.close);
  const reset = usePaymentStore((s) => s.reset);
  const selectedMethod = usePaymentStore((s) => s.selectedMethod);
  const selectMethod = usePaymentStore((s) => s.selectMethod);
  const cashReceivedStr = usePaymentStore((s) => s.cashReceivedStr);
  const setCashReceivedStr = usePaymentStore((s) => s.setCashReceivedStr);

  const cart = useCartStore((s) => s.cart);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const appliedPromotions = useCartStore((s) => s.appliedPromotions);
  const user = useAuthStore((s) => s.user);
  const checkout = useCheckout();

  const baseTotals = calculateTotals(cart, TAX_RATE);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  const total = Math.max(0, baseTotals.total - promotionTotal);
  const tax_amount = Math.round((total * TAX_RATE) / (1 + TAX_RATE));
  const totals = { ...baseTotals, total, tax_amount };
  const cashReceived = Number(cashReceivedStr || '0');
  const changeGiven = calculateChange(totals.total, cashReceived);

  const [success, setSuccess] = useState<SuccessState | null>(null);

  const canProcess = (() => {
    if (selectedMethod === 'cash') return cashReceived >= totals.total;
    if (selectedMethod === null) return false;
    return true;
  })();

  async function handleProcess() {
    if (!selectedMethod || !canProcess) return;
    try {
      const result = await checkout.mutateAsync({
        cart,
        payment: {
          method: selectedMethod,
          amount: totals.total,
          ...(selectedMethod === 'cash' ? { cash_received: cashReceived, change_given: changeGiven } : {}),
        },
      });
      setSuccess({
        orderNumber: result.order_number,
        total: result.total,
        changeGiven: result.change_given,
        pointsEarned: attachedCustomer
          ? earnPointsForCustomer(result.total, attachedCustomer.lifetime_points)
          : 0,
        customerName: attachedCustomer?.name ?? undefined,
      });
    } catch (err: unknown) {
      const e = err as { details?: { error?: string } };
      toast.error(`Payment failed: ${e.details?.error ?? 'unknown'}`);
    }
  }

  function handleNewOrder() {
    setSuccess(null);
    resetCartAfterCheckout();
    reset();
  }

  if (success) {
    return (
      <SuccessModal
        open
        orderNumber={success.orderNumber}
        total={success.total}
        changeGiven={success.changeGiven}
        pointsEarned={success.pointsEarned}
        cart={cart}
        paymentMethod={selectedMethod ?? 'cash'}
        cashReceived={Number(cashReceivedStr || '0')}
        cashierName={user?.full_name ?? 'Cashier'}
        onNewOrder={handleNewOrder}
        {...(success.customerName ? { customerName: success.customerName } : {})}
      />
    );
  }

  return (
    <FullScreenModal open={isOpen} onOpenChange={close}>
      <header className="h-14 flex items-center justify-between px-6 border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-center gap-3">
          <span className="font-serif text-lg">The Breakery</span>
          <span className="text-text-secondary text-xs uppercase tracking-widest">Terminal</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-text-secondary text-sm">Server: <span className="text-text-primary font-semibold">{user?.full_name}</span></span>
          <Button variant="ghost" size="sm" onClick={close}>
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden /> Back to Cart
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={close}>
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-2 gap-px bg-border-subtle overflow-hidden">
        {/* LEFT — order summary */}
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
            {/* Session 9 — applied promotions in the payment summary. */}
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

        {/* RIGHT — payment controls */}
        <section className="bg-bg-base p-6 overflow-y-auto">
          <div className="space-y-1 mb-6">
            <div className="text-xs uppercase tracking-widest text-text-secondary">Total Amount</div>
            <Currency amount={totals.total} emphasis="gold" className="text-4xl block" />
            <div className="text-xs text-text-secondary">
              Remaining: <Currency amount={Math.max(0, totals.total - cashReceived)} className="text-text-primary" />
            </div>
          </div>

          {selectedMethod === 'cash' && cashReceived >= totals.total && (
            <Button variant="primary" size="lg" className="w-full mb-4" onClick={() => { void handleProcess(); }} disabled={checkout.isPending}>
              {checkout.isPending ? 'Processing…' : `Cash Exact — ${formatLabel(totals.total)}`}
            </Button>
          )}

          <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Select Payment Method</div>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const active = selectedMethod === m.value;
              return (
                <button
                  key={m.value}
                  onClick={() => selectMethod(m.value)}
                  className={cn(
                    'h-24 rounded-md border flex flex-col items-center justify-center gap-1 transition-colors',
                    active ? 'border-gold bg-gold-soft text-gold' : 'border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  <span className="text-xs uppercase tracking-wide font-semibold">{m.label}</span>
                </button>
              );
            })}
          </div>

          {selectedMethod === 'cash' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Enter Amount</div>
                  <div className="bg-bg-input border-2 border-gold rounded-md p-4 text-center">
                    <span className="text-2xl font-mono">Rp {cashReceivedStr || '0'}</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Cash Received</div>
                  <div className="bg-bg-input border border-border-subtle rounded-md p-4 text-right">
                    <Currency amount={cashReceived} emphasis="gold" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Amount Received</div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setCashReceivedStr(String(totals.total))}
                      className={cn(
                        'rounded-md py-3 text-sm border',
                        cashReceived === totals.total
                          ? 'bg-gold text-bg-base border-gold'
                          : 'bg-bg-input border-border-subtle hover:bg-bg-overlay',
                      )}
                    >
                      Exact ({formatLabel(totals.total)})
                    </button>
                    {QUICK_AMOUNTS.filter((q) => q >= totals.total).slice(0, 5).map((q) => (
                      <button
                        key={q}
                        onClick={() => setCashReceivedStr(String(q))}
                        className="rounded-md py-3 text-sm bg-bg-input border border-border-subtle hover:bg-bg-overlay"
                      >
                        {formatLabel(q)}
                      </button>
                    ))}
                  </div>
                </div>
                <Numpad value={cashReceivedStr} onChange={setCashReceivedStr} />
              </div>
            </div>
          )}
        </section>
      </div>

      <footer className="h-16 flex items-center justify-between px-6 border-t border-border-subtle bg-bg-elevated">
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          size="lg"
          disabled={!canProcess || checkout.isPending}
          onClick={() => { void handleProcess(); }}
        >
          {checkout.isPending ? 'Processing…' : '✓ Process Payment'}
        </Button>
      </footer>
    </FullScreenModal>
  );
}

function formatLabel(amount: number): string {
  return `Rp ${amount.toLocaleString('en-US')}`;
}
