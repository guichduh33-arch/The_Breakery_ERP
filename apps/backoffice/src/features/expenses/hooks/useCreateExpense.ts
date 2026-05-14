// apps/backoffice/src/features/expenses/hooks/useCreateExpense.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { EXPENSES_QUERY_KEY } from './useExpensesList.js';

export interface CreateExpenseInput {
  category_id: string;
  amount: number;
  payment_method: 'cash' | 'transfer' | 'card' | 'credit';
  description: string;
  expense_date: string;       // ISO yyyy-mm-dd
  vat_amount?: number;
  vendor_name?: string;
  receipt_url?: string;
  idempotency_key?: string;
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation<string, Error, CreateExpenseInput>({
    mutationFn: async (input) => {
      const args: Record<string, unknown> = {
        p_category_id: input.category_id,
        p_amount: input.amount,
        p_payment_method: input.payment_method,
        p_description: input.description,
        p_expense_date: input.expense_date,
        p_vat_amount: input.vat_amount ?? 0,
      };
      if (input.vendor_name !== undefined)     args.p_vendor_name = input.vendor_name;
      if (input.receipt_url !== undefined)     args.p_receipt_url = input.receipt_url;
      if (input.idempotency_key !== undefined) args.p_idempotency_key = input.idempotency_key;

      const { data, error } = await supabase.rpc('create_expense_v1', args as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
    },
  });
}
