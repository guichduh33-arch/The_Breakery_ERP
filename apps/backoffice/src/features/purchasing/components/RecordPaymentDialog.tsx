// apps/backoffice/src/features/purchasing/components/RecordPaymentDialog.tsx
//
// Session 46 — R3: record a supplier payment against a PO. The payment step is
// traceable and INDEPENDENT from goods reception. Amount is clamped to the
// remaining due; the idempotency key is owned here (stable across retries).

import { useId, useRef, useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import type { PoPaymentMethod } from '../hooks/useRecordPoPayment.js';

const METHODS: { value: PoPaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'cash',     label: 'Cash' },
  { value: 'card',     label: 'Card' },
  { value: 'qris',     label: 'QRIS' },
  { value: 'edc',      label: 'EDC' },
];

export interface RecordPaymentDialogProps {
  poNumber:     string;
  remainingDue: number;
  onCancel:     () => void;
  onConfirm:    (args: {
    amount: number; method: PoPaymentMethod; reference?: string; idempotencyKey: string;
  }) => Promise<void>;
  submitting?:  boolean;
  error?:       string;
}

export function RecordPaymentDialog({
  poNumber, remainingDue, onCancel, onConfirm, submitting = false, error,
}: RecordPaymentDialogProps): JSX.Element {
  const reactId = useId();
  // Stable idempotency key for this dialog session (survives retries / re-renders).
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const [amount, setAmount]       = useState<number>(remainingDue > 0 ? remainingDue : 0);
  const [method, setMethod]       = useState<PoPaymentMethod>('transfer');
  const [reference, setReference] = useState<string>('');

  const overpay   = amount > remainingDue + 0.005;
  const canSubmit = Number.isFinite(amount) && amount > 0 && !overpay && !submitting;

  async function handleConfirm(): Promise<void> {
    if (!canSubmit) return;
    await onConfirm({
      amount,
      method,
      ...(reference.trim() !== '' ? { reference: reference.trim() } : {}),
      idempotencyKey: idempotencyKey.current,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !submitting) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            PO {poNumber} — remaining due Rp {formatIdr(remainingDue)}. Recording a
            payment is independent of goods reception.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`${reactId}-amount`} className="text-xs uppercase tracking-widest text-text-secondary">
              Amount (Rp)
            </label>
            <input
              id={`${reactId}-amount`}
              type="number" min={0} max={remainingDue} step={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
              disabled={submitting}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
              aria-required="true"
            />
            {overpay && (
              <div className="text-xs text-danger">Amount exceeds the remaining due.</div>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor={`${reactId}-method`} className="text-xs uppercase tracking-widest text-text-secondary">
              Method
            </label>
            <select
              id={`${reactId}-method`}
              value={method}
              onChange={(e) => setMethod(e.target.value as PoPaymentMethod)}
              disabled={submitting}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor={`${reactId}-ref`} className="text-xs uppercase tracking-widest text-text-secondary">
              Reference (optional)
            </label>
            <input
              id={`${reactId}-ref`}
              type="text" maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              disabled={submitting}
              placeholder="e.g. transfer ref, cheque no."
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
            />
          </div>

          {error !== undefined && error !== '' && (
            <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button
            type="button"
            variant="gold"
            onClick={() => { void handleConfirm(); }}
            disabled={!canSubmit}
          >
            {submitting ? 'Recording…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
