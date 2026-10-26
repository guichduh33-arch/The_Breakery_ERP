import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import { supabase } from '@/lib/supabase.js';
import { Card, Button } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import type { ExpenseRow } from '../hooks/useExpensesList.js';
import { ReceiptUploader } from './ReceiptUploader.js';

export function ExpenseReceiptPanel({expense, onBusyChange}: {
  expense: ExpenseRow; onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const profile = useAuthStore(s => s.user?.id);
  const token = useAuthStore(s => s.sessionToken);
  const permitted = useAuthStore(s => s.hasPermission);
  const canEdit = expense.status === 'draft' && (permitted('expenses.manage')
    || (profile === expense.created_by && permitted('expenses.create')));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = JSON.stringify([expense.id, expense.receipt_url, profile, token]);
  const observed = useRef(identity); observed.current = identity;
  const mounted = useRef(true);
  useEffect(() => {setBusy(false); setError(null);}, [identity]);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  async function download(): Promise<void> {
    const session = captureFinancialSession();
    const current = () => mounted.current && observed.current === identity && session.current();
    if (!current() || !expense.receipt_url) return;
    setBusy(true); setError(null);
    try {
      const response = await supabase.functions.invoke<Blob>('download-expense-receipt', {
        body: { expense_id: expense.id }, headers: { 'x-session-token': token ?? '' },
      });
      if (!current()) return;
      const state = useAuthStore.getState();
      if (!(state.hasPermission('expenses.read') || state.hasPermission('expenses.manage') || state.user?.id === expense.created_by)) return;
      if (response.error) throw response.error;
      if (!(response.data instanceof Blob)) throw new Error('The receipt could not be downloaded.');
      const url = URL.createObjectURL(response.data);
      try {
        const link = document.createElement('a'); link.href = url;
        link.download = expense.receipt_url.split('/').pop() ?? 'receipt';
        document.body.appendChild(link); link.click(); link.remove();
      } finally {URL.revokeObjectURL(url);}
    } catch (e) {if (current()) setError((e as Error).message);}
    finally {if (current()) setBusy(false);}
  }
  return <Card variant="default" padding="md" className="space-y-3">
    <SectionLabel as="h2" size="sm" className="text-gold">Receipt</SectionLabel>
    {expense.receipt_url ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => {void download();}}>Download receipt</Button>
      : <p className="text-sm text-text-secondary">No receipt attached.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <ReceiptUploader expenseId={expense.id} value={expense.receipt_url} editable={canEdit} onBusyChange={onBusyChange} />
  </Card>;
}
