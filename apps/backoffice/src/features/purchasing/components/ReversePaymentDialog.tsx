// ADR-048 — fenêtre de contre-passation d'un paiement fournisseur (super admin).
// Motif + PIN du super admin. Le serveur vérifie tout ; la fenêtre dit AVANT le
// PIN ce que la contre-passation fait : une ligne négative et une écriture
// inverse datées du jour d'origine, sans rien effacer.

import { useRef, useState, type JSX } from 'react';
import { Dialog, DialogDescription } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { formatCurrency, formatDateShortWita } from '@breakery/utils';
import {
  reversePoPaymentMessage,
  useReversePoPayment,
} from '../hooks/useReversePoPayment.js';

export interface ReversiblePayment {
  id: string;
  amount: number;
  method: string;
  paidAt: string;
  /** Nombre de bons du même règlement groupé (1 si le paiement est seul). */
  groupSize: number;
  /** Total du règlement groupé (= amount si seul). */
  groupTotal: number;
}

interface Props {
  poNumber: string;
  payment: ReversiblePayment;
  /** Bons touchés par la contre-passation (le groupe entier). */
  poIds: readonly string[];
  onClose: () => void;
}

export function ReversePaymentDialog({ poNumber, payment, poIds, onClose }: Props): JSX.Element {
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const idem = useRef(crypto.randomUUID());
  const m = useReversePoPayment();

  const reasonOk = reason.trim().length >= 3;
  const pinOk = /^\d{6}$/.test(pin);
  const canSubmit = reasonOk && pinOk && !m.isPending;
  const grouped = payment.groupSize > 1;

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    try {
      await m.mutateAsync({
        paymentId: payment.id, poIds, reason, managerPin: pin, idempotencyKey: idem.current,
      });
      onClose();
    } catch {
      // Un PIN faux se ressaisit : seul le PIN est vidé, la clé reste celle de la demande.
      setPin('');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !m.isPending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Reverse payment — PO {poNumber}</DialogTitle>
        <DialogDescription>
          Use this when a supplier payment was recorded by mistake. Nothing is deleted.
        </DialogDescription>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="reverse-payment-summary">
          <dt className="text-text-secondary">Amount</dt>
          <dd className="text-right font-data tabular-nums text-text-primary">{formatCurrency(payment.amount)}</dd>
          <dt className="text-text-secondary">Paid on</dt>
          <dd className="text-right font-data tabular-nums text-text-primary">{formatDateShortWita(payment.paidAt)}</dd>
          <dt className="text-text-secondary">Method</dt>
          <dd className="text-right uppercase text-text-primary">{payment.method}</dd>
        </dl>

        {grouped && (
          <p role="note" className="rounded border border-border-gold bg-surface-inert p-3 text-sm text-text-primary" data-testid="reverse-payment-group">
            This payment was recorded for {payment.groupSize} purchase orders at once
            ({formatCurrency(payment.groupTotal)} in total). The whole payment is reversed on all of them.
          </p>
        )}

        <p className="rounded border border-border-subtle bg-surface-inert p-3 text-sm text-text-secondary">
          A reversal line and a reversing journal entry are posted on the original payment date.
          If that accounting period is closed, the reversal is refused. If the payment is already
          matched in a bank reconciliation, fix that match afterwards.
        </p>

        <div>
          <label htmlFor="reverse-payment-reason" className="block text-sm font-medium">Reason</label>
          <textarea
            id="reverse-payment-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={`mt-1 w-full rounded border border-border-strong p-2 text-sm placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="Example: amount typed twice, real transfer was 1,500,000"
            aria-invalid={reason.length > 0 && !reasonOk}
            data-testid="reverse-payment-reason"
          />
        </div>

        <div>
          <label htmlFor="reverse-payment-pin" className="block text-sm font-medium">Your PIN</label>
          <input
            id="reverse-payment-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className={`mt-1 h-touch-min w-full rounded border border-border-strong px-2 text-sm tracking-widest ${FOCUS_RING}`}
            aria-invalid={pin.length > 0 && !pinOk}
            aria-describedby="reverse-payment-pin-hint"
            data-testid="reverse-payment-pin"
          />
          <p id="reverse-payment-pin-hint" className={`mt-1 text-xs ${pin.length > 0 && !pinOk ? 'text-danger' : 'text-text-muted'}`}>
            {pin.length > 0 && !pinOk ? 'Exactly 6 digits' : '6 digits'}
          </p>
        </div>

        {m.error && (
          <p role="alert" className="text-sm text-danger-as-text" data-testid="reverse-payment-error">
            {reversePoPaymentMessage(m.error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={m.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ink"
            size="sm"
            onClick={() => { void handleSubmit(); }}
            disabled={!canSubmit}
            data-testid="reverse-payment-submit"
          >
            {m.isPending ? 'Reversing…' : 'Reverse payment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
