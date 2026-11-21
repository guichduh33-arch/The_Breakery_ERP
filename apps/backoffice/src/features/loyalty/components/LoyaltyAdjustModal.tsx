// apps/backoffice/src/features/loyalty/components/LoyaltyAdjustModal.tsx
//
// Wraps LoyaltyAdjustForm and dispatches the adjust_loyalty_points RPC.
// Maps known RPC errors to inline form errors per spec §3.6.
// Décision 2026-11-21 : un crédit exige un PIN manager. Le PIN ne transite que
// par le lambda d'envoi : il n'entre jamais dans le payload de reprise persisté.

import { useEffect, useId, useState } from 'react';
import { Dialog, DialogDescription, LoyaltyAdjustForm, type LoyaltyAdjustFormValues } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useAdjustLoyaltyPoints, AdjustError, type AdjustErrorCode } from '../hooks/useAdjustLoyaltyPoints.js';
import type { CustomerListRow } from '../hooks/useLoyaltyCustomersList.js';
import { useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { FinancialAttemptError, PENDING_MESSAGE } from '@/lib/pendingFinancialAttempts.js';
import { useAuthStore } from '@/stores/authStore.js';

export interface LoyaltyAdjustModalProps {
  customer: CustomerListRow | undefined;
  onClose: () => void;
  /** Geste demandé. `redeem` pré-sélectionne le débit ; sans valeur, le
   *  formulaire reste neutre (« Adjust points », crédit par défaut). */
  direction?: 'add' | 'redeem';
}

const DIALOG_TITLE = { add: 'Add points', redeem: 'Redeem points' } as const;

/** Codes qui brûlent ou refusent le nonce : le PIN doit être ressaisi. */
const PIN_CODES: ReadonlySet<AdjustErrorCode> = new Set(['pin_required', 'wrong_pin', 'pin_forbidden', 'rate_limited']);

function adjustErrorCopy(code: AdjustErrorCode, balance: number): string {
  switch (code) {
    case 'forbidden':            return 'You no longer have permission to adjust points. Please refresh.';
    case 'insufficient_balance': return `Customer only has ${balance.toLocaleString('id-ID')} points.`;
    case 'customer_deleted':     return 'This customer was deleted in another session. Close this form and refresh the list.';
    case 'invalid_input':        return 'Invalid input.';
    case 'pin_required':         return 'Adding points requires a manager PIN.';
    case 'wrong_pin':            return 'Invalid manager PIN. Please retry.';
    case 'pin_forbidden':        return 'PIN rejected or authorization expired — the manager needs the loyalty adjust permission. Re-enter the PIN.';
    case 'rate_limited':         return 'Too many PIN attempts. Wait a minute and retry.';
    default:                     return 'Something went wrong. Please retry.';
  }
}

export function LoyaltyAdjustModal({ customer, onClose, direction }: LoyaltyAdjustModalProps) {
  const adjustMut = useAdjustLoyaltyPoints();
  const open = customer !== undefined;
  const [formError, setFormError] = useState<string | null>(null);
  const [pinResetToken, setPinResetToken] = useState(0);
  // PIN de la vue « tentative en attente » d'un crédit : jamais persisté.
  const [pendingPin, setPendingPin] = useState('');
  // Le créneau de reprise est écrit AVANT l'envoi : sans ce drapeau, la vue
  // « en attente » remplaçait le formulaire pendant l'appel et un refus
  // définitif (PIN faux…) rendait un formulaire vidé de son montant et motif.
  const [draftInFlight, setDraftInFlight] = useState(false);
  const pendingPinId = useId();
  const attempt = useFinancialAttempt('loyalty_adjustment', customer?.id ?? '', open);
  const snapshot = attempt.pending?.payload;
  const sessionToken = useAuthStore((s) => s.sessionToken);
  useEffect(() => { setFormError(null); setPendingPin(''); }, [open, customer?.id, sessionToken]);
  const blocked = attempt.busy || !attempt.allowed || Boolean(attempt.storageError);
  const pendingNeedsPin = snapshot !== undefined && snapshot.delta > 0;
  const pendingPinOk = !pendingNeedsPin || /^\d{6}$/.test(pendingPin);

  async function submit(values: { delta: number; reason: string }, managerPin: string | undefined): Promise<void> {
    if (customer === undefined || blocked) return;
    setFormError(null);
    const payload = snapshot ?? { customerId: customer.id, delta: values.delta, reason: values.reason.trim() };
    const outcome = await attempt.submit(payload,
      (saved, key, current) => adjustMut.mutateAsync({ ...saved, ...(managerPin ? { managerPin } : {}), idempotencyKey: key, sessionGuard: current }));
    if (!outcome.current) return;
    if ('result' in outcome) {
      onClose();
      return;
    }
    const err = outcome.error;
    if (err instanceof AdjustError && PIN_CODES.has(err.code)) {
      // Le nonce est brûlé ou refusé : on vide le PIN, montant et motif restent.
      setPinResetToken((n) => n + 1);
      setPendingPin('');
    }
    if (snapshot) {
      setFormError(err instanceof AdjustError && PIN_CODES.has(err.code)
        ? `${adjustErrorCopy(err.code, customer.loyalty_points)} The saved adjustment is still pending.`
        : 'The original result remains unconfirmed. Keep the saved details and check this pending adjustment.');
      return;
    }
    if (err instanceof AdjustError) setFormError(adjustErrorCopy(err.code, customer.loyalty_points));
    else setFormError(err instanceof FinancialAttemptError ? err.message : 'Something went wrong. Please retry.');
  }

  async function handleFormSubmit(values: LoyaltyAdjustFormValues): Promise<void> {
    setDraftInFlight(true);
    try {
      await submit(values, values.delta > 0 ? values.managerPin : undefined);
    } finally {
      setDraftInFlight(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setFormError(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{direction === undefined ? 'Adjust points' : DIALOG_TITLE[direction]} — {customer?.name}</DialogTitle>
        <DialogDescription className="sr-only">Manually credit or debit a customer's loyalty balance. Adding points requires a manager PIN.</DialogDescription>
        {customer && (
          <>
            {formError !== null && <div role="alert" className="rounded-md border border-red bg-red-soft p-2 text-xs text-red">{formError}</div>}
            {attempt.storageError && <p role="alert" className="text-sm text-danger">{attempt.storageError}</p>}
            {snapshot && !draftInFlight ? <div className="space-y-3">
              <p role="status" className="text-sm text-warning">{PENDING_MESSAGE}</p>
              <p>Saved adjustment: {snapshot.delta.toLocaleString('id-ID')} points</p>
              <p className="text-sm text-text-secondary">{snapshot.reason}</p>
              {pendingNeedsPin && (
                <div>
                  <label htmlFor={pendingPinId} className="block text-sm font-medium">Manager PIN</label>
                  <input
                    id={pendingPinId}
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={pendingPin}
                    disabled={blocked}
                    onChange={(e) => setPendingPin(e.target.value.replace(/\D/g, ''))}
                    aria-describedby={`${pendingPinId}-hint`}
                    className={`mt-1 w-full border border-border-strong rounded p-2 text-sm tracking-widest ${FOCUS_RING}`}
                  />
                  <p id={`${pendingPinId}-hint`} className="mt-1 text-xs text-text-secondary">6 digits — checking a pending credit needs a manager PIN.</p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Close</Button>
                <Button variant="ink" disabled={blocked || !pendingPinOk}
                  onClick={() => { void submit(snapshot, pendingNeedsPin ? pendingPin : undefined); }}>
                  {attempt.busy ? 'Checking…' : 'Check pending adjustment'}
                </Button>
              </div>
            </div> : <fieldset disabled={blocked}>
              <LoyaltyAdjustForm
              key={`${customer.id}:${sessionToken}:${direction ?? 'adjust'}`}
              currentBalance={customer.loyalty_points}
              initialSign={direction === 'redeem' ? '-' : '+'}
              requirePinForCredit
              pinResetToken={pinResetToken}
              onSubmit={handleFormSubmit}
              onCancel={() => { setFormError(null); onClose(); }}
              submitting={attempt.busy}
            />
            </fieldset>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
