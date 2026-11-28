// ADR-050 — fenêtre de correction guidée d'un bon reçu et/ou payé (super admin).
//
// Elle dit AVANT le PIN tout ce que la correction fait, dans l'ordre : chaque
// paiement contre-passé (ligne négative + écriture inverse au jour d'origine),
// chaque réception annulée (stock, coût moyen et dette contre-passés), puis le
// bon rouvert à l'édition. Rien n'est effacé. Elle dit aussi la suite : refaire
// la réception et le paiement une fois le bon corrigé.

import { useRef, useState, type JSX } from 'react';
import { Dialog, DialogDescription } from '@breakery/ui';
import { formatCurrency } from '@breakery/utils';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { PoPaymentRow } from '../hooks/usePoPayments.js';
import type { GoodsReceiptNoteRow } from '../hooks/usePurchaseOrderDetail.js';
import { startPoCorrectionMessage, useStartPoCorrection } from '../hooks/useStartPoCorrection.js';
import { formatPoDay } from '../poVocabulary.js';

interface Props {
  poId:      string;
  poNumber:  string;
  /** Paiements vivants (ni contre-passés, ni contre-passations). */
  payments:  readonly PoPaymentRow[];
  /** Réceptions actives (non annulées). */
  receipts:  readonly GoodsReceiptNoteRow[];
  onClose:   () => void;
}

export function CorrectOrderDialog({ poId, poNumber, payments, receipts, onClose }: Props): JSX.Element {
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const idem = useRef(crypto.randomUUID());
  const m = useStartPoCorrection();

  const reasonOk = reason.trim().length >= 3;
  const pinOk = /^\d{6}$/.test(pin);
  const canSubmit = reasonOk && pinOk && !m.isPending;
  const grouped = payments.some((p) => p.payment_group_id !== null);

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    try {
      await m.mutateAsync({ poId, reason, managerPin: pin, idempotencyKey: idem.current });
      onClose();
    } catch {
      // Un PIN faux se ressaisit : seul le PIN est vidé, la clé reste celle de la demande.
      setPin('');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !m.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Correct order — {poNumber}</DialogTitle>
        <DialogDescription>
          Use this when a received or paid order was entered with a mistake. Nothing is deleted:
          every step is posted as a reversal and stays in the order history.
        </DialogDescription>

        <ol className="list-decimal space-y-2 pl-5 text-sm text-text-primary" data-testid="correct-order-steps">
          <li>
            {payments.length === 0
              ? 'No payment to reverse.'
              : `Reverse ${String(payments.length)} payment(s):`}
            {payments.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-text-secondary">
                {payments.map((p) => (
                  <li key={p.id} className="font-data tabular-nums">
                    {formatCurrency(p.amount)} · paid on {formatPoDay(p.paid_at)} · <span className="uppercase">{p.method}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
          <li>
            {receipts.length === 0
              ? 'No receipt to cancel.'
              : `Cancel ${String(receipts.length)} receipt(s): the goods leave stock and the average cost goes back.`}
            {receipts.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-text-secondary">
                {receipts.map((g) => (
                  <li key={g.id} className="font-data tabular-nums">
                    {g.grn_number} · received on {formatPoDay(g.received_date)} · {formatCurrency(Number(g.total ?? 0))}
                  </li>
                ))}
              </ul>
            )}
          </li>
          <li>The order goes back to “To receive” and can be edited.</li>
        </ol>

        {grouped && (
          <p role="note" className="rounded border border-border-gold bg-surface-inert p-3 text-sm text-text-primary" data-testid="correct-order-group">
            One payment was recorded for several purchase orders at once. It is reversed on all of them.
            Record those other payments again afterwards.
          </p>
        )}

        <p className="rounded border border-border-subtle bg-surface-inert p-3 text-sm text-text-secondary">
          A payment reversal is dated on the original payment day; a receipt cancellation is dated
          today. If one of those accounting periods is closed, or the stock was already used, nothing
          is changed. After the correction,
          edit the order, then receive it and record the payment again.
        </p>

        <div>
          <label htmlFor="correct-order-reason" className="block text-sm font-medium">Reason</label>
          <textarea
            id="correct-order-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={`mt-1 w-full rounded border border-border-strong p-2 text-sm placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="Example: unit price typed 20,000 instead of 2,000"
            aria-invalid={reason.length > 0 && !reasonOk}
            data-testid="correct-order-reason"
          />
        </div>

        <div>
          <label htmlFor="correct-order-pin" className="block text-sm font-medium">Your PIN</label>
          <input
            id="correct-order-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className={`mt-1 h-touch-min w-full rounded border border-border-strong px-2 text-sm tracking-widest ${FOCUS_RING}`}
            aria-invalid={pin.length > 0 && !pinOk}
            aria-describedby="correct-order-pin-hint"
            data-testid="correct-order-pin"
          />
          <p id="correct-order-pin-hint" className={`mt-1 text-xs ${pin.length > 0 && !pinOk ? 'text-danger' : 'text-text-muted'}`}>
            {pin.length > 0 && !pinOk ? 'Exactly 6 digits' : '6 digits'}
          </p>
        </div>

        {m.error && (
          <p role="alert" className="text-sm text-danger-as-text" data-testid="correct-order-error">
            {startPoCorrectionMessage(m.error)}
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
            data-testid="correct-order-submit"
          >
            {m.isPending ? 'Correcting…' : 'Correct order'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
