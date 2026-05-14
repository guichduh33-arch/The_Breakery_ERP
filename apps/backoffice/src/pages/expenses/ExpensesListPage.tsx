// apps/backoffice/src/pages/expenses/ExpensesListPage.tsx
//
// Session 14 / Phase 5.A — rewrite of the Expenses list to match the
// `expenses.jpg` reference (Fraunces title, four KPI tiles, pill filters,
// dense table). Tabs (Expenses / Categories) sit above the title to mirror
// the screenshot, but Categories is intentionally a placeholder
// EmptyState — there's no expense category CRUD RPC in supabase/migrations
// today, so the surface stays read-only.
//
// All write paths still flow through the existing
// useCreateExpense / useExpenseActions hooks.

import { useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  Calculator,
  Calendar,
  Clock,
  Coins,
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
  KpiTile,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { ExpenseStatusBadge } from '@/features/expenses/components/ExpenseStatusBadge.js';
import {
  useExpenseCategories,
  useExpensesList,
  type ExpenseRow,
  type ExpensesListFilters,
  type ExpenseStatus,
} from '@/features/expenses/hooks/useExpensesList.js';

interface ExpensesKpi {
  totalAmount: number;
  pendingCount: number;
  monthlyCount: number;
  avgAmount: number;
}

function aggregate(rows: ReadonlyArray<ExpenseRow>): ExpensesKpi {
  const acc: ExpensesKpi = { totalAmount: 0, pendingCount: 0, monthlyCount: 0, avgAmount: 0 };
  if (rows.length === 0) return acc;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const ms = monthStart.getTime();
  for (const r of rows) {
    const amt = Number(r.amount ?? 0);
    if (r.status === 'approved' || r.status === 'paid') acc.totalAmount += amt;
    if (r.status === 'submitted')                       acc.pendingCount += 1;
    const t = Date.parse(r.expense_date);
    if (Number.isFinite(t) && t >= ms) acc.monthlyCount += 1;
  }
  acc.avgAmount = rows.length === 0 ? 0 : acc.totalAmount / Math.max(1, rows.length);
  return acc;
}

const STATUS_FILTERS: { value: ExpenseStatus | 'all'; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'draft',     label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved',  label: 'Approved' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'paid',      label: 'Paid' },
];

export default function ExpensesListPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('expenses.read');
  const canCreate = hasPermission('expenses.create');

  const [tab, setTab]                     = useState<'expenses' | 'categories'>('expenses');
  const [status, setStatus]               = useState<ExpenseStatus | 'all'>('all');
  const [categoryId, setCategoryId]       = useState<string>('all');
  const [paymentMethod, setPaymentMethod] = useState<'all' | 'cash' | 'transfer' | 'card' | 'credit'>('all');
  const [dateFrom, setDateFrom]           = useState<string>('');
  const [dateTo, setDateTo]               = useState<string>('');
  const [search, setSearch]               = useState<string>('');

  const filters = useMemo<ExpensesListFilters>(
    () => ({
      status,
      categoryId,
      paymentMethod,
      ...(dateFrom !== '' ? { dateFrom } : {}),
      ...(dateTo   !== '' ? { dateTo }   : {}),
      ...(search.trim() !== '' ? { search } : {}),
    }),
    [status, categoryId, paymentMethod, dateFrom, dateTo, search],
  );

  const list    = useExpensesList(filters);
  const allList = useExpensesList({ status: 'all' });
  const cats    = useExpenseCategories();

  const rows = list.data ?? [];
  const kpi  = useMemo(() => aggregate(allList.data ?? []), [allList.data]);

  const columns: ReadonlyArray<DataTableColumn<ExpenseRow>> = useMemo(() => [
    {
      id:    'date',
      header: 'Date',
      width: '120px',
      render: (r) => <span className="tabular-nums text-text-secondary">{r.expense_date}</span>,
    },
    {
      id:    'number',
      header: 'Number',
      width: '160px',
      render: (r) => (
        <Link
          to={`/backoffice/expenses/${r.id}`}
          className="font-mono text-xs text-gold hover:underline"
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
      render: (r) => <span className="tabular-nums">Rp {formatIdr(Number(r.amount ?? 0))}</span>,
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
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl text-text-primary">Expenses</h1>
              <p className="mt-1 text-sm text-text-secondary">Manage and track your bakery&apos;s expenditure.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" disabled aria-label="Export (coming soon)">
                <Download className="h-4 w-4" aria-hidden /> Export
              </Button>
              {canCreate && (
                <Button asChild variant="gold">
                  <Link to="/backoffice/expenses/new">
                    <Plus className="h-4 w-4" aria-hidden /> New expense
                  </Link>
                </Button>
              )}
            </div>
          </header>

          <section
            className="grid grid-cols-1 gap-4 md:grid-cols-4"
            aria-label="Expense totals"
          >
            <KpiTile
              label="Total Expenses"
              value={kpi.totalAmount}
              valueFormat="currency"
              icon={Coins}
              footer="Approved + paid"
            />
            <KpiTile
              label="Pending"
              value={kpi.pendingCount}
              icon={Clock}
              footer="Awaiting approval"
            />
            <KpiTile
              label="Monthly Count"
              value={kpi.monthlyCount}
              icon={Calendar}
              footer="This month"
            />
            <KpiTile
              label="Avg Expense"
              value={kpi.avgAmount}
              valueFormat="currency"
              icon={Calculator}
              footer="Per transaction"
            />
          </section>

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
                className="h-10 w-full rounded-md border border-border-subtle bg-bg-input pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
              />
            </div>
            <select
              id="exp-cat"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label="Category filter"
              className="h-10 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
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
              className="h-10 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
            >
              <option value="all">All methods</option>
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="card">Card</option>
              <option value="credit">Credit</option>
            </select>
            <input
              id="exp-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="From date"
              className="h-10 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
            />
            <input
              id="exp-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="To date"
              className="h-10 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Status filter">
            {STATUS_FILTERS.map((q) => {
              const isActive = status === q.value;
              return (
                <Button
                  key={q.value}
                  type="button"
                  variant={isActive ? 'gold' : 'ghost'}
                  size="sm"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setStatus(q.value)}
                >
                  {q.label}
                </Button>
              );
            })}
          </div>

          {list.error !== null && list.error !== undefined ? (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              Failed to load expenses: {list.error.message}
            </div>
          ) : (
            <DataTable
              data-testid="expenses-table"
              columns={columns}
              rows={rows}
              getRowKey={(r) => r.id}
              isLoading={list.isLoading}
              emptyState={
                <div className="px-6 py-12 text-center">
                  <Receipt className="mx-auto h-10 w-10 text-text-muted" aria-hidden />
                  <h3 className="mt-3 font-display italic text-xl text-text-primary">No expenses found</h3>
                  <p className="mx-auto mt-1 max-w-prose text-sm text-text-secondary">
                    {canCreate
                      ? 'Capture your first operational expense to start tracking spend.'
                      : 'Operational expenses will appear here once a manager records them.'}
                  </p>
                  {canCreate && (
                    <div className="mt-4">
                      <Button asChild variant="gold">
                        <Link to="/backoffice/expenses/new">
                          <Plus className="h-4 w-4" aria-hidden /> Add first expense
                        </Link>
                      </Button>
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
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
      <table className="w-full text-sm">
        <thead className="border-b border-border-subtle bg-bg-base/40">
          <tr>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-widest text-text-muted">Code</th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-widest text-text-muted">Name</th>
            <th className="px-4 py-3 text-left text-xs uppercase tracking-widest text-text-muted">Account</th>
            <th className="px-4 py-3 text-center text-xs uppercase tracking-widest text-text-muted">Status</th>
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
      <div className="border-t border-border-subtle px-4 py-2 text-[11px] text-text-muted">
        Categories are read-only — no expense_category CRUD RPC ships in this session.
      </div>
    </div>
  );
}
