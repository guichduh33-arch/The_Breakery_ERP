// packages/ui/src/components/LoyaltyAdjustForm.tsx
//
// Manual loyalty point adjustment form. Sign toggle + amount + reason.
// Server-side mirror: adjust_loyalty_points RPC (session 12).

import { useState, useMemo, type FormEvent, type JSX } from 'react';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';

export interface LoyaltyAdjustFormValues {
  delta:  number;
  reason: string;
}

export interface LoyaltyAdjustFormProps {
  currentBalance: number;
  onSubmit: (values: LoyaltyAdjustFormValues) => Promise<void> | void;
  onCancel: () => void;
  submitting?: boolean;
}

export function LoyaltyAdjustForm({
  currentBalance, onSubmit, onCancel, submitting,
}: LoyaltyAdjustFormProps): JSX.Element {
  const [sign,   setSign  ] = useState<'+' | '-'>('+');
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  const numericAmount = Number.parseInt(amount, 10);
  const isAmountValid = Number.isInteger(numericAmount) && numericAmount > 0;
  const isReasonValid = reason.trim().length >= 5;
  const signedDelta   = isAmountValid ? (sign === '+' ? numericAmount : -numericAmount) : 0;
  const wouldGoNegative = sign === '-' && isAmountValid && numericAmount > currentBalance;

  const canSubmit = isAmountValid && isReasonValid && !wouldGoNegative && !submitting;

  const projectedBalance = useMemo(
    () => (isAmountValid ? currentBalance + signedDelta : currentBalance),
    [currentBalance, isAmountValid, signedDelta],
  );

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    void onSubmit({ delta: signedDelta, reason: reason.trim() });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="text-sm text-text-secondary">
        Current balance: <span className="text-text-primary font-mono">{currentBalance.toLocaleString()}</span> pts
      </div>

      <div className="space-y-1">
        <span className="text-xs uppercase tracking-widest text-text-secondary">Direction</span>
        <div role="radiogroup" className="flex gap-2">
          <label className="flex items-center gap-2">
            <input type="radio" name="sign" value="+" checked={sign === '+'} onChange={() => setSign('+')} aria-label="+" />
            Add
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="sign" value="-" checked={sign === '-'} onChange={() => setSign('-')} aria-label="-" />
            Subtract
          </label>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="adj-amount" className="text-xs uppercase tracking-widest text-text-secondary">Amount</label>
        <Input id="adj-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        {wouldGoNegative && (
          <p className="text-red text-xs">Customer only has {currentBalance.toLocaleString()} points.</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="adj-reason" className="text-xs uppercase tracking-widest text-text-secondary">Reason</label>
        <textarea
          id="adj-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary"
          placeholder="At least 5 characters; appears in the audit trail."
        />
      </div>

      {isAmountValid && !wouldGoNegative && (
        <div className="text-sm text-text-secondary">
          New balance after apply: <span className="text-text-primary font-mono">{projectedBalance.toLocaleString()}</span> pts
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>Apply</Button>
      </div>
    </form>
  );
}
