// apps/backoffice/src/features/customers/components/GrantStoreCreditModal.tsx
// ADR-013 Lot 4 (D6) — accord d'avoir manager depuis la fiche client.
// Template VoidOrderModal : montant + motif (3-500 chars) + PIN manager 6
// chiffres. Le PIN minte un nonce single-use AU SUBMIT (jamais pré-minté —
// TTL 60 s) ; un échec RPC le brûle → re-saisie PIN, valeurs conservées.
// Une idempotency key par ouverture (useRef, régénérée à la fermeture).

import { useState, useRef, type JSX } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@breakery/ui';
import { formatCurrency } from '@breakery/utils';
import {
  useGrantStoreCredit, GrantStoreCreditError, type GrantErrorCode,
} from '../hooks/useGrantStoreCredit.js';

const ERROR_COPY: Record<GrantErrorCode, string> = {
  wrong_pin:          'Invalid manager PIN. Please retry.',
  pin_forbidden:      'PIN rejected or authorization expired — the manager needs the store-credit grant permission. Re-enter the PIN.',
  rate_limited:       'Too many PIN attempts. Wait a minute and retry.',
  invalid_input:      'Amount must be positive and the reason 3-500 characters.',
  customer_not_found: 'This customer was deleted in another session.',
  fiscal_closed:      'The fiscal period is closed — grant refused.',
  unknown:            'Something went wrong. Please retry.',
};

interface Props {
  open:         boolean;
  onClose:      () => void;
  customerId:   string;
  customerName: string;
}

export function GrantStoreCreditModal({ open, onClose, customerId, customerName }: Props): JSX.Element {
  const [amountStr, setAmountStr] = useState('');
  const [reason, setReason]       = useState('');
  const [pin, setPin]             = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const idem = useRef(crypto.randomUUID());
  const m = useGrantStoreCredit();

  const amount    = Number(amountStr || '0');
  const amountOk  = Number.isFinite(amount) && amount > 0;
  const reasonOk  = reason.trim().length >= 3 && reason.trim().length <= 500;
  const pinOk     = /^\d{6}$/.test(pin);
  const canSubmit = amountOk && reasonOk && pinOk && !m.isPending;

  const resetAll = (): void => {
    setAmountStr('');
    setReason('');
    setPin('');
    setFormError(null);
    idem.current = crypto.randomUUID();
  };

  const handleClose = (): void => {
    resetAll();
    onClose();
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setFormError(null);
    try {
      const result = await m.mutateAsync({
        customerId,
        amount,
        reason: reason.trim(),
        managerPin: pin,
        idempotencyKey: idem.current,
      });
      toast.success(
        `Store credit granted — new balance ${formatCurrency(result.balance_after)}`
        + (result.expires_at ? ` (expires ${new Date(result.expires_at).toLocaleDateString('id-ID')})` : ''),
      );
      resetAll();
      onClose();
    } catch (err) {
      // Nonce brûlé quel que soit l'échec → le PIN doit être re-saisi.
      setPin('');
      const code: GrantErrorCode = err instanceof GrantStoreCreditError ? err.code : 'unknown';
      setFormError(ERROR_COPY[code]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Grant store credit — {customerName}</DialogTitle>
        <DialogDescription className="sr-only">
          Grants store credit to this customer, authorized by a manager PIN. Creates an accounting entry.
        </DialogDescription>
        <div>
          <label className="block text-sm font-medium">Amount (Rp)</label>
          <input
            type="number"
            min={1}
            step="any"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="mt-1 w-full border rounded p-2 text-sm tabular-nums"
            placeholder="50000"
            data-testid="grant-amount"
          />
          {!amountOk && amountStr.length > 0 && (
            <p className="text-xs text-danger mt-1">Amount must be greater than 0</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            className="mt-1 w-full border rounded p-2 text-sm"
            placeholder="3-500 characters…"
            data-testid="grant-reason"
          />
          {!reasonOk && reason.length > 0 && (
            <p className="text-xs text-danger mt-1">3-500 characters required</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium">Manager PIN</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="mt-1 w-full border rounded p-2 text-sm tracking-widest"
            data-testid="grant-pin"
          />
        </div>
        {formError !== null && (
          <p className="text-sm text-danger" data-testid="grant-error">{formError}</p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={handleClose} className="px-4 py-2 text-sm" data-testid="grant-cancel">Cancel</button>
          <button
            onClick={() => { void handleSubmit(); }}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-gold text-bg-base rounded disabled:opacity-50"
            data-testid="grant-submit"
          >
            {m.isPending ? 'Granting…' : 'Grant credit'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
