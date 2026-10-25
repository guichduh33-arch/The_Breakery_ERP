// apps/backoffice/src/features/customers/components/ConvertLoyaltyModal.tsx
// ADR-013 Lot 4 (D6) — conversion points fidélité → avoir (BO seulement).
// Points par multiples de 100, taux serveur 1 pt = Rp 10 (préversion client
// indicative — le serveur reste autoritaire). Clé et payload durables jusqu'à confirmation.

import { useEffect, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogDescription } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { formatCurrency } from '@breakery/utils';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { FinancialAttemptError, PENDING_MESSAGE } from '@/lib/pendingFinancialAttempts.js';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useConvertLoyaltyToStoreCredit, ConvertStoreCreditError, type ConvertErrorCode,
} from '../hooks/useConvertLoyaltyToStoreCredit.js';

// Miroir de la constante serveur (conversion points → avoir : ×10).
const RP_PER_POINT = 10;

const ERROR_COPY: Record<ConvertErrorCode, string> = {
  forbidden:           'You no longer have permission to convert points. Please refresh.',
  invalid_points:      'Points must be a positive multiple of 100.',
  insufficient_points: 'The customer does not have enough points.',
  customer_not_found:  'This customer was deleted in another session.',
  fiscal_closed:       'The fiscal period is closed — conversion refused.',
  unknown:             'Something went wrong. Please retry.',
};

interface Props {
  open:          boolean;
  onClose:       () => void;
  customerId:    string;
  customerName:  string;
  loyaltyPoints: number;
}

export function ConvertLoyaltyModal({
  open, onClose, customerId, customerName, loyaltyPoints,
}: Props): JSX.Element {
  const [pointsStr, setPointsStr] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const m = useConvertLoyaltyToStoreCredit();
  const attempt = useFinancialAttempt('loyalty_conversion', customerId, open);
  const snapshot = attempt.pending?.payload;
  const sessionToken = useAuthStore((s) => s.sessionToken);
  useEffect(() => { setPointsStr(''); setFormError(null); }, [open, customerId, sessionToken]);

  const points = snapshot?.points ?? Number(pointsStr || '0');
  const pointsOk =
    Number.isInteger(points) && points > 0 && points % 100 === 0 && points <= loyaltyPoints;
  const canSubmit = attempt.allowed && (Boolean(snapshot) || pointsOk) && !attempt.busy && !attempt.storageError;

  const handleClose = (): void => {
    setPointsStr('');
    setFormError(null);
    onClose();
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setFormError(null);
    const outcome = await attempt.submit(snapshot ?? { customerId, points },
      (payload, key, current) => m.mutateAsync({ ...payload, idempotencyKey: key, sessionGuard: current }));
    if (!outcome.current) return;
    if ('result' in outcome && outcome.result) {
      const result = outcome.result;
      toast.success(
        `${result.points_converted.toLocaleString('id-ID')} points converted to ${formatCurrency(result.amount)} store credit`
        + ` — new balance ${formatCurrency(result.balance_after)}`,
      );
      handleClose();
    } else {
      const err = outcome.error;
      const code: ConvertErrorCode = err instanceof ConvertStoreCreditError ? err.code : 'unknown';
      setFormError(snapshot ? 'The original result remains unconfirmed. Keep the saved details and check this pending conversion.'
        : err instanceof FinancialAttemptError && code === 'unknown' ? err.message : ERROR_COPY[code]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Convert points to store credit — {customerName}</DialogTitle>
        <DialogDescription className="sr-only">
          Converts loyalty points into store credit (multiples of 100 points).
        </DialogDescription>
        <p className="text-sm text-text-secondary">
          Available: <span className="font-medium tabular-nums">{loyaltyPoints.toLocaleString('id-ID')}</span> points
        </p>
        {snapshot && <p role="status" className="text-sm text-warning">{PENDING_MESSAGE}</p>}
        {attempt.storageError && <p role="alert" className="text-sm text-danger">{attempt.storageError}</p>}
        <div>
          <label htmlFor="convert-points" className="block text-sm font-medium">Points to convert</label>
          <input
            id="convert-points"
            type="number"
            min={100}
            step={100}
            value={snapshot ? String(snapshot.points) : pointsStr}
            disabled={Boolean(snapshot) || attempt.busy}
            onChange={(e) => setPointsStr(e.target.value)}
            className={`mt-1 w-full border border-border-strong rounded p-2 text-sm tabular-nums placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="100"
            data-testid="convert-points"
          />
          {!snapshot && !pointsOk && pointsStr.length > 0 && (
            <p className="text-xs text-danger mt-1">
              Positive multiple of 100, up to {loyaltyPoints.toLocaleString('id-ID')} points
            </p>
          )}
          {pointsOk && (
            <p className="text-xs text-text-secondary mt-1" data-testid="convert-preview">
              = {formatCurrency(points * RP_PER_POINT)} store credit
            </p>
          )}
        </div>
        {formError !== null && (
          <p className="text-sm text-danger" role="alert" data-testid="convert-error">{formError}</p>
        )}
        <div className="flex justify-end gap-2">
          {/* L'action terminale de la modale est ENCRE, pas or : l'or ne
              remplit pas (The Ink-Not-Gold Rule) et le premier plan `text-bg-base`
              ne valait que 4,47:1 sur l'aplat doré. */}
          <Button variant="secondary" size="sm" onClick={handleClose} data-testid="convert-cancel">
            Cancel
          </Button>
          <Button
            variant="ink"
            size="sm"
            onClick={() => { void handleSubmit(); }}
            disabled={!canSubmit}
            data-testid="convert-submit"
          >
            {attempt.busy ? 'Checking…' : snapshot ? 'Check pending conversion' : 'Convert'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
