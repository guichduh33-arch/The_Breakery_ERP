// apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts
// Iso-behaviour extraction of PaymentTerminal's flow logic (S-refactor 2026-06-01).
// Owns store selectors + derivations + local UI state + handlers. NOT IO-free
// (consumes Zustand + React Query) — stays in apps/pos by design. Pure math stays
// in @breakery/domain.
//
// IMPORTANT: imports useCheckout from './useCheckout' so the test mock
// vi.mock('../hooks/useCheckout', ...) (resolved from __tests__/) hits this module.

import { useEffect, useState } from 'react';
import {
  calculateTotals, earnPointsForCustomer,
  validateTenders, sumTenders, computeRemaining,
  classifyCheckoutError, type RetryClassification,
  type Tender,
  type PaymentResultLine,
  type AppliedPromotion,
} from '@breakery/domain';
import { resetCartAfterCheckout, useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';
import { useCheckout } from './useCheckout';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import { useTaxRate } from '@/features/settings/hooks/useTaxRate';
import { useEnabledPaymentMethods } from '@/features/settings/hooks/useEnabledPaymentMethods';
import { usePOSPresets } from '@/features/settings/hooks/usePOSPresets';
import { useFireToStations } from '@/features/cart/hooks/useFireToStations';
import { toast } from 'sonner';
import type { PaymentMethod } from '@breakery/domain';

export interface PaymentSuccessState {
  orderNumber: string;
  total: number;
  // S51 — server-authoritative tax + per-line breakdown (money-path v15). The
  // receipt consumes these instead of recomputing client-side. `taxAmount` falls
  // back to the pre-payment estimate only if the server omitted it.
  taxAmount: number;
  subtotal?: number;
  lines?: PaymentResultLine[];
  changeGiven: number | null;
  pointsEarned: number;
  // S44 D4 — server-resolved loyalty balance (direct/EF path only).
  loyaltyBalanceAfter?: number;
  customerName: string | undefined;
  paymentMethod: PaymentMethod;
  // Session 60 (fiche 13 D1.1) — snapshot of cartStore.appliedPromotions at the
  // moment of success, so the receipt shows named promo lines without reading
  // the store directly (parity with the other frozen PaymentSuccessState fields).
  appliedPromotions?: AppliedPromotion[];
}

export function usePaymentFlowLogic() {
  const isOpen = usePaymentStore((s) => s.isOpen);
  const closeStore = usePaymentStore((s) => s.close);
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
  const taxRate = useTaxRate();
  const enabledMethods = useEnabledPaymentMethods();
  // S64 — si la méthode draft vient d'être désactivée au BO (ou si le défaut
  // 'cash' posé par open() est désactivé), on désélectionne. paymentStore.
  // selectMethod n'accepte pas null → setState direct.
  useEffect(() => {
    if (selectedMethod && !enabledMethods.has(selectedMethod)) {
      usePaymentStore.setState({ selectedMethod: null, cashReceivedStr: '' });
    }
  }, [selectedMethod, enabledMethods]);
  const { mutation: fireToStations } = useFireToStations();
  const { presets } = usePOSPresets();
  const quickAmounts = presets.quickPayments;

  // Pre-payment estimate shown in the terminal — uses the SERVER tax rate
  // (useTaxRate) so it matches what the money-path RPC will charge. The receipt
  // (post-payment) consumes the server `tax_amount`/`total` directly below.
  const baseTotals = calculateTotals(cart, taxRate);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  const total = Math.max(0, baseTotals.total - promotionTotal);
  const tax_amount = Math.round((total * taxRate) / (1 + taxRate));
  const totals = { ...baseTotals, total, tax_amount };

  const tenderedSum = sumTenders(tenders);
  const remaining = computeRemaining(total, tenders);

  const draftAmount = Number(cashReceivedStr || '0');
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
    && (isCashDraft || draftAmount === draftTenderAmount);

  const fastPathReady =
    tenders.length === 0
    && selectedMethod !== null
    && (
      (isCashDraft && draftAmount >= total)
      || (!isCashDraft && draftAmount === total)
    );

  const canProcess = remaining === 0 || fastPathReady;

  const [success, setSuccess] = useState<PaymentSuccessState | null>(null);
  const [lastError, setLastError] = useState<RetryClassification | null>(null);
  const [lastTendersShipped, setLastTendersShipped] = useState<Tender[] | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);

  function close(): void {
    // S43 P0-1b — un fatal corrigé hors modal (ex: discount ré-autorisé au PIN) ne doit pas
    // réapparaître en bannière périmée au reopen. retryable/already_paid sont préservés.
    setLastError((prev) => (prev?.kind === 'fatal' ? null : prev));
    closeStore();
  }

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

    const v = validateTenders(total, tendersToShip);
    if (!v.ok) {
      toast.error(`Validation: ${v.error}${v.detail ? ` — ${v.detail}` : ''}`);
      return;
    }

    await dispatchCheckout(tendersToShip);
  }

  async function dispatchCheckout(tendersToShip: Tender[]): Promise<void> {
    setLastError(null);
    setLastTendersShipped(tendersToShip);
    try {
      const result = await checkout.mutateAsync({ cart, payment: tendersToShip });

      // S43 P0-3 — printOnly: the order already exists in the DB (created by
      // complete_order_with_payment_v11 / paid via pay_existing_order_v7).
      // Persisting here would mint an orphan order or append to a paid one.
      fireToStations.mutateAsync({ orderNumber: result.order_number, printOnly: true }).then((results) => {
        for (const r of results) {
          if (!r.ok) {
            toast.error(`${r.role} printer unreachable — ticket saved to KDS, not printed`);
          }
        }
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown';
        toast.error(`Station print failed: ${message}`);
      });

      // S44 D4 — points and balance come from the server envelope (the DB
      // resolves the tier × category multiplier). Fall back to the local
      // estimate only if the server omitted points (legacy / no customer).
      setSuccess({
        orderNumber: result.order_number,
        total: result.total,
        // S51 — consume server tax/subtotal/lines; fall back to the pre-payment
        // estimate for tax only if the envelope omitted it (legacy pickup path).
        taxAmount: result.tax_amount ?? tax_amount,
        ...(result.subtotal != null ? { subtotal: result.subtotal } : {}),
        ...(result.lines ? { lines: result.lines } : {}),
        changeGiven: result.change_given,
        pointsEarned: result.loyalty_points_earned
          ?? (attachedCustomer
            ? earnPointsForCustomer(result.total, attachedCustomer.lifetime_points)
            : 0),
        ...(result.loyalty_balance_after != null ? { loyaltyBalanceAfter: result.loyalty_balance_after } : {}),
        customerName: attachedCustomer?.name ?? undefined,
        paymentMethod: tendersToShip[0]!.method,
        ...(appliedPromotions.length > 0 ? { appliedPromotions } : {}),
      });
    } catch (err: unknown) {
      const classified = classifyCheckoutError(err);
      setLastError(classified);
      // S72 audit — journal the failed charge (fraud/ops signal: repeated
      // failures, or a "failed" payment that actually went through). No order_id:
      // the order isn't created on the failure path.
      emitPosEvent('payment_failed', {
        amount: total,
        reason: err instanceof Error ? err.message : String(err),
        payload: { kind: classified.kind, method: tendersToShip[0]?.method ?? null },
      });
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

  return {
    // modal
    isOpen, close,
    // identity / data
    user, cart, attachedCustomer, appliedPromotions, totals, tenderedSum,
    // method + draft
    selectedMethod, selectMethod, cashReceivedStr, setCashReceivedStr,
    quickAmounts, draftAmount, isCashDraft, draftTenderAmount, cashChange, draftValid,
    // tenders
    tenders, removeTender,
    // flow flags
    total, remaining, fastPathReady, canProcess,
    checkoutPending: checkout.isPending,
    // ui state
    success, lastError, splitOpen, setSplitOpen,
    // handlers
    handleAddTender, handleProcess, handleRetry,
    handleDismissAlreadyPaid, handleNewOrder, handleSplitComplete,
  };
}
