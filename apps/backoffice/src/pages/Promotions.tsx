// apps/backoffice/src/pages/Promotions.tsx
//
// Session 14 / Phase 5.B — Promotions BO list rebuild on top of the new
// design-system primitives (KpiTile / Card / DataTable). The behaviour is
// unchanged — only the chrome moves to the canonical pattern.
//
// Mirrors `combo 2.jpg` for the surface treatment (KPI tiles + filter card +
// table). Promotions modals (PromotionFormModal + PromotionDeleteConfirm)
// are reused as-is from Session 9.
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md
//   §1 BO1–BO3, §4.5 + Session 14 spec D-W6-PROMO-01.

import { useMemo, useState, type JSX } from 'react';
import {
  ChevronDown,
  Pencil,
  Percent,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  KpiTile,
  PromotionTypeBadge,
  type DataTableColumn,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { PromotionDeleteConfirm } from '@/features/promotions/components/PromotionDeleteConfirm.js';
import { PromotionFormModal } from '@/features/promotions/components/PromotionFormModal.js';
import { useUpdatePromotion } from '@/features/promotions/hooks/useUpdatePromotion.js';
import {
  usePromotionsList,
  type PromotionListRow,
  type PromotionsListFilters,
} from '@/features/promotions/hooks/usePromotionsList.js';

type TypeFilter = 'all' | 'percentage' | 'fixed_amount' | 'bogo' | 'free_product';
type ActiveFilter = 'all' | 'active' | 'inactive';

const TYPE_OPTIONS: ReadonlyArray<{ value: TypeFilter; label: string }> = [
  { value: 'all',           label: 'Type: All' },
  { value: 'percentage',    label: 'Percentage' },
  { value: 'fixed_amount',  label: 'Fixed amount' },
  { value: 'bogo',          label: 'BOGO' },
  { value: 'free_product',  label: 'Free product' },
];

const STATUS_OPTIONS: ReadonlyArray<{ value: ActiveFilter; label: string }> = [
  { value: 'all',      label: 'Status: All' },
  { value: 'active',   label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

interface PromoStats {
  total:    number;
  active:   number;
  bogo:     number;
  discount: number;
}

function summarise(rows: ReadonlyArray<PromotionListRow>): PromoStats {
  let active = 0;
  let bogo = 0;
  let discount = 0;
  for (const r of rows) {
    if (r.is_active) active += 1;
    if (r.type === 'bogo') bogo += 1;
    if (r.type === 'percentage' || r.type === 'fixed_amount') discount += 1;
  }
  return { total: rows.length, active, bogo, discount };
}

export default function PromotionsPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('promotions.read');
  const canCreate = hasPermission('promotions.create');
  const canUpdate = hasPermission('promotions.update');
  const canDelete = hasPermission('promotions.delete');

  const [typeFilter,   setTypeFilter  ] = useState<TypeFilter>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [startDate,    setStartDate   ] = useState<string>('');
  const [endDate,      setEndDate     ] = useState<string>('');
  const [editing,      setEditing     ] = useState<PromotionListRow | undefined>(undefined);
  const [creating,     setCreating    ] = useState(false);
  const [deleting,     setDeleting    ] = useState<PromotionListRow | undefined>(undefined);

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

  const stats = useMemo(() => summarise(list.data ?? []), [list.data]);

  if (!canRead) {
    return (
      <div className="text-text-secondary">
        You do not have permission to view promotions.
      </div>
    );
  }

  function handleToggleActive(row: PromotionListRow): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }

  const columns: ReadonlyArray<DataTableColumn<PromotionListRow>> = [
    {
      id:     'name',
      header: 'Promotion',
      width:  '32%',
      render: (row) => (
        <div className="leading-tight">
          <div className="font-semibold text-text-primary">{row.name}</div>
          <div className="font-mono text-xs text-text-secondary">{row.slug}</div>
        </div>
      ),
    },
    {
      id:     'type',
      header: 'Type',
      align:  'center',
      render: (row) => <PromotionTypeBadge type={row.type} />,
    },
    {
      id:     'scope',
      header: 'Scope',
      align:  'center',
      render: (row) => (
        <span className="text-xs uppercase tracking-wide text-text-secondary">
          {row.scope ?? '—'}
        </span>
      ),
    },
    {
      id:     'priority',
      header: 'Priority',
      align:  'right',
      render: (row) => <span className="font-mono text-sm">{row.priority}</span>,
    },
    {
      id:     'status',
      header: 'Status',
      align:  'center',
      render: (row) => (
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={row.is_active}
            disabled={!canUpdate}
            onChange={() => handleToggleActive(row)}
            aria-label={`Toggle ${row.name} active`}
            className="accent-gold"
          />
          <span
            className={[
              'text-[10px] font-semibold uppercase tracking-widest',
              row.is_active ? 'text-success' : 'text-text-secondary',
            ].join(' ')}
          >
            {row.is_active ? 'Active' : 'Inactive'}
          </span>
        </label>
      ),
    },
    {
      id:     'actions',
      header: '',
      align:  'right',
      width:  '180px',
      render: (row) => (
        <div className="inline-flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canUpdate}
            onClick={() => setEditing(row)}
            aria-label={`Edit ${row.name}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
          </Button>
          {canDelete && (
            <Button
              type="button"
              variant="ghostDestructive"
              size="sm"
              onClick={() => setDeleting(row)}
              aria-label={`Delete ${row.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-text-primary">Promotions</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Manage automatic discounts (percentage / fixed amount / BOGO / free product).
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New promotion
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={Tag} label="Total promotions" value={stats.total} valueFormat="number" />
        <KpiTile icon={Sparkles} label="Active right now" value={stats.active} valueFormat="number" />
        <KpiTile icon={Zap} label="BOGO" value={stats.bogo} valueFormat="number" />
        <KpiTile icon={Percent} label="Discount" value={stats.discount} valueFormat="number" footer="Percentage + fixed amount" />
      </div>

      <Card variant="default" padding="sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <FilterField
            id="filter-type"
            label="Type"
            value={typeFilter}
            options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => setTypeFilter(v as TypeFilter)}
          />
          <FilterField
            id="filter-active"
            label="Status"
            value={activeFilter}
            options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => setActiveFilter(v as ActiveFilter)}
          />
          <DateField
            id="filter-start"
            label="Created from"
            value={startDate}
            onChange={setStartDate}
          />
          <DateField
            id="filter-end"
            label="Created to"
            value={endDate}
            onChange={setEndDate}
          />
        </div>
      </Card>

      {list.error !== null && list.error !== undefined ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed: {list.error.message}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={list.data ?? []}
          getRowKey={(r) => r.id}
          isLoading={list.isLoading}
          emptyTitle="No promotions"
          emptyDescription="Adjust the filters or create a new promotion."
          data-testid="promotions-table"
        />
      )}

      <PromotionFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
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

interface FilterFieldProps {
  id:       string;
  label:    string;
  value:    string;
  options:  ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string) => void;
}

function FilterField({ id, label, value, options, onChange }: FilterFieldProps): JSX.Element {
  return (
    <label htmlFor={id} className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-base px-3">
      <span className="sr-only">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full bg-transparent text-sm text-text-primary outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden />
    </label>
  );
}

interface DateFieldProps {
  id:       string;
  label:    string;
  value:    string;
  onChange: (next: string) => void;
}

function DateField({ id, label, value, onChange }: DateFieldProps): JSX.Element {
  return (
    <label htmlFor={id} className="flex flex-col">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">{label}</span>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
      />
    </label>
  );
}
