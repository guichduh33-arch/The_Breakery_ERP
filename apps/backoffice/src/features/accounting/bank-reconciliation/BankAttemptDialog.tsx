import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogDescription, Input } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { PENDING_MESSAGE, type FinancialPayloads } from '@/lib/pendingFinancialAttempts.js';
import type { BankManageSnapshot, BankPostSnapshot, BankFinalizeSnapshot } from '@/lib/bankAttemptSchema.js';
import { useAuthStore } from '@/stores/authStore.js';
import { sendBankFinalize, sendBankManage, sendBankPost } from './api.js';
import { bankMoney } from './money.js';

export type BankOperation = 'bank_manage' | 'bank_post' | 'bank_finalize';
export function BankAttemptDialog<K extends BankOperation>({ operation, target, payload, onClose, onSuccess }: {
  operation: K; target: string; payload: FinancialPayloads[K] | null; onClose: () => void;
  onSuccess?: (result: unknown) => void;
}) {
  const attempt = useFinancialAttempt(operation,target,true);
  const effective = attempt.pending?.payload ?? payload;
  const qc = useQueryClient();
  const [pin,setPin] = useState('');
  const [error,setError] = useState('');
  const sessionToken = useAuthStore((s) => s.sessionToken);
  useEffect(() => { setPin(''); setError(''); },[sessionToken]);
  const canPost = useAuthStore((s) => s.hasPermission('accounting.bank.manage') && s.hasPermission('accounting.je.create_manual'));
  const allowed = attempt.allowed && (operation !== 'bank_post' || canPost);
  const title = operation === 'bank_post' ? 'Post bank entry' : operation === 'bank_finalize' ? 'Finalize reconciliation' : 'Confirm bank operation';
  async function confirm() {
    if (!effective || !allowed || attempt.busy) return;
    setError('');
    const outcome = await attempt.submit(effective,async (snapshot,key,current) => {
      if (operation === 'bank_post') return sendBankPost(snapshot as BankPostSnapshot,key,pin,current);
      if (operation === 'bank_finalize') return sendBankFinalize(snapshot as BankFinalizeSnapshot,key,current);
      return sendBankManage(snapshot as BankManageSnapshot,key,current);
    });
    if (!outcome.current) return;
    setPin('');
    if ('error' in outcome) setError(outcome.error instanceof Error ? outcome.error.message : 'Unable to confirm this operation.');
    else {
      void qc.invalidateQueries({ queryKey: ['bank-reconciliation'] });
      void qc.invalidateQueries({ queryKey: ['accounting','journal-entries'] });
      void qc.invalidateQueries({ queryKey: ['accounting','general-ledger'] });
      onSuccess?.(outcome.result); onClose();
    }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
    <DialogTitle>{title}</DialogTitle><DialogDescription>Review the saved operation before confirming.</DialogDescription>
    {attempt.pending && <p role="status" className="text-sm text-warning">{PENDING_MESSAGE}</p>}
    {effective ? <AttemptSummary operation={operation} payload={effective} /> : <p>No pending operation was found.</p>}
    {operation === 'bank_post' && <label className="space-y-1 text-sm">Manager PIN<Input type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={12} onChange={(e) => setPin(e.target.value)} /></label>}
    {!allowed && <p role="alert" className="text-sm text-danger">You do not have all permissions required for this operation. Sign in again if new permissions were granted.</p>}
    {attempt.storageError && <p role="alert" className="text-sm text-danger">{attempt.storageError}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button
      disabled={!effective || !allowed || attempt.busy || Boolean(attempt.storageError) || (operation === 'bank_post' && !pin.trim())}
      onClick={() => { void confirm(); }}>{attempt.busy ? 'Checking…' : attempt.pending ? 'Check pending operation' : 'Confirm'}</Button></div>
  </DialogContent></Dialog>;
}

function AttemptSummary({ operation, payload }: { operation: BankOperation; payload: FinancialPayloads[BankOperation] }) {
  if (operation === 'bank_manage') {
    const v = payload as BankManageSnapshot;
    if (v.kind === 'import') return <div className="space-y-2 text-sm"><p>Import {v.statement.rows.length} bank movements from <strong>{v.statement.file_name}</strong> / {v.statement.sheet_name}.</p>
      <p>{v.statement.period_start} → {v.statement.period_end}</p><p>Opening {bankMoney(v.statement.opening_balance)} · closing {bankMoney(v.statement.closing_balance)}</p>
      <p className="break-all text-xs text-text-muted">Source SHA-256: {v.statement.source_sha256}</p></div>;
    if (v.kind === 'balances') return <p className="text-sm">Save opening {bankMoney(v.opening)} and closing {bankMoney(v.closing)}. Missing balances remain unavailable.</p>;
    if (v.kind === 'unmatch') return <div className="text-sm space-y-2"><p>Remove the selected association. Existing journal entries and settlement reservations remain recorded.</p><p>Reason: {v.reason}</p></div>;
    return <p className="text-sm">Match {v.bankIds.length} bank movements with {v.glIds.length} ledger lines. The server requires exactly equal totals and unallocated source lines.</p>;
  }
  if (operation === 'bank_post') {
    const v = payload as BankPostSnapshot;
    return <div className="text-sm space-y-2"><p><strong>{v.kind === 'net_fee' ? 'Actual fees on an existing bank receipt' : v.kind === 'settlement' ? 'Card / QRIS settlement' : v.kind === 'fee' ? 'Bank fees' : 'Bank interest'}</strong> · {v.date}</p>
      <p>{v.description}</p><p>{v.bankIds.length} bank movements · {v.clearingIds.length} clearing lines · {v.bankGlIds.length} existing bank ledger lines.</p>
      <p>Actual fee: {bankMoney(v.fee)}</p><p>This creates a balanced journal entry and an audited association. Removing the association later does not reverse the journal entry.</p></div>;
  }
  const v = payload as BankFinalizeSnapshot;
  return <div className="space-y-2 text-sm"><p>Freeze this reconciliation and its source snapshot. Further changes to this reconciliation will be refused.</p>
    <p>{v.transit.length} ledger lines will be carried forward with the following reasons:</p>
    <ul className="max-h-60 space-y-2 overflow-auto">{v.transit.map((line) => <li key={line.gl_line_id}><span className="font-data text-xs">{line.gl_line_id}</span> · {line.reason}</li>)}</ul>
    <p>Unknown bank lines or an unexplained balance difference block finalization.</p></div>;
}
