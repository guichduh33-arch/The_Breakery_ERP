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
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Copy,
  CreditCard,
  FileText,
  Receipt,
  Tag,
  XCircle,
} from 'lucide-react';
import { Card, EmptyState } from '@breakery/ui';
import { SectionLabel } from '@/components/SectionLabel.js';
import { formatCurrency } from '@breakery/utils';
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
import type { DuplicateExpenseSeed } from '@/features/expenses/components/ExpenseForm.js';
import type { ApprovalStep } from '@/features/settings/expense-thresholds/hooks/useExpenseThresholds.js';
import {
  TOOLBAR_BTN,
  TOOLBAR_BTN_PRIMARY,
  TOOLBAR_BTN_SECONDARY,
  TOOLBAR_ICON,
} from '@/components/toolbarButton.js';
import { PageHeader } from '@/components/PageHeader.js';

/** Le refus est un secondaire de bandeau teinté — même géométrie, encre rouge. */
const BTN_DANGER = `${TOOLBAR_BTN} border border-red bg-bg-elevated text-red-as-text hover:bg-red-soft`;

function fmtIdr(amount: number | string | null): string {
  return formatCurrency(Number(amount ?? 0));
}

/**
 * Le fil d'Ariane de la page — extrait au LOT 9 pour être rendu AUSSI au-dessus
 * de la branche « introuvable », qui n'en avait pas.
 *
 * Gabarit UNIQUE depuis le 2026-08-18 : `gap-1 text-xs text-text-muted`,
 * chevron icône `text-text-inert`, segment terminal en `text-text-secondary`.
 * Quatre pages — dépenses et achats — gardaient `gap-2 text-xs
 * text-text-secondary` avec un terminal en primaire : deux gabarits pour un
 * objet, ce que la campagne annonçait unifié.
 *
 * `leaf` remplace le numéro de dépense quand on ne l'a pas (ou plus).
 */
function ExpenseBreadcrumb({ leaf }: { leaf: string }): JSX.Element {
  return (
    <nav className="flex items-center gap-1 text-xs text-text-muted" aria-label="Breadcrumb">
      <Link to="/backoffice/expenses" className="hover:text-text-primary">Expenses</Link>
      <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
      <span className="font-mono text-text-secondary">{leaf}</span>
    </nav>
  );
}

export default function ExpenseDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const navigate = useNavigate();

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const currentUserRole = useAuthStore((s) => s.user?.role_code ?? null);
  const canApprove = hasPermission('expenses.approve');
  const canPay     = hasPermission('expenses.pay');
  const canCreate  = hasPermission('expenses.create');

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
  // LOT 9 — cette branche n'avait AUCUN fil d'Ariane : son « ← Back to
  // expenses » était sa seule sortie, on ne pouvait donc pas le retirer sec.
  // Elle rend désormais le fil, qui la remplace.
  if (expense === null || expense === undefined) {
    return (
      <div className="space-y-4">
        <ExpenseBreadcrumb leaf="—" />
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

  // Session 59 / Task 6b — "Duplicate" seeds a fresh draft with this expense's
  // category/amount/VAT/payment method/vendor/description via navigation
  // state. NewExpensePage forces expense_date to today and drops the
  // receipt regardless of what's passed here.
  function handleDuplicate(): void {
    const seed: DuplicateExpenseSeed = {
      category_id: expense!.category_id,
      amount: String(expense!.amount),
      vat_amount: String(expense!.vat_amount ?? 0),
      payment_method: expense!.payment_method as DuplicateExpenseSeed['payment_method'],
      vendor_name: expense!.vendor_name ?? '',
      description: expense!.description ?? '',
    };
    void navigate('/backoffice/expenses/new', { state: { duplicateFrom: seed } });
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* LOT 9 — l'écran portait TROIS vocabulaires de retour : ce fil
          d'Ariane, un « ← Back to expenses » juste dessous, et un « ← Back to
          list » au pied du rail de droite. L'ossature commune (DESIGN.md
          § Page Archetypes) n'en déclare qu'un ; les deux autres sont partis. */}
      <ExpenseBreadcrumb leaf={expense.expense_number} />

      {/* Bandeau — `PageHeader` est la source UNIQUE du bandeau de page.
          La rangée d'actions portait TROIS hauteurs à la fois (32 px pour la
          chaîne de bandeau, 56 px pour deux `<Button>` écrits sans `size`) ;
          elle est désormais entièrement dans la famille du bandeau, 32 px. */}
      <PageHeader
        className="items-start"
        titleClassName="tabular-nums"
        title={expense.expense_number}
        subtitle={
          <>
            <p>{expense.description}</p>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <ExpenseStatusBadge status={expense.status} />
              <ThresholdResolutionBadge
                snapshot={expense.required_approval_steps_snapshot as ApprovalStep[] | null}
                autoApproved={expense.auto_approved}
              />
            </div>
          </>
        }
        actions={
          <>
            {canCreate && (
              <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={handleDuplicate}>
                <Copy className={TOOLBAR_ICON} aria-hidden /> Duplicate
              </button>
            )}
            {expense.status === 'draft' && (
              <button
                type="button"
                className={TOOLBAR_BTN_PRIMARY}
                onClick={() => { void handleSubmitForReview(); }}
                disabled={submit.isPending}
              >
                {submit.isPending ? 'Submitting…' : 'Submit for approval'}
              </button>
            )}
            {expense.status === 'submitted' && canApprove && (
              <>
                <button type="button" className={TOOLBAR_BTN_PRIMARY} onClick={() => setApproveOpen(true)}>
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Approve
                </button>
                <button type="button" className={BTN_DANGER} onClick={() => setRejectOpen(true)}>
                  <XCircle className="h-3.5 w-3.5" aria-hidden /> Reject
                </button>
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
              <button type="button" className={TOOLBAR_BTN_PRIMARY} onClick={() => setPayOpen(true)}>
                <CreditCard className="h-3.5 w-3.5" aria-hidden /> Mark as paid
              </button>
            )}
          </>
        }
      />

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

          {submit.error !== null && submit.error !== undefined && (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
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
        currentUserRole={currentUserRole}
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
    <div className="rounded-md bg-surface-inert px-3 py-2">
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
