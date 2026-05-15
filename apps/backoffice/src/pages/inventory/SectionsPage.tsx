// apps/backoffice/src/pages/inventory/SectionsPage.tsx
// Session 14 / Phase 4.C — sections CRUD page, rewritten on top of DataTable
// + KpiTile primitives. Sections back every section-aware stock movement so
// we surface a quick health pulse (active count by kind) at the top.

import { useMemo, useState, type JSX } from 'react';
import { Edit2, Layers, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  KpiTile,
  type DataTableColumn,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useSectionsList,
  useSoftDeleteSection,
  type SectionRow,
} from '@/features/sections/hooks/useSectionsList.js';
import { SectionFormModal } from '@/features/sections/components/SectionFormModal.js';

interface SectionKpi {
  total:      number;
  active:     number;
  warehouse:  number;
  production: number;
  sales:      number;
}

function aggregate(rows: ReadonlyArray<SectionRow>): SectionKpi {
  const acc: SectionKpi = { total: rows.length, active: 0, warehouse: 0, production: 0, sales: 0 };
  for (const r of rows) {
    if (r.is_active) acc.active += 1;
    if (r.kind === 'warehouse')  acc.warehouse  += 1;
    if (r.kind === 'production') acc.production += 1;
    if (r.kind === 'sales')      acc.sales      += 1;
  }
  return acc;
}

export default function SectionsPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('inventory.sections.update');

  const list       = useSectionsList();
  const softDelete = useSoftDeleteSection();
  const [editing,  setEditing ] = useState<SectionRow | null>(null);
  const [creating, setCreating] = useState<boolean>(false);

  const rows = list.data ?? [];
  const kpi  = useMemo(() => aggregate(rows), [rows]);

  function handleDelete(id: string): void {
    // eslint-disable-next-line no-alert
    if (!confirm('Soft-delete this section? Existing references stay intact ; the section just stops appearing in pickers.')) return;
    softDelete.mutate({ id });
  }

  const columns: ReadonlyArray<DataTableColumn<SectionRow>> = useMemo(() => {
    const base: DataTableColumn<SectionRow>[] = [
      {
        id: 'code',
        header: 'Code',
        width: '120px',
        render: (r) => <span className="font-mono text-xs text-text-secondary">{r.code}</span>,
      },
      {
        id: 'name',
        header: 'Name',
        render: (r) => <span className="font-medium text-text-primary">{r.name}</span>,
      },
      {
        id: 'kind',
        header: 'Kind',
        width: '140px',
        render: (r) => (
          <Badge variant={r.kind === 'production' ? 'default' : r.kind === 'warehouse' ? 'outline' : 'secondary'}>
            {r.kind}
          </Badge>
        ),
      },
      {
        id: 'order',
        header: 'Order',
        align: 'right',
        width: '100px',
        render: (r) => <span className="font-mono">{r.display_order}</span>,
      },
      {
        id: 'active',
        header: 'Active',
        width: '100px',
        render: (r) =>
          r.is_active ? (
            <span className="text-xs text-success">Active</span>
          ) : (
            <span className="text-xs text-text-muted">Inactive</span>
          ),
      },
    ];
    if (canWrite) {
      base.push({
        id: 'actions',
        header: '',
        align: 'right',
        width: '100px',
        render: (r) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(r); }} aria-label={`Edit ${r.name}`}>
              <Edit2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { handleDelete(r.id); }} aria-label={`Delete ${r.name}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ),
      });
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-text-primary">Sections</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Physical zones (warehouse, production kitchen, sales front) referenced
            by every section-aware stock movement.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => { setCreating(true); }}>
            <Plus className="h-4 w-4" aria-hidden /> New section
          </Button>
        )}
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-4"
        aria-label="Section totals"
      >
        <KpiTile
          label="Sections"
          value={kpi.total}
          icon={Layers}
          footer={`${kpi.active} active`}
        />
        <KpiTile label="Warehouse"  value={kpi.warehouse}  />
        <KpiTile label="Production" value={kpi.production} />
        <KpiTile label="Sales"      value={kpi.sales}      />
      </section>

      {list.error !== null ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed to load sections: {String(list.error)}
        </div>
      ) : (
        <DataTable
          data-testid="sections-table"
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.id}
          isLoading={list.isLoading}
          emptyTitle="No sections defined"
          emptyDescription={
            canWrite
              ? 'Add a section to start posting stock movements against a physical zone.'
              : 'A manager must add sections before stock can be tracked.'
          }
        />
      )}

      {creating && (
        <SectionFormModal onClose={() => { setCreating(false); }} />
      )}
      {editing !== null && (
        <SectionFormModal initial={editing} onClose={() => { setEditing(null); }} />
      )}
    </div>
  );
}
