// apps/pos/src/features/shift/components/CashInOutModal.tsx
// Session 13 / Phase 3.C — mid-shift cash in/out recorder.

import { useRef, useState, type JSX } from 'react';
import { Button, Currency, Numpad, FullScreenModal, Select } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { toast } from 'sonner';
import { useCashMovement, type CashMovementReasonCode } from '../hooks/useCashMovement';
import { useAuthStore } from '@/stores/authStore';
import { counterFireScope, isDefiniteFireRefusal } from '@/features/cart/hooks/counterFireRecovery';
import { clearCashMovement, readCashMovement, resumeCashMovement, saveCashMovement, type CashMovementAttempt } from '../hooks/cashMovementRecovery';

export interface CashInOutModalProps {
  open:       boolean;
  sessionId:  string;
  direction:  'in' | 'out';
  onClose:    () => void;
  onRecorded?: (newCashInTotal: number, newCashOutTotal: number) => void;
}

const REASON_CODE_OPTIONS: { value: CashMovementReasonCode; label: string }[] = [
  { value: 'misc',           label: 'Miscellaneous — no journal entry' },
  { value: 'apport_owner',   label: 'Owner cash injection — posts JE 1110/3100' },
  { value: 'bank_transfer',  label: 'Bank transfer — posts JE 1110↔1112' },
  { value: 'replenishment',  label: 'Float rotation — no journal entry' },
];

const POSTS_JE: ReadonlySet<CashMovementReasonCode> = new Set(['apport_owner', 'bank_transfer']);

export function CashInOutModal({
  open,
  sessionId,
  direction,
  onClose,
  onRecorded,
}: CashInOutModalProps): JSX.Element {
  const [recovery, setRecovery] = useState<{ attempt: CashMovementAttempt | null; error: string | null }>(() => {
    try { return { attempt: readCashMovement(), error: null }; }
    catch (error) { return { attempt: null, error: error instanceof Error ? error.message : 'Cash movement recovery unavailable' }; }
  });
  const [amountStr, setAmountStr] = useState(recovery.attempt ? String(recovery.attempt.input.amount) : '');
  const [reason, setReason] = useState(recovery.attempt?.input.reason ?? '');
  const [reasonCode, setReasonCode] = useState<CashMovementReasonCode>(recovery.attempt?.input.reason_code ?? 'misc');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mut = useCashMovement();
  const frozen = recovery.attempt !== null || recovery.error !== null || submitting;

  const amount = Number(amountStr || '0');
  const effectiveDirection = recovery.attempt?.input.direction ?? direction;
  const title = effectiveDirection === 'in' ? 'Cash In' : 'Cash Out';

  function resetAndClose(): void {
    // Une fermeture ne solde jamais un résultat inconnu ; le prochain mount le reprend.
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (submittingRef.current || recovery.error) return;
    if (amount <= 0) {
      toast.error('Amount must be greater than zero.');
      return;
    }
    if (reason.trim().length < 3) {
      toast.error('Reason is required (min 3 characters).');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    let resumingUncertain = false;
    try {
      const auth = useAuthStore.getState();
      const saved = await resumeCashMovement(auth.user?.id ?? '', auth.sessionToken, sessionId);
      resumingUncertain = saved !== null;
      const attempt = saved ?? saveCashMovement({ version: 1,
        scope: await counterFireScope(auth.user?.id ?? '', auth.sessionToken, sessionId),
        input: { session_id: sessionId, direction, amount, reason: reason.trim(), reason_code: reasonCode,
          idempotency_key: crypto.randomUUID() },
      });
      setRecovery({ attempt, error: null });
      const result = await mut.mutateAsync(attempt.input);
      clearCashMovement();
      setRecovery({ attempt: null, error: null });
      toast.success(`${attempt.input.direction === 'in' ? 'Cash In' : 'Cash Out'} recorded (${formatIdr(attempt.input.amount)}).`);
      onRecorded?.(result.cash_in_total, result.cash_out_total);
      setAmountStr('');
      setReason('');
      setReasonCode('misc');
      resetAndClose();
    } catch (err) {
      const details = (err as { details?: { code?: string } } | null)?.details;
      // Un refus de reprise (droits retirés, session fermée…) ne prouve pas
      // l'absence du premier mouvement dont l'accusé a été perdu.
      if (!resumingUncertain && details && isDefiniteFireRefusal(details)) {
        clearCashMovement();
        setRecovery({ attempt: null, error: null });
      }
      toast.error(err instanceof Error ? err.message : 'Failed to record');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => { if (!o) resetAndClose(); }} accessibleTitle="Cash in / out">
      <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-md w-full shadow-modal space-y-6">
        <header className="flex items-center justify-between">
          <h2 className="font-semibold text-2xl">{title}</h2>
          <span className="text-xs uppercase tracking-wide text-text-secondary">
            {effectiveDirection === 'in' ? 'Add to drawer' : 'Remove from drawer'}
          </span>
        </header>

        {recovery.error && <p role="alert" className="text-red-as-text">{recovery.error}</p>}
        {recovery.attempt && <p role="status" className="text-text-secondary">Cash movement unconfirmed — resume this saved movement before recording another.</p>}
        <fieldset disabled={frozen} className="space-y-6 min-w-0">
        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Amount</label>
          {/* Critique run 3 (polish) — saisie formatée dès la frappe, une seule graphie. */}
          <div className="bg-bg-input border-2 border-gold rounded-md px-4 py-3 text-2xl font-mono text-right tabular-nums">
            {formatIdr(amount)}
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
            className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold placeholder:text-text-secondary"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={effectiveDirection === 'in' ? 'Float top-up from safe' : 'Petty cash purchase'}
          />
        </section>

        <section className="space-y-2">
          <label htmlFor="cash_reason_code" className="text-xs uppercase tracking-wide text-text-secondary">
            Reason Code
          </label>
          <Select
            id="cash_reason_code"
            data-testid="cash-reason-code"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as CashMovementReasonCode)}
          >
            {REASON_CODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
          {POSTS_JE.has(reasonCode) && (
            <p className="text-xs text-gold">This will post a journal entry.</p>
          )}
        </section>

        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={resetAndClose} disabled={submitting || mut.isPending}>
            Cancel
          </Button>
          <Button
            variant="gold"
            size="lg"
            disabled={submitting || mut.isPending || recovery.error !== null || amount <= 0 || reason.trim().length < 3}
            onClick={() => { void handleSubmit(); }}
          >
            {submitting || mut.isPending ? 'Recording…' : recovery.attempt ? `Resume ${title}` : `Record ${title}`}
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
