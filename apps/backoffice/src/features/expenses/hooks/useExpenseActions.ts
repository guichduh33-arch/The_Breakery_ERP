// apps/backoffice/src/features/expenses/hooks/useExpenseActions.ts
//
// Workflow mutations: submit, approve, reject, pay.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { EXPENSES_QUERY_KEY } from './useExpensesList.js';

export function useSubmitExpense() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.rpc('submit_expense_v1', { p_expense_id: id });
      if (error) throw error;
    },
    onSuccess: async (_data, { id }) => {
      await qc.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['expense-detail', id] });
    },
  });
}

export interface ApproveResult {
  expense_id: string;
  je_id: string;
  entry_number: string;
  status: string;
}

export function useApproveExpense() {
  const qc = useQueryClient();
  return useMutation<ApproveResult, Error, { id: string; notes?: string }>({
    mutationFn: async ({ id, notes }) => {
      const args: Record<string, unknown> = { p_expense_id: id };
      if (notes !== undefined) args.p_approval_notes = notes;
      const { data, error } = await supabase.rpc('approve_expense_v1', args as never);
      if (error) throw error;
      return data as unknown as ApproveResult;
    },
    onSuccess: async (_data, { id }) => {
      await qc.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['expense-detail', id] });
    },
  });
}

export function useRejectExpense() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      const { error } = await supabase.rpc('reject_expense_v1', {
        p_expense_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: async (_data, { id }) => {
      await qc.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['expense-detail', id] });
    },
  });
}

export interface PayResult {
  expense_id: string;
  payment_je_id: string | null;
  status: string;
  was_credit: boolean;
}

export function usePayExpense() {
  const qc = useQueryClient();
  return useMutation<PayResult, Error, { id: string; paymentMethod?: string }>({
    mutationFn: async ({ id, paymentMethod }) => {
      const args: Record<string, unknown> = { p_expense_id: id };
      if (paymentMethod !== undefined) args.p_payment_method = paymentMethod;
      const { data, error } = await supabase.rpc('pay_expense_v1', args as never);
      if (error) throw error;
      return data as unknown as PayResult;
    },
    onSuccess: async (_data, { id }) => {
      await qc.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['expense-detail', id] });
    },
  });
}
