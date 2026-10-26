import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import type { DuplicateExpenseSeed } from '../components/ExpenseForm.js';
import { prepareExpenseDraftNavigation } from '../utils/expenseDraftNavigation.js';
import { startNewExpenseDraft } from '../utils/expenseDraftPointer.js';

export function useBeginExpenseDraft() {
 const navigate=useNavigate();
 const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 async function begin(duplicateFrom?:DuplicateExpenseSeed) {
  const session=captureFinancialSession(),profileId=session.profileId;
  const current=()=>session.current()&&(useAuthStore.getState().hasPermission('expenses.create')||useAuthStore.getState().hasPermission('expenses.manage'));
  if(!profileId||!current())return;
  setBusy(true);setError(null);
  try{
   await startNewExpenseDraft({environment:import.meta.env.VITE_SUPABASE_URL as string,profileId},current);
   if(current())void navigate('/backoffice/expenses/new',{state:prepareExpenseDraftNavigation(duplicateFrom)});
  }catch(e){
   if(!current())return;
   // La page de reprise présente le snapshot existant ; jamais de nouvelle création implicite.
   setError((e as Error).message);
   void navigate('/backoffice/expenses/new',{state:null});
  }finally{if(current())setBusy(false);}
 }
 return {begin,busy,error};
}
