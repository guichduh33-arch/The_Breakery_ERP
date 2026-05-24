// apps/backoffice/src/features/expenses/hooks/useExpenseApprovals.ts
//
// Per-expense approval audit trail. Ordered by step ascending so callers
// render the chain in the sequence it was executed.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ExpenseApprovalRow {
  id: string;
  expense_id: string;
  approver_user_id: string;
  approver_name: string | null;
  step: number;
  approved_at: string;
}

export function useExpenseApprovals(expenseId: string | null) {
  return useQuery({
    queryKey: ['expense_approvals', expenseId],
    enabled: !!expenseId,
    queryFn: async (): Promise<ExpenseApprovalRow[]> => {
      const { data, error } = await supabase
        .from('expense_approvals')
        .select(
          'id, expense_id, approver_user_id, step, approved_at, user_profiles!expense_approvals_approver_user_id_fkey(full_name)',
        )
        .eq('expense_id', expenseId!)
        .order('step', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        expense_id: r.expense_id,
        approver_user_id: r.approver_user_id,
        step: r.step,
        approved_at: r.approved_at,
        approver_name:
          (r as { user_profiles?: { full_name: string | null } | null })
            .user_profiles?.full_name ?? null,
      }));
    },
  });
}
