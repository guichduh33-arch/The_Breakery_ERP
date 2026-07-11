// apps/pos/src/stores/paymentStore.ts
// Session 10 — extended to track an accumulated tenders[] list for split-payment
// alongside the existing single-method draft state. The terminal renders the draft
// inputs (method + cash received) ; clicking "Add Tender" pushes the draft into
// the tenders array. Process Payment ships either:
//   - the accumulated tenders array (multi-tender split) when tenders.length > 0
//   - a single-element array [draft] (legacy cash-exact / single-method flow)
//     when tenders is empty
//
// `idempotencyKey` is regenerated on open/close/reset so each user-visible
// checkout attempt gets a fresh UUID (decision D8 of session-1 addendum).

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
   * user-visible checkout attempt (D8). Server treats a replayed key as a duplicate.
   */
  idempotencyKey: string;
  open: () => void;
  close: () => void;
  selectMethod: (m: PaymentMethod) => void;
  setCashReceivedStr: (v: string) => void;
  /** Session 10 — push a tender to the accumulated list and reset the draft. */
  addTender: (t: Tender) => void;
  removeTender: (idx: number) => void;
  clearTenders: () => void;
  reset: () => void;
}

export const usePaymentStore = create<PaymentState>((set) => ({
  isOpen: false,
  selectedMethod: null,
  cashReceivedStr: '',
  tenders: [],
  idempotencyKey: crypto.randomUUID(),
  open: () =>
    set({
      isOpen: true,
      selectedMethod: 'cash',
      cashReceivedStr: '',
      tenders: [],
      // New attempt → new key
      idempotencyKey: crypto.randomUUID(),
    }),
  close: () =>
    set({
      isOpen: false,
      // Regenerate so re-opening without an explicit reset still starts a fresh attempt
      idempotencyKey: crypto.randomUUID(),
    }),
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
  reset: () =>
    set({
      isOpen: false,
      selectedMethod: null,
      cashReceivedStr: '',
      tenders: [],
      // Prepare next attempt
      idempotencyKey: crypto.randomUUID(),
    }),
}));
