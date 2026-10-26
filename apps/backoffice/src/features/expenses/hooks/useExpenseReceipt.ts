import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import type { ExpenseReceiptSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';
import { captureFinancialSession, useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { receiptFileDigest, receiptPath } from '../utils/expenseReceiptFiles.js';
import { EXPENSES_QUERY_KEY } from './useExpensesList.js';

export interface ExpenseReceiptResult {
 expense_id:string; receipt_path:string|null; applied:boolean; idempotent_replay:boolean;
 reason?:'receipt_requires_draft'|'receipt_changed';
}
export function useExpenseReceipt(expenseId:string) {
 const attempt=useFinancialAttempt('expense_receipt',expenseId,true);
 const qc=useQueryClient();
 async function submit(payload:ExpenseReceiptSnapshot,file?:File) {
  return attempt.submit(payload,async(snapshot,key,current):Promise<ExpenseReceiptResult>=>{
   const session=captureFinancialSession();
   const assertSession=()=>{if(!current()||!session.current())throw new FinancialAttemptError('Your session changed. Reopen this expense.');};
   assertSession();
   if(file && snapshot.kind==='attach') {
    const digest=await receiptFileDigest(file);assertSession();
    if(digest!==snapshot.sha256||file.type!==snapshot.mime||file.size!==snapshot.size) {
     throw new FinancialAttemptError('Select the same receipt file to check this pending upload.');
    }
   }
   const path=snapshot.kind==='attach'?receiptPath(snapshot,key):null;
   const apply=()=>supabase.rpc('set_expense_receipt_v1',{
    p_expense_id:snapshot.expenseId,p_idempotency_key:key,
    ...(path!==null?{p_storage_path:path}:{}),
    ...(snapshot.expectedPath!==null?{p_expected_path:snapshot.expectedPath}:{}),
   });
   let response=await apply();assertSession();
   if(snapshot.kind==='attach'&&response.error?.code==='P0002'
      && response.error.message==='receipt_object_not_found') {
    if(!file)throw new FinancialAttemptError('Select the same receipt file to retry the upload. The expense is retained.');
    const uploaded=await supabase.storage.from('expense-receipts').upload(path!,file,{upsert:false,contentType:snapshot.mime});
    assertSession();
    // Une réponse d'upload perdue peut laisser le bon objet en place : confirmer avant de conclure.
    response=await apply();assertSession();
    if(uploaded.error && response.error) throw new FinancialAttemptError(uploaded.error.message);
   }
   if(response.error) throw new FinancialAttemptError(response.error.message,
    ['22023','42501','28000','23514'].includes(response.error.code));
   const result:unknown=response.data;
   if(typeof result!=='object'||result===null||Array.isArray(result))throw new FinancialAttemptError('The receipt change is unconfirmed. Check it before trying another file.');
   const r=result as Record<string,unknown>;
   if(r.expense_id!==expenseId||typeof r.applied!=='boolean'||typeof r.idempotent_replay!=='boolean'
    ||(r.applied===true&&r.receipt_path!==path)
    ||(r.applied===false&&(typeof r.reason!=='string'||!['receipt_requires_draft','receipt_changed'].includes(r.reason)))) {
    throw new FinancialAttemptError('The receipt change is unconfirmed. Check it before trying another file.');
   }
   assertSession();
   await Promise.all([qc.invalidateQueries({queryKey:['expense-detail',expenseId]}),qc.invalidateQueries({queryKey:EXPENSES_QUERY_KEY})]);
   assertSession();
   return result as ExpenseReceiptResult;
  });
 }
 return {...attempt,submit};
}
