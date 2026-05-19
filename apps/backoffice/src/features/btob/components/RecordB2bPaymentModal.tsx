// apps/backoffice/src/features/btob/components/RecordB2bPaymentModal.tsx
//
// Session 24 / Phase 2.A.4 — record a B2B payment received.
//
// Single-screen Dialog form ; mirrors the ReceiveModal pattern.

import { useEffect, useId, useMemo, useState, type FormEvent, type JSX } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import {
  useRecordB2bPayment,
  RecordB2bPaymentError,
  type B2bPaymentMethod,
} from '../hooks/useRecordB2bPayment.js';
import { useB2bCustomers } from '../hooks/useB2bCustomers.js';

export interface RecordB2bPaymentModalProps {
  open:    boolean;
  /** Pre-select a customer (e.g. from an Outstanding row). */
  initialCustomerId?: string;
  onClose: () => void;
}

const METHODS: ReadonlyArray<{ value: B2bPaymentMethod; label: string }> = [
  { value: 'cash',         label: 'Cash' },
  { value: 'transfer',     label: 'Bank transfer' },
  { value: 'qris',         label: 'QRIS' },
  { value: 'card',         label: 'Card' },
  { value: 'edc',          label: 'EDC' },
  { value: 'store_credit', label: 'Store credit' },
];

export function RecordB2bPaymentModal({ open, initialCustomerId, onClose }: RecordB2bPaymentModalProps): JSX.Element {
  const recordMut = useRecordB2bPayment();
  const customers = useB2bCustomers();

  const reactId      = useId();
  const customerId_  = `${reactId}-customer`;
  const amountId     = `${reactId}-amount`;
  const methodId     = `${reactId}-method`;
  const refId        = `${reactId}-ref`;
  const dateId       = `${reactId}-date`;
  const notesId      = `${reactId}-notes`;

  const [customerId, setCustomerId]       = useState<string>(initialCustomerId ?? '');
  const [amount,     setAmount]           = useState<string>('');
  const [method,     setMethod]           = useState<B2bPaymentMethod>('cash');
  const [reference,  setReference]        = useState<string>('');
  const [paidAt,     setPaidAt]           = useState<string>('');
  const [notes,      setNotes]            = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [formError, setFormError]         = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCustomerId(initialCustomerId ?? '');
      setAmount('');
      setMethod('cash');
      setReference('');
      setPaidAt('');
      setNotes('');
      setIdempotencyKey(crypto.randomUUID());
      setFormError(null);
    }
  }, [open, initialCustomerId]);

  const selectedCustomer = useMemo(
    () => customers.data?.find((c) => c.id === customerId) ?? null,
    [customers.data, customerId],
  );

  const numericAmount = Number.parseFloat(amount);
  const amountValid   = Number.isFinite(numericAmount) && numericAmount > 0;
  const overpaying    = selectedCustomer !== null
                        && amountValid
                        && numericAmount > Number(selectedCustomer.b2b_current_balance ?? 0);

  const canSubmit = customerId !== '' && amountValid && !overpaying && !recordMut.isPending;

  function handleClose(): void {
    setFormError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setFormError(null);

    try {
      await recordMut.mutateAsync({
        customerId,
        amount: numericAmount,
        method,
        ...(reference.trim() !== '' ? { reference: reference.trim() } : {}),
        ...(paidAt.trim()    !== '' ? { paidAt }                       : {}),
        ...(notes.trim()     !== '' ? { notes: notes.trim() }          : {}),
        idempotencyKey,
      });
      handleClose();
    } catch (err) {
      if (err instanceof RecordB2bPaymentError) {
        switch (err.code) {
          case 'overpayment_not_allowed':
            setFormError('Amount exceeds the customer outstanding balance. Adjust and retry.');
            break;
          case 'customer_not_b2b':
            setFormError('Selected customer is not a B2B account.');
            break;
          case 'permission_denied':
            setFormError('You do not have permission to record B2B payments (needs customers.update).');
            break;
          case 'fiscal_period_closed':
            setFormError('The current fiscal period is closed.');
            break;
          default:
            setFormError(err.message);
        }
      } else {
        setFormError('Something went wrong. Please retry.');
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Record B2B Payment</DialogTitle>
        <DialogDescription className="sr-only">
          Record a payment received from a B2B customer. Decreases the customer's outstanding balance.
        </DialogDescription>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate className="space-y-4">
          {formError !== null && (
            <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
              {formError}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={customerId_} className="text-xs uppercase tracking-widest text-text-secondary">
              Customer
            </label>
            <select
              id={customerId_}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
              disabled={customers.isLoading}
            >
              <option value="">— Select a B2B customer —</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.b2b_company_name ?? c.name}
                </option>
              ))}
            </select>
            {selectedCustomer !== null && (
              <p className="text-[10px] text-text-muted">
                Outstanding: <span className="font-mono">{formatIdr(selectedCustomer.b2b_current_balance)}</span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={amountId} className="text-xs uppercase tracking-widest text-text-secondary">
                Amount
              </label>
              <Input
                id={amountId}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={(amount !== '' && !amountValid) || overpaying}
              />
              {overpaying && (
                <p className="text-[10px] text-red">Cannot exceed outstanding balance.</p>
              )}
            </div>
            <div className="space-y-1">
              <label htmlFor={methodId} className="text-xs uppercase tracking-widest text-text-secondary">
                Method
              </label>
              <select
                id={methodId}
                value={method}
                onChange={(e) => setMethod(e.target.value as B2bPaymentMethod)}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={refId} className="text-xs uppercase tracking-widest text-text-secondary">
                Reference
              </label>
              <Input
                id={refId}
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Bank ref / check #"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={dateId} className="text-xs uppercase tracking-widest text-text-secondary">
                Paid at
              </label>
              <Input
                id={dateId}
                type="datetime-local"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor={notesId} className="text-xs uppercase tracking-widest text-text-secondary">
              Notes
            </label>
            <textarea
              id={notesId}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary"
              placeholder="Optional"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {recordMut.isPending ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
