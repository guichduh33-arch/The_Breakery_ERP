// apps/pos/src/stores/paymentStore.ts
import { create } from 'zustand';
import type { PaymentMethod } from '@breakery/domain';

interface PaymentState {
  isOpen: boolean;
  selectedMethod: PaymentMethod | null;
  cashReceivedStr: string;          // string raw du numpad
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
  open: () => set({ isOpen: true, selectedMethod: 'cash', cashReceivedStr: '' }),
  close: () => set({ isOpen: false }),
  selectMethod: (m) => set({ selectedMethod: m, cashReceivedStr: '' }),
  setCashReceivedStr: (v) => set({ cashReceivedStr: v }),
  reset: () => set({ isOpen: false, selectedMethod: null, cashReceivedStr: '' }),
}));
