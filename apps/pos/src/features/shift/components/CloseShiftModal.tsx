// apps/pos/src/features/shift/components/CloseShiftModal.tsx
// Session 13 / Phase 3.C — full-screen modal to count cash, preview
// variance, and post the close via close_shift_v1.

import { useMemo, useState, type JSX } from 'react';
import { Button, Currency, Numpad, FullScreenModal } from '@breakery/ui';
import { toast } from 'sonner';
import { useCloseShift } from '../hooks/useCloseShift';
import { VarianceWarningBadge, shouldShowWarning } from './VarianceWarningBadge';

export interface CloseShiftModalProps {
  open:               boolean;
  sessionId:          string;
  /** Computed from server hint: opening + cash sales + cash_in - cash_out. */
  expectedCash:       number;
  thresholdAbs:       number;
  thresholdPct:       number;
  onClose:            () => void;
  onClosed?:          (variance: number) => void;
}

export function CloseShiftModal({
  open,
  sessionId,
  expectedCash,
  thresholdAbs,
  thresholdPct,
  onClose,
  onClosed,
}: CloseShiftModalProps): JSX.Element {
  const [amountStr, setAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const closeMut = useCloseShift();

  const counted = Number(amountStr || '0');
  const variance = useMemo(() => counted - expectedCash, [counted, expectedCash]);

  // P1-2 (S43): above-threshold variance requires an explanatory note before
  // the shift can be closed. Same predicate as the VarianceWarningBadge so the
  // note requirement kicks in exactly when the badge shows.
  const overThreshold = shouldShowWarning(variance, expectedCash, thresholdAbs, thresholdPct);
  const noteRequired = amountStr !== '' && overThreshold && notes.trim() === '';

  async function handleSubmit(): Promise<void> {
    if (amountStr === '') {
      toast.error('Enter the counted cash amount.');
      return;
    }
    try {
      const payload: { session_id: string; counted_cash: number; notes?: string } = {
        session_id: sessionId,
        counted_cash: counted,
      };
      if (notes !== '') payload.notes = notes;
      const result = await closeMut.mutateAsync(payload);
      toast.success(
        result.variance === 0
          ? 'Shift closed (balanced).'
          : `Shift closed — variance ${result.variance > 0 ? '+' : ''}${result.variance.toLocaleString('id-ID')} IDR.`,
      );
      onClosed?.(result.variance);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close shift');
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => { if (!o) onClose(); }} accessibleTitle="Close shift">
      {/* max-h + scroll : sur un écran tablette (~800px) le contenu (numpad +
          notes + footer) dépasse le viewport et le bouton Close devenait
          inatteignable (constaté à l'audit POS 2026-06-12). */}
      <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-md w-full shadow-modal space-y-6 max-h-[92vh] overflow-y-auto">
        <header className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">Close Shift</h2>
          <VarianceWarningBadge
            variance={variance}
            expectedCash={expectedCash}
            thresholdAbs={thresholdAbs}
            thresholdPct={thresholdPct}
          />
        </header>

        <section className="space-y-3 rounded-md bg-bg-input p-3 text-sm">
          <Row label="Expected cash" value={<Currency amount={expectedCash} emphasis="normal" />} />
          <Row
            label="Counted cash"
            value={
              <span className="font-mono tabular-nums text-text-primary">
                Rp {amountStr || '0'}
              </span>
            }
          />
          <Row
            label="Variance"
            value={
              <span
                data-testid="variance-preview"
                className={
                  variance === 0
                    ? 'font-mono tabular-nums text-text-primary'
                    : variance > 0
                      ? 'font-mono tabular-nums text-green'
                      : 'font-mono tabular-nums text-red'
                }
              >
                {variance > 0 ? '+' : ''}{variance.toLocaleString('id-ID')}
              </span>
            }
          />
        </section>

        <Numpad value={amountStr} onChange={setAmountStr} />

        <section className="space-y-2">
          <label htmlFor="close_notes" className="text-xs uppercase tracking-wide text-text-secondary">
            Notes {overThreshold
              ? '(required — variance above threshold)'
              : '(optional — variance reason, manager override)'}
          </label>
          <textarea
            id="close_notes"
            className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes..."
          />
          {noteRequired && (
            <p className="text-xs text-danger" role="alert">
              Variance above threshold — a note explaining the difference is required.
            </p>
          )}
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={closeMut.isPending}>
            Cancel
          </Button>
          <Button
            variant="gold"
            size="lg"
            disabled={closeMut.isPending || amountStr === '' || noteRequired}
            onClick={() => { void handleSubmit(); }}
          >
            {closeMut.isPending ? 'Closing…' : 'Close Shift'}
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}

function Row({ label, value }: { label: string; value: JSX.Element }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">{label}</span>
      <span>{value}</span>
    </div>
  );
}
