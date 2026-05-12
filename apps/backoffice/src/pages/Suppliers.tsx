// apps/backoffice/src/pages/Suppliers.tsx
//
// BO suppliers list. Mirrors the session 10 Loyalty page shape: filters bar,
// table, create/edit/delete modals. RLS handles real auth at the DB layer;
// UI permission checks gate the buttons.

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { SupplierDeleteConfirm } from '@/features/suppliers/components/SupplierDeleteConfirm.js';
import { SupplierFormModal } from '@/features/suppliers/components/SupplierFormModal.js';
import { SupplierListRow } from '@/features/suppliers/components/SupplierListRow.js';
import { useUpdateSupplier } from '@/features/suppliers/hooks/useUpdateSupplier.js';
import {
  useSuppliersList,
  type ActiveFilter,
  type SupplierRow,
  type SuppliersListFilters,
} from '@/features/suppliers/hooks/useSuppliersList.js';

export default function SuppliersPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('suppliers.read');
  const canCreate = hasPermission('suppliers.create');
  const canUpdate = hasPermission('suppliers.update');
  const canDelete = hasPermission('suppliers.delete');

  const [active, setActive] = useState<ActiveFilter>('all');
  const [search, setSearch] = useState<string>('');

  const filters = useMemo<SuppliersListFilters>(
    () => ({ active, ...(search.trim() !== '' ? { search } : {}) }),
    [active, search],
  );

  const list = useSuppliersList(filters);
  const updateMut = useUpdateSupplier();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<SupplierRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<SupplierRow | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view suppliers.</div>;
  }

  function handleToggleActive(row: SupplierRow): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Suppliers</h1>
          <p className="text-text-secondary text-sm mt-1">Vendors that feed the receiving flow.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New supplier
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <label htmlFor="sup-search" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input id="sup-search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or code" maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="sup-active" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select id="sup-active" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="text-left px-4 py-3 w-28">Code</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 w-40">Phone</th>
              <th className="text-left px-4 py-3 w-56">Email</th>
              <th className="text-right px-4 py-3 w-24">Terms</th>
              <th className="text-center px-4 py-3 w-32">Status</th>
              <th className="text-right px-4 py-3 w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>Loading…</td></tr>}
            {list.error && <tr><td className="px-4 py-6 text-red" colSpan={7}>Failed to load: {list.error.message}</td></tr>}
            {list.data?.length === 0 && !list.isLoading && (
              <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>No suppliers match the current filters.</td></tr>
            )}
            {list.data?.map((row) => (
              <SupplierListRow key={row.id} row={row} canUpdate={canUpdate} canDelete={canDelete}
                onEdit={setEditing} onToggleActive={handleToggleActive} onDelete={setDeleting} />
            ))}
          </tbody>
        </table>
      </div>

      <SupplierFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <SupplierFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <SupplierDeleteConfirm open={deleting !== undefined} row={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
