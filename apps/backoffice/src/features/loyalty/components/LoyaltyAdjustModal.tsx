// apps/backoffice/src/features/loyalty/components/LoyaltyAdjustModal.tsx
//
// Wraps LoyaltyAdjustForm and dispatches the adjust_loyalty_points RPC.
// Maps known RPC errors to inline form errors per spec §3.6.

import { useEffect, useState } from 'react';
import { Dialog, DialogDescription, LoyaltyAdjustForm, type LoyaltyAdjustFormValues } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { useAdjustLoyaltyPoints, AdjustError } from '../hooks/useAdjustLoyaltyPoints.js';
import type { CustomerListRow } from '../hooks/useLoyaltyCustomersList.js';
import { useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { FinancialAttemptError, PENDING_MESSAGE } from '@/lib/pendingFinancialAttempts.js';
import { useAuthStore } from '@/stores/authStore.js';

export interface LoyaltyAdjustModalProps {
  customer: CustomerListRow | undefined;
  onClose: () => void;
}

export function LoyaltyAdjustModal({ customer, onClose }: LoyaltyAdjustModalProps) {
  const adjustMut = useAdjustLoyaltyPoints();
  const open = customer !== undefined;
  const [formError, setFormError] = useState<string | null>(null);
  const attempt = useFinancialAttempt('loyalty_adjustment', customer?.id ?? '', open);
  const snapshot = attempt.pending?.payload;
  const sessionToken = useAuthStore((s) => s.sessionToken);
  useEffect(() => { setFormError(null); }, [open, customer?.id, sessionToken]);
  const blocked = attempt.busy || !attempt.allowed || Boolean(attempt.storageError);

  async function handleSubmit(values: LoyaltyAdjustFormValues): Promise<void> {
    if (customer === undefined || blocked) return;
    setFormError(null);
    const outcome = await attempt.submit(snapshot ?? { customerId: customer.id, delta: values.delta, reason: values.reason.trim() },
      (payload, key, current) => adjustMut.mutateAsync({ ...payload, idempotencyKey: key, sessionGuard: current }));
    if (!outcome.current) return;
    if ('result' in outcome) {
      onClose();
    } else {
      const err = outcome.error;
      if (snapshot) {
        setFormError('The original result remains unconfirmed. Keep the saved details and check this pending adjustment.');
        return;
      }
      if (err instanceof AdjustError) {
        switch (err.code) {
          case 'forbidden':            setFormError('You no longer have permission to adjust points. Please refresh.'); break;
          case 'insufficient_balance': setFormError(`Customer only has ${customer.loyalty_points.toLocaleString('id-ID')} points.`); break;
          case 'customer_deleted':
            setFormError('This customer was deleted in another session. Close this form and refresh the list.');
            break;
          case 'invalid_input':        setFormError('Invalid input.'); break;
          default:                     setFormError('Something went wrong. Please retry.');
        }
      } else {
        setFormError(err instanceof FinancialAttemptError ? err.message : 'Something went wrong. Please retry.');
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setFormError(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Adjust points — {customer?.name}</DialogTitle>
        <DialogDescription className="sr-only">Manually credit or debit a customer's loyalty balance.</DialogDescription>
        {customer && (
          <>
            {formError !== null && <div role="alert" className="rounded-md border border-red bg-red-soft p-2 text-xs text-red">{formError}</div>}
            {attempt.storageError && <p role="alert" className="text-sm text-danger">{attempt.storageError}</p>}
            {snapshot ? <div className="space-y-3">
              <p role="status" className="text-sm text-warning">{PENDING_MESSAGE}</p>
              <p>Saved adjustment: {snapshot.delta.toLocaleString('id-ID')} points</p>
              <p className="text-sm text-text-secondary">{snapshot.reason}</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Close</Button>
                <Button variant="ink" disabled={blocked} onClick={() => { void handleSubmit(snapshot); }}>
                  {attempt.busy ? 'Checking…' : 'Check pending adjustment'}
                </Button>
              </div>
            </div> : <fieldset disabled={blocked}>
              <LoyaltyAdjustForm
              key={`${customer.id}:${sessionToken}`}
              currentBalance={customer.loyalty_points}
              onSubmit={handleSubmit}
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
