import { useEffect, useReducer, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { pendingFinancialTargets, subscribeFinancialAttempts } from '@/lib/pendingFinancialAttempts.js';
import { Button } from '@/components/BackofficeUi.js';
import { BankAttemptDialog, type BankOperation } from './BankAttemptDialog.js';

export function BankRecovery({ target }: { target?: string }) {
  const profile = useAuthStore((s) => s.user?.id);
  const token = useAuthStore((s) => s.sessionToken);
  const [,refresh] = useReducer((n: number) => n + 1,0);
  const [selected,setSelected] = useState<{ operation: BankOperation; target: string } | null>(null);
  useEffect(() => subscribeFinancialAttempts(refresh),[]);
  useEffect(() => { setSelected(null); },[profile,token,target]);
  const entries: { operation: BankOperation; target: string }[] = [];
  let error = '';
  try {
    if (profile) for (const operation of ['bank_manage','bank_post','bank_finalize'] as const) {
      for (const value of pendingFinancialTargets(import.meta.env.VITE_SUPABASE_URL as string,profile,operation)) {
        if (!target || value === target) entries.push({ operation,target: value });
      }
    }
  } catch (failure) { error = (failure as Error).message; }
  if (!entries.length && !error) return null;
  return <div className="space-y-2 rounded border border-border-strong bg-bg-elevated p-3">
    <p className="font-medium">Pending bank operations</p><p className="text-sm text-text-secondary">Check the original result with its saved key before starting another operation on the same statement.</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap gap-2">{entries.map((entry) => <Button variant="secondary" key={`${entry.operation}:${entry.target}`} onClick={() => setSelected(entry)}>
      Check {entry.operation === 'bank_post' ? 'bank entry' : entry.operation === 'bank_finalize' ? 'finalization' : entry.target === 'new' ? 'statement import' : 'bank operation'} · {entry.target === 'new' ? 'new statement' : entry.target.slice(0,8)}
    </Button>)}</div>
    {selected && <BankAttemptDialog key={`${selected.operation}:${selected.target}`} {...selected} payload={null} onClose={() => setSelected(null)} />}
  </div>;
}
