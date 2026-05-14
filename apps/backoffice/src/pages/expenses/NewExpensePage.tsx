// apps/backoffice/src/pages/expenses/NewExpensePage.tsx
import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore.js';
import { useCreateExpense } from '@/features/expenses/hooks/useCreateExpense.js';
import {
  ExpenseForm,
  emptyExpenseFormValues,
  type ExpenseFormValues,
} from '@/features/expenses/components/ExpenseForm.js';

export default function NewExpensePage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate     = hasPermission('expenses.create');
  const navigate      = useNavigate();

  const [draftId] = useState<string>(() => crypto.randomUUID());
  const [idemKey] = useState<string>(() => crypto.randomUUID());
  const [values, setValues] = useState<ExpenseFormValues>(emptyExpenseFormValues);

  const create = useCreateExpense();

  const isSubmitting = create.isPending;

  const submitDisabled = useMemo(() => isSubmitting, [isSubmitting]);

  if (!canCreate) {
    return <div className="text-text-secondary">You do not have permission to create expenses.</div>;
  }

  async function handleSubmit(): Promise<void> {
    try {
      const input: import('@/features/expenses/hooks/useCreateExpense.js').CreateExpenseInput = {
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
      <div>
        <Link to="/backoffice/expenses" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to expenses
        </Link>
        <h1 className="font-serif text-3xl mt-2">New expense</h1>
        <p className="text-text-secondary text-sm">Capture an operational expense. Submit it later to request approval.</p>
      </div>

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
        <div className="text-sm text-red">Failed to save: {create.error.message}</div>
      )}
    </div>
  );
}
