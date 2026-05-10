// apps/pos/src/features/payment/PaymentTerminal.tsx
// Session 10 — sequential multi-tender flow. Cashier picks method, types amount,
// clicks "Add Tender" to push it to the running list. When remaining = 0, "Process
// Payment" finalizes all tenders atomically via RPC v8.
//
// Single-tender fast-path: if no tenders accumulated AND a cash draft covers the
// total, the cashier can hit "Process Payment" directly — equivalent to v7 behaviour
// (the store will ship a single-element tenders array).

import { useState } from 'react';
import { X, ArrowLeft, Banknote, CreditCard, QrCode, Smartphone, ArrowRightLeft, Wallet, Plus } from 'lucide-react';
import {
  Button, Currency, FullScreenModal, LoyaltyBadge, Numpad,
  PromotionLineRow, TenderListBuilder, cn,
} from '@breakery/ui';
import {
  calculateTotals, calculateChange, earnPointsForCustomer, tierFromLifetime, TIERS,
  validateTenders, sumTenders, computeRemaining,
  type PaymentMethod, type Tender,
} from '@breakery/domain';
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
  paymentMethod: PaymentMethod;
}

export function PaymentTerminal() {
  const isOpen = usePaymentStore((s) => s.isOpen);
  const close = usePaymentStore((s) => s.close);
  const reset = usePaymentStore((s) => s.reset);
  const selectedMethod = usePaymentStore((s) => s.selectedMethod);
  const selectMethod = usePaymentStore((s) => s.selectMethod);
  const cashReceivedStr = usePaymentStore((s) => s.cashReceivedStr);
  const setCashReceivedStr = usePaymentStore((s) => s.setCashReceivedStr);
  const tenders = usePaymentStore((s) => s.tenders);
  const addTender = usePaymentStore((s) => s.addTender);
  const removeTender = usePaymentStore((s) => s.removeTender);

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

  const tenderedSum = sumTenders(tenders);
  const remaining = computeRemaining(total, tenders);

  // Draft state derived from selectedMethod + cashReceivedStr
  const draftAmount = Number(cashReceivedStr || '0');
  // For cash: the amount on the tender = min(received, remaining); change = received - amount (last tender only).
  // For non-cash: amount = parsed.
  const isCashDraft = selectedMethod === 'cash';
  const draftTenderAmount = isCashDraft
    ? Math.min(draftAmount, remaining)
    : draftAmount;
  const cashChange = isCashDraft && draftAmount > remaining
    ? draftAmount - remaining
    : 0;

  const draftValid =
    selectedMethod !== null
    && draftTenderAmount > 0
    && remaining > 0
    && draftTenderAmount <= remaining
    // When non-cash, must equal exactly what they typed (no overpay)
    && (isCashDraft || draftAmount === draftTenderAmount);

  // Single-tender fast-path: no accumulated tenders, draft covers total
  const fastPathReady =
    tenders.length === 0
    && selectedMethod !== null
    && (
      // cash: cashReceived >= total
      (isCashDraft && draftAmount >= total)
      // non-cash: amount === total
      || (!isCashDraft && draftAmount === total)
    );

  const canProcess = remaining === 0 || fastPathReady;

  const [success, setSuccess] = useState<SuccessState | null>(null);

  function handleAddTender(): void {
    if (!selectedMethod || !draftValid) return;
    const isLast = draftTenderAmount === remaining;
    const tender: Tender = {
      method: selectedMethod,
      amount: draftTenderAmount,
      ...(isCashDraft ? { cash_received: draftAmount } : {}),
      ...(isCashDraft && cashChange > 0 && isLast ? { change_given: cashChange } : {}),
    };
    if (isCashDraft && cashChange > 0 && !isLast) {
      toast.error('Cash overpay only allowed on the last tender');
      return;
    }
    addTender(tender);
  }

  async function handleProcess(): Promise<void> {
    let tendersToShip: Tender[];
    if (tenders.length > 0 && remaining === 0) {
      tendersToShip = tenders;
    } else if (fastPathReady && selectedMethod) {
      // Build a 1-tender from draft state
      const lastChange = isCashDraft ? Math.max(0, draftAmount - total) : 0;
      const tender: Tender = {
        method: selectedMethod,
        amount: total,
        ...(isCashDraft ? { cash_received: draftAmount } : {}),
        ...(isCashDraft && lastChange > 0 ? { change_given: lastChange } : {}),
      };
      tendersToShip = [tender];
    } else {
      return;
    }

    // Final client-side validation (server re-validates)
    const v = validateTenders(total, tendersToShip);
    if (!v.ok) {
      toast.error(`Validation: ${v.error}${v.detail ? ` — ${v.detail}` : ''}`);
      return;
    }

    try {
      const result = await checkout.mutateAsync({ cart, payment: tendersToShip });
      setSuccess({
        orderNumber: result.order_number,
        total: result.total,
        changeGiven: result.change_given,
        pointsEarned: attachedCustomer
          ? earnPointsForCustomer(result.total, attachedCustomer.lifetime_points)
          : 0,
        customerName: attachedCustomer?.name ?? undefined,
        paymentMethod: tendersToShip[0]!.method,
      });
    } catch (err: unknown) {
      const e = err as { details?: { error?: string } };
      toast.error(`Payment failed: ${e.details?.error ?? 'unknown'}`);
    }
  }

  function handleNewOrder(): void {
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
        paymentMethod={success.paymentMethod}
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
              Tendered: <Currency amount={tenderedSum} className="text-text-primary" /> · Remaining: <Currency amount={remaining} className="text-text-primary" />
            </div>
          </div>

          {/* Accumulated tenders list (session 10) */}
          {tenders.length > 0 && (
            <div className="mb-4">
              <TenderListBuilder
                tenders={tenders.map((t) => ({
                  method: t.method,
                  amount: t.amount,
                  ...(t.cash_received !== undefined ? { cash_received: t.cash_received } : {}),
                  ...(t.change_given !== undefined ? { change_given: t.change_given } : {}),
                }))}
                remaining={remaining}
                onRemoveTender={removeTender}
              />
            </div>
          )}

          {fastPathReady && remaining > 0 && (
            <Button variant="primary" size="lg" className="w-full mb-4" onClick={() => { void handleProcess(); }} disabled={checkout.isPending}>
              {checkout.isPending ? 'Processing…' : `${isCashDraft ? 'Cash' : selectedMethod?.toUpperCase()} Exact — ${formatLabel(total)}`}
            </Button>
          )}

          {remaining > 0 && (
            <>
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

              {selectedMethod && (
                <div className="space-y-4 mb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">
                        {isCashDraft ? 'Cash Received' : 'Amount'}
                      </div>
                      <div className="bg-bg-input border-2 border-gold rounded-md p-4 text-center">
                        <span className="text-2xl font-mono">Rp {cashReceivedStr || '0'}</span>
                      </div>
                      {isCashDraft && cashChange > 0 && draftTenderAmount === remaining && (
                        <div className="mt-2 text-xs text-text-secondary text-right">
                          Change: <Currency amount={cashChange} className="text-gold" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Quick</div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => setCashReceivedStr(String(remaining))}
                          className={cn(
                            'rounded-md py-3 text-sm border',
                            draftAmount === remaining
                              ? 'bg-gold text-bg-base border-gold'
                              : 'bg-bg-input border-border-subtle hover:bg-bg-overlay',
                          )}
                        >
                          Exact ({formatLabel(remaining)})
                        </button>
                        {isCashDraft && QUICK_AMOUNTS.filter((q) => q >= remaining).slice(0, 5).map((q) => (
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
                  </div>

                  <Numpad value={cashReceivedStr} onChange={setCashReceivedStr} />

                  <Button
                    variant="secondary"
                    size="lg"
                    className="w-full"
                    onClick={handleAddTender}
                    disabled={!draftValid}
                  >
                    <Plus className="h-4 w-4 mr-2" aria-hidden /> Add Tender
                  </Button>
                </div>
              )}
            </>
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

// calculateChange import retained for potential SuccessModal interplay; helpers kept in domain.
void calculateChange;
