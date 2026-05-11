// apps/backoffice/src/pages/Promotions.tsx
//
// Backoffice promotions list. Filterable by type/active/date-range. Hosts the
// create/edit modal and soft-delete confirmation. RLS handles real auth at
// the DB layer; UI permission checks are UX only (gate buttons).
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §1 BO1-BO3, §4.5

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { PromotionDeleteConfirm } from '@/features/promotions/components/PromotionDeleteConfirm.js';
import { PromotionFormModal } from '@/features/promotions/components/PromotionFormModal.js';
import { PromotionListRow } from '@/features/promotions/components/PromotionListRow.js';
import { useUpdatePromotion } from '@/features/promotions/hooks/useUpdatePromotion.js';
import {
  usePromotionsList,
  type PromotionListRow as PromotionListRowType,
  type PromotionsListFilters,
} from '@/features/promotions/hooks/usePromotionsList.js';

type TypeFilter = 'all' | 'percentage' | 'fixed_amount' | 'bogo' | 'free_product';
type ActiveFilter = 'all' | 'active' | 'inactive';

export default function PromotionsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission('promotions.read');
  const canCreate = hasPermission('promotions.create');
  const canUpdate = hasPermission('promotions.update');
  const canDelete = hasPermission('promotions.delete');

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const filters = useMemo<PromotionsListFilters>(
    () => ({
      type: typeFilter,
      active: activeFilter,
      startDate: startDate === '' ? null : startDate,
      endDate: endDate === '' ? null : endDate,
    }),
    [typeFilter, activeFilter, startDate, endDate],
  );

  const list = usePromotionsList(filters);
  const updateMut = useUpdatePromotion();

  const [editing, setEditing] = useState<PromotionListRowType | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PromotionListRowType | undefined>(undefined);

  if (!canRead) {
    return (
      <div className="text-text-secondary">
        You do not have permission to view promotions.
      </div>
    );
  }

  function handleToggleActive(row: PromotionListRowType): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Promotions</h1>
          <p className="text-text-secondary text-sm mt-1">
            Manage automatic discounts (percentage / fixed / BOGO / free product).
          </p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New promotion
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1">
          <label htmlFor="filter-type" className="text-xs uppercase tracking-widest text-text-secondary">
            Type
          </label>
          <select
            id="filter-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="all">All types</option>
            <option value="percentage">Percentage</option>
            <option value="fixed_amount">Fixed amount</option>
            <option value="bogo">BOGO</option>
            <option value="free_product">Free product</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="filter-active" className="text-xs uppercase tracking-widest text-text-secondary">
            Status
          </label>
          <select
            id="filter-active"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="filter-start" className="text-xs uppercase tracking-widest text-text-secondary">
            Created from
          </label>
          <input
            id="filter-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="filter-end" className="text-xs uppercase tracking-widest text-text-secondary">
            Created to
          </label>
          <input
            id="filter-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 w-32">Type</th>
              <th className="text-left px-4 py-3 w-24">Scope</th>
              <th className="text-right px-4 py-3 w-24">Priority</th>
              <th className="text-center px-4 py-3 w-32">Status</th>
              <th className="text-right px-4 py-3 w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td className="px-4 py-6 text-text-secondary" colSpan={6}>
                  Loading…
                </td>
              </tr>
            )}
            {list.error && (
              <tr>
                <td className="px-4 py-6 text-red" colSpan={6}>
                  Failed to load: {list.error.message}
                </td>
              </tr>
            )}
            {list.data?.length === 0 && !list.isLoading && (
              <tr>
                <td className="px-4 py-6 text-text-secondary" colSpan={6}>
                  No promotions match the current filters.
                </td>
              </tr>
            )}
            {list.data?.map((row) => (
              <PromotionListRow
                key={row.id}
                row={row}
                canUpdate={canUpdate}
                canDelete={canDelete}
                onEdit={(r) => setEditing(r)}
                onToggleActive={handleToggleActive}
                onDelete={(r) => setDeleting(r)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <PromotionFormModal
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
      />
      <PromotionFormModal
        open={editing !== undefined}
        mode="edit"
        initialRow={editing}
        onClose={() => setEditing(undefined)}
      />
      <PromotionDeleteConfirm
        open={deleting !== undefined}
        row={deleting}
        onClose={() => setDeleting(undefined)}
      />
    </div>
  );
}
