// apps/backoffice/src/pages/Promotions.tsx
//
// Liste des promotions — instance de l'archétype LIST, régime BORNÉ (chargée
// en entier) : la bande de compteurs `ListCounterStrip` remplace les tuiles à
// icônes (DESIGN.md § Tuile de KPI : sans icône), et l'état de liste — type,
// statut, dates — vit dans l'URL (audit Sales 2026-11-21). Les modales
// (PromotionFormModal, PromotionDeleteConfirm, PromotionActivateConfirm) sont
// inchangées.

import { useEffect, useMemo, useState, type JSX } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PromotionTypeBadge, type DataTableColumn } from '@breakery/ui';
import { Button, Card, DataTable } from '@/components/BackofficeUi.js';
import { useAuthStore } from '@/stores/authStore.js';
import { PromotionDeleteConfirm } from '@/features/promotions/components/PromotionDeleteConfirm.js';
import { PromotionFormModal } from '@/features/promotions/components/PromotionFormModal.js';
import { useUpdatePromotion } from '@/features/promotions/hooks/useUpdatePromotion.js';
import {
  usePromotionsList,
  type PromotionListRow,
  type PromotionsListFilters,
} from '@/features/promotions/hooks/usePromotionsList.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { FOCUS_WITHIN_RING } from '@/components/focusRing.js';
import { PageHeader } from '@/components/PageHeader.js';
import { Breadcrumb } from '@/components/Breadcrumb.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { useListParams } from '@/hooks/useListParams.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { PromotionActivateConfirm } from '@/features/promotions/components/PromotionActivateConfirm.js';
import {
  PROMOTION_TYPES,
  PROMOTION_TYPE_LABEL,
  PROMOTION_WINDOW_LABEL,
  isPromotionType,
  promotionValueText,
  promotionWindowState,
  promotionWindowText,
  summarisePromotions,
  type PromotionTypeEnum,
  type PromotionWindowState,
} from '@/features/promotions/promotionSummary.js';

// Le filtre de type dérive de l'enum Postgres : `threshold` et `bundle`
// manquaient à la liste recopiée à la main (audit Sales 2026-11-21).
type TypeFilter = 'all' | PromotionTypeEnum;
type ActiveFilter = 'all' | 'active' | 'inactive';

const TYPE_OPTIONS: readonly { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Type: All' },
  ...PROMOTION_TYPES.map((t) => ({ value: t, label: PROMOTION_TYPE_LABEL[t] })),
];

const WINDOW_TONE: Record<PromotionWindowState, string> = {
  live:      'text-success',
  always:    'text-success',
  scheduled: 'text-warning',
  expired:   'text-text-muted',
};

/** Horloge de la page, rafraîchie chaque minute : « Live » ne se fige pas. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); }, 60_000);
    return () => { clearInterval(id); };
  }, []);
  return now;
}

const STATUS_OPTIONS: readonly { value: ActiveFilter; label: string }[] = [
  { value: 'all',      label: 'Status: All' },
  { value: 'active',   label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

// L'état de liste vit dans l'URL (DESIGN.md § List) : `type`, `status`, `from`,
// `to`. Une valeur inconnue — lien ancien, saisie à la main — retombe sur le
// défaut au lieu de partir en filtre serveur.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function readDay(raw: string | null): string {
  if (raw === null || !ISO_DAY.test(raw)) return '';
  // Le motif laisse passer `2026-99-99` : la date doit exister au calendrier.
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : '';
}


export default function PromotionsPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('promotions.read');
  const canCreate = hasPermission('promotions.create');
  const canUpdate = hasPermission('promotions.update');
  const canDelete = hasPermission('promotions.delete');

  const [params, patchParams] = useListParams();
  const typeRaw = params.get('type') ?? '';
  const typeFilter: TypeFilter = isPromotionType(typeRaw) ? typeRaw : 'all';
  const statusRaw = params.get('status');
  const activeFilter: ActiveFilter = statusRaw === 'active' || statusRaw === 'inactive' ? statusRaw : 'all';
  const startDate = readDay(params.get('from'));
  const endDate = readDay(params.get('to'));
  const [editing,      setEditing     ] = useState<PromotionListRow | undefined>(undefined);
  const [creating,     setCreating    ] = useState(false);
  const [deleting,     setDeleting    ] = useState<PromotionListRow | undefined>(undefined);
  const [activating,   setActivating  ] = useState<PromotionListRow | undefined>(undefined);
  const now = useMinuteClock();

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
  // Les compteurs portent sur TOUTES les promotions, jamais sur le filtre de table.
  const all = usePromotionsList();
  const updateMut = useUpdatePromotion();

  const stats = useMemo(() => summarisePromotions(all.data ?? [], now), [all.data, now]);
  // Tirets, jamais 0, tant que le compte n'est pas connu : un « 0 live » pendant
  // le chargement ou après un échec se lit comme un fait.
  const countsUnknown = all.isError || all.data === undefined;
  const shown = (n: number): number | string => (countsUnknown ? '—' : n);
  const counters: ListCounter[] = [
    {
      id: 'all',
      label: 'All promotions',
      value: shown(stats.total),
      onSelect: () => { patchParams({ type: null, status: null }); },
    },
    {
      id: 'live',
      label: 'Live now',
      value: shown(stats.liveNow),
      ...(!countsUnknown && stats.liveNow > 0 ? { tone: 'success' as const } : {}),
      title: stats.scheduled > 0
        ? `Active and within dates · ${stats.scheduled} scheduled`
        : 'Active and within dates',
    },
    {
      id: 'scheduled',
      label: 'Scheduled',
      value: shown(stats.scheduled),
      ...(!countsUnknown && stats.scheduled > 0 ? { tone: 'warning' as const } : {}),
      title: 'Active, but their start date is still ahead.',
    },
    {
      id: 'bogo',
      label: 'BOGO',
      value: shown(stats.bogo),
      onSelect: () => { patchParams({ type: 'bogo' }); },
    },
    {
      id: 'discount',
      label: 'Discount',
      value: shown(stats.discount),
      title: 'Percentage + fixed amount',
    },
  ];
  const activeCounter = typeFilter === 'bogo'
    ? 'bogo'
    : typeFilter === 'all' && activeFilter === 'all' ? 'all' : null;

  if (!canRead) {
    return (
      <div className="text-text-secondary">
        You do not have permission to view promotions.
      </div>
    );
  }

  // Activer une promotion change les prix à la caisse en plein service : le
  // résultat se dit, l'échec surtout. Avant, un refus (droits, réseau) laissait
  // la case revenir en silence et l'opérateur croyait la promotion active.
  // L'ACTIVATION passe par une confirmation (décision 2026-11-21) ; la
  // désactivation reste directe.
  function handleToggleActive(row: PromotionListRow): void {
    if (row.is_active) setActive(row, false);
    else setActivating(row);
  }

  function setActive(row: PromotionListRow, next: boolean): void {
    updateMut.mutate(
      { id: row.id, values: { is_active: next } },
      {
        onSuccess: () => {
          if (next) setActivating(undefined);
          toast.success(next ? `${row.name} is now active.` : `${row.name} is now inactive.`);
        },
        onError: (err) => {
          toast.error(`${row.name} could not be ${next ? 'activated' : 'deactivated'}: ${err.message}`);
        },
      },
    );
  }

  const columns: readonly DataTableColumn<PromotionListRow>[] = [
    {
      id:     'name',
      header: 'Promotion',
      width:  '24%',
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
      id:     'value',
      header: 'Value',
      align:  'right',
      render: (row) => (
        <span className="whitespace-nowrap font-data text-sm tabular-nums text-text-primary">{promotionValueText(row)}</span>
      ),
    },
    {
      id:     'window',
      header: 'Window',
      render: (row) => {
        const state = promotionWindowState(row, now);
        return (
          <div className="leading-tight">
            <div className={`font-data text-xs font-semibold uppercase tracking-widest ${WINDOW_TONE[state]}`}>
              {PROMOTION_WINDOW_LABEL[state]}
            </div>
            <div className="font-data text-xs tabular-nums text-text-secondary">{promotionWindowText(row)}</div>
            {typeof row.max_uses === 'number' && (
              <div className="text-xs text-text-muted">Max {row.max_uses.toLocaleString('id-ID')} uses</div>
            )}
          </div>
        );
      },
    },
    {
      id:     'scope',
      header: 'Scope',
      align:  'center',
      render: (row) => (
        <span className="font-data font-semibold text-xs uppercase tracking-wide text-text-secondary">
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
            disabled={!canUpdate || (updateMut.isPending && updateMut.variables?.id === row.id)}
            onChange={() => handleToggleActive(row)}
            aria-label={`Toggle ${row.name} active`}
            className={`accent-gold ${FOCUS_RING}`}
          />
          <span
            className={[
              'font-data text-xs font-semibold uppercase tracking-widest',
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
    <div className="flex flex-col gap-[13px]">
      <Breadcrumb items={[{ label: 'Sales' }, { label: 'Promotions' }]} />
      <PageHeader
        title="Promotions"
        subtitle="Manage automatic discounts applied at the POS."
        actions={canCreate ? (
          <button type="button" onClick={() => setCreating(true)} className={TOOLBAR_BTN_PRIMARY}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New promotion
          </button>
        ) : undefined}
      />

      {all.isError && (
        <QueryErrorBanner
          detail={all.error.message}
          onRetry={() => { void all.refetch(); }}
          data-testid="promotions-counters-error"
        >
          Promotion counts could not be loaded.
        </QueryErrorBanner>
      )}
      <ListCounterStrip
        counters={counters}
        activeId={activeCounter}
        ariaLabel="Promotion filters"
        data-testid="promotions-counters"
      />

      <Card variant="default" padding="sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <FilterField
            id="filter-type"
            label="Type"
            value={typeFilter}
            options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => { patchParams({ type: isPromotionType(v) ? v : null }); }}
          />
          <FilterField
            id="filter-active"
            label="Status"
            value={activeFilter}
            options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => { patchParams({ status: v === 'active' || v === 'inactive' ? v : null }); }}
          />
          <DateField
            id="filter-start"
            label="Created from"
            value={startDate}
            onChange={(v) => { patchParams({ from: readDay(v) }); }}
          />
          <DateField
            id="filter-end"
            label="Created to"
            value={endDate}
            onChange={(v) => { patchParams({ to: readDay(v) }); }}
          />
        </div>
      </Card>

      {list.isError ? (
        <QueryErrorBanner
          detail={list.error.message}
          onRetry={() => { void list.refetch(); }}
          data-testid="promotions-error"
        >
          Promotions could not be loaded.
        </QueryErrorBanner>
      ) : (
        <DataTable
          caption="Promotion, type, value, date window, scope, priority and status per promotion"
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
      <PromotionActivateConfirm
        row={activating}
        pending={updateMut.isPending}
        onConfirm={(row) => { setActive(row, true); }}
        onClose={() => setActivating(undefined)}
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
  options:  readonly { value: string; label: string }[];
  onChange: (next: string) => void;
}

function FilterField({ id, label, value, options, onChange }: FilterFieldProps): JSX.Element {
  return (
    <label htmlFor={id} className={`flex items-center gap-2 rounded-md border border-border-subtle bg-bg-base px-3 ${FOCUS_WITHIN_RING}`}>
      <span className="sr-only">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full bg-transparent text-sm text-text-primary focus-visible:outline-none"
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
      <span className="font-data px-1 text-xs font-semibold uppercase tracking-widest text-text-muted">{label}</span>
      <input
        id={id}
        type="date" lang="id-ID"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
      />
    </label>
  );
}
