// apps/pos/src/features/shift/components/CloseShiftModal.tsx
// Session 13 / Phase 3.C — full-screen modal to count cash, preview
// variance, and post the close via close_shift_v1.
//
// LOT 4 (POS P0 hardening, audit 2026-06-25) — BLIND CASH COUNT. The cashier
// must enter the physically-counted cash WITHOUT seeing the system-expected
// amount or the live variance. Otherwise they can tune their count to match
// the expected figure, masking a till skim. The expected/variance are only
// revealed AFTER the count is submitted (step 'review'). The above-threshold
// note requirement still applies, on the review step.

import { useMemo, useState, type JSX } from 'react';
import { Button, Currency, Numpad, FullScreenModal } from '@breakery/ui';
import { toast } from 'sonner';
import { sumDenominations } from '@breakery/domain';
import { useCloseShift } from '../hooks/useCloseShift';
import { useDenominationCountEnabled } from '../hooks/useDenominationCountEnabled';
import { DenominationGrid } from './DenominationGrid';
import { useLoginUsers } from '@/features/auth/hooks/useLoginUsers';
import { useEnabledPaymentMethods } from '@/features/settings/hooks/useEnabledPaymentMethods';
import { VarianceWarningBadge, shouldShowWarning } from './VarianceWarningBadge';

// S66 (12 D2.1) — role NAMES (list_login_users_v1 exposes roles.name, not the
// code) whose holders can approve a large variance. Kept in sync with the
// shift.variance.approve seed (_118: MANAGER/ADMIN/SUPER_ADMIN); the server
// re-checks the permission regardless, so a drift here only mis-filters the
// picker, never bypasses the gate.
const APPROVER_ROLE_NAMES = ['Manager', 'Admin', 'Super Admin'];

export interface CloseShiftModalProps {
  open:               boolean;
  sessionId:          string;
  /** Computed from server hint: opening + cash sales + cash_in - cash_out. */
  expectedCash:       number;
  thresholdAbs:       number;
  thresholdPct:       number;
  /** S66 — manager-PIN thresholds (higher tier than the note thresholds). */
  pinThresholdAbs:    number;
  pinThresholdPct:    number;
  onClose:            () => void;
  onClosed?:          (variance: number) => void;
}

type Step = 'count' | 'review';

export function CloseShiftModal({
  open,
  sessionId,
  expectedCash,
  thresholdAbs,
  thresholdPct,
  pinThresholdAbs,
  pinThresholdPct,
  onClose,
  onClosed,
}: CloseShiftModalProps): JSX.Element {
  const [amountStr, setAmountStr] = useState('');
  // S67 (12 D2.2/D2.3) — three-way count: QRIS/card terminal totals, entered
  // blind alongside cash (no expected shown for any volet on this step).
  const [qrisStr, setQrisStr] = useState('');
  const [cardStr, setCardStr] = useState('');
  // S67 — closing-cash denomination grid, opt-in via business_config flag.
  const [denoms, setDenoms] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  // Blind count: stay on 'count' until the cashier commits their figure; the
  // expected cash and variance are hidden entirely on this step.
  const [step, setStep] = useState<Step>('count');
  // S66 — manager approval on large variances.
  const [approverId, setApproverId] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const closeMut = useCloseShift();
  const loginUsers = useLoginUsers();
  const denomEnabled = useDenominationCountEnabled();
  const enabledMethods = useEnabledPaymentMethods();
  const qrisVisible = enabledMethods.has('qris');
  const cardVisible = enabledMethods.has('card') || enabledMethods.has('edc');

  const counted = denomEnabled ? sumDenominations(denoms) : Number(amountStr || '0');
  const variance = useMemo(() => counted - expectedCash, [counted, expectedCash]);

  // S67 — cash volet is "empty" per the active input mode; the two non-cash
  // volets (when visible) are required-but-zero-allowed, per the "blind
  // count" invariant — nothing here reveals an expected amount.
  const cashEmpty = denomEnabled
    ? counted <= 0 && Object.keys(denoms).length === 0
    : amountStr === '';
  const nonCashIncomplete = (qrisVisible && qrisStr === '') || (cardVisible && cardStr === '');

  // P1-2 (S43): above-threshold variance requires an explanatory note before
  // the shift can be closed. Same predicate as the VarianceWarningBadge so the
  // note requirement kicks in exactly when the badge shows.
  const overThreshold = shouldShowWarning(variance, expectedCash, thresholdAbs, thresholdPct);
  const noteRequired = step === 'review' && overThreshold && notes.trim() === '';

  // S66 (12 D2.1): above the higher PIN thresholds, a designated manager must
  // approve. Same predicate shape as the note guard, mirrored server-side in
  // close_shift_v5 (pin_approval_required) — the UI block is a convenience,
  // the RPC is the authority.
  const pinRequired = step === 'review'
    && shouldShowWarning(variance, expectedCash, pinThresholdAbs, pinThresholdPct);
  const approvers = (loginUsers.data ?? []).filter((u) => APPROVER_ROLE_NAMES.includes(u.role));
  const pinIncomplete = pinRequired && (approverId === '' || !/^\d{6}$/.test(managerPin));

  function handleConfirmCount(): void {
    if (cashEmpty) {
      toast.error('Enter the counted cash amount.');
      return;
    }
    if (nonCashIncomplete) {
      toast.error('Enter every counted volet (0 is allowed).');
      return;
    }
    setStep('review');
  }

  async function handleSubmit(): Promise<void> {
    if (cashEmpty) {
      toast.error('Enter the counted cash amount.');
      return;
    }
    if (nonCashIncomplete) {
      toast.error('Enter every counted volet (0 is allowed).');
      return;
    }
    try {
      const payload: {
        session_id: string;
        counted_cash: number;
        notes?: string;
        approver_id?: string;
        manager_pin?: string;
        counted_qris?: number;
        counted_card?: number;
        denominations?: Record<string, number>;
      } = {
        session_id: sessionId,
        counted_cash: counted,
      };
      if (notes !== '') payload.notes = notes;
      if (pinRequired) {
        payload.approver_id = approverId;
        payload.manager_pin = managerPin;
      }
      if (qrisVisible) payload.counted_qris = Number(qrisStr || '0');
      if (cardVisible) payload.counted_card = Number(cardStr || '0');
      if (denomEnabled) payload.denominations = denoms;
      const result = await closeMut.mutateAsync(payload);
      // Idempotent replay (double-submit race) returns a slim envelope without
      // `variance` — never dereference it blindly.
      const resultVariance = result.variance ?? 0;
      toast.success(
        resultVariance === 0
          ? 'Shift closed (balanced).'
          : `Shift closed — variance ${resultVariance > 0 ? '+' : ''}${resultVariance.toLocaleString('id-ID')} IDR.`,
      );
      onClosed?.(resultVariance);
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
          {/* Variance badge is part of the reveal — never shown during the
              blind count step. */}
          {step === 'review' && (
            <VarianceWarningBadge
              variance={variance}
              expectedCash={expectedCash}
              thresholdAbs={thresholdAbs}
              thresholdPct={thresholdPct}
            />
          )}
        </header>

        {step === 'count' && (
          <p className="text-xs text-text-secondary">
            Count the physical cash in the drawer and enter the total. The
            expected amount stays hidden until you confirm your count.
          </p>
        )}

        <section className="space-y-3 rounded-md bg-bg-input p-3 text-sm">
          {/* Expected cash is hidden during the blind count to prevent the
              cashier tuning their count to the system figure (LOT 4). */}
          {step === 'review' && (
            <Row label="Expected cash" value={<Currency amount={expectedCash} emphasis="normal" />} />
          )}
          <Row
            label="Counted cash"
            value={
              <span className="font-mono tabular-nums text-text-primary">
                Rp {denomEnabled ? counted.toLocaleString('id-ID') : (amountStr || '0')}
              </span>
            }
          />
          {step === 'review' && (
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
          )}
          {/* S67 — non-cash volets: counted-only on review, no client-side
              expected/variance (the RPC is the authority; see review-step
              note below). Cash stays the sole volet with a client-computed
              variance, since it's the one the note/PIN gates key off. */}
          {step === 'review' && qrisVisible && (
            <Row
              label="QRIS counted"
              value={<span className="font-mono tabular-nums text-text-primary">Rp {Number(qrisStr || '0').toLocaleString('id-ID')}</span>}
            />
          )}
          {step === 'review' && cardVisible && (
            <Row
              label="Card + EDC counted"
              value={<span className="font-mono tabular-nums text-text-primary">Rp {Number(cardStr || '0').toLocaleString('id-ID')}</span>}
            />
          )}
        </section>

        {step === 'review' && (qrisVisible || cardVisible) && (
          <p className="text-[11px] text-text-secondary">
            Non-cash volets are reconciled server-side at close; any large variance
            will ask for a note or manager approval.
          </p>
        )}

        {step === 'count' && (
          denomEnabled
            ? <DenominationGrid value={denoms} onChange={setDenoms} />
            : <Numpad value={amountStr} onChange={setAmountStr} />
        )}

        {/* S67 — blind entry for the non-cash volets: no expected shown here
            either. Required-when-visible (0 accepted) before Confirm count. */}
        {step === 'count' && qrisVisible && (
          <section className="space-y-1">
            <label htmlFor="counted_qris" className="text-xs uppercase tracking-wide text-text-secondary">
              QRIS total (terminal report)
            </label>
            <input
              id="counted_qris"
              data-testid="counted-qris-input"
              type="text"
              inputMode="numeric"
              placeholder="0"
              className="w-full min-h-[44px] bg-bg-input border border-border-subtle rounded-md p-3 text-sm font-mono tabular-nums focus:outline-none focus:border-gold"
              value={qrisStr}
              onChange={(e) => setQrisStr(e.target.value.replace(/\D/g, ''))}
            />
          </section>
        )}
        {step === 'count' && cardVisible && (
          <section className="space-y-1">
            <label htmlFor="counted_card" className="text-xs uppercase tracking-wide text-text-secondary">
              Card + EDC total (terminal report)
            </label>
            <input
              id="counted_card"
              data-testid="counted-card-input"
              type="text"
              inputMode="numeric"
              placeholder="0"
              className="w-full min-h-[44px] bg-bg-input border border-border-subtle rounded-md p-3 text-sm font-mono tabular-nums focus:outline-none focus:border-gold"
              value={cardStr}
              onChange={(e) => setCardStr(e.target.value.replace(/\D/g, ''))}
            />
          </section>
        )}

        {step === 'review' && (
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
        )}

        {/* S66 (12 D2.1) — large variance: a designated manager approves with
            their 6-digit PIN. Server-enforced by close_shift_v4; this section
            just collects approver + PIN. */}
        {pinRequired && (
          <section className="space-y-2" data-testid="manager-approval-section">
            <label htmlFor="approver_select" className="text-xs uppercase tracking-wide text-text-secondary">
              Manager approval (required — variance above manager threshold)
            </label>
            <select
              id="approver_select"
              className="w-full min-h-[44px] bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold"
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
            >
              <option value="">Select manager…</option>
              {approvers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name} ({u.role})
                </option>
              ))}
            </select>
            <input
              id="approver_pin"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="Manager PIN (6 digits)"
              className="w-full min-h-[44px] bg-bg-input border border-border-subtle rounded-md p-3 text-sm font-mono tracking-[0.5em] focus:outline-none focus:border-gold"
              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            {pinIncomplete && (
              <p className="text-xs text-danger" role="alert">
                Select the approving manager and enter their 6-digit PIN.
              </p>
            )}
          </section>
        )}

        <div className="grid grid-cols-2 gap-3">
          {step === 'count' ? (
            <>
              <Button variant="secondary" size="lg" onClick={onClose} disabled={closeMut.isPending}>
                Cancel
              </Button>
              <Button
                variant="gold"
                size="lg"
                disabled={cashEmpty || nonCashIncomplete}
                onClick={handleConfirmCount}
              >
                Confirm count
              </Button>
            </>
          ) : (
            <>
              {/* Back lets the cashier re-edit a mistyped count; it returns to
                  the blind step (expected/variance hidden again). */}
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setStep('count')}
                disabled={closeMut.isPending}
              >
                Back
              </Button>
              <Button
                variant="gold"
                size="lg"
                disabled={closeMut.isPending || cashEmpty || nonCashIncomplete || noteRequired || pinIncomplete}
                onClick={() => { void handleSubmit(); }}
              >
                {closeMut.isPending ? 'Closing…' : 'Close Shift'}
              </Button>
            </>
          )}
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
