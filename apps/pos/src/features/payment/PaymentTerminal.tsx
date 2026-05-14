// apps/pos/src/features/payment/PaymentTerminal.tsx
// Session 10 — sequential multi-tender flow. Cashier picks method, types amount,
// clicks "Add Tender" to push it to the running list. When remaining = 0, "Process
// Payment" finalizes all tenders atomically via RPC v8.
//
// Single-tender fast-path: if no tenders accumulated AND a cash draft covers the
// total, the cashier can hit "Process Payment" directly — equivalent to v7 behaviour
// (the store will ship a single-element tenders array).

import { useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRightLeft, Banknote, CheckCircle2, CreditCard, Plus, QrCode, RefreshCw, Smartphone, Users, Wallet, X } from 'lucide-react';
import {
  Button, Currency, FullScreenModal, LoyaltyBadge, Numpad,
  PromotionLineRow, SectionLabel, TenderListBuilder, cn,
} from '@breakery/ui';
import {
  calculateTotals, calculateChange, earnPointsForCustomer, tierFromLifetime, TIERS,
  validateTenders, sumTenders, computeRemaining,
  classifyCheckoutError, type RetryClassification,
  type PaymentMethod, type Tender,
} from '@breakery/domain';
import { resetCartAfterCheckout, useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';
import { useCheckout } from './hooks/useCheckout';
import { SuccessModal } from './SuccessModal';
import { SplitPaymentFlow } from './split/SplitPaymentFlow';
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
  /**
   * Phase 4.A — idempotency-aware retry state. When the RPC throws we keep
   * the last shipped tenders array around (so the Retry button can resend
   * the exact same payload — and crucially the same `idempotencyKey` from
   * the store, which is regenerated only on close/reset).
   */
  const [lastError, setLastError] = useState<RetryClassification | null>(null);
  const [lastTendersShipped, setLastTendersShipped] = useState<Tender[] | null>(null);
  /** Session 14 / Phase 2.C — split-by-item flow toggle. When true, the
   *  split sub-flow takes over the modal body until the cashier completes
   *  the assignment + per-payer payment steps. */
  const [splitOpen, setSplitOpen] = useState(false);

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

    await dispatchCheckout(tendersToShip);
  }

  /**
   * Phase 4.A — extracted so the inline Retry button can re-run the same
   * payload (including the same idempotencyKey from the paymentStore) without
   * the user retouching the numpad. The store's idempotency key is regenerated
   * only on close/reset ; this Retry preserves it.
   */
  async function dispatchCheckout(tendersToShip: Tender[]): Promise<void> {
    setLastError(null);
    setLastTendersShipped(tendersToShip);
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
      const classified = classifyCheckoutError(err);
      setLastError(classified);
      // Toast for fatal-only ; retryable + already_paid use the inline banner
      // (more actionable than a transient toast).
      if (classified.kind === 'fatal') {
        toast.error(classified.userMessage);
      }
    }
  }

  function handleRetry(): void {
    if (!lastTendersShipped) return;
    void dispatchCheckout(lastTendersShipped);
  }

  function handleDismissAlreadyPaid(): void {
    // Order already finalized — close the modal and reset state. The
    // resetCartAfterCheckout / reset() pair regenerates the idempotency key.
    resetCartAfterCheckout();
    reset();
    setLastError(null);
    setLastTendersShipped(null);
  }

  function handleNewOrder(): void {
    setSuccess(null);
    resetCartAfterCheckout();
    reset();
  }

  async function handleSplitComplete(splitTenders: Tender[]): Promise<void> {
    const v = validateTenders(total, splitTenders);
    if (!v.ok) {
      toast.error(`Validation: ${v.error}${v.detail ? ` — ${v.detail}` : ''}`);
      return;
    }
    await dispatchCheckout(splitTenders);
    setSplitOpen(false);
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

  if (splitOpen) {
    return (
      <FullScreenModal open={isOpen} onOpenChange={close}>
        <SplitPaymentFlow
          cartItems={cart.items}
          grandTotal={total}
          onCancel={() => setSplitOpen(false)}
          onComplete={(t) => { void handleSplitComplete(t); }}
        />
      </FullScreenModal>
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
          <div className="space-y-1 mb-4">
            <SectionLabel as="div">Total Amount</SectionLabel>
            <Currency amount={totals.total} emphasis="gold" className="text-4xl block" />
            <div
              aria-hidden
              className="h-0.5 w-full rounded-full bg-border-subtle overflow-hidden mt-2"
            >
              <div
                className="h-full bg-gold transition-all duration-300"
                style={{ width: `${total > 0 ? Math.min(100, (tenderedSum / total) * 100) : 0}%` }}
              />
            </div>
            <div className="text-xs text-text-secondary text-right pt-1">
              Remaining: <span className="text-text-primary font-mono"><Currency amount={remaining} /></span>
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

          {/* Phase 4.A — idempotency-aware retry banner. Surfaces transient
              failures with a one-click Retry that reuses the same idempotency
              key (regenerated only on close/reset) so the server returns the
              same row instead of double-charging. */}
          {lastError?.kind === 'retryable' && (
            <div
              role="alert"
              data-testid="payment-retry-banner"
              className="mb-4 rounded-md border border-warning bg-warning-soft p-3 text-sm"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-warning shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text-primary">Payment did not reach the server</div>
                  <p className="text-text-secondary mt-1">{lastError.userMessage}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={handleRetry}
                    disabled={checkout.isPending}
                    data-testid="payment-retry-button"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                    {checkout.isPending ? 'Retrying…' : 'Retry payment'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {lastError?.kind === 'already_paid' && (
            <div
              role="alert"
              data-testid="payment-already-paid-banner"
              className="mb-4 rounded-md border border-success bg-success-soft p-3 text-sm"
            >
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-success shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text-primary">Order already finalized</div>
                  <p className="text-text-secondary mt-1">{lastError.userMessage}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={handleDismissAlreadyPaid}
                    data-testid="payment-already-paid-dismiss"
                  >
                    Continue
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Quick-pay row : prominent CASH EXACT (when fast-path-ready) + SPLIT BY ITEM */}
          {remaining > 0 && (
            <div className="flex items-stretch gap-3 mb-5">
              {fastPathReady ? (
                <button
                  type="button"
                  onClick={() => { void handleProcess(); }}
                  disabled={checkout.isPending}
                  data-testid="pay-cash-exact"
                  className="flex-1 h-12 rounded-md bg-green hover:bg-green/90 text-white font-bold uppercase tracking-widest text-sm transition-colors disabled:opacity-60"
                >
                  {checkout.isPending
                    ? 'Processing…'
                    : `${isCashDraft ? 'Cash' : selectedMethod?.toUpperCase()} Exact — ${formatLabel(total)}`}
                </button>
              ) : (
                <div className="flex-1 h-12 rounded-md border border-dashed border-border-subtle grid place-items-center text-text-muted text-xs uppercase tracking-widest">
                  Select a method to proceed
                </div>
              )}
              <button
                type="button"
                onClick={() => setSplitOpen(true)}
                disabled={cart.items.length === 0 || checkout.isPending}
                data-testid="pay-split-entry"
                className="h-12 px-4 rounded-md border border-purple-400/60 bg-purple-400/10 text-purple-400 font-bold uppercase tracking-widest text-xs hover:bg-purple-400/20 transition-colors disabled:opacity-40 inline-flex items-center gap-2"
              >
                <Users className="h-3.5 w-3.5" aria-hidden />
                Split by Item
              </button>
            </div>
          )}

          {remaining > 0 && (
            <>
              <SectionLabel as="div" className="mb-2">Select Payment Method</SectionLabel>
              <div className="grid grid-cols-3 gap-3 mb-6">
                {METHODS.map((m) => {
                  const Icon = m.icon;
                  const active = selectedMethod === m.value;
                  return (
                    <button
                      key={m.value}
                      onClick={() => selectMethod(m.value)}
                      className={cn(
                        'h-24 rounded-md border flex flex-col items-center justify-center gap-1.5 transition-colors',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold',
                        active
                          ? 'border-gold bg-gold-soft text-gold'
                          : 'border-border-subtle bg-bg-elevated text-text-secondary hover:text-text-primary hover:border-gold/60',
                      )}
                      data-testid={`pay-method-${m.value}`}
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                      <span className="text-xs uppercase tracking-widest font-semibold">{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {selectedMethod && (
                <div className="space-y-4 mb-4">
                  {/* ENTER AMOUNT — big centered display */}
                  <div>
                    <SectionLabel as="div" className="text-gold mb-2 text-center">
                      Enter Amount
                    </SectionLabel>
                    <div className="bg-bg-input border-2 border-gold rounded-md py-5 text-center">
                      <span className="font-mono tabular-nums text-3xl text-text-primary">
                        Rp {cashReceivedStr || '0'}
                      </span>
                    </div>
                    {isCashDraft && cashChange > 0 && draftTenderAmount === remaining && (
                      <div className="mt-2 text-xs text-text-secondary text-right">
                        Change: <Currency amount={cashChange} className="text-gold" />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* AMOUNT RECEIVED preset grid */}
                    <div>
                      <SectionLabel as="div" className="text-gold mb-2">Amount Received</SectionLabel>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setCashReceivedStr(String(remaining))}
                          className={cn(
                            'col-span-2 rounded-md py-2.5 text-xs font-bold uppercase tracking-widest border',
                            draftAmount === remaining
                              ? 'bg-gold text-bg-base border-gold'
                              : 'bg-bg-input border-border-subtle hover:bg-bg-overlay text-text-primary',
                          )}
                        >
                          Exact ({formatLabel(remaining)})
                        </button>
                        {isCashDraft && QUICK_AMOUNTS.filter((q) => q >= remaining).slice(0, 4).map((q) => (
                          <button
                            key={q}
                            onClick={() => setCashReceivedStr(String(q))}
                            className="rounded-md py-2.5 text-xs font-mono tabular-nums bg-bg-input border border-border-subtle hover:bg-bg-overlay text-text-primary"
                          >
                            {formatLabel(q)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Numpad */}
                    <div>
                      <SectionLabel as="div" className="text-gold mb-2">Cash Received</SectionLabel>
                      <Numpad value={cashReceivedStr} onChange={setCashReceivedStr} />
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="lg"
                    className="w-full uppercase tracking-widest"
                    onClick={handleAddTender}
                    disabled={!draftValid}
                    data-testid="pay-add-tender"
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
          {checkout.isPending ? (
            'Processing…'
          ) : (
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Process Payment
            </span>
          )}
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
