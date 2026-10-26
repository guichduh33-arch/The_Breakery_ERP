import { useReducer } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import type { ExpenseCreationSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';
import { captureFinancialSession, useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { readExpenseDraftPointer,startNewExpenseDraft,writeExpenseDraftPointer } from '../utils/expenseDraftPointer.js';
import { useCreateExpense } from './useCreateExpense.js';

export function useExpenseDraftCreation() {
 const profileId=useAuthStore(s=>s.user?.id);
 const environment=import.meta.env.VITE_SUPABASE_URL as string;
 const scope=profileId&&environment?{environment,profileId}:null;
 const attempt=useFinancialAttempt('expense_creation','new',true);
 const create=useCreateExpense();
 const [,refresh]=useReducer((n:number)=>n+1,0);
 let pointer=null,error=attempt.storageError;
 try{if(scope)pointer=readExpenseDraftPointer(scope);}catch(e){error=(e as Error).message;}
 async function save(payload:ExpenseCreationSnapshot) {
  return attempt.submit(payload,async(snapshot,key,current)=>{
   if(!scope)throw new FinancialAttemptError('Sign in before saving an expense.');
   const id=await create.mutateAsync({...snapshot,idempotency_key:key,sessionGuard:current});
   if(!current())throw new FinancialAttemptError('Your session changed. Check the pending save after signing in.');
   // La confirmation doit être durable avant que le runner ne résolve sa tentative.
   writeExpenseDraftPointer(scope,{version:1,status:'saved',expenseId:id});
   return id;
  });
 }
 async function startNew() {
  const session=captureFinancialSession();
  if(!scope||scope.profileId!==session.profileId||!session.current())throw new Error('Sign in before creating an expense.');
  const current=()=>session.current()&&(useAuthStore.getState().hasPermission('expenses.create')||useAuthStore.getState().hasPermission('expenses.manage'));
  await startNewExpenseDraft(scope,current);
  if(current())refresh();
  return current();
 }
 return {...attempt,pointer,storageError:error,save,startNew};
}
