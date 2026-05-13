// apps/backoffice/src/features/expenses/components/ExpenseForm.tsx
//
// Controlled form for creating an expense (draft). Used in NewExpensePage.

import { useState } from 'react';
import { Button, Input } from '@breakery/ui';
import { CategoryPicker } from './CategoryPicker.js';
import { ReceiptUploader } from './ReceiptUploader.js';

export interface ExpenseFormValues {
  category_id: string;
  amount: string;       // string for the input, parsed at submit
  vat_amount: string;
  payment_method: 'cash' | 'transfer' | 'card' | 'credit';
  description: string;
  vendor_name: string;
  expense_date: string; // yyyy-mm-dd
  receipt_url: string;
}

export const emptyExpenseFormValues = (): ExpenseFormValues => ({
  category_id: '',
  amount: '',
  vat_amount: '0',
  payment_method: 'cash',
  description: '',
  vendor_name: '',
  expense_date: new Date().toISOString().slice(0, 10),
  receipt_url: '',
});

export interface ExpenseFormProps {
  /** Pre-generated UUID (for namespacing receipt uploads before insert). */
  draftId: string;
  value: ExpenseFormValues;
  onChange: (next: ExpenseFormValues) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  submitting?: boolean;
  submitLabel?: string;
}

export function ExpenseForm({
  draftId, value, onChange, onSubmit, onCancel, submitting, submitLabel,
}: ExpenseFormProps): JSX.Element {
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const errors: Partial<Record<keyof ExpenseFormValues, string>> = {};
  if (value.category_id === '') errors.category_id = 'Required';
  const amountNum = Number.parseFloat(value.amount);
  if (Number.isNaN(amountNum) || amountNum <= 0) errors.amount = 'Must be > 0';
  if (value.description.trim() === '') errors.description = 'Required';
  if (value.expense_date === '') errors.expense_date = 'Required';
  const vatNum = Number.parseFloat(value.vat_amount === '' ? '0' : value.vat_amount);
  if (Number.isNaN(vatNum) || vatNum < 0) errors.vat_amount = 'Must be >= 0';
  if (!Number.isNaN(amountNum) && !Number.isNaN(vatNum) && vatNum > amountNum) {
    errors.vat_amount = 'Cannot exceed amount';
  }

  const hasErrors = Object.keys(errors).length > 0;

  function patch(p: Partial<ExpenseFormValues>): void {
    onChange({ ...value, ...p });
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (hasErrors) {
      setTouched({
        category_id: true, amount: true, description: true,
        expense_date: true, vat_amount: true,
      });
      return;
    }
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="exp-category" className="text-xs uppercase tracking-widest text-text-secondary">
            Category <span className="text-red">*</span>
          </label>
          <CategoryPicker
            id="exp-category"
            value={value.category_id}
            onChange={(id) => patch({ category_id: id })}
          />
          {touched.category_id === true && errors.category_id !== undefined && (
            <div className="text-xs text-red">{errors.category_id}</div>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="exp-date" className="text-xs uppercase tracking-widest text-text-secondary">
            Date <span className="text-red">*</span>
          </label>
          <Input
            id="exp-date"
            type="date"
            value={value.expense_date}
            onChange={(e) => patch({ expense_date: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, expense_date: true }))}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="exp-amount" className="text-xs uppercase tracking-widest text-text-secondary">
            Amount (IDR) <span className="text-red">*</span>
          </label>
          <Input
            id="exp-amount"
            type="number"
            min={0}
            step="0.01"
            value={value.amount}
            onChange={(e) => patch({ amount: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, amount: true }))}
          />
          {touched.amount === true && errors.amount !== undefined && (
            <div className="text-xs text-red">{errors.amount}</div>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="exp-vat" className="text-xs uppercase tracking-widest text-text-secondary">
            VAT amount (IDR)
          </label>
          <Input
            id="exp-vat"
            type="number"
            min={0}
            step="0.01"
            value={value.vat_amount}
            onChange={(e) => patch({ vat_amount: e.target.value })}
          />
          {touched.vat_amount === true && errors.vat_amount !== undefined && (
            <div className="text-xs text-red">{errors.vat_amount}</div>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="exp-method" className="text-xs uppercase tracking-widest text-text-secondary">
            Payment method <span className="text-red">*</span>
          </label>
          <select
            id="exp-method"
            value={value.payment_method}
            onChange={(e) => patch({ payment_method: e.target.value as ExpenseFormValues['payment_method'] })}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="cash">Cash</option>
            <option value="transfer">Bank transfer</option>
            <option value="card">Card</option>
            <option value="credit">Credit (pay later)</option>
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="exp-vendor" className="text-xs uppercase tracking-widest text-text-secondary">
            Vendor / supplier name
          </label>
          <Input
            id="exp-vendor"
            value={value.vendor_name}
            onChange={(e) => patch({ vendor_name: e.target.value })}
            placeholder="e.g. PLN, Indomaret…"
            maxLength={120}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="exp-desc" className="text-xs uppercase tracking-widest text-text-secondary">
          Description <span className="text-red">*</span>
        </label>
        <Input
          id="exp-desc"
          value={value.description}
          onChange={(e) => patch({ description: e.target.value })}
          onBlur={() => setTouched((t) => ({ ...t, description: true }))}
          placeholder="Short description (e.g. April electricity bill)"
          maxLength={250}
        />
        {touched.description === true && errors.description !== undefined && (
          <div className="text-xs text-red">{errors.description}</div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs uppercase tracking-widest text-text-secondary">
          Receipt (optional)
        </label>
        <ReceiptUploader
          expenseId={draftId}
          value={value.receipt_url}
          onUploaded={(p) => patch({ receipt_url: p })}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        )}
        <Button type="submit" variant="primary" disabled={submitting === true || hasErrors}>
          {submitLabel ?? 'Save as draft'}
        </Button>
      </div>
    </form>
  );
}
