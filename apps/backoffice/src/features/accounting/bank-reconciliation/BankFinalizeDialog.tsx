import { useState } from 'react';
import { Dialog, DialogDescription, Input } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import type { BankFinalizeSnapshot } from '@/lib/bankAttemptSchema.js';
import type { GlLine } from './contracts.js';
import { bankMoney } from './money.js';
export function BankFinalizeDialog({ reconciliationId, unmatched, onClose, onReady }: { reconciliationId: string; unmatched: GlLine[]; onClose: () => void; onReady: (payload: BankFinalizeSnapshot) => void }) {
  const [reasons,setReasons] = useState<Record<string,string>>({});
  const okay = unmatched.length <= 5000 && unmatched.every((line) => (reasons[line.id]?.trim().length ?? 0) >= 3);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
    <DialogTitle>Review reconciliation finalization</DialogTitle><DialogDescription>Only identified ledger movements in transit may be carried forward. Every bank movement must already be explained.</DialogDescription>
    {unmatched.length === 0 ? <p className="text-sm">No unmatched ledger lines will be carried forward.</p> : <div className="space-y-3">{unmatched.map((line) => <label key={line.id} className="block space-y-1 border-b border-border-subtle pb-3 text-sm">
      <span>{line.entry_date} · {line.entry_number} · {bankMoney(line.amount)}<br />{line.description}</span>
      <Input aria-label={`Transit reason ${line.entry_number} ${line.id.slice(0,8)}`} maxLength={1000} placeholder="Reason this ledger movement is still in transit" value={reasons[line.id] ?? ''} onChange={(e) => setReasons((old) => ({ ...old,[line.id]: e.target.value }))} />
    </label>)}</div>}
    <p className="text-sm text-text-secondary">Finalization freezes the snapshot. The server verifies exact balances, source integrity and all outstanding lines again.</p>
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={!okay} onClick={() => onReady({ reconciliationId,transit: unmatched.map((line) => ({ gl_line_id: line.id,reason: reasons[line.id]!.trim() })) })}>Review final confirmation</Button></div>
  </DialogContent></Dialog>;
}
