import { useState } from 'react';
import { Dialog, DialogDescription, Input } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import type { BankManageSnapshot } from '@/lib/bankAttemptSchema.js';
export function BankUnmatchDialog({ reconciliationId, matchId, onClose, onReady }: { reconciliationId: string; matchId: string; onClose: () => void; onReady: (payload: BankManageSnapshot) => void }) {
  const [reason,setReason] = useState('');
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-lg">
    <DialogTitle>Remove match</DialogTitle><DialogDescription>The association remains in the audit history. Existing journal entries and financial reservations are preserved.</DialogDescription>
    <label className="space-y-1 text-sm">Reason for removal<Input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></label>
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={reason.trim().length < 3} onClick={() => onReady({ kind: 'unmatch',reconciliationId,matchId,reason: reason.trim() })}>Review removal</Button></div>
  </DialogContent></Dialog>;
}
