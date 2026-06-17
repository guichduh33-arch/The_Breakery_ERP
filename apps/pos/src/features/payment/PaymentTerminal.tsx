// apps/pos/src/features/payment/PaymentTerminal.tsx
// Session 10 — sequential multi-tender flow. Cashier picks method, types amount,
// clicks "Add Tender" to push it to the running list. When remaining = 0, "Process
// Payment" finalizes all tenders atomically via RPC v8.
//
// Single-tender fast-path: if no tenders accumulated AND a cash draft covers the
// total, the cashier can hit "Process Payment" directly — equivalent to v7 behaviour
// (the store will ship a single-element tenders array).
//
// Refactored 2026-06-01: flow logic extracted to usePaymentFlowLogic; JSX sub-blocks
// extracted to presentation components. Iso-behaviour.

import { ArrowLeft, CheckCircle2, X } from 'lucide-react';
import {
  Button, Currency, FullScreenModal,
  SectionLabel, TenderListBuilder,
} from '@breakery/ui';
import {
  calculateChange,
} from '@breakery/domain';
import { SuccessModal } from './SuccessModal';
import { SplitPaymentFlow } from './split/SplitPaymentFlow';
import { usePaymentFlowLogic } from './hooks/usePaymentFlowLogic';
import { RetryBanner } from './components/RetryBanner';
import { PaymentMethodGrid } from './components/PaymentMethodGrid';
import { TenderDraftPanel } from './components/TenderDraftPanel';
import { QuickPayRow } from './components/QuickPayRow';
import { OrderSummaryPanel } from './components/OrderSummaryPanel';

export function PaymentTerminal() {
  const {
    isOpen, close,
    user, cart, attachedCustomer, appliedPromotions, totals, tenderedSum,
    selectedMethod, selectMethod, cashReceivedStr, setCashReceivedStr,
    quickAmounts, draftAmount, isCashDraft, draftTenderAmount, cashChange, draftValid,
    tenders, removeTender,
    total, remaining, fastPathReady, canProcess, checkoutPending,
    success, lastError, splitOpen, setSplitOpen,
    handleAddTender, handleProcess, handleRetry,
    handleDismissAlreadyPaid, handleNewOrder, handleSplitComplete,
  } = usePaymentFlowLogic();

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
        {...(success.loyaltyBalanceAfter !== undefined ? { loyaltyBalanceAfter: success.loyaltyBalanceAfter } : {})}
      />
    );
  }

  if (splitOpen) {
    return (
      <FullScreenModal open={isOpen} onOpenChange={close} accessibleTitle="Payment terminal">
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
    <FullScreenModal open={isOpen} onOpenChange={close} accessibleTitle="Payment terminal">
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
        <OrderSummaryPanel
          cart={cart}
          attachedCustomer={attachedCustomer}
          appliedPromotions={appliedPromotions}
          totals={totals}
        />

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

          <RetryBanner
            lastError={lastError}
            checkoutPending={checkoutPending}
            onRetry={handleRetry}
            onDismissAlreadyPaid={handleDismissAlreadyPaid}
          />

          {/* Quick-pay row : prominent CASH EXACT (when fast-path-ready) + SPLIT BY ITEM */}
          {remaining > 0 && (
            <QuickPayRow
              fastPathReady={fastPathReady}
              isCashDraft={isCashDraft}
              selectedMethod={selectedMethod}
              total={total}
              checkoutPending={checkoutPending}
              cartEmpty={cart.items.length === 0}
              onProcess={() => { void handleProcess(); }}
              onSplitOpen={() => setSplitOpen(true)}
            />
          )}

          {remaining > 0 && (
            <>
              <PaymentMethodGrid selectedMethod={selectedMethod} onSelect={selectMethod} />

              {selectedMethod && (
                <TenderDraftPanel
                  cashReceivedStr={cashReceivedStr}
                  setCashReceivedStr={setCashReceivedStr}
                  isCashDraft={isCashDraft}
                  cashChange={cashChange}
                  draftTenderAmount={draftTenderAmount}
                  draftAmount={draftAmount}
                  remaining={remaining}
                  quickAmounts={quickAmounts}
                  draftValid={draftValid}
                  onAddTender={handleAddTender}
                />
              )}
            </>
          )}
        </section>
      </div>

      <footer className="h-16 flex items-center justify-between px-6 border-t border-border-subtle bg-bg-elevated">
        <Button variant="secondary" onClick={close}>Cancel</Button>
        {/* GREEN (primary), not gold — intentional. Gold = "go to pay" (the
            Checkout button in BottomActionBar); green = "commit the money"
            here, the irreversible final action. See BottomActionBar checkout. */}
        <Button
          variant="primary"
          size="lg"
          disabled={!canProcess || checkoutPending}
          onClick={() => { void handleProcess(); }}
        >
          {checkoutPending ? (
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

// calculateChange import retained for potential SuccessModal interplay; helpers kept in domain.
void calculateChange;
