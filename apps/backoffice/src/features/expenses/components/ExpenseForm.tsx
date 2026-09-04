// apps/backoffice/src/features/expenses/components/ExpenseForm.tsx
//
// Controlled form for creating an expense (draft). Used in NewExpensePage.
//
// Critique /impeccable 2026-08-13 (P1, lot 2) — le formulaire verrouillait son
// bouton tant que la saisie était invalide, sans dire ce qui manquait : un
// bouton disabled n'émet jamais de submit, la branche de validation était du
// code mort, et le « Required » de la catégorie (sans onBlur) était
// inatteignable. Le bouton reste actif ; la validation se joue AU submit,
// révèle toutes les erreurs (câblées aux champs par FormField) et renvoie le
// focus au premier champ fautif.

import { useState } from 'react';
import { Button, Input, Select } from '@breakery/ui';
import { FormField } from '@/components/FormField.js';
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

// Session 59 / Task 6b — fields carried over by "Duplicate" from an existing
// expense. Deliberately excludes `expense_date` (always today on the new
// draft) and `receipt_url` (never carried over — see ExpenseDetailPage).
export type DuplicateExpenseSeed = Pick<
  ExpenseFormValues,
  'category_id' | 'amount' | 'vat_amount' | 'payment_method' | 'vendor_name' | 'description'
>;

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

// Ordre de focus au submit raté = ordre visuel du formulaire.
const FIELD_DOM_IDS: Partial<Record<keyof ExpenseFormValues, string>> = {
  category_id: 'exp-category',
  expense_date: 'exp-date',
  amount: 'exp-amount',
  vat_amount: 'exp-vat',
  description: 'exp-desc',
};
const FIELD_ORDER = ['category_id', 'expense_date', 'amount', 'vat_amount', 'description'] as const;

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

  /** Erreur visible seulement une fois le champ touché (blur ou submit raté). */
  function shown(field: keyof ExpenseFormValues): string | null {
    return touched[field] === true ? errors[field] ?? null : null;
  }

  function touch(field: keyof ExpenseFormValues): void {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (hasErrors) {
      setTouched({
        category_id: true, amount: true, description: true,
        expense_date: true, vat_amount: true,
      });
      const firstFaulty = FIELD_ORDER.find((f) => errors[f] !== undefined);
      if (firstFaulty !== undefined) {
        document.getElementById(FIELD_DOM_IDS[firstFaulty] ?? '')?.focus();
      }
      return;
    }
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField id="exp-category" label="Category" required error={shown('category_id')}>
          <CategoryPicker
            value={value.category_id}
            onChange={(id) => { patch({ category_id: id }); touch('category_id'); }}
          />
        </FormField>

        <FormField id="exp-date" label="Date" required error={shown('expense_date')}>
          <Input
            type="date" lang="id-ID"
            value={value.expense_date}
            onChange={(e) => patch({ expense_date: e.target.value })}
            onBlur={() => touch('expense_date')}
          />
        </FormField>

        <FormField id="exp-amount" label="Amount (IDR)" required error={shown('amount')}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={value.amount}
            onChange={(e) => patch({ amount: e.target.value })}
            onBlur={() => touch('amount')}
          />
        </FormField>

        <FormField id="exp-vat" label="VAT amount (IDR)" error={shown('vat_amount')}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={value.vat_amount}
            onChange={(e) => patch({ vat_amount: e.target.value })}
            onBlur={() => touch('vat_amount')}
          />
        </FormField>

        <FormField id="exp-method" label="Payment method" required>
          <Select
            value={value.payment_method}
            onChange={(e) => patch({ payment_method: e.target.value as ExpenseFormValues['payment_method'] })}
            className="w-full"
          >
            <option value="cash">Cash</option>
            <option value="transfer">Bank transfer</option>
            <option value="card">Card</option>
            <option value="credit">Credit (pay later)</option>
          </Select>
        </FormField>

        <FormField id="exp-vendor" label="Vendor / supplier name">
          <Input
            value={value.vendor_name}
            onChange={(e) => patch({ vendor_name: e.target.value })}
            placeholder="e.g. PLN, Indomaret…"
            maxLength={120}
          />
        </FormField>
      </div>

      <FormField id="exp-desc" label="Description" required error={shown('description')}>
        <Input
          value={value.description}
          onChange={(e) => patch({ description: e.target.value })}
          onBlur={() => touch('description')}
          placeholder="Short description (e.g. April electricity bill)"
          maxLength={250}
        />
      </FormField>

      <div className="space-y-1">
        <span className="font-data font-semibold block text-xs uppercase tracking-widest text-text-secondary">
          Receipt (optional)
        </span>
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
        {/* Le bouton reste actif quand la saisie est incomplète : c'est le
            submit qui révèle ce qui manque (DESIGN.md § Do's). Seul l'envoi
            en cours le neutralise. */}
        <Button type="submit" variant="ink" disabled={submitting === true}>
          {submitLabel ?? 'Save as draft'}
        </Button>
      </div>
    </form>
  );
}
