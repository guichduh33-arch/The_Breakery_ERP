// apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx
//
// Session 14 / Phase 5.A — rewrite of the Purchase Orders list to match the
// `13-incoming-po-list.jpg` family (KPI strip + status pills + DataTable).
//
// Composition:
//   - Fraunces title + supporting copy on the left, primary CTA right.
//   - Four KPI tiles: TOTAL ORDERS / PENDING / PARTIAL / RECEIVED.
//   - Status quick-filter pills (all / pending / partial / received /
//     cancelled) + supplier select + free-text search bar.
//   - Themed DataTable (PO number link, supplier, status pill, dates,
//     total) with EmptyState v2 fallback.

import { useMemo, useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  Package,
  Plus,
  Search,
  TrendingUp,
} from 'lucide-react';
import {
  Button,
  DataTable,
  KpiTile,
  type DataTableColumn,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import {
  usePurchaseOrdersList,
  type POStatus,
  type PurchaseOrderListRow,
  type PurchaseOrdersFilters,
} from '@/features/purchasing/hooks/usePurchaseOrdersList.js';
import { POStatusBadge } from '@/features/purchasing/components/POStatusBadge.js';
import { useSuppliersList } from '@/features/suppliers/hooks/useSuppliersList.js';

interface POKpi {
  total:     number;
  pending:   number;
  partial:   number;
  received:  number;
  cancelled: number;
}

function aggregate(rows: ReadonlyArray<PurchaseOrderListRow>): POKpi {
  const acc: POKpi = { total: rows.length, pending: 0, partial: 0, received: 0, cancelled: 0 };
  for (const r of rows) {
    if (r.status === 'pending')   acc.pending   += 1;
    if (r.status === 'partial')   acc.partial   += 1;
    if (r.status === 'received')  acc.received  += 1;
    if (r.status === 'cancelled') acc.cancelled += 1;
  }
  return acc;
}

const QUICK_FILTERS: { value: POStatus | 'all'; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'pending',   label: 'Pending' },
  { value: 'partial',   label: 'Partial' },
  { value: 'received',  label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function PurchaseOrdersListPage(): JSX.Element {
  const navigate      = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('purchasing.po.read');
  const canCreate = hasPermission('purchasing.po.create');

  const [status, setStatus]         = useState<POStatus | 'all'>('all');
  const [supplierId, setSupplierId] = useState<string>('');
  const [search, setSearch]         = useState<string>('');

  const filters = useMemo<PurchaseOrdersFilters>(() => ({
    ...(status !== 'all' ? { status } : {}),
    ...(supplierId !== '' ? { supplierId } : {}),
    ...(search.trim() !== '' ? { search } : {}),
  }), [status, supplierId, search]);

  const list      = usePurchaseOrdersList(filters);
  const allList   = usePurchaseOrdersList({});
  const suppliers = useSuppliersList({ active: 'active' });

  const rows = list.data ?? [];
  const kpi  = useMemo(() => aggregate(allList.data ?? []), [allList.data]);

  const columns: ReadonlyArray<DataTableColumn<PurchaseOrderListRow>> = useMemo(() => [
    {
      id:    'po_number',
      header: 'PO Number',
      render: (r) => (
        <Link
          to={`/backoffice/purchasing/purchase-orders/${r.id}`}
          className="font-mono text-xs text-gold hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {r.po_number}
        </Link>
      ),
    },
    {
      id:    'supplier',
      header: 'Supplier',
      render: (r) => <span className="text-text-primary">{r.suppliers?.name ?? '—'}</span>,
    },
    {
      id:    'status',
      header: 'Status',
      width: '120px',
      render: (r) => <POStatusBadge status={r.status as POStatus} />,
    },
    {
      id:    'order_date',
      header: 'Order date',
      width: '120px',
      align: 'left',
      render: (r) => <span className="tabular-nums text-text-secondary">{r.order_date ?? '—'}</span>,
    },
    {
      id:    'expected_date',
      header: 'Expected',
      width: '120px',
      align: 'left',
      render: (r) => <span className="tabular-nums text-text-secondary">{r.expected_date ?? '—'}</span>,
    },
    {
      id:    'total',
      header: 'Total',
      width: '160px',
      align: 'right',
      render: (r) => <span className="tabular-nums">Rp {formatIdr(Number(r.total_amount ?? 0))}</span>,
    },
  ], []);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view purchase orders.</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-text-primary">Purchase Orders</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Track open and historical POs ; receive goods to post inventory + accounting entries.
          </p>
        </div>
        {canCreate && (
          <Button asChild variant="gold">
            <Link to="/backoffice/purchasing/purchase-orders/new">
              <Plus className="h-4 w-4" aria-hidden /> New purchase order
            </Link>
          </Button>
        )}
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-4"
        aria-label="Purchase order totals"
      >
        <KpiTile
          label="Total Orders"
          value={kpi.total}
          icon={ClipboardList}
        />
        <KpiTile
          label="Pending"
          value={kpi.pending}
          icon={Clock}
        />
        <KpiTile
          label="Partial"
          value={kpi.partial}
          icon={TrendingUp}
        />
        <KpiTile
          label="Received"
          value={kpi.received}
          icon={CheckCircle2}
        />
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3">
        <div className="relative flex-1 min-w-[16rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            id="po-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PO number…"
            maxLength={64}
            aria-label="Search purchase orders"
            className="h-10 w-full rounded-md border border-border-subtle bg-bg-input pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
          />
        </div>
        <select
          id="po-supplier"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          aria-label="Supplier filter"
          className="h-10 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
        >
          <option value="">All suppliers</option>
          {(suppliers.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Status filter">
        {QUICK_FILTERS.map((q) => {
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
          Failed to load purchase orders: {list.error.message}
        </div>
      ) : (
        <DataTable
          data-testid="po-table"
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.id}
          isLoading={list.isLoading}
          onRowClick={(row) => navigate(`/backoffice/purchasing/purchase-orders/${row.id}`)}
          emptyState={
            <div className="px-6 py-12 text-center">
              <Package className="mx-auto h-10 w-10 text-text-muted" aria-hidden />
              <h3 className="mt-3 font-display italic text-xl text-text-primary">No purchase orders yet</h3>
              <p className="mx-auto mt-1 max-w-prose text-sm text-text-secondary">
                {canCreate
                  ? 'Draft a purchase order to start tracking incoming stock and supplier balances.'
                  : 'A manager must draft a purchase order before any will appear here.'}
              </p>
              {canCreate && (
                <div className="mt-4">
                  <Button asChild variant="gold">
                    <Link to="/backoffice/purchasing/purchase-orders/new">
                      <Plus className="h-4 w-4" aria-hidden /> New purchase order
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          }
        />
      )}
    </div>
  );
}
