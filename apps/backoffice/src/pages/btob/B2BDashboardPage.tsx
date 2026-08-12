// apps/backoffice/src/pages/btob/B2BDashboardPage.tsx
//
// Session 14 / Phase 5.B — B2B Wholesale dashboard.
// Session 24 / Phase 2.A.3 — "+ New B2B Order" now opens CreateB2bOrderModal
// which calls create_b2b_order_v1 (closes deviation D-W6-B2B-01).

import { Link } from 'react-router-dom';
import { useState, type JSX } from 'react';
import {
  AlertTriangle,
  Calendar,
  ClipboardList,
  CreditCard,
  FileText,
  Inbox,
  Plus,
  TrendingUp,
  Users as UsersIcon,
} from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  KpiTile,
  SectionLabel,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useB2bDashboard,
  type B2bAgingBucket,
  type B2bClientRow,
  type B2bRecentOrder,
} from '@/features/btob/hooks/useB2bDashboard.js';
import { useB2bBalanceDrift } from '@/features/btob/hooks/useB2bBalanceDrift.js';
import { CreateB2bOrderModal } from '@/features/btob/components/CreateB2bOrderModal.js';
import { AgingBucketsGrid } from '@/features/btob/components/AgingBucketsGrid.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';

// Rampe de GRAVITÉ uniquement — `cat-*` est réservé à l'identité d'une
// catégorie de produit, jamais à une sévérité (DESIGN.md, Named Rules).
const AGING_TONES: Record<string, string> = {
  Current:  'text-success',
  Overdue:  'text-warning',
  Critical: 'text-danger',
  Default:  'text-danger',
};

/** Un échec ou un chargement rendent des tirets, jamais des zéros (ADR-025). */
function kpiValue(v: number | undefined): number | string {
  return v ?? '—';
}

export default function B2BDashboardPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  // Écart de gates ASSUMÉ ici, pas harmonisé : la route est gatée `b2b.read`
  // (routes/index.tsx) mais la page re-vérifie `customers.read` (ses données
  // viennent de la table customers) et la création exige `pos.sale.create`.
  // Toute harmonisation est un changement de sémantique sécurité — hors du
  // chantier de conformité visuelle (validation owner + tests négatifs).
  const canRead   = hasPermission('customers.read');
  const canCreate = hasPermission('pos.sale.create');
  const [createOpen, setCreateOpen] = useState<boolean>(false);

  const dash = useB2bDashboard();

  const canReconcile = hasPermission('b2b.read');
  const driftQuery   = useB2bBalanceDrift(canReconcile);
  const drifted      = (driftQuery.data ?? []).filter((r) => r.has_drift);

  if (!canRead) {
    return <div className="text-text-secondary">No access to B2B Wholesale.</div>;
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span className="text-text-secondary">B2B</span>
      </nav>

      <PageHeader
        title="B2B Dashboard"
        subtitle="Manage your wholesale customers and B2B orders."
        actions={
          <>
            <Button asChild variant="ghost" size="md">
              <Link to="/backoffice/b2b/payments">
                <CreditCard className="h-4 w-4" aria-hidden /> Payments
              </Link>
            </Button>
            <button
              type="button"
              className={TOOLBAR_BTN_PRIMARY}
              disabled={!canCreate}
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> New B2B Order
            </button>
          </>
        }
      />

      {drifted.length > 0 ? (
        <div
          data-testid="b2b-drift-banner"
          role="alert"
          className="rounded-lg border border-warning bg-warning-soft p-4 space-y-1"
        >
          <div className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Balance drift detected (cache ≠ ledger) — {drifted.length} client{drifted.length > 1 ? 's' : ''}
          </div>
          <ul className="text-sm text-text-secondary">
            {drifted.map((r) => (
              <li key={r.customer_id}>
                {r.customer_name} : cached {formatIdr(r.cached_balance)} vs derived{' '}
                {formatIdr(r.derived_balance)} (drift {formatIdr(r.drift)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dash.error !== null && (
        <p role="alert" className="rounded-md border border-red bg-red-soft p-3 text-sm text-red-as-text">
          The B2B dashboard could not be loaded — the tiles below show dashes rather
          than numbers that would be wrong.{' '}
          <button type="button" className="underline" onClick={() => { void dash.refetch(); }}>
            Try again
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiTile
          icon={UsersIcon}
          label="Active clients"
          value={kpiValue(dash.data?.activeClients)}
          valueFormat="number"
          footer="With at least one order"
        />
        <KpiTile
          icon={TrendingUp}
          label="Monthly B2B revenue"
          value={kpiValue(dash.data?.monthlyRevenue)}
          valueFormat="currency"
          {...(dash.data !== undefined
            ? {
                delta: {
                  value: `${dash.data.monthlyDeltaPct >= 0 ? '+' : ''}${dash.data.monthlyDeltaPct}%`,
                  direction: dash.data.monthlyDeltaPct >= 0 ? ('up' as const) : ('down' as const),
                },
              }
            : {})}
        />
        <KpiTile
          icon={FileText}
          label="Outstanding AR"
          value={kpiValue(dash.data?.outstandingAr)}
          valueFormat="currency"
          footer="Across all wholesale clients"
        />
        <KpiTile
          icon={ClipboardList}
          label="Pending orders"
          value={kpiValue(dash.data?.pendingOrders)}
          valueFormat="number"
          footer="Processing"
        />
        <KpiTile
          icon={Calendar}
          label="Total orders"
          value={kpiValue(dash.data?.totalOrders)}
          valueFormat="number"
          footer="All time"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopClientsCard rows={dash.data?.topClients ?? []} loading={dash.isLoading} />
        <RecentOrdersCard rows={dash.data?.recentOrders ?? []} loading={dash.isLoading} />
      </div>

      <AgingSummaryCard buckets={dash.data?.aging ?? []} loading={dash.isLoading} />

      <CreateB2bOrderModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

interface TopClientsCardProps { rows: readonly B2bClientRow[]; loading: boolean }
function TopClientsCard({ rows, loading }: TopClientsCardProps): JSX.Element {
  return (
    <Card variant="default" padding="md" className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel as="div" size="xs">
          <span className="inline-flex items-center gap-2">
            <UsersIcon className="h-3.5 w-3.5" aria-hidden /> Top clients
          </span>
        </SectionLabel>
        <Link to="/backoffice/customers" className="text-xs text-gold transition-colors duration-fast hover:text-gold-strong">
          View all clients
        </Link>
      </div>
      {loading ? (
        <div className="text-sm text-text-secondary">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title="No B2B clients yet" size="sm" />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-medium text-text-primary">{c.b2b_company_name ?? c.name}</div>
                <div className="text-xs text-text-secondary">{c.total_visits} orders</div>
              </div>
              <div className="text-right">
                <div className="font-data tabular-nums text-text-primary">{formatIdr(c.total_spent)}</div>
                {Number(c.b2b_current_balance) > 0 && (
                  <div className="text-xs text-warning">
                    {formatIdr(Number(c.b2b_current_balance))} outstanding
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface RecentOrdersCardProps { rows: readonly B2bRecentOrder[]; loading: boolean }
function RecentOrdersCard({ rows, loading }: RecentOrdersCardProps): JSX.Element {
  return (
    <Card variant="default" padding="md" className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel as="div" size="xs">
          <span className="inline-flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" aria-hidden /> Recent orders
          </span>
        </SectionLabel>
        <Link to="/backoffice/customers" className="text-xs text-gold transition-colors duration-fast hover:text-gold-strong">
          Track all
        </Link>
      </div>
      {loading ? (
        <div className="text-sm text-text-secondary">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No recent orders"
          description="B2B orders show up here once placed."
          size="sm"
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {rows.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-data tabular-nums text-text-primary">{o.order_number}</div>
                <div className="text-xs text-text-secondary">
                  {new Date(o.created_at).toLocaleDateString()} • {o.status}
                </div>
              </div>
              <span className="font-data tabular-nums text-text-primary">{formatIdr(o.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface AgingSummaryCardProps { buckets: readonly B2bAgingBucket[]; loading: boolean }
function AgingSummaryCard({ buckets, loading }: AgingSummaryCardProps): JSX.Element {
  const totalCount = buckets.reduce((acc, b) => acc + b.count, 0);
  return (
    <Card variant="default" padding="md" className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel as="div" size="xs">
          <span className="inline-flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5" aria-hidden /> Aging summary (AR)
          </span>
        </SectionLabel>
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest">
          <Legend tone="text-success"  label="0-30 Days" />
          <Legend tone="text-warning" label="31-60 Days" />
          <Legend tone="text-danger"    label="61-90+ Days" />
        </div>
      </div>
      {loading ? (
        <div className="text-sm text-text-secondary">Loading…</div>
      ) : totalCount === 0 ? (
        <EmptyState icon={Inbox} title="No outstanding receivables" size="sm" />
      ) : (
        <AgingBucketsGrid buckets={buckets} tones={AGING_TONES} />
      )}
    </Card>
  );
}

function Legend({ tone, label }: { tone: string; label: string }): JSX.Element {
  return (
    <span className={['inline-flex items-center gap-1', tone].join(' ')}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
