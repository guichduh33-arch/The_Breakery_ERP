// apps/backoffice/src/features/settings/expense-thresholds/ExpenseThresholdsPage.tsx
// S28 — wave 5.F — Settings page for expense approval thresholds.
// Route: /settings/expense-thresholds
// Native HTML element pattern: @breakery/ui has no Table/Select/Input exports for forms.

import { useState, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useExpenseThresholds, type ExpenseThresholdRow } from './hooks/useExpenseThresholds.js';
import { useDeleteExpenseThreshold } from './hooks/useDeleteExpenseThreshold.js';
import { useExpenseCategories } from '@/features/expenses/hooks/useExpensesList.js';
import { ThresholdFormDialog } from './ThresholdFormDialog.js';
import { useAuthStore } from '@/stores/authStore.js';

const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function formatRange(min: number, max: number): string {
  return `${IDR.format(min)} – ${IDR.format(max)}`;
}

export default function ExpenseThresholdsPage(): JSX.Element {
  const thresholds    = useExpenseThresholds();
  const categories    = useExpenseCategories();
  const deleteMut     = useDeleteExpenseThreshold();
  const canWrite      = useAuthStore((s) => s.hasPermission('expenses.thresholds.write'));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]       = useState<ExpenseThresholdRow | null>(null);

  function openCreate(): void {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(row: ExpenseThresholdRow): void {
    setEditing(row);
    setDialogOpen(true);
  }

  async function handleDelete(row: ExpenseThresholdRow): Promise<void> {
    const label = row.category_name ?? 'All categories';
    const confirmed = window.confirm(
      `Delete threshold "${label}" (${formatRange(row.amount_min, row.amount_max)})? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await deleteMut.mutateAsync(row.id);
    } catch {
      // errors surface via deleteMut.error
    }
  }

  const rows = thresholds.data ?? [];
  const cats = (categories.data ?? []).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Expense Thresholds</h1>
          <p className="text-sm text-text-secondary italic">
            Configure approval chains by amount bracket and category. Changes apply to new expenses
            only — in-flight expenses keep their original approval chain.
          </p>
        </div>
        {canWrite && (
          <Button
            onClick={openCreate}
            className="inline-flex items-center gap-2"
            data-testid="new-threshold-btn"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New threshold
          </Button>
        )}
      </div>

      {/* Loading */}
      {thresholds.isLoading && (
        <p className="text-sm text-text-secondary">Loading…</p>
      )}

      {/* Error */}
      {thresholds.isError && (
        <p className="text-sm text-red" data-testid="threshold-list-error">
          {(thresholds.error as Error).message}
        </p>
      )}

      {/* Delete error */}
      {deleteMut.isError && (
        <p className="text-sm text-red" data-testid="delete-threshold-error">
          {(deleteMut.error as Error).message}
        </p>
      )}

      {/* Empty state */}
      {!thresholds.isLoading && rows.length === 0 && (
        <p className="text-sm text-text-secondary" data-testid="threshold-empty">
          No thresholds configured yet. Add one to start enforcing approval chains.
        </p>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-hidden">
          <table className="w-full text-sm" data-testid="threshold-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Amount range (IDR)</th>
                <th className="px-3 py-2">Steps</th>
                <th className="px-3 py-2">Roles required</th>
                {canWrite && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`threshold-row-${row.id}`}
                  className="border-t border-border-subtle"
                >
                  <td className="px-3 py-2">
                    {row.category_name ?? (
                      <span className="italic text-text-secondary">All categories</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatRange(row.amount_min, row.amount_max)}
                  </td>
                  <td className="px-3 py-2">
                    {row.steps.length === 0 ? (
                      <span className="text-text-secondary italic">Auto-approve</span>
                    ) : (
                      <span>{row.steps.length}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.steps.length === 0 ? (
                      <span className="text-text-secondary italic">—</span>
                    ) : (
                      <span className="text-xs">
                        {[...new Set(row.steps.flatMap((s) => s.role_codes))].join(', ')}
                      </span>
                    )}
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(row)}
                          data-testid={`edit-threshold-${row.id}`}
                          className="inline-flex items-center gap-1"
                        >
                          <Pencil className="h-3 w-3" aria-hidden />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { void handleDelete(row); }}
                          disabled={deleteMut.isPending}
                          data-testid={`delete-threshold-${row.id}`}
                          className="inline-flex items-center gap-1 text-red hover:text-red"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                          Delete
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <ThresholdFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        categories={cats}
      />
    </div>
  );
}
