// apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts
// Iso-behaviour extraction of PaymentTerminal's flow logic (S-refactor 2026-06-01).
// Owns store selectors + derivations + local UI state + handlers. NOT IO-free
// (consumes Zustand + React Query) — stays in apps/pos by design. Pure math stays
// in @breakery/domain.
//
// IMPORTANT: imports useCheckout from './useCheckout' so the test mock
// vi.mock('../hooks/useCheckout', ...) (resolved from __tests__/) hits this module.

import { useState } from 'react';
import {
  calculateTotals, earnPointsForCustomer,
  validateTenders, sumTenders, computeRemaining,
  classifyCheckoutError, type RetryClassification,
  type Tender,
} from '@breakery/domain';
import { resetCartAfterCheckout, useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';
import { useCheckout } from './useCheckout';
import { usePOSPresets } from '@/features/settings/hooks/usePOSPresets';
import { useFireToStations } from '@/features/cart/hooks/useFireToStations';
import { toast } from 'sonner';
import type { PaymentMethod } from '@breakery/domain';

const TAX_RATE = 0.10;

export interface PaymentSuccessState {
  orderNumber: string;
  total: number;
  changeGiven: number | null;
  pointsEarned: number;
  customerName: string | undefined;
  paymentMethod: PaymentMethod;
}

export function usePaymentFlowLogic() {
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
  const { mutation: fireToStations } = useFireToStations();
  const { presets } = usePOSPresets();
  const quickAmounts = presets.quickPayments;

  const baseTotals = calculateTotals(cart, TAX_RATE);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  const total = Math.max(0, baseTotals.total - promotionTotal);
  const tax_amount = Math.round((total * TAX_RATE) / (1 + TAX_RATE));
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

      fireToStations.mutateAsync({ orderNumber: result.order_number }).then((results) => {
        for (const r of results) {
          if (!r.ok) {
            toast.error(`${r.role} printer unreachable — ticket not printed`);
          }
        }
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown';
        toast.error(`Station print failed: ${message}`);
      });

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
