import { financialStorageKey, readFinancialSlot } from '@/lib/pendingFinancialAttempts.js';

export interface ExpenseDraftScope { environment: string; profileId: string }
export type ExpenseDraftPointer = { version: 1; status: 'new' }
  | { version: 1; status: 'saved'; expenseId: string };
const FAILURE = 'Draft recovery storage is unavailable or invalid. Restore storage before saving another expense.';
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);

export function expenseDraftPointerKey(scope: ExpenseDraftScope): string {
  return 'breakery:expense-draft:v1:' + [scope.environment,scope.profileId].map(encodeURIComponent).join(':');
}
function valid(value: unknown): value is ExpenseDraftPointer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string,unknown>;
  return v.version === 1 && (v.status === 'new' && Object.keys(v).every(k=>['version','status'].includes(k))
    || v.status === 'saved' && uuid(v.expenseId) && Object.keys(v).every(k=>['version','status','expenseId'].includes(k)));
}
export function readExpenseDraftPointer(scope: ExpenseDraftScope): ExpenseDraftPointer | null {
  try {
    const raw = localStorage.getItem(expenseDraftPointerKey(scope));
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!valid(value)) throw new Error();
    return value;
  } catch { throw new Error(FAILURE); }
}
export function writeExpenseDraftPointer(scope: ExpenseDraftScope,pointer: ExpenseDraftPointer): void {
  try {
    if (!valid(pointer)) throw new Error();
    const key = expenseDraftPointerKey(scope), value = JSON.stringify(pointer);
    localStorage.setItem(key,value);
    if (localStorage.getItem(key) !== value) throw new Error();
    window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));
  } catch { throw new Error(FAILURE); }
}
export async function startNewExpenseDraft(scope: ExpenseDraftScope,current:()=>boolean): Promise<void> {
  if (!navigator.locks?.request) throw new Error('Secure tab locking is unavailable. Use a supported browser.');
  await navigator.locks.request(financialStorageKey({...scope,operation:'expense_creation',target:'new'}),
    {mode:'exclusive',ifAvailable:true}, lock=>{
      if (!lock || !current()) throw new Error('This draft changed or is being checked in another tab. Reopen it.');
      readExpenseDraftPointer(scope);
      if (readFinancialSlot({...scope,operation:'expense_creation',target:'new'})?.status === 'pending') {
        throw new Error('Check the unconfirmed save before starting another expense.');
      }
      // Le brouillon serveur reste conservé ; seul le choix explicite de la prochaine saisie change.
      writeExpenseDraftPointer(scope,{version:1,status:'new'});
    });
}
