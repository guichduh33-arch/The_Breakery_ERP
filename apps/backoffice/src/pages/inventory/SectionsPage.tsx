// apps/backoffice/src/pages/inventory/SectionsPage.tsx
// Session 14 / Phase 4.C — sections CRUD page, on top of DataTable + KpiTile.
//
// ADR-027 — l'écran est recentré sur les STATIONS DE PRODUCTION. Les sections
// ne portent plus de stock : elles ne servent qu'au routage de la page
// Production et à l'affectation produit↔station. La liste ne montre donc que
// `kind === 'production'` ; les sections warehouse / sales d'époque survivent en
// base (le ledger historique les référence, FK RESTRICT) mais n'ont plus rien à
// faire ici, et il n'est plus possible d'en créer.

import { useMemo, useState, type JSX } from 'react';
import { Edit2, Factory, Plus, Trash2, ChevronRight } from 'lucide-react';
import {
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
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';

interface StationKpi {
  total:  number;
  active: number;
}

function aggregate(rows: readonly SectionRow[]): StationKpi {
  const acc: StationKpi = { total: rows.length, active: 0 };
  for (const r of rows) {
    if (r.is_active) acc.active += 1;
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

  const rows = useMemo(
    () => (list.data ?? []).filter((r) => r.kind === 'production'),
    [list.data],
  );
  const kpi = useMemo(() => aggregate(rows), [rows]);

  function handleDelete(id: string): void {
    // eslint-disable-next-line no-alert
    if (!confirm('Soft-delete this station? Existing references stay intact; the station just stops appearing in pickers.')) return;
    softDelete.mutate({ id });
  }

  const columns: readonly DataTableColumn<SectionRow>[] = useMemo(() => {
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
      {/* Critique 2026-08-31 — comptabilité et inventaire étaient les seuls
          domaines sans fil d'Ariane. Motif recopié d'OrdersListPage, en ligne :
          en extraire un composant partagé serait une décision d'architecture. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Stock</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Stations</span>
      </nav>

      <PageHeader
        className="items-start gap-4"
        title="Production stations"
        subtitle="Where production is recorded — kitchen, pastry, bar. Stations route the Production screen and carry the product↔station assignment; they hold no stock."
        actions={canWrite ? (
          <Button variant="ink" onClick={() => { setCreating(true); }}>
            <Plus className="h-4 w-4" aria-hidden /> New station
          </Button>
        ) : undefined}
      />

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        aria-label="Station totals"
      >
        <KpiTile
          label="Stations"
          value={kpi.total}
          icon={Factory}
          footer={`${kpi.active} active`}
        />
      </section>

      {list.error !== null ? (
        <QueryErrorBanner
          detail={errorDetailText(list.error)}
          onRetry={() => { void list.refetch(); }}
          data-testid="sections-error"
        >
          Stations could not be loaded — the table is withheld rather than shown
          empty, which would read as “no station exists”.
        </QueryErrorBanner>
      ) : (
        <DataTable
          caption="Code, name, display order and active status per inventory section"
          data-testid="sections-table"
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.id}
          isLoading={list.isLoading}
          emptyTitle="No stations defined"
          emptyDescription={
            canWrite
              ? 'Add a station to start recording production against it.'
              : 'A manager must add stations before production can be recorded.'
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
