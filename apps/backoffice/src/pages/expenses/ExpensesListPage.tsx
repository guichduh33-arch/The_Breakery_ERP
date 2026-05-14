// apps/backoffice/src/pages/expenses/ExpensesListPage.tsx
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { ExpenseStatusBadge } from '@/features/expenses/components/ExpenseStatusBadge.js';
import {
  useExpensesList,
  useExpenseCategories,
  type ExpensesListFilters,
  type ExpenseStatus,
} from '@/features/expenses/hooks/useExpensesList.js';

const ALL_STATUSES: Array<ExpenseStatus | 'all'> = ['all', 'draft', 'submitted', 'approved', 'rejected', 'paid'];

function formatIdr(n: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n);
}

export default function ExpensesListPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead    = hasPermission('expenses.read');
  const canCreate  = hasPermission('expenses.create');

  const [status,        setStatus]        = useState<ExpenseStatus | 'all'>('all');
  const [categoryId,    setCategoryId]    = useState<string>('all');
  const [paymentMethod, setPaymentMethod] = useState<'all' | 'cash' | 'transfer' | 'card' | 'credit'>('all');
  const [dateFrom,      setDateFrom]      = useState<string>('');
  const [dateTo,        setDateTo]        = useState<string>('');
  const [search,        setSearch]        = useState<string>('');

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

  const list = useExpensesList(filters);
  const cats = useExpenseCategories();

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view expenses.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Expenses</h1>
          <p className="text-text-secondary text-sm mt-1">Manage and approve operational expenses.</p>
        </div>
        {canCreate && (
          <Button asChild variant="primary">
            <Link to="/backoffice/expenses/new">
              <Plus className="h-4 w-4" aria-hidden /> New expense
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <label htmlFor="exp-search" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input id="exp-search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Description, vendor, number" maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="exp-status" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select id="exp-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="exp-cat" className="text-xs uppercase tracking-widest text-text-secondary">Category</label>
          <select id="exp-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="all">All</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="exp-pm" className="text-xs uppercase tracking-widest text-text-secondary">Method</label>
          <select id="exp-pm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="all">All</option>
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="card">Card</option>
            <option value="credit">Credit</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="exp-from" className="text-xs uppercase tracking-widest text-text-secondary">From</label>
          <input id="exp-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="exp-to" className="text-xs uppercase tracking-widest text-text-secondary">To</label>
          <input id="exp-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
      </div>

      <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="text-left  px-4 py-3 w-36">Date</th>
              <th className="text-left  px-4 py-3 w-44">Number</th>
              <th className="text-left  px-4 py-3">Description</th>
              <th className="text-right px-4 py-3 w-36">Amount</th>
              <th className="text-left  px-4 py-3 w-32">Method</th>
              <th className="text-center px-4 py-3 w-28">Status</th>
              <th className="text-right px-4 py-3 w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>Loading…</td></tr>}
            {list.error !== null && list.error !== undefined && (
              <tr><td className="px-4 py-6 text-red" colSpan={7}>Failed: {list.error.message}</td></tr>
            )}
            {list.data?.length === 0 && !list.isLoading && (
              <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>No expenses match the current filters.</td></tr>
            )}
            {list.data?.map((row) => (
              <tr key={row.id} className="border-t border-border-subtle hover:bg-bg-overlay">
                <td className="px-4 py-2 whitespace-nowrap">{row.expense_date}</td>
                <td className="px-4 py-2 font-mono text-xs">{row.expense_number}</td>
                <td className="px-4 py-2">{row.description}</td>
                <td className="px-4 py-2 text-right font-mono">{formatIdr(Number(row.amount))}</td>
                <td className="px-4 py-2 capitalize">{row.payment_method}</td>
                <td className="px-4 py-2 text-center"><ExpenseStatusBadge status={row.status} /></td>
                <td className="px-4 py-2 text-right">
                  <Link to={`/backoffice/expenses/${row.id}`} className="text-gold hover:underline text-xs">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
