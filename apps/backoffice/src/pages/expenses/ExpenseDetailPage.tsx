// apps/backoffice/src/pages/expenses/ExpenseDetailPage.tsx
import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useExpenseDetail } from '@/features/expenses/hooks/useExpenseDetail.js';
import { useSubmitExpense } from '@/features/expenses/hooks/useExpenseActions.js';
import { useExpenseCategories } from '@/features/expenses/hooks/useExpensesList.js';
import { ExpenseStatusBadge } from '@/features/expenses/components/ExpenseStatusBadge.js';
import { ApproveDialog } from '@/features/expenses/components/ApproveDialog.js';
import { RejectDialog }  from '@/features/expenses/components/RejectDialog.js';
import { PayDialog }     from '@/features/expenses/components/PayDialog.js';

function formatIdr(n: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n);
}

export default function ExpenseDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id     = params.id ?? '';
  const navigate = useNavigate();

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canApprove = hasPermission('expenses.approve');
  const canPay     = hasPermission('expenses.pay');

  const { data: expense, isLoading, error } = useExpenseDetail(id);
  const { data: cats } = useExpenseCategories();
  const submit = useSubmitExpense();

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [payOpen,     setPayOpen]     = useState(false);

  if (isLoading === true) return <div className="text-text-secondary">Loading…</div>;
  if (error !== null && error !== undefined)
    return <div className="text-red">Failed to load: {error.message}</div>;
  if (expense === null || expense === undefined)
    return <div className="text-text-secondary">Expense not found.</div>;

  const category = (cats ?? []).find((c) => c.id === expense.category_id);

  async function handleSubmitForReview(): Promise<void> {
    try {
      await submit.mutateAsync({ id });
    } catch {
      // surfaced via submit.error
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link to="/backoffice/expenses" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to expenses
        </Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="font-serif text-3xl">{expense.expense_number}</h1>
            <p className="text-text-secondary text-sm">{expense.description}</p>
          </div>
          <ExpenseStatusBadge status={expense.status} />
        </div>
      </div>

      {/* Identity + Financial */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-bg-elevated border border-border-subtle rounded-lg p-4 space-y-3">
          <h2 className="font-serif text-lg">Details</h2>
          <DetailRow label="Date"           value={expense.expense_date} />
          <DetailRow label="Category"       value={category?.name ?? '-'} />
          <DetailRow label="Vendor"         value={expense.vendor_name ?? '-'} />
          <DetailRow label="Payment method" value={expense.payment_method} />
        </div>

        <div className="bg-bg-elevated border border-border-subtle rounded-lg p-4 space-y-3">
          <h2 className="font-serif text-lg">Financial</h2>
          <DetailRow label="Amount"   value={`Rp ${formatIdr(Number(expense.amount))}`} />
          <DetailRow label="VAT"      value={`Rp ${formatIdr(Number(expense.vat_amount ?? 0))}`} />
          <DetailRow label="Net (DR)" value={`Rp ${formatIdr(Number(expense.amount) - Number(expense.vat_amount ?? 0))}`} />
          {expense.je_id !== null && expense.je_id !== undefined && (
            <DetailRow label="Journal entry" value={<span className="font-mono text-xs">{expense.je_id}</span>} />
          )}
          {expense.payment_je_id !== null && expense.payment_je_id !== undefined && (
            <DetailRow label="Payment JE" value={<span className="font-mono text-xs">{expense.payment_je_id}</span>} />
          )}
        </div>
      </div>

      {/* Traceability */}
      <div className="bg-bg-elevated border border-border-subtle rounded-lg p-4 space-y-2">
        <h2 className="font-serif text-lg">Traceability</h2>
        <DetailRow label="Created"   value={expense.created_at} />
        {expense.submitted_at !== null && expense.submitted_at !== undefined && (
          <DetailRow label="Submitted" value={expense.submitted_at} />
        )}
        {expense.approved_at !== null && expense.approved_at !== undefined && (
          <DetailRow label="Approved" value={expense.approved_at} />
        )}
        {expense.paid_at !== null && expense.paid_at !== undefined && (
          <DetailRow label="Paid" value={expense.paid_at} />
        )}
        {expense.rejected_reason !== null && expense.rejected_reason !== undefined && (
          <DetailRow label="Rejected reason" value={expense.rejected_reason} />
        )}
      </div>

      {/* Actions */}
      <div className="bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <h2 className="font-serif text-lg mb-3">Actions</h2>
        <div className="flex flex-wrap gap-2">
          {expense.status === 'draft' && (
            <Button type="button" variant="primary" onClick={() => { void handleSubmitForReview(); }} disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'Submit for approval'}
            </Button>
          )}
          {expense.status === 'submitted' && canApprove && (
            <>
              <Button type="button" variant="primary" onClick={() => setApproveOpen(true)}>Approve</Button>
              <Button type="button" variant="ghostDestructive" onClick={() => setRejectOpen(true)}>Reject</Button>
            </>
          )}
          {expense.status === 'approved' && canPay && (
            <Button type="button" variant="gold" onClick={() => setPayOpen(true)}>Mark as paid</Button>
          )}
          <Button type="button" variant="ghost" onClick={() => navigate('/backoffice/expenses')}>Back</Button>
        </div>
        {submit.error !== null && submit.error !== undefined && (
          <div className="text-sm text-red mt-2">{submit.error.message}</div>
        )}
      </div>

      <ApproveDialog open={approveOpen} expenseId={id} onClose={() => setApproveOpen(false)} />
      <RejectDialog  open={rejectOpen}  expenseId={id} onClose={() => setRejectOpen(false)} />
      <PayDialog     open={payOpen}     expenseId={id} onClose={() => setPayOpen(false)} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <div className="text-text-secondary">{label}</div>
      <div className="text-text-primary text-right">{value}</div>
    </div>
  );
}
