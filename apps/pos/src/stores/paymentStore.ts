// apps/pos/src/stores/paymentStore.ts
import { create } from 'zustand';
import type { PaymentMethod } from '@breakery/domain';

interface PaymentState {
  isOpen: boolean;
  selectedMethod: PaymentMethod | null;
  cashReceivedStr: string;          // string raw du numpad
  /**
   * Idempotency key for the current checkout attempt (UUID v4).
   * Regenerated on `open()` and `reset()` so that one UUID = one user-visible
   * checkout attempt (decision D8). The server treats a replayed key as a
   * duplicate and returns the original order.
   */
  idempotencyKey: string;
  open: () => void;
  close: () => void;
  selectMethod: (m: PaymentMethod) => void;
  setCashReceivedStr: (v: string) => void;
  reset: () => void;
}

export const usePaymentStore = create<PaymentState>((set) => ({
  isOpen: false,
  selectedMethod: null,
  cashReceivedStr: '',
  idempotencyKey: crypto.randomUUID(),
  open: () =>
    set({
      isOpen: true,
      selectedMethod: 'cash',
      cashReceivedStr: '',
      // New attempt → new key
      idempotencyKey: crypto.randomUUID(),
    }),
  close: () =>
    set({
      isOpen: false,
      // Regenerate so re-opening without an explicit reset still starts a fresh attempt
      idempotencyKey: crypto.randomUUID(),
    }),
  selectMethod: (m) => set({ selectedMethod: m, cashReceivedStr: '' }),
  setCashReceivedStr: (v) => set({ cashReceivedStr: v }),
  reset: () =>
    set({
      isOpen: false,
      selectedMethod: null,
      cashReceivedStr: '',
      // Prepare next attempt
      idempotencyKey: crypto.randomUUID(),
    }),
}));
