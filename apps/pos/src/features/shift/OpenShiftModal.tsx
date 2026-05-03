// apps/pos/src/features/shift/OpenShiftModal.tsx
import { useState } from 'react';
import { Button, Currency, Numpad, FullScreenModal } from '@breakery/ui';
import { todayIsoDate, formatTimeWita } from '@breakery/utils';
import { useOpenShift } from './hooks/useShift';
import { toast } from 'sonner';

const QUICK_AMOUNTS = [100000, 200000, 300000, 500000, 1000000];

export interface OpenShiftModalProps {
  open: boolean;
}

export function OpenShiftModal({ open }: OpenShiftModalProps) {
  const [amountStr, setAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const openShift = useOpenShift();

  const amount = Number(amountStr || '0');
  const today = todayIsoDate();
  const time = formatTimeWita(new Date());

  async function handleSubmit() {
    if (amount <= 0) return;
    try {
      const mutInput: { opening_cash: number; opening_notes?: string } = { opening_cash: amount };
      if (notes) mutInput.opening_notes = notes;
      await openShift.mutateAsync(mutInput);
      toast.success('Shift opened');
    } catch (err) {
      toast.error('Failed to open shift');
      console.error(err);
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={() => { /* not closable */ }}>
      <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-md w-full shadow-modal space-y-6">
        <header className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">Open Shift</h2>
          <div className="text-right text-sm">
            <div className="text-text-primary uppercase tracking-wide">{today}</div>
            <div className="text-text-secondary">{time}</div>
          </div>
        </header>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Opening Cash</label>
          <div className="bg-bg-input border-2 border-gold rounded-md px-4 py-3 text-2xl font-mono text-right tabular-nums">
            Rp {amountStr || '0'}
          </div>
          <div className="text-center">
            <Currency amount={amount} emphasis="gold" className="text-3xl" />
          </div>
        </section>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Quick Amounts</label>
          <div className="grid grid-cols-3 gap-2">
            {QUICK_AMOUNTS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmountStr(String(q))}
                className="bg-bg-input border border-border-subtle rounded-md py-2 text-sm hover:bg-bg-overlay"
              >
                <Currency amount={q} />
              </button>
            ))}
          </div>
        </section>

        <Numpad value={amountStr} onChange={setAmountStr} />

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Notes (optional)</label>
          <textarea
            className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes..."
          />
        </section>

        <Button
          variant="gold"
          size="lg"
          className="w-full"
          disabled={amount <= 0 || openShift.isPending}
          onClick={() => { void handleSubmit(); }}
        >
          {openShift.isPending ? 'Opening…' : 'Open Shift'}
        </Button>
      </div>
    </FullScreenModal>
  );
}
