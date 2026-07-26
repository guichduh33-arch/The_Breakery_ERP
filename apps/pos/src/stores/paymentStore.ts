// apps/pos/src/stores/paymentStore.ts
// Session 10 — extended to track an accumulated tenders[] list for split-payment
// alongside the existing single-method draft state. The terminal renders the draft
// inputs (method + cash received) ; clicking "Add Tender" pushes the draft into
// the tenders array. Process Payment ships either:
//   - the accumulated tenders array (multi-tender split) when tenders.length > 0
//   - a single-element array [draft] (legacy cash-exact / single-method flow)
//     when tenders is empty
//
// `idempotencyKey` — ADR-013 D13 (remplace la décision D8 du session-1
// addendum) : la clé reste STABLE tant qu'une tentative retryable n'est pas
// soldée. open()/close() ne régénèrent que si `attemptUnsettled` est false ;
// un échec retryable pose le flag (via markAttemptUnsettled), et seul un
// solde explicite — reset() (succès / dismiss already_paid) ou un échec
// fatal — le lève. Sans ça, close→reopen du modal pendant une bannière
// retryable mintait une nouvelle clé : risque de double charge au retry et
// de double intent cash offline (la clé sert d'id d'intent).

import { create } from 'zustand';
import type { PaymentMethod, Tender } from '@breakery/domain';
import { emitPosEvent } from '@/features/audit/emitPosEvent';

interface PaymentState {
  isOpen: boolean;
  /** Current draft method for the next tender being composed. */
  selectedMethod: PaymentMethod | null;
  /** Cash receive string buffer for the cash draft (raw numpad input). */
  cashReceivedStr: string;
  /** Session 10 — accumulated tenders the cashier has added via "Add Tender". */
  tenders: Tender[];
  /**
   * Idempotency key for the current checkout attempt (UUID v4). One UUID = one
   * checkout attempt ; le serveur rejoue l'enveloppe sur une clé répétée.
   * ADR-013 D13 : stable tant que `attemptUnsettled` est true.
   */
  idempotencyKey: string;
  /**
   * ADR-013 D13 — true quand la dernière tentative a échoué en RETRYABLE et
   * n'est pas encore soldée (bannière Retry affichée). Bloque la régénération
   * de la clé sur open()/close().
   */
  attemptUnsettled: boolean;
  open: () => void;
  close: () => void;
  selectMethod: (m: PaymentMethod) => void;
  setCashReceivedStr: (v: string) => void;
  /** Session 10 — push a tender to the accumulated list and reset the draft. */
  addTender: (t: Tender) => void;
  removeTender: (idx: number) => void;
  clearTenders: () => void;
  /** ADR-013 D13 — posé par usePaymentFlowLogic selon la classification de l'échec. */
  markAttemptUnsettled: (unsettled: boolean) => void;
  reset: () => void;
}

export const usePaymentStore = create<PaymentState>((set) => ({
  isOpen: false,
  selectedMethod: null,
  cashReceivedStr: '',
  tenders: [],
  idempotencyKey: crypto.randomUUID(),
  attemptUnsettled: false,
  open: () =>
    set((s) => ({
      isOpen: true,
      selectedMethod: 'cash',
      cashReceivedStr: '',
      tenders: [],
      // D13 — nouvelle tentative → nouvelle clé, SAUF si une tentative
      // retryable est en suspens (le retry doit rejouer la même clé).
      ...(s.attemptUnsettled ? {} : { idempotencyKey: crypto.randomUUID() }),
    })),
  close: () =>
    set((s) => ({
      isOpen: false,
      // D13 — fermer le modal ne solde pas une tentative retryable : la clé
      // survit au close→reopen tant que la bannière Retry est vivante.
      ...(s.attemptUnsettled ? {} : { idempotencyKey: crypto.randomUUID() }),
    })),
  selectMethod: (m) => {
    set({ selectedMethod: m, cashReceivedStr: '' });
    // S72 audit — the cashier picked a tender method for the next tender.
    emitPosEvent('payment_method_selected', { payload: { method: m } });
  },
  setCashReceivedStr: (v) => set({ cashReceivedStr: v }),
  addTender: (t) =>
    set((s) => ({
      tenders: [...s.tenders, t],
      // Reset draft after adding
      cashReceivedStr: '',
    })),
  removeTender: (idx) =>
    set((s) => ({
      tenders: s.tenders.filter((_, i) => i !== idx),
    })),
  clearTenders: () => set({ tenders: [] }),
  markAttemptUnsettled: (unsettled) => set({ attemptUnsettled: unsettled }),
  reset: () =>
    set({
      isOpen: false,
      selectedMethod: null,
      cashReceivedStr: '',
      tenders: [],
      // reset() SOLDE la tentative (succès / dismiss already_paid) —
      // régénération inconditionnelle + flag levé.
      idempotencyKey: crypto.randomUUID(),
      attemptUnsettled: false,
    }),
}));
