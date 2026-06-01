// apps/backoffice/src/features/expenses/hooks/useExpenseActions.ts
//
// Workflow mutations: submit, approve, reject, pay.
// S28: submit → v2 (idempotency_key). approve → v3 (server-side manager-PIN
// re-auth via verify_user_pin; PIN passed as RPC arg — H1 audit fix 2026-06-01).

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { EXPENSES_QUERY_KEY } from './useExpensesList.js';

export interface SubmitResult {
  expense_id: string;
  status: string;
  auto_approved: boolean;
  steps_required: number;
}

export function useSubmitExpense() {
  const qc = useQueryClient();
  // Per-mount idempotency key — survives re-renders within a single modal open.
  // Call resetIdempotency() after a successful submit before re-opening the dialog.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const mutation = useMutation<SubmitResult, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.rpc('submit_expense_v2', {
        p_expense_id: id,
        p_idempotency_key: idempotencyKey.current,
      });
      if (error) throw error;
      return data as unknown as SubmitResult;
    },
    onSuccess: async (_data, { id }) => {
      await qc.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['expense-detail', id] });
    },
  });

  return {
    ...mutation,
    /** Rotate the idempotency key before re-using this hook for a fresh submission. */
    resetIdempotency: () => {
      idempotencyKey.current = crypto.randomUUID();
    },
  };
}

export interface ApproveResult {
  expense_id: string;
  step: number;
  of_total: number;
  status: string;
}

export function useApproveExpense() {
  const qc = useQueryClient();
  return useMutation<ApproveResult, Error, { id: string; manager_pin: string }>({
    mutationFn: async ({ id, manager_pin }) => {
      // H1 audit fix (2026-06-01): approve_expense_v3 verifies the manager PIN
      // server-side via verify_user_pin. For a Postgres RPC the PIN travels as an
      // arg (NOT a header — the PIN-in-header rule targets Edge Functions whose
      // bodies get logged; RPC args do not). v2 (which ignored the PIN) is dropped.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('approve_expense_v3', {
        p_expense_id:  id,
        p_manager_pin: manager_pin,
      });
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
