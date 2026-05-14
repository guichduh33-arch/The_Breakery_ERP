// apps/backoffice/src/pages/inventory/OpnameListPage.tsx
// Session 14 / Phase 4.C — paginated list of opname (stock-count) sessions,
// rewritten against the `stock opname.jpg` screenshot family.
//
// Header → KPI tile row (open / in review / finalized this month) → status
// filter → DataTable. Empty + loading states delegated to DataTable / EmptyState.

import { useMemo, useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, CheckCircle2, Loader2, Plus } from 'lucide-react';
import {
  Button,
  DataTable,
  KpiTile,
  type DataTableColumn,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useOpnameList,
  type OpnameListRow,
  type OpnameStatus,
} from '@/features/inventory-opname/hooks/useOpnameList.js';
import { OpnameStatusBadge } from '@/features/inventory-opname/components/OpnameStatusBadge.js';
import { CreateOpnameModal } from '@/features/inventory-opname/components/CreateOpnameModal.js';

const STATUS_OPTIONS: ReadonlyArray<{ value: '' | OpnameStatus; label: string }> = [
  { value: '',          label: 'All statuses' },
  { value: 'draft',     label: 'Draft' },
  { value: 'counting',  label: 'Counting' },
  { value: 'review',    label: 'Review' },
  { value: 'finalized', label: 'Finalized' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface OpnameKpi {
  open:           number;
  review:         number;
  finalizedMonth: number;
}

function aggregateRows(rows: ReadonlyArray<OpnameListRow>): OpnameKpi {
  const monthStart = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  })();
  const acc: OpnameKpi = { open: 0, review: 0, finalizedMonth: 0 };
  for (const r of rows) {
    if (r.status === 'draft' || r.status === 'counting') acc.open += 1;
    if (r.status === 'review') acc.review += 1;
    if (r.status === 'finalized' && r.finalized_at !== null && r.finalized_at >= monthStart) {
      acc.finalizedMonth += 1;
    }
  }
  return acc;
}

const COLUMNS: ReadonlyArray<DataTableColumn<OpnameListRow>> = [
  {
    id: 'count_number',
    header: 'Count #',
    width: '180px',
    render: (r) => (
      <Link
        to={`/backoffice/inventory/opname/${r.id}`}
        className="font-mono text-sm text-gold transition-colors duration-fast hover:underline"
      >
        {r.count_number}
      </Link>
    ),
  },
  {
    id: 'section',
    header: 'Section',
    render: (r) => (
      <span className="text-text-primary">{r.section?.name ?? '—'}</span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    width: '140px',
    render: (r) => <OpnameStatusBadge status={r.status} />,
  },
  {
    id: 'started',
    header: 'Started',
    width: '200px',
    render: (r) => (
      <span className="font-mono text-xs text-text-secondary">
        {new Date(r.started_at).toLocaleString()}
      </span>
    ),
  },
  {
    id: 'notes',
    header: 'Notes',
    render: (r) => (
      <span className="text-xs text-text-secondary line-clamp-1">{r.notes ?? ''}</span>
    ),
  },
];

export default function OpnameListPage(): JSX.Element {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission('inventory.opname.create');

  const [statusFilter, setStatusFilter] = useState<'' | OpnameStatus>('');
  const [createOpen,   setCreateOpen  ] = useState<boolean>(false);

  const list = useOpnameList({
    ...(statusFilter !== '' ? { status: statusFilter } : {}),
  });

  const rows = list.data ?? [];
  const kpi  = useMemo(() => aggregateRows(rows), [rows]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-text-primary">Stock counts</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Periodic counts compared against the section_stock cache. Finalizing
            emits adjustment movements and balanced journal entries.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => { setCreateOpen(true); }}>
            <Plus className="h-4 w-4" aria-hidden /> New count
          </Button>
        )}
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
        aria-label="Opname totals"
      >
        <KpiTile
          label="In progress"
          value={kpi.open}
          icon={Loader2}
          footer="Draft + counting"
        />
        <KpiTile
          label="Awaiting review"
          value={kpi.review}
          icon={ClipboardList}
        />
        <KpiTile
          label="Finalized this month"
          value={kpi.finalizedMonth}
          icon={CheckCircle2}
        />
      </section>

      <div className="flex items-center gap-3">
        <label htmlFor="opname-status-filter" className="text-xs uppercase tracking-widest text-text-secondary">
          Status
        </label>
        <select
          id="opname-status-filter"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as '' | OpnameStatus); }}
          className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {list.error !== null ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed to load counts: {String(list.error)}
        </div>
      ) : (
        <DataTable
          data-testid="opname-list-table"
          columns={COLUMNS}
          rows={rows}
          getRowKey={(r) => r.id}
          isLoading={list.isLoading}
          emptyTitle="No counts yet"
          emptyDescription={
            canCreate
              ? 'Open a new count to start recording physical-vs-system variances.'
              : 'Once a count is opened by a manager, it will appear here.'
          }
        />
      )}

      {createOpen && (
        <CreateOpnameModal
          onCreated={(id) => {
            setCreateOpen(false);
            navigate(`/backoffice/inventory/opname/${id}`);
          }}
          onClose={() => { setCreateOpen(false); }}
        />
      )}
    </div>
  );
}
