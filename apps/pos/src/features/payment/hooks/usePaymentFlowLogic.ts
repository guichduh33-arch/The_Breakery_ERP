// apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts
// Iso-behaviour extraction of PaymentTerminal's flow logic (S-refactor 2026-06-01).
// Owns store selectors + derivations + local UI state + handlers. NOT IO-free
// (consumes Zustand + React Query) — stays in apps/pos by design. Pure math stays
// in @breakery/domain.
//
// IMPORTANT: imports useCheckout from './useCheckout' so the test mock
// vi.mock('../hooks/useCheckout', ...) (resolved from __tests__/) hits this module.

import { isOrderSending } from '@/stores/orderSendGuard';
import { useEffect, useState } from 'react';
import {
  calculateTotals, earnPointsForCustomer,
  validateTenders, sumTenders, computeRemaining,
  classifyCheckoutError, type RetryClassification,
  type Tender,
} from '@breakery/domain';
import { resetCartAfterCheckout, useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import type { PaymentAttempt } from '@/stores/paymentAttempt';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';
import { useCheckout } from './useCheckout';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';
import { useEnabledPaymentMethods } from '@/features/settings/hooks/useEnabledPaymentMethods';
import { usePOSPresets } from '@/features/settings/hooks/usePOSPresets';
import { useFireToStations } from '@/features/cart/hooks/useFireToStations';
import { useOfflinePaymentGate } from '@/features/lan/hooks/useOfflinePaymentGate';
import { hubBus } from '@/features/lan/hubBusClient';
import { enqueueIntent, nextIntentSeq } from '@/features/lan/offlineOutbox';
import type { OrderPaidOfflinePayload } from '@/features/lan/busTopics';
import { toast } from 'sonner';
import type { PaymentSuccessState } from './paymentSuccess';
import { nextLocalOrderNumber } from '@/features/lan/localOrderNumber';
import { getOrderSourceCode } from '@/stores/posSettingsStore';
export type { PaymentSuccessState } from './paymentSuccess';

let dispatching = false;

export function usePaymentFlowLogic() {
  const attempt = usePaymentStore((s) => s.attempt);
  const activeAttempt = attempt?.state !== 'refused' ? attempt : null;
  const [dispatchPending, setDispatchPending] = useState(false);
  const isOpen = usePaymentStore((s) => s.isOpen);
  // Lot 4 — clé d'idempotence de la tentative (même cycle de vie que l'EF
  // x-idempotency-key) : c'est elle qui identifie l'encaissement offline.
  const idempotencyKey = usePaymentStore((s) => s.idempotencyKey);
  const closeStore = usePaymentStore((s) => s.close);
  const reset = usePaymentStore((s) => s.reset);
  const markAttemptUnsettled = usePaymentStore((s) => s.markAttemptUnsettled);
  const selectedMethod = usePaymentStore((s) => s.selectedMethod);
  const selectMethod = usePaymentStore((s) => s.selectMethod);
  const cashReceivedStr = usePaymentStore((s) => s.cashReceivedStr);
  const setCashReceivedStr = usePaymentStore((s) => s.setCashReceivedStr);
  const liveTenders = usePaymentStore((s) => s.tenders);
  const tenders = activeAttempt?.tenders ?? liveTenders;
  const addTender = usePaymentStore((s) => s.addTender);
  const removeTender = usePaymentStore((s) => s.removeTender);

  const liveCart = useCartStore((s) => s.cart);
  const cart = activeAttempt?.cart ?? liveCart;
  const liveCustomer = useCartStore((s) => s.attachedCustomer);
  const attachedCustomer = activeAttempt ? activeAttempt.customer : liveCustomer;
  const livePromotions = useCartStore((s) => s.appliedPromotions);
  const appliedPromotions = activeAttempt?.context.appliedPromotions ?? livePromotions;
  const user = useAuthStore((s) => s.user);
  const checkout = useCheckout();
  const taxConfig = useTaxConfig();
  const taxRate = activeAttempt?.taxRate ?? taxConfig.taxRate;
  const taxInclusive = activeAttempt?.taxInclusive ?? taxConfig.taxInclusive;
  const enabledMethods = useEnabledPaymentMethods();
  // S64 — si la méthode draft vient d'être désactivée au BO (ou si le défaut
  // 'cash' posé par open() est désactivé), on désélectionne. paymentStore.
  // selectMethod n'accepte pas null → setState direct.
  useEffect(() => {
    if (selectedMethod && !enabledMethods.has(selectedMethod)) {
      usePaymentStore.setState({ selectedMethod: null, cashReceivedStr: '' });
    }
  }, [selectedMethod, enabledMethods]);
  // ADR-013 Lot 4 (D8) — store_credit exige un client rattaché (gate serveur
  // P0015) : si le client est détaché après sélection, on désélectionne
  // (la tuile a déjà disparu de la grille — miroir du guard S64 ci-dessus).
  useEffect(() => {
    if (selectedMethod === 'store_credit' && !attachedCustomer) {
      usePaymentStore.setState({ selectedMethod: null, cashReceivedStr: '' });
    }
  }, [selectedMethod, attachedCustomer]);
  const { mutation: fireToStations } = useFireToStations();
  // ADR-015 — gate hors-ligne : mode OFFLINE + réglage offline_payments_enabled
  // (la fenêtre de durée A5 est supprimée).
  const offlineGate = useOfflinePaymentGate();
  const { presets } = usePOSPresets();
  const quickAmounts = presets.quickPayments;

  // Pre-payment estimate shown in the terminal — uses the SERVER tax config
  // (useTaxConfig: rate + inclusive mode) so it matches what the money-path RPC
  // will charge. ADR-013 D11 : la promo vit dans `cart.promotionTotal` (écrit
  // par setAppliedPromotions) — calculateTotals applique l'ordre canonique
  // items → promo → redemption → remise panier → taxe, plus aucun
  // post-traitement ici. The receipt (post-payment) consumes the server
  // `tax_amount`/`total` directly below.
  const totals = calculateTotals(cart, taxRate, taxInclusive);
  const { tax_amount, total } = totals;

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

  const [success, setSuccessState] = useState<PaymentSuccessState | null>(activeAttempt?.result ?? null);
  function setSuccess(result: PaymentSuccessState | null) {
    if (result) usePaymentStore.getState().completeAttempt(result);
    setSuccessState(result);
  }
  const [lastError, setLastError] = useState<RetryClassification | null>(() => activeAttempt && !activeAttempt.result ? { kind: 'retryable', userMessage: 'Payment confirmation unavailable — resume the saved attempt' } : null);
  const [lastTendersShipped, setLastTendersShipped] = useState<Tender[] | null>(() => activeAttempt?.tenders ?? null);
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
    if (activeAttempt) { await dispatchCheckout(activeAttempt.tenders); return; }
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

  // ADR-015 — encaissement en mode OFFLINE : la vente est journalisée dans
  // l'outbox durable (clé = idempotencyKey de la tentative) et rejouée vers
  // pay_existing_order au retour du cloud. Aucun montant n'est validé
  // serveur ici : cash exact/rendu calculés client, totaux au tarif catalogue —
  // les flux online-only (promos, remise commande, points) sont refusés
  // proprement en amont.
  //
  // Toutes les méthodes sont acceptées SAUF store_credit : l'EDC carte/QRIS
  // encaisse par sa propre SIM et le POS ne fait qu'enregistrer, tandis que le
  // solde d'un avoir se vérifie serveur sous verrou — un intent d'avoir rejeté
  // au replay bloquerait tout le drain derrière lui.
  function validateOfflinePayment(snapshot: PaymentAttempt): void {
    const tendersToShip = snapshot.tenders;
    if (offlineGate.offlineMode && !offlineGate.paymentsAllowed) {
      throw new Error('Offline payments are disabled — ask a manager to enable them in the Back Office');
    }
    if (tendersToShip.length < 1 || tendersToShip.length > 5) {
      throw new Error('Offline: 1 to 5 tenders per sale');
    }
    if (tendersToShip.some((t) => t.method === 'store_credit')) {
      throw new Error('Store credit unavailable offline — remove this tender');
    }
    if (snapshot.context.pickedUpOrderId !== null) {
      throw new Error('Cloud order — payment unavailable offline');
    }
    if (snapshot.context.appliedPromotions.length > 0 || snapshot.cart.cartDiscount !== undefined) {
      throw new Error('Promotions and order discounts unavailable offline — remove before checkout');
    }
    if ((snapshot.cart.loyaltyPointsToRedeem ?? 0) > 0) {
      throw new Error('Points redemption unavailable offline');
    }

  }

  async function dispatchOfflinePayment(snapshot: PaymentAttempt): Promise<void> {
    const tendersToShip = snapshot.tenders;
    const cartState = useCartStore.getState();
    // La commande locale doit exister sur le bus/KDS avant l'encaissement :
    // fire offline maintenant si le panier n'a pas encore été envoyé (vente
    // comptoir directe — items 'none' inclus, aucun KOT superflu).
    if (cartState.offlineOrder === null || cartState.cart.items.some((item) => !item.is_cancelled && !cartState.lockedItemIds.includes(item.id))) {
      await fireToStations.mutateAsync({ clientUuid: snapshot.context.appendUuid, forceOffline: true });
    }
    const offlineOrder = useCartStore.getState().offlineOrder;
    // La liaison créée par l'envoi est durable avant l'enregistrement du règlement.
    usePaymentStore.getState().updateContext({ offlineOrder, lockedItemIds: useCartStore.getState().lockedItemIds, printedItemIds: useCartStore.getState().printedItemIds });
    if (offlineOrder === null) {
      throw new Error('Offline send failed — nothing to charge');
    }

    // Le rendu monnaie ne concerne que le volet espèces d'un split : les autres
    // règlements sont encaissés au centime par leur propre canal.
    const cashTenders = tendersToShip.filter((t) => t.method === 'cash');
    const cashDue = cashTenders.reduce((sum, t) => sum + t.amount, 0);
    const cashReceived = cashTenders.reduce((sum, t) => sum + (t.cash_received ?? t.amount), 0);
    const changeGiven = Math.max(0, cashReceived - cashDue);
    const methods = tendersToShip.map((t) => t.method);
    const paidAt = new Date().toISOString();

    emitPosEvent('payment_started', {
      amount: total,
      order_number_snap: offlineOrder.localNumber,
      payload: { tenders: tendersToShip.length, methods, offline: true },
    });

    // 1. Outbox durable D'ABORD (spec §4.3) — la vente survit à un crash.
    await enqueueIntent({
      kind: 'payment',
      id: idempotencyKey,
      root_client_uuid: offlineOrder.clientUuid,
      seq: nextIntentSeq(),
      created_at: paidAt,
      local_number: offlineOrder.localNumber,
      payments: tendersToShip,
      ...(cart.customerId !== undefined ? { customer_id: cart.customerId } : {}),
    });

    // 2. Journal hub (traçabilité — aucun consommateur n'agit dessus en lot 4).
    const paidPayload: OrderPaidOfflinePayload = {
      order_id: offlineOrder.clientUuid,
      order_number: offlineOrder.localNumber,
      idempotency_key: idempotencyKey,
      amount: total,
      cash_received: cashReceived,
      change_given: changeGiven,
      paid_at: paidAt,
    };
    hubBus.publish('order.paid_offline', paidPayload);

    // ADR-013 D13 — l'encaissement offline solde la tentative (l'intent est
    // durable dans l'outbox ; une clé stabilisée par un échec retryable
    // antérieur ne doit pas coller à la vente suivante).
    markAttemptUnsettled(false);

    emitPosEvent('payment_completed', {
      order_number_snap: offlineOrder.localNumber,
      amount: total,
      payload: { methods, change_given: changeGiven, offline: true },
    });

    setSuccess({
      orderNumber: offlineOrder.localNumber,
      orderId: offlineOrder.clientUuid,
      total,
      taxAmount: tax_amount,
      changeGiven,
      pointsEarned: 0,
      offline: true,
      cashReceived,
      customerName: attachedCustomer?.name ?? undefined,
      // Sur un split, la méthode « principale » affichée est celle du plus gros
      // règlement — le ticket, lui, porte le détail complet.
      paymentMethod: [...tendersToShip].sort((a, b) => b.amount - a.amount)[0]!.method,
    });
  }

  async function dispatchCheckout(tendersToShip: Tender[]): Promise<void> {
    if (dispatching) return;
    if (isOrderSending()) { toast.error('Wait for the order send to finish before paying'); return; }
    dispatching = true;
    setDispatchPending(true);
    let dispatched = false;
    try {
      const stored = usePaymentStore.getState().attempt;
      const saved = stored?.state !== 'refused' ? stored : null;
      const state = useCartStore.getState();
      const sessionId = saved?.context.sessionId ?? useShiftStore.getState().current?.id;
      if (!sessionId || !user) throw new Error('no_open_shift');
      const snapshot = saved && saved.state !== 'refused' ? saved : JSON.parse(JSON.stringify({
        version: 1, state: 'pending', cart: state.cart, tenders: tendersToShip,
        context: {
          idempotencyKey, appendUuid: crypto.randomUUID(), sessionId, userId: user.id,
          pickedUpOrderId: state.pickedUpOrderId, orderOrigin: state.orderOrigin,
          lockedItemIds: state.lockedItemIds, printedItemIds: state.printedItemIds,
          appliedPromotions: state.appliedPromotions, sourceCode: getOrderSourceCode(), offlineOrder: state.offlineOrder,
        },
        customer: state.attachedCustomer, offline: offlineGate.offlineMode, taxRate, taxInclusive,
      })) as PaymentAttempt;
      if (snapshot.context.userId !== user.id) throw new Error('Resume this payment with the original cashier');
      if (snapshot.offline && !snapshot.context.offlineOrder) snapshot.context.offlineOrder = { clientUuid: snapshot.context.appendUuid, localNumber: nextLocalOrderNumber() };
      if (snapshot.result) { setSuccessState(snapshot.result); return; }
      if (snapshot.offline && !saved) validateOfflinePayment(snapshot);
      usePaymentStore.getState().beginAttempt({ ...snapshot, state: 'pending' });
      setLastTendersShipped(snapshot.tenders);
      if (snapshot.offline) useCartStore.setState({ cart: snapshot.cart, offlineOrder: snapshot.context.offlineOrder ?? null, lockedItemIds: snapshot.context.lockedItemIds, printedItemIds: snapshot.context.printedItemIds, pickedUpOrderId: snapshot.context.pickedUpOrderId });
      dispatched = true;
      if (snapshot.offline) {
        await dispatchOfflinePayment(snapshot);
      } else {
        await dispatchOnlinePayment(snapshot);
      }
    } catch (error) {
      const classified = classifyCheckoutError(error);
      setLastError(classified);
      const saved = usePaymentStore.getState().attempt;
      if (saved && dispatched) usePaymentStore.getState().settleAttempt(saved.offline || classified.kind === 'retryable' ? 'unknown' : 'refused');
      toast.error(error instanceof Error ? error.message : 'Payment could not be recorded');
    } finally {
      dispatching = false;
      setDispatchPending(false);
    }
  }

  async function dispatchOnlinePayment(snapshot: PaymentAttempt): Promise<void> {
    const tendersToShip = snapshot.tenders;
    setLastError(null);
    setLastTendersShipped(tendersToShip);
    // S72 audit — a charge attempt begins (pairs with payment_completed /
    // payment_failed so the journal shows every attempt, not just outcomes).
    emitPosEvent('payment_started', {
      amount: total,
      payload: { tenders: tendersToShip.length, method: tendersToShip[0]?.method ?? null },
    });
    try {
      const result = await checkout.mutateAsync({ cart: snapshot.cart, payment: tendersToShip, context: snapshot.context });
      // ADR-013 D13 — la tentative est soldée (un retry réussi lève le flag
      // posé par l'échec retryable précédent) ; reset() régénérera la clé.
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
        orderId: result.order_id,
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
        // Critique 2026-08-29 P3 — même somme que le chemin offline : le reçu
        // n'imprime jamais un cash_received périmé sur un split.
        cashReceived: tendersToShip
          .filter((t) => t.method === 'cash')
          .reduce((sum, t) => sum + (t.cash_received ?? t.amount), 0),
        ...(appliedPromotions.length > 0 ? { appliedPromotions } : {}),
      });
      // S72 audit — the charge succeeded (order now exists server-side).
      emitPosEvent('payment_completed', {
        order_number_snap: result.order_number,
        amount: result.total,
        payload: { method: tendersToShip[0]!.method, change_given: result.change_given },
      });
    } catch (err: unknown) {
      const classified = classifyCheckoutError(err);
      setLastError(classified);
      // ADR-013 D13 — un échec RETRYABLE laisse la tentative en suspens : la
      // clé d'idempotence survit à close()/open() tant que la bannière Retry
      // est vivante (pas de double charge, pas de double intent offline). Un
      // échec fatal ou already_paid SOLDE la tentative (clé régénérée au
      // prochain open/reset, comportement historique conservé).
      usePaymentStore.getState().settleAttempt(classified.kind === 'retryable' ? 'unknown' : 'refused');
      markAttemptUnsettled(classified.kind === 'retryable');
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
    reset();
    resetCartAfterCheckout();
    setLastError(null);
    setLastTendersShipped(null);
  }

  function handleNewOrder(): void {
    reset();
    resetCartAfterCheckout();
    setSuccess(null);
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
    // config taxe — OrderSummaryPanel rend le même libellé conditionnel que le
    // panier (ActiveOrderPanel) au lieu d'un « incl. » figé.
    taxInclusive,
    // method + draft
    selectedMethod, selectMethod, cashReceivedStr, setCashReceivedStr,
    quickAmounts, draftAmount, isCashDraft, draftTenderAmount, cashChange, draftValid,
    // tenders
    tenders, removeTender,
    // flow flags
    total, remaining, fastPathReady, canProcess,
    checkoutPending: checkout.isPending || dispatchPending,
    attemptLocked: Boolean(activeAttempt),
    // spec 006x lot 4 — mode offline + gate cash (bannières terminal)
    offlineGate,
    // ui state
    success, lastError, splitOpen, setSplitOpen,
    // handlers
    handleAddTender, handleProcess, handleRetry,
    handleDismissAlreadyPaid, handleNewOrder, handleSplitComplete,
  };
}
