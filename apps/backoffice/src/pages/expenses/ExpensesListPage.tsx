// apps/backoffice/src/pages/expenses/ExpensesListPage.tsx
//
// Liste des dépenses — instance de l'archétype LIST.
//
// Ce que l'audit UX/UI change ici, et pourquoi :
//   · Le titre passe AVANT les onglets. Les onglets étaient au-dessus du `<h1>`
//     — on choisissait la sous-vue d'une page qu'on n'avait pas encore nommée,
//     et le fil de lecture démarrait par un contrôle.
//   · Les quatre tuiles de KPI et les six pastilles dorées disaient deux fois
//     la même chose : « Pending 3 » au-dessus, un bouton « Submitted » en
//     dessous. Les deux cèdent à une seule bande de compteurs
//     (`ListCounterStrip`), où le compteur EST le filtre de statut.
//   · Les compteurs suivent catégorie / méthode / dates / recherche, mais
//     JAMAIS le statut actif : un compteur qui se recalcule sur son propre
//     filtre ne compte plus que lui-même (même règle que la liste des
//     commandes, ADR-025 D2).
//   · Le montant par statut passe en infobulle : la bande répond à « combien
//     de lignes vais-je voir », l'argent s'y lit au survol.
//
// Categories reste une sous-vue en lecture seule — aucune RPC de CRUD de
// catégorie de dépense n'existe. Les écritures passent toujours par
// useCreateExpense / useExpenseActions.

import { useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  Plus,
  Receipt,
  Search,
  Tag,
} from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@breakery/ui';
import { formatCurrency, formatDate } from '@breakery/utils';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { useAuthStore } from '@/stores/authStore.js';
import { ExpenseStatusBadge } from '@/features/expenses/components/ExpenseStatusBadge.js';
import {
  useExpenseCategories,
  useExpensesList,
  type ExpenseRow,
  type ExpensesListFilters,
  type ExpenseStatus,
} from '@/features/expenses/hooks/useExpensesList.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';

type ExpenseFilterKey = ExpenseStatus | 'all';

interface ExpenseBucket { count: number; amount: number }
type ExpenseBuckets = Record<ExpenseFilterKey, ExpenseBucket>;

function aggregate(rows: readonly ExpenseRow[]): ExpenseBuckets {
  const acc: ExpenseBuckets = {
    all:       { count: rows.length, amount: 0 },
    draft:     { count: 0, amount: 0 },
    submitted: { count: 0, amount: 0 },
    approved:  { count: 0, amount: 0 },
    rejected:  { count: 0, amount: 0 },
    paid:      { count: 0, amount: 0 },
  };
  for (const r of rows) {
    const amt = Number(r.amount ?? 0);
    acc.all.amount += amt;
    const bucket = acc[r.status as ExpenseFilterKey] as ExpenseBucket | undefined;
    if (bucket === undefined) continue;
    bucket.count  += 1;
    bucket.amount += amt;
  }
  return acc;
}

// Les six entrées de la bande — mêmes valeurs de filtre que les pastilles
// qu'elle remplace. Seuls deux statuts portent un ton : « Submitted » désigne
// du travail qui attend une décision, « Rejected » un refus qu'il faut traiter.
// Les autres ne sont pas graves, ils sont l'état normal d'une dépense.
const EXPENSE_COUNTERS: readonly {
  value: ExpenseFilterKey;
  label: string;
  tone?: 'warning' | 'danger';
}[] = [
  { value: 'all',       label: 'All expenses' },
  { value: 'draft',     label: 'Draft' },
  { value: 'submitted', label: 'Submitted', tone: 'warning' },
  { value: 'approved',  label: 'Approved' },
  { value: 'rejected',  label: 'Rejected',  tone: 'danger' },
  { value: 'paid',      label: 'Paid' },
];

export default function ExpensesListPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('expenses.read');
  const canCreate = hasPermission('expenses.create');

  const [tab, setTab]                     = useState<'expenses' | 'categories'>('expenses');
  const [status, setStatus]               = useState<ExpenseFilterKey>('all');
  const [categoryId, setCategoryId]       = useState<string>('all');
  const [paymentMethod, setPaymentMethod] = useState<'all' | 'cash' | 'transfer' | 'card' | 'credit'>('all');
  const [dateFrom, setDateFrom]           = useState<string>('');
  const [dateTo, setDateTo]               = useState<string>('');
  const [search, setSearch]               = useState<string>('');

  // Les filtres HORS statut : ce sur quoi les compteurs se calculent. Le statut
  // ne s'ajoute que pour la table — sans quoi chaque compteur ne compterait que
  // les lignes que son propre filtre a déjà retenues.
  const counterFilters = useMemo<ExpensesListFilters>(
    () => ({
      status: 'all',
      categoryId,
      paymentMethod,
      ...(dateFrom !== '' ? { dateFrom } : {}),
      ...(dateTo   !== '' ? { dateTo }   : {}),
      ...(search.trim() !== '' ? { search } : {}),
    }),
    [categoryId, paymentMethod, dateFrom, dateTo, search],
  );

  const filters = useMemo<ExpensesListFilters>(
    () => ({ ...counterFilters, status }),
    [counterFilters, status],
  );

  const list    = useExpensesList(filters);
  const allList = useExpensesList(counterFilters);
  const cats    = useExpenseCategories();

  const rows    = list.data ?? [];
  const buckets = useMemo(() => aggregate(allList.data ?? []), [allList.data]);
  const countersDown = allList.isError;

  const counters = useMemo<ListCounter[]>(() => EXPENSE_COUNTERS.map((c) => {
    const bucket = buckets[c.value];
    return {
      id:    c.value,
      label: c.label,
      // Un échec de chargement rend un tiret, jamais un zéro : « aucune dépense
      // en attente » et « je n'ai pas pu compter » ne se ressemblent pas.
      value: countersDown ? '—' : bucket.count,
      ...(c.tone !== undefined && bucket.count > 0 && !countersDown ? { tone: c.tone } : {}),
      ...(countersDown ? {} : {
        title: `${formatCurrency(bucket.amount)} across ${String(bucket.count)} expense(s). Counted over the 200 most recent expenses matching the category / method / date / search filters.`,
      }),
      onSelect: () => { setStatus(c.value); },
    };
  }), [buckets, countersDown]);

  const columns: readonly DataTableColumn<ExpenseRow>[] = useMemo(() => [
    {
      id:    'date',
      header: 'Date',
      width: '120px',
      // The Mono-Carries-Data Rule nomme explicitement l'HORODATAGE. Le lot qui
      // a corrigé les montants de cette table s'est arrêté aux montants :
      // `tabular-nums` seul demande des chiffres de largeur fixe à Instrument
      // Sans, il ne le remplace pas par du mono.
      render: (r) => <span className="font-data tabular-nums text-text-secondary">{formatDate(r.expense_date)}</span>,
    },
    {
      id:    'number',
      header: 'Number',
      width: '160px',
      render: (r) => (
        <Link
          to={`/backoffice/expenses/${r.id}`}
          className={`font-mono text-xs text-gold hover:underline ${FOCUS_RING}`}
          onClick={(e) => e.stopPropagation()}
        >
          {r.expense_number}
        </Link>
      ),
    },
    {
      id:    'description',
      header: 'Description',
      render: (r) => (
        <div className="min-w-0">
          <div className="text-text-primary truncate">{r.description}</div>
          {r.vendor_name !== null && r.vendor_name !== '' && (
            <div className="text-xs text-text-muted truncate">{r.vendor_name}</div>
          )}
        </div>
      ),
    },
    {
      id:    'amount',
      header: 'Amount',
      width: '140px',
      align: 'right',
      // `tabular-nums` sans `font-data` ne fait que demander des chiffres de
      // chasse égale À INSTRUMENT SANS : le montant sortait en sans-serif.
      // The Mono-Carries-Data Rule — un montant rend en mono tabulaire.
      render: (r) => <span className="font-data tabular-nums">{formatCurrency(Number(r.amount ?? 0))}</span>,
    },
    {
      id:    'method',
      header: 'Method',
      width: '120px',
      render: (r) => <span className="capitalize text-text-secondary">{r.payment_method}</span>,
    },
    {
      id:    'status',
      header: 'Status',
      width: '120px',
      align: 'center',
      render: (r) => <ExpenseStatusBadge status={r.status} />,
    },
  ], []);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view expenses.</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        className="items-start gap-4"
        title="Expenses"
        subtitle="Manage and track your bakery's expenditure."
        actions={
          <>
            <Button variant="ghost" size="sm" disabled aria-label="Export (coming soon)">
              <Download className="h-4 w-4" aria-hidden /> Export
            </Button>
            {canCreate && (
              <Link to="/backoffice/expenses/new" className={TOOLBAR_BTN_PRIMARY}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> New expense
              </Link>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="expenses">
            <Receipt className="h-4 w-4" aria-hidden /> Expenses
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Tag className="h-4 w-4" aria-hidden /> Categories
          </TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="mt-4 space-y-6">
          <ListCounterStrip
            counters={counters}
            activeId={status}
            ariaLabel="Expense status filter"
            data-testid="expenses-counters"
          />

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3">
            <div className="relative flex-1 min-w-[16rem]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
              <input
                id="exp-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search expenses…"
                maxLength={64}
                aria-label="Search expenses"
                className={`h-9 w-full rounded-md border border-border-strong bg-bg-input pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted ${FOCUS_RING}`}
              />
            </div>
            <select
              id="exp-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label="Category filter"
              className={`h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
            >
              <option value="all">All categories</option>
              {(cats.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              id="exp-pm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
              aria-label="Payment method filter"
              className={`h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
            >
              <option value="all">All methods</option>
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="card">Card</option>
              <option value="credit">Credit</option>
            </select>
            <input
              id="exp-from"
              type="date" lang="id-ID"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="From date"
              className={`h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
            />
            <input
              id="exp-to"
              type="date" lang="id-ID"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="To date"
              className={`h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
            />
          </div>

          {list.error !== null && list.error !== undefined ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
              Failed to load expenses: {list.error.message}
            </div>
          ) : (
            <DataTable
              caption="Date, number, description, amount, payment method and status per expense"
              data-testid="expenses-table"
              columns={columns}
              rows={rows}
              getRowKey={(r) => r.id}
              isLoading={list.isLoading}
              emptyState={
                <div className="px-6 py-12 text-center">
                  <Receipt className="mx-auto h-10 w-10 text-text-muted" aria-hidden />
                  {/* `<h3>` sous le `<h1>` de PageHeader : la page n'a pas de
                      `<h2>`, le niveau sautait de 1 à 3 (WCAG 1.3.1). */}
                  {/* `font-display italic` retiré (2026-08-18) : sous le thème
                      back-office `--font-display` est remappé sur la pile du
                      corps, la classe ne rendait donc AUCUN serif — DESIGN.md
                      dit d'elle qu'elle « nomme le contraire de ce qu'elle
                      fait ». Le titre s'aligne sur l'autre état vide corrigé
                      dans le même geste (`ProductsGrid`). */}
                  <h2 className="mt-3 text-xl font-semibold text-text-primary">No expenses found</h2>
                  <p className="mx-auto mt-1 max-w-prose text-sm text-text-secondary">
                    {canCreate
                      ? 'Capture your first operational expense to start tracking spend.'
                      : 'Operational expenses will appear here once a manager records them.'}
                  </p>
                  {canCreate && (
                    <div className="mt-4">
                      <Link to="/backoffice/expenses/new" className={TOOLBAR_BTN_PRIMARY}>
                        <Plus className="h-3.5 w-3.5" aria-hidden /> Add first expense
                      </Link>
                    </div>
                  )}
                </div>
              }
            />
          )}
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CategoriesTab(): JSX.Element {
  const cats = useExpenseCategories();
  const rows = cats.data ?? [];
  if (cats.isLoading) {
    return <div className="h-32 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Tag}
        title="No expense categories"
        description="Categories must be seeded by an administrator before expenses can be filed."
        size="md"
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-elevated">
      <table className="w-full text-sm">
        <caption className="sr-only">Code, name, mapped account and status per expense category</caption>
        <thead className="border-b border-border-subtle bg-surface-inert">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs uppercase tracking-widest text-text-muted">Code</th>
            <th scope="col" className="px-4 py-3 text-left text-xs uppercase tracking-widest text-text-muted">Name</th>
            <th scope="col" className="px-4 py-3 text-left text-xs uppercase tracking-widest text-text-muted">Account</th>
            <th scope="col" className="px-4 py-3 text-center text-xs uppercase tracking-widest text-text-muted">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-border-subtle">
              <td className="px-4 py-3 font-mono text-xs text-text-secondary">{c.code}</td>
              <td className="px-4 py-3 text-text-primary">{c.name}</td>
              <td className="px-4 py-3 font-mono text-xs text-text-muted">{c.account_id}</td>
              <td className="px-4 py-3 text-center">
                {c.is_active ? (
                  <span className="text-xs text-success">Active</span>
                ) : (
                  <span className="text-xs text-text-muted">Inactive</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-border-subtle px-4 py-2 text-xs text-text-muted">
        Categories are read-only — no expense_category CRUD RPC ships in this session.
      </div>
    </div>
  );
}
