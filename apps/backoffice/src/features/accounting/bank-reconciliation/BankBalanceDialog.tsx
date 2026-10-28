import { useState } from 'react';
import { Dialog, DialogDescription, Input } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import type { BankManageSnapshot } from '@/lib/bankAttemptSchema.js';
import type { BankReconciliation } from './contracts.js';
import { decimalCents, decimalText } from './money.js';
export function BankBalanceDialog({ reconciliation, onClose, onReady }: { reconciliation: BankReconciliation; onClose: () => void; onReady: (payload: BankManageSnapshot) => void }) {
  const [opening,setOpening] = useState(reconciliation.opening_balance ?? '');
  const [closing,setClosing] = useState(reconciliation.closing_balance ?? '');
  const [error,setError] = useState('');
  function next() {
    try { onReady({ kind: 'balances',reconciliationId: reconciliation.id,
      opening: opening.trim() ? decimalText(decimalCents(opening)) : null, closing: closing.trim() ? decimalText(decimalCents(closing)) : null }); }
    catch (failure) { setError((failure as Error).message); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-lg">
    <DialogTitle>Statement balances</DialogTitle><DialogDescription>Use exact balances from the bank statement. Leave missing values blank.</DialogDescription>
    <label className="space-y-1 text-sm">Opening balance (decimal point)<Input value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="Unavailable" /></label>
    <label className="space-y-1 text-sm">Closing balance (decimal point)<Input value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="Unavailable" /></label>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={next}>Review balances</Button></div>
  </DialogContent></Dialog>;
}
