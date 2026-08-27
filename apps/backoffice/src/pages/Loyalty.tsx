// apps/backoffice/src/pages/Loyalty.tsx
//
// Session 14 / Phase 5.B — Loyalty BO page rebuild on top of the new
// design-system primitives (KpiTile / Card / DataTable). The visual
// reference is `customer.jpg` (loyalty members are retail customers
// with points) — same KPI / filter / table chrome as CustomersListPage.
//
// Behaviour stays the same as the previous list:
//   - search by name / phone prefix
//   - tier filter (bronze / silver / gold / platinum)
//   - row actions: view history, adjust points, edit, delete (gated by
//     the existing permission codes).
//
// All mutations still flow through the existing modals
// (CustomerFormModal / LoyaltyAdjustModal / CustomerDeleteConfirm /
// LoyaltyHistoryDrawer) — only the page chrome changed.

import { useId, useMemo, useState, type JSX } from 'react';
import {
  Award,
  ChevronDown,
  Heart,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  KpiTile,
  LoyaltyBadge,
  useDebouncedValue,
  type DataTableColumn,
} from '@breakery/ui';
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

// Le cran du Command Palette et de la liste clients — le dépôt n'en a qu'un.
const SEARCH_DEBOUNCE_MS = 250;

const TIER_OPTIONS: readonly { value: TierFilter; label: string }[] = [
  { value: 'all',      label: 'Tier: All' },
  { value: 'bronze',   label: 'Bronze' },
  { value: 'silver',   label: 'Silver' },
  { value: 'gold',     label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

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
  const [tier,   setTier  ] = useState<TierFilter>('all');

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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view loyalty.</div>;
  }

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
      render: (row) => (
        <RowActions
          row={row}
          isOpen={openMenuId === row.id}
          onToggle={() => setOpenMenuId(openMenuId === row.id ? null : row.id)}
          canAdjust={canAdjust}
          canEdit={canUpdate}
          canDelete={canDelete}
          onView={(r) => { setOpenMenuId(null); setViewing(r); }}
          onAdjust={(r) => { setOpenMenuId(null); setAdjusting(r); }}
          onEdit={(r) => { setOpenMenuId(null); setEditing(r); }}
          onDelete={(r) => { setOpenMenuId(null); setDeleting(r); }}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        className="items-start"
        title="Loyalty"
        subtitle="Retail members, balances and ledger."
        actions={canCreate ? (
          <button type="button" onClick={() => setCreating(true)} className={TOOLBAR_BTN_PRIMARY}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New member
          </button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={Heart} label="Total members" value={stats.data?.members ?? 0} valueFormat="number" />
        <KpiTile icon={Sparkles} label="Points outstanding" value={stats.data?.totalPoints ?? 0} valueFormat="number" footer="Sum of current balances" />
        <KpiTile icon={TrendingUp} label="Lifetime points earned" value={stats.data?.lifetimePoints ?? 0} valueFormat="number" />
        <KpiTile
          icon={Award}
          label="Premium tiers"
          value={(stats.data?.gold ?? 0) + (stats.data?.platinum ?? 0)}
          valueFormat="number"
          footer={`${stats.data?.silver ?? 0} silver • ${stats.data?.gold ?? 0} gold • ${stats.data?.platinum ?? 0} platinum`}
        />
      </div>

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
              onChange={(e) => setTier(e.target.value as TierFilter)}
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

      {list.error !== null && list.error !== undefined ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
          Failed: {list.error.message}
        </div>
      ) : (
        // Le conteneur porte l'écart de la note à sa table : posé sur la note
        // elle-même, `space-y-6` du conteneur de page l'emporterait.
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

interface RowActionsProps {
  row:        Row;
  isOpen:     boolean;
  onToggle:   () => void;
  canAdjust:  boolean;
  canEdit:    boolean;
  canDelete:  boolean;
  onView:     (r: Row) => void;
  onAdjust:   (r: Row) => void;
  onEdit:     (r: Row) => void;
  onDelete:   (r: Row) => void;
}

function RowActions({
  row, isOpen, onToggle, canAdjust, canEdit, canDelete,
  onView, onAdjust, onEdit, onDelete,
}: RowActionsProps): JSX.Element {
  const panelId = useId();
  return (
    <div className="relative inline-block">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggle}
        aria-label={`Actions for ${row.name}`}
        // Pas d'`aria-haspopup="menu"` : cette valeur PROMET le patron menu de
        // l'APG (tabindex tournant, ↑/↓, Début/Fin, saisie prédictive), et seul
        // Tab a jamais fonctionné ici. Le panneau est un DISCLOSURE —
        // `aria-expanded` + `aria-controls` décrivent exactement ce qu'il fait,
        // et les entrées gardent leur rôle natif `button`. Même arbitrage, pour
        // la même raison, que les onglets de la TopBar (voir son en-tête) et
        // que le menu d'export des rapports.
        aria-expanded={isOpen}
        {...(isOpen ? { 'aria-controls': panelId } : {})}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      {isOpen && (
        <div
          id={panelId}
          role="group"
          aria-label={`Actions for ${row.name}`}
          className="absolute right-0 mt-1 w-44 rounded-md border border-border-subtle bg-bg-elevated shadow-lg z-10"
        >
          <MenuItem onClick={() => onView(row)}>View history</MenuItem>
          {canAdjust && <MenuItem onClick={() => onAdjust(row)}>Adjust points</MenuItem>}
          {canEdit   && <MenuItem onClick={() => onEdit(row)}>Edit</MenuItem>}
          {canDelete && <MenuItem onClick={() => onDelete(row)} tone="danger">Delete</MenuItem>}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children, onClick, tone,
}: { children: React.ReactNode; onClick: () => void; tone?: 'danger' }): JSX.Element {
  return (
    // Pas de `role="menuitem"` : hors d'un vrai patron menu il ne décrit rien
    // et retire au bouton son rôle natif. Le panneau est un disclosure, ses
    // entrées sont des boutons — voir l'en-tête de `RowActions`.
    <button
      type="button"
      onClick={onClick}
      className={[
        // `bg-surface-4` et non `bg-bg-overlay` : dans le thème clair
        // `--bg-overlay`, `--bg-elevated` et `--bg-input` valent TOUS #ffffff.
        // Sur le panneau blanc du menu, survol et focus repeignaient donc du
        // blanc sur du blanc — ratio 1,000:1, aucun retour visible. Et
        // `focus:outline-none` était posé sans remplaçant : au clavier, rien ne
        // disait quelle entrée était sélectionnée, Delete compris (WCAG 2.4.7).
        `block w-full px-3 py-2 text-left text-sm transition-colors duration-fast hover:bg-surface-4 focus:bg-surface-4 ${FOCUS_RING}`,
        tone === 'danger' ? 'text-danger' : 'text-text-primary',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
