// apps/backoffice/src/features/accounting/pages/ChartOfAccountsPage.tsx
// Session 26b / Wave 1.E — Chart of Accounts cockpit page.
// Gate route : accounting.coa.read ; toggle gated par accounting.coa.write.

import { useMemo, useState, type JSX } from 'react';
import { Button, EmptyState, Input } from '@breakery/ui';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader.js';
import {
  useChartOfAccounts,
  type AccountRow,
} from '@/features/accounting/hooks/useChartOfAccounts.js';
import { useUpdateAccountActive } from '@/features/accounting/hooks/useUpdateAccountActive.js';
import { useAuthStore } from '@/stores/authStore.js';

const CLASS_LABELS: Record<number, string> = {
  1: 'Asset',
  2: 'Liability',
  3: 'Equity',
  4: 'Revenue',
  5: 'COGS',
  6: 'Expense',
};

export default function ChartOfAccountsPage(): JSX.Element {
  const accounts = useChartOfAccounts();
  const toggle = useUpdateAccountActive();
  const canWrite = useAuthStore((s) => s.hasPermission('accounting.coa.write'));

  const [classFilter, setClassFilter] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [toggleError, setToggleError] = useState<string | null>(null);

  const filtered = useMemo<AccountRow[]>(() => {
    const rows = accounts.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (classFilter !== 'all' && r.account_class !== classFilter) return false;
      if (q === '') return true;
      return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    });
  }, [accounts.data, classFilter, search]);

  function handleToggle(row: AccountRow) {
    setToggleError(null);
    toggle.mutate(
      { accountId: row.id, isActive: !row.is_active },
      {
        onError: (err) => setToggleError(err.message),
      },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chart of Accounts"
        subtitle={
          <span className="italic">
            {filtered.length} of {accounts.data?.length ?? 0} accounts
            {canWrite ? ' — toggle active inline' : ' — read-only (no write permission)'}
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Search code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="coa-search"
        />
        <select
          value={classFilter === 'all' ? 'all' : String(classFilter)}
          onChange={(e) =>
            setClassFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
          }
          className="rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-sm"
          data-testid="coa-class-filter"
        >
          <option value="all">All classes</option>
          {Object.entries(CLASS_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {k} — {label}
            </option>
          ))}
        </select>
      </div>

      {toggleError !== null && (
        <div
          role="alert"
          className="rounded border border-red bg-red-soft px-3 py-2 text-sm text-red"
        >
          Toggle failed: {toggleError}
        </div>
      )}

      {accounts.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {!accounts.isLoading && filtered.length === 0 && (
        <EmptyState
          size="sm"
          icon={FileText}
          title="No accounts"
          description="No accounts match filters."
        />
      )}

      {filtered.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-hidden">
          <table className="w-full text-sm" data-testid="coa-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Balance type</th>
                <th className="px-3 py-2 text-center">Active</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`coa-row-${row.code}`}
                  className="border-t border-border-subtle"
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {CLASS_LABELS[row.account_class] ?? row.account_class}
                  </td>
                  <td className="px-3 py-2 text-xs uppercase tracking-widest text-text-secondary">
                    {row.balance_type}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                        row.is_active
                          ? 'bg-success-soft text-success'
                          : 'bg-bg-overlay text-text-muted'
                      }`}
                      aria-label={row.is_active ? 'Active' : 'Inactive'}
                    >
                      {row.is_active ? '✓' : '✗'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggle(row)}
                      disabled={!canWrite || toggle.isPending}
                      data-testid={`coa-toggle-${row.code}`}
                    >
                      {row.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
