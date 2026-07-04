// apps/backoffice/src/pages/expenses/NewExpensePage.tsx
//
// Session 14 / Phase 5.A — header chrome aligned with the rebuilt Expenses
// surface (breadcrumb + Fraunces heading). Form behaviour unchanged — the
// existing ExpenseForm + create_expense_v1 RPC still own validation and
// idempotent submission.

import { useMemo, useState, type JSX } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore.js';
import { useCreateExpense } from '@/features/expenses/hooks/useCreateExpense.js';
import type { CreateExpenseInput } from '@/features/expenses/hooks/useCreateExpense.js';
import {
  ExpenseForm,
  emptyExpenseFormValues,
  type ExpenseFormValues,
  type DuplicateExpenseSeed,
} from '@/features/expenses/components/ExpenseForm.js';

interface NewExpenseNavigationState {
  duplicateFrom?: DuplicateExpenseSeed;
}

export default function NewExpensePage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate     = hasPermission('expenses.create');
  const navigate      = useNavigate();
  const location      = useLocation();

  const [draftId] = useState<string>(() => crypto.randomUUID());
  const [idemKey] = useState<string>(() => crypto.randomUUID());
  // Session 59 / Task 6b — "Duplicate" (ExpenseDetailPage) navigates here with
  // { duplicateFrom } in navigation state. The date is always today and the
  // receipt is never carried over, regardless of what's in duplicateFrom.
  const [values, setValues] = useState<ExpenseFormValues>(() => {
    const base = emptyExpenseFormValues();
    const duplicateFrom = (location.state as NewExpenseNavigationState | null)?.duplicateFrom;
    if (duplicateFrom === undefined) return base;
    return {
      ...base,
      ...duplicateFrom,
      expense_date: base.expense_date,
      receipt_url: '',
    };
  });

  const create = useCreateExpense();

  const isSubmitting = create.isPending;
  const submitDisabled = useMemo(() => isSubmitting, [isSubmitting]);

  if (!canCreate) {
    return <div className="text-text-secondary">You do not have permission to create expenses.</div>;
  }

  async function handleSubmit(): Promise<void> {
    try {
      const input: CreateExpenseInput = {
        category_id: values.category_id,
        amount: Number.parseFloat(values.amount),
        vat_amount: values.vat_amount === '' ? 0 : Number.parseFloat(values.vat_amount),
        payment_method: values.payment_method,
        description: values.description.trim(),
        expense_date: values.expense_date,
        idempotency_key: idemKey,
      };
      const vendor = values.vendor_name.trim();
      if (vendor !== '') input.vendor_name = vendor;
      if (values.receipt_url !== '') input.receipt_url = values.receipt_url;

      const id = await create.mutateAsync(input);
      navigate(`/backoffice/expenses/${id}`);
    } catch {
      // surfaced via create.error
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <nav className="flex items-center gap-2 text-xs text-text-secondary" aria-label="Breadcrumb">
        <Link to="/backoffice/expenses" className="hover:text-text-primary">Expenses</Link>
        <span aria-hidden>›</span>
        <span className="text-text-primary">New</span>
      </nav>

      <Link
        to="/backoffice/expenses"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to expenses
      </Link>

      <header>
        <h1 className="font-display text-3xl text-text-primary">New expense</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Capture an operational expense. Submit it later to request approval.
        </p>
      </header>

      <ExpenseForm
        draftId={draftId}
        value={values}
        onChange={setValues}
        onSubmit={() => { void handleSubmit(); }}
        onCancel={() => navigate('/backoffice/expenses')}
        submitting={submitDisabled}
        submitLabel="Save as draft"
      />

      {create.error !== null && create.error !== undefined && (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed to save: {create.error.message}
        </div>
      )}
    </div>
  );
}
