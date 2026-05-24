// apps/backoffice/src/pages/expenses/ExpenseDetailPage.tsx
//
// Session 14 / Phase 5.A — rewrite of the expense detail page to match the
// surrounding purchasing chrome (breadcrumbs, Fraunces heading, Card-based
// two-column layout, gold primary CTAs).
//
// Behaviour preserved — submit_expense_v1 / approve_expense_v1 /
// reject_expense_v1 / pay_expense_v1 are still the only write paths and
// the existing dialogs drive each transition.

import { useState, type JSX, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  CreditCard,
  FileText,
  Receipt,
  Tag,
  XCircle,
} from 'lucide-react';
import { Button, Card, EmptyState, SectionLabel } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { useExpenseDetail } from '@/features/expenses/hooks/useExpenseDetail.js';
import { useSubmitExpense } from '@/features/expenses/hooks/useExpenseActions.js';
import { useExpenseCategories } from '@/features/expenses/hooks/useExpensesList.js';
import { useExpenseApprovals } from '@/features/expenses/hooks/useExpenseApprovals.js';
import { ExpenseStatusBadge } from '@/features/expenses/components/ExpenseStatusBadge.js';
import { ApproveDialog } from '@/features/expenses/components/ApproveDialog.js';
import { RejectDialog } from '@/features/expenses/components/RejectDialog.js';
import { PayDialog } from '@/features/expenses/components/PayDialog.js';
import { ApprovalTimeline } from '@/features/expenses/components/ApprovalTimeline.js';
import { ThresholdResolutionBadge } from '@/features/expenses/components/ThresholdResolutionBadge.js';
import type { ApprovalStep } from '@/features/settings/expense-thresholds/hooks/useExpenseThresholds.js';

function fmtIdr(amount: number | string | null): string {
  return `Rp ${formatIdr(Number(amount ?? 0))}`;
}

export default function ExpenseDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const navigate = useNavigate();

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const canApprove = hasPermission('expenses.approve');
  const canPay     = hasPermission('expenses.pay');

  const { data: expense, isLoading, error } = useExpenseDetail(id);
  const { data: cats } = useExpenseCategories();
  const { data: approvals = [] } = useExpenseApprovals(id || null);
  const submit = useSubmitExpense();

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [payOpen,     setPayOpen]     = useState(false);

  if (isLoading === true) return <div className="text-text-secondary">Loading…</div>;
  if (error !== null && error !== undefined) {
    return <div className="text-danger">Failed to load: {error.message}</div>;
  }
  if (expense === null || expense === undefined) {
    return (
      <div className="space-y-4">
        <Link to="/backoffice/expenses" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to expenses
        </Link>
        <EmptyState
          icon={Receipt}
          title="Expense not found"
          description="It may have been deleted or you do not have access."
          size="md"
        />
      </div>
    );
  }

  const category = (cats ?? []).find((c) => c.id === expense.category_id);

  async function handleSubmitForReview(): Promise<void> {
    try {
      await submit.mutateAsync({ id });
      // Rotate the idempotency key so a subsequent submit (same mount) is a fresh call.
      submit.resetIdempotency();
    } catch {
      // surfaced via submit.error
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <nav className="flex items-center gap-2 text-xs text-text-secondary" aria-label="Breadcrumb">
        <Link to="/backoffice/expenses" className="hover:text-text-primary">Expenses</Link>
        <span aria-hidden>›</span>
        <span className="font-mono text-text-primary">{expense.expense_number}</span>
      </nav>

      <Link to="/backoffice/expenses" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to expenses
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-text-primary tabular-nums">{expense.expense_number}</h1>
          <p className="mt-1 text-sm text-text-secondary">{expense.description}</p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <ExpenseStatusBadge status={expense.status} />
            <ThresholdResolutionBadge
              snapshot={expense.required_approval_steps_snapshot as ApprovalStep[] | null}
              autoApproved={expense.auto_approved}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {expense.status === 'draft' && (
            <Button
              type="button"
              variant="gold"
              onClick={() => { void handleSubmitForReview(); }}
              disabled={submit.isPending}
            >
              {submit.isPending ? 'Submitting…' : 'Submit for approval'}
            </Button>
          )}
          {expense.status === 'submitted' && canApprove && (
            <>
              <Button type="button" variant="gold" onClick={() => setApproveOpen(true)}>
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve
              </Button>
              <Button type="button" variant="ghostDestructive" onClick={() => setRejectOpen(true)}>
                <XCircle className="h-4 w-4" aria-hidden /> Reject
              </Button>
            </>
          )}
          {expense.status === 'submitted' && (
            <div className="w-full mt-2">
              <ApprovalTimeline
                expenseId={id}
                snapshot={expense.required_approval_steps_snapshot as ApprovalStep[] | null}
                autoApproved={expense.auto_approved}
                currentStep={expense.current_approval_step}
              />
            </div>
          )}
          {expense.status === 'approved' && canPay && (
            <Button type="button" variant="gold" onClick={() => setPayOpen(true)}>
              <CreditCard className="h-4 w-4" aria-hidden /> Mark as paid
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card variant="default" padding="md" className="space-y-4">
            <SectionLabel as="h2" size="sm" className="text-gold">Details</SectionLabel>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DetailRow icon={Calendar} label="Date" value={expense.expense_date} />
              <DetailRow icon={Tag}      label="Category" value={category?.name ?? '—'} />
              <DetailRow icon={Building2} label="Vendor" value={expense.vendor_name ?? '—'} />
              <DetailRow icon={CreditCard} label="Payment method" value={expense.payment_method} mono />
            </dl>
          </Card>

          <Card variant="default" padding="md" className="space-y-3">
            <SectionLabel as="h2" size="sm" className="text-gold">Traceability</SectionLabel>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DetailRow icon={Calendar} label="Created"   value={expense.created_at?.slice(0, 19).replace('T', ' ')} />
              {expense.submitted_at !== null && expense.submitted_at !== undefined && (
                <DetailRow icon={Calendar} label="Submitted" value={expense.submitted_at.slice(0, 19).replace('T', ' ')} />
              )}
              {expense.approved_at !== null && expense.approved_at !== undefined && (
                <DetailRow icon={Calendar} label="Approved" value={expense.approved_at.slice(0, 19).replace('T', ' ')} />
              )}
              {expense.paid_at !== null && expense.paid_at !== undefined && (
                <DetailRow icon={Calendar} label="Paid" value={expense.paid_at.slice(0, 19).replace('T', ' ')} />
              )}
              {expense.rejected_reason !== null && expense.rejected_reason !== undefined && (
                <DetailRow icon={XCircle} label="Rejected reason" value={expense.rejected_reason} />
              )}
            </dl>
          </Card>

          {expense.receipt_url !== null && expense.receipt_url !== '' && (
            <Card variant="default" padding="md" className="space-y-2">
              <SectionLabel as="h2" size="sm" className="text-gold">Receipt</SectionLabel>
              <a
                href={expense.receipt_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-gold hover:underline"
              >
                <FileText className="h-4 w-4" aria-hidden /> View receipt
              </a>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card variant="default" padding="md" className="space-y-4">
            <SectionLabel as="h2" size="sm" className="text-gold">Financial</SectionLabel>
            <dl className="space-y-2 text-sm">
              <SummaryRow label="Amount" value={fmtIdr(expense.amount)} />
              <SummaryRow label="VAT"    value={fmtIdr(expense.vat_amount)} />
            </dl>
            <div className="flex items-baseline justify-between border-t border-border-subtle pt-3">
              <SectionLabel as="span" size="sm">Net (DR)</SectionLabel>
              <span className="font-mono text-xl tabular-nums text-gold">
                {fmtIdr(Number(expense.amount) - Number(expense.vat_amount ?? 0))}
              </span>
            </div>
            {(expense.je_id !== null && expense.je_id !== undefined) && (
              <div className="border-t border-border-subtle pt-3 text-xs text-text-muted space-y-1">
                <div>JE: <span className="font-mono">{expense.je_id}</span></div>
                {expense.payment_je_id !== null && expense.payment_je_id !== undefined && (
                  <div>Payment JE: <span className="font-mono">{expense.payment_je_id}</span></div>
                )}
              </div>
            )}
          </Card>

          <Card variant="default" padding="md" className="space-y-2">
            <SectionLabel as="h2" size="sm" className="text-gold">Status Timeline</SectionLabel>
            <ul className="space-y-1.5 text-xs">
              <TimelineItem reached label="Drafted" date={expense.created_at?.slice(0, 10) ?? '—'} />
              <TimelineItem reached={['submitted', 'approved', 'paid', 'rejected'].includes(expense.status)} label="Submitted" date={expense.submitted_at?.slice(0, 10) ?? '—'} />
              <TimelineItem reached={['approved', 'paid'].includes(expense.status)} label="Approved" date={expense.approved_at?.slice(0, 10) ?? '—'} />
              <TimelineItem reached={expense.status === 'paid'} label="Paid" date={expense.paid_at?.slice(0, 10) ?? '—'} />
              {expense.status === 'rejected' && (
                <TimelineItem reached cancelled label="Rejected" date={expense.rejected_at?.slice(0, 10) ?? '—'} />
              )}
            </ul>
          </Card>

          <Button type="button" variant="ghost" onClick={() => navigate('/backoffice/expenses')} className="w-full">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to list
          </Button>

          {submit.error !== null && submit.error !== undefined && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              {submit.error.message}
            </div>
          )}
        </div>
      </div>

      <ApproveDialog
        open={approveOpen}
        expenseId={id}
        onClose={() => setApproveOpen(false)}
        createdByUserId={expense.created_by ?? null}
        approvals={approvals}
        currentUserId={currentUserId}
      />
      <RejectDialog  open={rejectOpen}  expenseId={id} onClose={() => setRejectOpen(false)} />
      <PayDialog     open={payOpen}     expenseId={id} onClose={() => setPayOpen(false)} />
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: typeof Calendar;
  label: string;
  value: ReactNode;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-md bg-bg-base/40 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-text-muted" aria-hidden />
        <SectionLabel as="div" size="xs">{label}</SectionLabel>
      </div>
      <div className={`mt-0.5 text-sm text-text-primary ${mono ? 'font-mono capitalize' : ''}`}>{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between text-text-secondary">
      <span>{label}</span>
      <span className="tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

function TimelineItem({
  reached,
  cancelled = false,
  label,
  date,
}: {
  reached: boolean;
  cancelled?: boolean;
  label: string;
  date: string;
}): JSX.Element {
  return (
    <li className="flex items-center gap-2">
      {cancelled ? (
        <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden />
      ) : (
        <CheckCircle2
          className={`h-3.5 w-3.5 ${reached ? 'text-success' : 'text-text-muted'}`}
          aria-hidden
        />
      )}
      <span className={reached ? 'text-text-primary' : 'text-text-muted'}>{label}</span>
      <span className="ml-auto text-text-muted tabular-nums">{date}</span>
    </li>
  );
}
