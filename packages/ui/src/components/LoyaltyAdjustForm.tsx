// packages/ui/src/components/LoyaltyAdjustForm.tsx
//
// Manual loyalty point adjustment form. Sign toggle + amount + reason.
// Server-side mirror: adjust_loyalty_points RPC (session 12).
// Server bounds : |delta| <= 1_000_000, reason length 5..500.

import { useId, useState, useMemo, type FormEvent, type JSX } from 'react';
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

const MAX_DELTA  = 1_000_000;  // matches adjust_loyalty_points server-side guard
const MAX_REASON = 500;

export function LoyaltyAdjustForm({
  currentBalance, onSubmit, onCancel, submitting,
}: LoyaltyAdjustFormProps): JSX.Element {
  const [sign,   setSign  ] = useState<'+' | '-'>('+');
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  const reactId    = useId();
  const signGroup  = `${reactId}-sign`;
  const amountId   = `${reactId}-amount`;
  const amountErrId = `${reactId}-amount-error`;
  const reasonId   = `${reactId}-reason`;
  const reasonHintId = `${reactId}-reason-hint`;

  const numericAmount = Number.parseInt(amount, 10);
  const isAmountInt    = Number.isInteger(numericAmount) && numericAmount > 0 && /^\d+$/.test(amount);
  const isAmountInRange = isAmountInt && numericAmount <= MAX_DELTA;
  const isAmountValid   = isAmountInRange;
  const isReasonValid   = reason.trim().length >= 5 && reason.trim().length <= MAX_REASON;
  const signedDelta     = isAmountValid ? (sign === '+' ? numericAmount : -numericAmount) : 0;
  const wouldGoNegative = sign === '-' && isAmountValid && numericAmount > currentBalance;
  const wouldOverflow   = isAmountInt && numericAmount > MAX_DELTA;

  const canSubmit = isAmountValid && isReasonValid && !wouldGoNegative && !submitting;

  const projectedBalance = useMemo(
    () => (isAmountValid ? currentBalance + signedDelta : currentBalance),
    [currentBalance, isAmountValid, signedDelta],
  );

  const amountError = wouldOverflow
    ? `Amount must be ≤ ${MAX_DELTA.toLocaleString()}.`
    : wouldGoNegative
    ? `Customer only has ${currentBalance.toLocaleString()} points.`
    : null;

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
        <div role="radiogroup" aria-label="Direction" className="flex gap-2">
          <label className="flex items-center gap-2">
            <input type="radio" name={signGroup} value="+" checked={sign === '+'} onChange={() => setSign('+')} aria-label="+" />
            Add
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name={signGroup} value="-" checked={sign === '-'} onChange={() => setSign('-')} aria-label="-" />
            Subtract
          </label>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={amountId} className="text-xs uppercase tracking-widest text-text-secondary">Amount</label>
        <Input
          id={amountId}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_DELTA}
          step={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={amountError !== null}
          aria-describedby={amountError !== null ? amountErrId : undefined}
        />
        {amountError !== null && (
          <p id={amountErrId} className="text-red text-xs">{amountError}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor={reasonId} className="text-xs uppercase tracking-widest text-text-secondary">Reason</label>
        <textarea
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={MAX_REASON}
          aria-describedby={reasonHintId}
          className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary"
          placeholder={`At least 5 characters; appears in the audit trail. (max ${MAX_REASON})`}
        />
        <p id={reasonHintId} className="text-text-secondary text-[10px]">
          {reason.trim().length}/{MAX_REASON}
        </p>
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
