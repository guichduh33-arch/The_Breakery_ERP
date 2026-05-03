// packages/domain/src/types/payment.ts
export type PaymentMethod = 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  cash_received?: number;
  change_given?: number;
}

export interface PaymentResult {
  ok: true;
  order_id: string;
  order_number: string;
  total: number;
  tax_amount: number;
  change_given: number | null;
}

export interface PaymentError {
  ok: false;
  error: string;
  message?: string;
}
