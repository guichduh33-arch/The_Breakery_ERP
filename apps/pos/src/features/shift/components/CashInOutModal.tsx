// apps/pos/src/features/shift/components/CashInOutModal.tsx
// Session 13 / Phase 3.C — mid-shift cash in/out recorder.

import { useState, type JSX } from 'react';
import { Button, Currency, Numpad, FullScreenModal } from '@breakery/ui';
import { toast } from 'sonner';
import { useCashMovement } from '../hooks/useCashMovement';

export interface CashInOutModalProps {
  open:       boolean;
  sessionId:  string;
  direction:  'in' | 'out';
  onClose:    () => void;
  onRecorded?: (newCashInTotal: number, newCashOutTotal: number) => void;
}

export function CashInOutModal({
  open,
  sessionId,
  direction,
  onClose,
  onRecorded,
}: CashInOutModalProps): JSX.Element {
  const [amountStr, setAmountStr] = useState('');
  const [reason, setReason] = useState('');
  const mut = useCashMovement();

  const amount = Number(amountStr || '0');
  const title = direction === 'in' ? 'Cash In' : 'Cash Out';

  async function handleSubmit(): Promise<void> {
    if (amount <= 0) {
      toast.error('Amount must be greater than zero.');
      return;
    }
    if (reason.trim().length < 3) {
      toast.error('Reason is required (min 3 characters).');
      return;
    }
    try {
      const result = await mut.mutateAsync({
        session_id: sessionId,
        direction,
        amount,
        reason: reason.trim(),
      });
      toast.success(`${title} recorded (${amount.toLocaleString('id-ID')} IDR).`);
      onRecorded?.(result.cash_in_total, result.cash_out_total);
      setAmountStr('');
      setReason('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record');
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-md w-full shadow-modal space-y-6">
        <header className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">{title}</h2>
          <span className="text-xs uppercase tracking-wide text-text-secondary">
            {direction === 'in' ? 'Add to drawer' : 'Remove from drawer'}
          </span>
        </header>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Amount</label>
          <div className="bg-bg-input border-2 border-gold rounded-md px-4 py-3 text-2xl font-mono text-right tabular-nums">
            Rp {amountStr || '0'}
          </div>
          <div className="text-center">
            <Currency amount={amount} emphasis="gold" className="text-3xl" />
          </div>
        </section>

        <Numpad value={amountStr} onChange={setAmountStr} />

        <section className="space-y-2">
          <label htmlFor="cash_reason" className="text-xs uppercase tracking-wide text-text-secondary">
            Reason
          </label>
          <input
            id="cash_reason"
            type="text"
            className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={direction === 'in' ? 'Float top-up from safe' : 'Petty cash purchase'}
          />
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            variant="gold"
            size="lg"
            disabled={mut.isPending || amount <= 0 || reason.trim().length < 3}
            onClick={() => { void handleSubmit(); }}
          >
            {mut.isPending ? 'Recording…' : `Record ${title}`}
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
