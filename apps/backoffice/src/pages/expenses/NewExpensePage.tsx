import { useEffect, useRef, useState, type JSX } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore.js';
import { useExpenseDraftCreation } from '@/features/expenses/hooks/useExpenseDraftCreation.js';
import { ExpenseForm, emptyExpenseFormValues, type ExpenseFormValues } from '@/features/expenses/components/ExpenseForm.js';
import { ExpenseConsequenceRail } from '@/features/expenses/components/ExpenseConsequenceRail.js';
import { PageHeader } from '@/components/PageHeader.js';
import { RestrictedState } from '@/components/RestrictedState.js';
import { Button } from '@/components/BackofficeUi.js';
import { clearExpenseDraftNavigation, readExpenseDraftSeed, type ExpenseDraftNavigationState } from '@/features/expenses/utils/expenseDraftNavigation.js';
import type { ExpenseCreationSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';

function Breadcrumb(): JSX.Element {
  return <nav className="flex items-center gap-1 text-xs text-text-muted" aria-label="Breadcrumb">
    <Link to="/backoffice/expenses" className="hover:text-text-primary">Expenses</Link>
    <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
    <span className="text-text-secondary">New</span>
  </nav>;
}

export default function NewExpensePage(): JSX.Element {
  const profile = useAuthStore(s => s.user?.id);
  const token = useAuthStore(s => s.sessionToken);
  const location = useLocation();
  const ticket = (location.state as ExpenseDraftNavigationState | null)?.expenseDraftTicket;
  // Le secret ne devient jamais une clé React ou un attribut du document.
  const context = useRef({profile, token, ticket, generation: 0});
  if (context.current.profile !== profile || context.current.token !== token || (ticket && ticket !== context.current.ticket)) {
    context.current = {profile, token, ticket, generation: context.current.generation + 1};
  }
  return <DraftPage key={context.current.generation} ticket={context.current.ticket} />;
}

function DraftPage({ticket}: {ticket: string | undefined}): JSX.Element {
  const hasPermission = useAuthStore(s => s.hasPermission);
  const canCreate = hasPermission('expenses.create') || hasPermission('expenses.manage');
  const navigate = useNavigate();
  const location = useLocation();
  const recovery = useExpenseDraftCreation();
  const [error, setError] = useState<string | null>(null);
  const [formGeneration, setFormGeneration] = useState(0);
  const [values, setValues] = useState<ExpenseFormValues>(() => {
    const base = emptyExpenseFormValues();
    const seed = readExpenseDraftSeed(ticket);
    return seed ? {...base, category_id: seed.category_id, amount: seed.amount, vat_amount: seed.vat_amount,
      payment_method: seed.payment_method, vendor_name: seed.vendor_name, description: seed.description} : base;
  });

  useEffect(() => {
    if (!ticket) return;
    clearExpenseDraftNavigation(ticket);
    if ((location.state as ExpenseDraftNavigationState | null)?.expenseDraftTicket === ticket) {
      void navigate('/backoffice/expenses/new', {state: null, replace: true});
    }
  }, [ticket, location.state, navigate]);

  async function save(): Promise<void> {
    setError(null);
    const payload: ExpenseCreationSnapshot = recovery.pending?.payload ?? {
      category_id: values.category_id, amount: Number(values.amount),
      vat_amount: Number(values.vat_amount || '0'), payment_method: values.payment_method,
      description: values.description.trim(), expense_date: values.expense_date,
      ...(values.vendor_name.trim() ? {vendor_name: values.vendor_name.trim()} : {}),
    };
    const outcome = await recovery.save(payload);
    if (!outcome.current) return;
    if ('error' in outcome) setError(outcome.error instanceof Error ? outcome.error.message : 'The save is unconfirmed. Check it again.');
    else if (outcome.result) void navigate('/backoffice/expenses/' + outcome.result);
  }
  async function startNew(): Promise<void> {
    try {
      if (await recovery.startNew()) {
        setValues(emptyExpenseFormValues()); setFormGeneration(n => n + 1); setError(null);
        void navigate('/backoffice/expenses/new', {state: null, replace: true});
      }
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="space-y-6 max-w-6xl">
    <Breadcrumb />
    <PageHeader title="New expense" subtitle="Save a draft before attaching its receipt or requesting approval." />
    {!canCreate ? <RestrictedState what="creating expenses" permission="expenses.create" /> : <>
      {(recovery.storageError ?? error) && <div role="alert" className="text-danger">{recovery.storageError ?? error}</div>}
      {recovery.pending ? <section className="space-y-3" aria-label="Pending expense save">
        <p role="status">The save is unconfirmed. Check the same draft before starting another expense.</p>
        <p>{recovery.pending.payload.description} — {recovery.pending.payload.amount} IDR — {recovery.pending.payload.expense_date}</p>
        <Button size="sm" disabled={recovery.busy || Boolean(recovery.storageError)} onClick={() => {void save();}}>Check pending save</Button>
      </section> : recovery.pointer?.status === 'saved' ? <section className="space-y-3">
        <p>This draft has already been saved. Open it to attach a receipt or submit it.</p>
        <Link className="text-text-primary underline" to={'/backoffice/expenses/' + recovery.pointer.expenseId}>Open saved draft</Link>
        <Button size="sm" disabled={recovery.busy || Boolean(recovery.storageError)} onClick={() => {void startNew();}}>Start another expense</Button>
      </section> : <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <ExpenseForm key={formGeneration} value={values} onChange={setValues} onSubmit={() => {void save();}}
          onCancel={() => {void navigate('/backoffice/expenses');}} submitting={recovery.busy || Boolean(recovery.storageError)} submitLabel="Save as draft" />
        <ExpenseConsequenceRail categoryId={values.category_id} amount={values.amount} vatAmount={values.vat_amount} />
      </div>}
    </>}
  </div>;
}
