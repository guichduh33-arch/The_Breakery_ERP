// ADR-046 — fenêtre de correction du moyen d'un règlement (super admin).
// Nouveau moyen + motif + PIN du super admin. Le serveur vérifie tout ; la
// fenêtre dit AVANT le PIN ce que la correction change, et ce qu'elle ne change
// pas (le rapport Z reste le document du jour).

import { useRef, useState, type JSX } from 'react';
import { Dialog, DialogDescription, Select } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { formatCurrency } from '@breakery/utils';
import { PAYMENT_METHODS, paymentMethodLabel, type PaymentMethod } from '@/features/orders/statusMeta.js';
import {
  correctPaymentMethodMessage,
  useCorrectPaymentMethod,
} from '@/features/orders/hooks/useCorrectPaymentMethod.js';

/** L'avoir client engage le solde d'un client : exclu dans les deux sens (ADR-046 §3). */
export const CORRECTABLE_METHODS: readonly PaymentMethod[] = PAYMENT_METHODS.filter((m) => m !== 'store_credit');

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: string;
  payment: { id: string; method: string; amount: number };
}

export function CorrectPaymentMethodDialog({ open, onClose, orderId, orderNumber, payment }: Props): JSX.Element {
  const [newMethod, setNewMethod] = useState<PaymentMethod | ''>('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const idem = useRef(crypto.randomUUID());
  const m = useCorrectPaymentMethod();

  const choices = CORRECTABLE_METHODS.filter((method) => method !== payment.method);
  const reasonOk = reason.trim().length >= 3;
  const pinOk = /^\d{6}$/.test(pin);
  const canSubmit = newMethod !== '' && reasonOk && pinOk && !m.isPending;

  const reset = (): void => {
    setNewMethod('');
    setReason('');
    setPin('');
    m.reset();
    idem.current = crypto.randomUUID();
  };

  const handleClose = (): void => {
    reset();
    onClose();
  };

  const handleSubmit = async (): Promise<void> => {
    if (newMethod === '' || !canSubmit) return;
    try {
      await m.mutateAsync({
        paymentId: payment.id, orderId, newMethod, reason, managerPin: pin, idempotencyKey: idem.current,
      });
      handleClose();
    } catch {
      // Un PIN faux se ressaisit : seul le PIN est vidé, la clé reste celle de la demande.
      setPin('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Correct payment method — order {orderNumber}</DialogTitle>
        <DialogDescription>
          Use this when the cashier picked the wrong method. The amount does not change.
        </DialogDescription>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="correct-method-summary">
          <dt className="text-text-secondary">Amount</dt>
          <dd className="text-right font-data tabular-nums text-text-primary">{formatCurrency(payment.amount)}</dd>
          <dt className="text-text-secondary">Recorded as</dt>
          <dd className="text-right text-text-primary">{paymentMethodLabel(payment.method)}</dd>
        </dl>

        <label className="block space-y-1 text-sm font-medium">
          Correct method
          <Select
            value={newMethod}
            onChange={(e) => setNewMethod(e.target.value as PaymentMethod | '')}
            data-testid="correct-method-select"
          >
            <option value="">Choose the method actually used</option>
            {choices.map((method) => (
              <option key={method} value={method}>{paymentMethodLabel(method)}</option>
            ))}
          </Select>
        </label>

        <p className="rounded border border-border-subtle bg-surface-inert p-3 text-sm text-text-secondary">
          A correcting journal entry is posted on the sale date. If the shift is closed, its cash
          variance is corrected too. The Z-report stays as printed.
        </p>

        <div>
          <label htmlFor="correct-method-reason" className="block text-sm font-medium">Reason</label>
          <textarea
            id="correct-method-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={`mt-1 w-full rounded border border-border-strong p-2 text-sm placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="Example: customer paid by QRIS, cashier tapped Cash"
            aria-invalid={reason.length > 0 && !reasonOk}
            data-testid="correct-method-reason"
          />
        </div>

        <div>
          <label htmlFor="correct-method-pin" className="block text-sm font-medium">Your PIN</label>
          <input
            id="correct-method-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className={`mt-1 h-touch-min w-full rounded border border-border-strong px-2 text-sm tracking-widest ${FOCUS_RING}`}
            aria-invalid={pin.length > 0 && !pinOk}
            aria-describedby="correct-method-pin-hint"
            data-testid="correct-method-pin"
          />
          <p id="correct-method-pin-hint" className={`mt-1 text-xs ${pin.length > 0 && !pinOk ? 'text-danger' : 'text-text-muted'}`}>
            {pin.length > 0 && !pinOk ? 'Exactly 6 digits' : '6 digits'}
          </p>
        </div>

        {m.error && (
          <p role="alert" className="text-sm text-danger-as-text" data-testid="correct-method-error">
            {correctPaymentMethodMessage(m.error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleClose} data-testid="correct-method-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            variant="ink"
            size="sm"
            onClick={() => { void handleSubmit(); }}
            disabled={!canSubmit}
            data-testid="correct-method-submit"
          >
            {m.isPending ? 'Correcting…' : 'Correct method'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
