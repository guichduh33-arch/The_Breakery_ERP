// apps/backoffice/src/pages/Loyalty.tsx
//
// Programme de fidélité — instance de l'archétype LIST. La bande de compteurs
// `ListCounterStrip` remplace les tuiles à icônes (DESIGN.md § Tuile de KPI :
// sans icône) ; les compteurs de palier SONT les filtres, et le palier actif
// vit dans l'URL (`?tier=`) pour que le retour arrière rende la liste qu'on
// regardait (audit Sales 2026-11-21).
//
// Les mutations passent toujours par les modales existantes
// (CustomerFormModal / LoyaltyAdjustModal / CustomerDeleteConfirm /
// LoyaltyHistoryDrawer).

import { useMemo, useState, type JSX } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { LoyaltyBadge, useDebouncedValue, type DataTableColumn } from '@breakery/ui';
import { Card, DataTable } from '@/components/BackofficeUi.js';
import { tierFromLifetime } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import { CustomerAvatar } from '@/features/customers/components/CustomerAvatar.js';
import { CustomerFormModal } from '@/features/loyalty/components/CustomerFormModal.js';
import { CustomerDeleteConfirm } from '@/features/loyalty/components/CustomerDeleteConfirm.js';
import { LoyaltyHistoryDrawer } from '@/features/loyalty/components/LoyaltyHistoryDrawer.js';
import { LoyaltyAdjustModal } from '@/features/loyalty/components/LoyaltyAdjustModal.js';
import {
  useLoyaltyCustomersList,
  LOYALTY_FETCH_CAP,
  type CustomerListRow as Row,
  type LoyaltyCustomersFilters,
  type TierFilter,
} from '@/features/loyalty/hooks/useLoyaltyCustomersList.js';
import { useLoyaltyStats } from '@/features/loyalty/hooks/useLoyaltyStats.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { PageHeader } from '@/components/PageHeader.js';
import { Breadcrumb } from '@/components/Breadcrumb.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { useListParams } from '@/hooks/useListParams.js';
import { RowActionsMenu } from '@/components/RowActionsMenu.js';

// Le cran du Command Palette et de la liste clients — le dépôt n'en a qu'un.
const SEARCH_DEBOUNCE_MS = 250;

const TIER_OPTIONS: readonly { value: TierFilter; label: string }[] = [
  { value: 'all',      label: 'Tier: All' },
  { value: 'bronze',   label: 'Bronze' },
  { value: 'silver',   label: 'Silver' },
  { value: 'gold',     label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

function isTier(v: string | null): v is Exclude<TierFilter, 'all'> {
  return v === 'bronze' || v === 'silver' || v === 'gold' || v === 'platinum';
}

function formatLastVisit(iso: string | null): string {
  if (iso === null) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function LoyaltyPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('loyalty.read');
  const canAdjust = hasPermission('loyalty.adjust');
  const canCreate = hasPermission('customers.create');
  const canUpdate = hasPermission('customers.update');
  const canDelete = hasPermission('customers.delete');

  const [search, setSearch] = useState<string>('');
  const [params, patchParams] = useListParams();
  const tierRaw = params.get('tier');
  // Une valeur inconnue dans l'URL retombe sur « tous », jamais en filtre serveur.
  const tier: TierFilter = isTier(tierRaw) ? tierRaw : 'all';
  const pickTier = (next: TierFilter): void => { patchParams({ tier: next === 'all' ? null : next }); };

  // La saisie vit en local ; seule la valeur POSÉE atteint les filtres. Poussée
  // à la frappe, elle changeait la `queryKey` à chaque caractère et lançait donc
  // une requête PostgREST par touche. Même cran que la liste clients.
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const filters = useMemo<LoyaltyCustomersFilters>(
    () => ({ ...(debouncedSearch !== '' ? { search: debouncedSearch } : {}), tier }),
    [debouncedSearch, tier],
  );

  const list  = useLoyaltyCustomersList(filters);
  const stats = useLoyaltyStats();
  const rows  = list.data?.rows ?? [];
  // Le verdict de troncature vient du HOOK (qui demande CAP+1 lignes) et non
  // d'un `rows.length >= CAP` : un jeu filtré de PILE 500 membres est complet,
  // et la comparaison lui collait quand même la note « refine the search ».
  const capped = list.data?.capped ?? false;

  const [creating,  setCreating ] = useState(false);
  const [editing,   setEditing  ] = useState<Row | undefined>(undefined);
  const [viewing,   setViewing  ] = useState<Row | undefined>(undefined);
  const [adjusting, setAdjusting] = useState<Row | undefined>(undefined);
  const [deleting,  setDeleting ] = useState<Row | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view loyalty.</div>;
  }

  // Tirets, jamais 0, tant que les compteurs ne sont pas connus.
  const s = stats.data;
  const unknown = stats.isError || s === undefined;
  const num = (n: number | undefined): string => (unknown || n === undefined ? '—' : n.toLocaleString('id-ID'));
  const counters: ListCounter[] = [
    { id: 'all', label: 'All members', value: num(s?.members), onSelect: () => { pickTier('all'); } },
    { id: 'bronze', label: 'Bronze', value: num(s?.bronze), onSelect: () => { pickTier('bronze'); } },
    { id: 'silver', label: 'Silver', value: num(s?.silver), onSelect: () => { pickTier('silver'); } },
    { id: 'gold', label: 'Gold', value: num(s?.gold), onSelect: () => { pickTier('gold'); } },
    { id: 'platinum', label: 'Platinum', value: num(s?.platinum), onSelect: () => { pickTier('platinum'); } },
    { id: 'points', label: 'Points outstanding', value: num(s?.totalPoints), title: 'Sum of current balances — every member, not the filter.' },
    { id: 'lifetime', label: 'Lifetime points earned', value: num(s?.lifetimePoints), title: 'Every member, not the filter.' },
  ];

  const columns: readonly DataTableColumn<Row>[] = [
    {
      id:     'customer',
      header: 'Member',
      width:  '32%',
      render: (row) => (
        <button
          type="button"
          onClick={() => setViewing(row)}
          className="flex items-center gap-3 text-left transition-colors duration-fast hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          aria-label={`View loyalty history for ${row.name}`}
        >
          <CustomerAvatar name={row.name} />
          <div className="leading-tight">
            <div className="font-medium text-text-primary">{row.name}</div>
            {row.phone !== null && (
              <div className="text-xs text-text-secondary">{row.phone}</div>
            )}
          </div>
        </button>
      ),
    },
    {
      id:     'tier',
      header: 'Tier',
      align:  'center',
      render: (row) => (
        <LoyaltyBadge
          tier={tierFromLifetime(row.lifetime_points)}
          points={row.loyalty_points}
        />
      ),
    },
    {
      id:     'balance',
      header: 'Balance',
      align:  'right',
      render: (row) => <span className="font-mono text-sm">{row.loyalty_points.toLocaleString('id-ID')}</span>,
    },
    {
      id:     'lifetime',
      header: 'Lifetime',
      align:  'right',
      render: (row) => (
        <span className="font-mono text-sm text-text-secondary">
          {row.lifetime_points.toLocaleString('id-ID')}
        </span>
      ),
    },
    {
      id:     'last',
      header: 'Last visit',
      align:  'right',
      render: (row) => (
        <span className="text-xs text-text-secondary">{formatLastVisit(row.last_visit_at)}</span>
      ),
    },
    {
      id:     'actions',
      header: '',
      align:  'right',
      width:  '60px',
      // Le menu partagé du back-office : panneau hors du tableau (il était
      // rogné sur les dernières lignes), Échap, clic extérieur et flèches.
      render: (row) => (
        <RowActionsMenu
          subject={row.name}
          testId={`loyalty-actions-${row.id}`}
          entries={[
            { key: 'view', label: 'View history', activate: () => { setViewing(row); } },
            ...(canAdjust ? [{ key: 'adjust', label: 'Adjust points', activate: () => { setAdjusting(row); } }] : []),
            ...(canUpdate ? [{ key: 'edit', label: 'Edit', activate: () => { setEditing(row); } }] : []),
            ...(canDelete ? [{ key: 'delete', label: 'Delete', danger: true, activate: () => { setDeleting(row); } }] : []),
          ]}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      <Breadcrumb items={[{ label: 'Sales' }, { label: 'Loyalty' }]} />
      <PageHeader
        title="Loyalty"
        subtitle="Retail members, balances and ledger."
        actions={canCreate ? (
          <button type="button" onClick={() => setCreating(true)} className={TOOLBAR_BTN_PRIMARY}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New member
          </button>
        ) : undefined}
      />

      {stats.isError && (
        <QueryErrorBanner
          detail={stats.error.message}
          onRetry={() => { void stats.refetch(); }}
          data-testid="loyalty-counters-error"
        >
          Member counts could not be loaded.
        </QueryErrorBanner>
      )}
      <ListCounterStrip
        counters={counters}
        activeId={tier}
        ariaLabel="Loyalty tier filters"
        data-testid="loyalty-counters"
      />

      <Card variant="default" padding="sm">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex flex-1 items-center gap-2 min-w-[12rem] text-text-secondary">
            <Search className="h-4 w-4" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              maxLength={64}
              aria-label="Search members"
              className={`h-9 w-full rounded-md bg-transparent text-sm text-text-primary placeholder:text-text-muted ${FOCUS_RING}`}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="sr-only">Tier filter</span>
            <select
              aria-label="Tier filter"
              value={tier}
              onChange={(e) => { pickTier(isTier(e.target.value) ? e.target.value : 'all'); }}
              className={`h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
            >
              {TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden />
          </label>
        </div>
      </Card>

      {list.isError ? (
        <QueryErrorBanner
          detail={list.error.message}
          onRetry={() => { void list.refetch(); }}
          data-testid="loyalty-error"
        >
          Loyalty members could not be loaded.
        </QueryErrorBanner>
      ) : (
        // Le conteneur porte l'écart de la note à sa table : posé sur la note
        // elle-même, la gouttière du conteneur de page l'emporterait.
        <div className="space-y-2">
          <DataTable
            caption="Member, tier, point balance, lifetime points and last visit per loyalty member"
            columns={columns}
            rows={rows}
            getRowKey={(r) => r.id}
            isLoading={list.isLoading}
            emptyTitle="No members match"
            emptyDescription="Adjust the filters or create a new member."
            data-testid="loyalty-table"
          />
          {/* La table n'a pas de pied : sans cette ligne, la borne haute de la
              requête tronquerait la liste EN SILENCE et l'écran se lirait comme
              exhaustif. */}
          {capped && (
            <p
              role="status"
              className="font-data text-xs tabular-nums text-text-muted"
              data-testid="loyalty-truncated"
            >
              First {LOYALTY_FETCH_CAP.toLocaleString('id-ID')} loaded — refine the search or tier filter to see the rest.
            </p>
          )}
        </div>
      )}

      <CustomerFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <CustomerFormModal
        open={editing !== undefined}
        mode="edit"
        {...(editing !== undefined ? { initial: editing } : {})}
        onClose={() => setEditing(undefined)}
      />
      <LoyaltyHistoryDrawer customer={viewing} onClose={() => setViewing(undefined)} />
      <LoyaltyAdjustModal customer={adjusting} onClose={() => setAdjusting(undefined)} />
      <CustomerDeleteConfirm customer={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
