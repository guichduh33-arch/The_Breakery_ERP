// apps/backoffice/src/pages/Suppliers.tsx
//
// Session 14 / Phase 5.A — Supplier Management.
// Composition mirrors `15-suppliers-list.jpg`:
//   - Fraunces title + subtitle on the left, secondary actions
//     (Categories / Template / Import / Export) and primary CTA on the right.
//   - Three KPI tiles: TOTAL / ACTIVE / INACTIVE.
//   - Free-text search bar.
//   - Card grid (responsive 1/2/3/4 columns) of SupplierCard.
//   - Empty/error states via EmptyState v2.
// Categories / Template / Import / Export aren't backed by RPCs — they appear
// as disabled affordances so the surface matches the reference visual without
// promising features that don't exist in the DB.

import { useMemo, useState, type JSX } from 'react';
import {
  Building2,
  CheckCircle2,
  Download,
  FileText,
  Plus,
  Search,
  Tag,
  Upload,
  XCircle,
} from 'lucide-react';
import { Button, EmptyState, KpiTile } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { SupplierCard } from '@/features/suppliers/components/SupplierCard.js';
import { SupplierDeleteConfirm } from '@/features/suppliers/components/SupplierDeleteConfirm.js';
import { SupplierFormModal } from '@/features/suppliers/components/SupplierFormModal.js';
import { useUpdateSupplier } from '@/features/suppliers/hooks/useUpdateSupplier.js';
import {
  useSuppliersList,
  type ActiveFilter,
  type SupplierRow,
  type SuppliersListFilters,
} from '@/features/suppliers/hooks/useSuppliersList.js';
import { ImportEntityModal } from '@/features/data-import/components/ImportEntityModal.js';
import { buildTemplateWorkbook, buildExportWorkbook, downloadWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { suppliersImportDef } from '@/features/suppliers/import/suppliersImportDef.js';

interface SuppliersKpi {
  total:    number;
  active:   number;
  inactive: number;
}

function aggregate(rows: ReadonlyArray<SupplierRow>): SuppliersKpi {
  const acc: SuppliersKpi = { total: rows.length, active: 0, inactive: 0 };
  for (const r of rows) {
    if (r.is_active) acc.active += 1;
    else acc.inactive += 1;
  }
  return acc;
}

export default function SuppliersPage(): JSX.Element {
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

  const list      = useSuppliersList(filters);
  const updateMut = useUpdateSupplier();

  // We always need the unfiltered KPI counts independent of search.
  const allList = useSuppliersList({ active: 'all' });
  const kpi     = useMemo(() => aggregate(allList.data ?? []), [allList.data]);

  const [creating, setCreating] = useState(false);
  const [editing,  setEditing]  = useState<SupplierRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<SupplierRow | undefined>(undefined);
  const [importing, setImporting] = useState(false);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view suppliers.</div>;
  }

  function handleToggleActive(row: SupplierRow): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }

  function handleTemplate(): void {
    downloadWorkbook(buildTemplateWorkbook(suppliersImportDef), 'breakery-suppliers-template.xlsx');
  }
  function handleExport(): void {
    downloadWorkbook(
      buildExportWorkbook(suppliersImportDef, allList.data ?? []),
      `breakery-suppliers-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }

  const rows = list.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-text-primary">Supplier Management</h1>
          <p className="mt-1 text-sm text-text-secondary">Manage your suppliers and their contact information.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" disabled aria-label="Categories (coming soon)">
            <Tag className="h-4 w-4" aria-hidden /> Categories
          </Button>
          <Button variant="ghost" size="sm" onClick={handleTemplate} aria-label="Download suppliers template">
            <FileText className="h-4 w-4" aria-hidden /> Template
          </Button>
          {canCreate && (
            <Button variant="ghost" size="sm" onClick={() => setImporting(true)} aria-label="Import suppliers">
              <Upload className="h-4 w-4" aria-hidden /> Import
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleExport} aria-label="Export suppliers">
            <Download className="h-4 w-4" aria-hidden /> Export
          </Button>
          {canCreate && (
            <Button type="button" variant="gold" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Add new supplier
            </Button>
          )}
        </div>
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
        aria-label="Supplier totals"
      >
        <KpiTile
          label="Total Suppliers"
          value={kpi.total}
          icon={Building2}
        />
        <KpiTile
          label="Active"
          value={kpi.active}
          icon={CheckCircle2}
        />
        <KpiTile
          label="Inactive"
          value={kpi.inactive}
          icon={XCircle}
        />
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3">
        <div className="relative flex-1 min-w-[16rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            id="sup-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search suppliers, categories, or contact person..."
            maxLength={64}
            aria-label="Search suppliers"
            className="h-10 w-full rounded-md border border-border-subtle bg-bg-input pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
          />
        </div>
        <select
          id="sup-active"
          value={active}
          onChange={(e) => setActive(e.target.value as ActiveFilter)}
          aria-label="Status filter"
          className="h-10 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {list.error !== null && list.error !== undefined ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed to load suppliers: {list.error.message}
        </div>
      ) : list.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={`sup-skeleton-${i}`}
              className="h-28 animate-pulse rounded-lg border border-border-subtle bg-bg-elevated"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          tone="branded"
          title="No suppliers match the current filters"
          description={
            canCreate
              ? 'Add your first supplier to start drafting purchase orders.'
              : 'A manager must add suppliers before purchase orders can be created.'
          }
          {...(canCreate
            ? { action: { label: 'Add new supplier', onClick: () => setCreating(true) } }
            : {})}
        />
      ) : (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          data-testid="suppliers-grid"
        >
          {rows.map((row) => (
            <SupplierCard
              key={row.id}
              row={row}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onEdit={setEditing}
              onToggleActive={handleToggleActive}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      <SupplierFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <SupplierFormModal
        open={editing !== undefined}
        mode="edit"
        {...(editing !== undefined ? { initial: editing } : {})}
        onClose={() => setEditing(undefined)}
      />
      <SupplierDeleteConfirm
        open={deleting !== undefined}
        row={deleting}
        onClose={() => setDeleting(undefined)}
      />
      <ImportEntityModal
        open={importing}
        onClose={() => setImporting(false)}
        def={suppliersImportDef}
        title="Import suppliers"
        description="Upload a filled .xlsx template. Existing codes are updated; new codes are created. The file is validated before any writes."
      />
    </div>
  );
}
