import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import type { ExpenseCreationSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import { EXPENSES_QUERY_KEY } from './useExpensesList.js';

export type CreateExpenseInput = Omit<ExpenseCreationSnapshot,'vat_amount'> & {
  vat_amount?: number; idempotency_key?: string; sessionGuard?:()=>boolean;
};
export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    retry:false, meta:{errorHandled:true}, onMutate:()=>captureFinancialSession(),
    mutationFn:async(input:CreateExpenseInput):Promise<string>=>{
      const session=captureFinancialSession();
      const assertSession=()=>{
        if(!session.current() || input.sessionGuard?.()===false) {
          throw new FinancialAttemptError('Your session changed. Reopen this expense before continuing.');
        }
      };
      assertSession();
      const {data,error}=await supabase.rpc('create_expense_v4',{
        p_category_id:input.category_id,p_amount:input.amount,p_payment_method:input.payment_method,
        p_description:input.description,p_expense_date:input.expense_date,
        ...(input.expense_term_id!==undefined?{p_expense_term_id:input.expense_term_id}:{}),
        ...(input.remarks!==undefined?{p_remarks:input.remarks}:{}),
        p_vat_amount:input.vat_amount??0,
        ...(input.vendor_name!==undefined?{p_vendor_name:input.vendor_name}:{}),
        ...(input.idempotency_key!==undefined?{p_idempotency_key:input.idempotency_key}:{}),
      });
      assertSession();
      const messages: Record<string, string> = {
        expense_term_required: 'Select an active expense term and try again.',
        expense_term_category_mismatch: 'This expense term changed. Select it again before saving.',
        expense_term_category_unavailable: 'This category or account is unavailable. Select another expense term.',
        expense_remarks_too_long: 'Remarks must contain at most 2000 characters.',
      };
      if(error) throw new FinancialAttemptError(messages[error.message] ?? error.message,
        ['22023','23514','23502','23503','23505','42501','28000','P0002'].includes(error.code));
      if(typeof data!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data)) {
        throw new FinancialAttemptError('The saved expense could not be confirmed. Check the pending save.');
      }
      const row=await supabase.from('expenses').select('id,created_by').eq('id',data).maybeSingle();
      assertSession();
      if(row.error || row.data?.id!==data || row.data.created_by!==session.profileId) {
        throw new FinancialAttemptError('The expense record could not confirm this save. Check the pending save.');
      }
      return data;
    },
    onSuccess:async(_id,input,session)=>{
      if(!session?.current() || input.sessionGuard?.()===false) return;
      await qc.invalidateQueries({queryKey:EXPENSES_QUERY_KEY});
    },
  });
}
