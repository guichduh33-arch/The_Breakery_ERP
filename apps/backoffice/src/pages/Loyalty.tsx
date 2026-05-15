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

import { useMemo, useState, type JSX } from 'react';
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
  type CustomerListRow as Row,
  type LoyaltyCustomersFilters,
  type TierFilter,
} from '@/features/loyalty/hooks/useLoyaltyCustomersList.js';
import { useLoyaltyStats } from '@/features/loyalty/hooks/useLoyaltyStats.js';

const TIER_OPTIONS: ReadonlyArray<{ value: TierFilter; label: string }> = [
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

  const filters = useMemo<LoyaltyCustomersFilters>(
    () => ({ ...(search !== '' ? { search } : {}), tier }),
    [search, tier],
  );

  const list  = useLoyaltyCustomersList(filters);
  const stats = useLoyaltyStats();

  const [creating,  setCreating ] = useState(false);
  const [editing,   setEditing  ] = useState<Row | undefined>(undefined);
  const [viewing,   setViewing  ] = useState<Row | undefined>(undefined);
  const [adjusting, setAdjusting] = useState<Row | undefined>(undefined);
  const [deleting,  setDeleting ] = useState<Row | undefined>(undefined);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view loyalty.</div>;
  }

  const columns: ReadonlyArray<DataTableColumn<Row>> = [
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
      render: (row) => <span className="font-mono text-sm">{row.loyalty_points.toLocaleString()}</span>,
    },
    {
      id:     'lifetime',
      header: 'Lifetime',
      align:  'right',
      render: (row) => (
        <span className="font-mono text-sm text-text-secondary">
          {row.lifetime_points.toLocaleString()}
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-text-primary">Loyalty</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Retail members, balances and ledger.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New member
          </Button>
        )}
      </header>

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
              className="h-9 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="sr-only">Tier filter</span>
            <select
              aria-label="Tier filter"
              value={tier}
              onChange={(e) => setTier(e.target.value as TierFilter)}
              className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
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
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed: {list.error.message}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={list.data ?? []}
          getRowKey={(r) => r.id}
          isLoading={list.isLoading}
          emptyTitle="No members match"
          emptyDescription="Adjust the filters or create a new member."
          data-testid="loyalty-table"
        />
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
  return (
    <div className="relative inline-block">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggle}
        aria-label={`Actions for ${row.name}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      {isOpen && (
        <div
          role="menu"
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
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        'block w-full px-3 py-2 text-left text-sm transition-colors duration-fast hover:bg-bg-overlay focus:bg-bg-overlay focus:outline-none',
        tone === 'danger' ? 'text-danger' : 'text-text-primary',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
