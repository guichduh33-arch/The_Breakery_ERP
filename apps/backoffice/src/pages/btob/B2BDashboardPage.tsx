// apps/backoffice/src/pages/btob/B2BDashboardPage.tsx
//
// Session 14 / Phase 5.B — B2B Wholesale dashboard.
// Session 24 / Phase 2.A.3 — "+ New B2B Order" now opens CreateB2bOrderModal
// which calls create_b2b_order_v1 (closes deviation D-W6-B2B-01).

import { Link } from 'react-router-dom';
import { useState, type JSX } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
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

const AGING_TONES: Record<string, string> = {
  Current:  'text-success',
  Overdue:  'text-warning',
  Critical: 'text-cat-orange',
  Default:  'text-danger',
};

export default function B2BDashboardPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
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
            <Button
              variant="primary"
              size="md"
              disabled={!canCreate}
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden /> New B2B Order
            </Button>
          </>
        }
      />

      {drifted.length > 0 ? (
        <div
          data-testid="b2b-drift-banner"
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 p-4 space-y-1"
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiTile
          icon={UsersIcon}
          label="Active clients"
          value={dash.data?.activeClients ?? 0}
          valueFormat="number"
          footer="With at least one order"
        />
        <KpiTile
          icon={TrendingUp}
          label="Monthly B2B revenue"
          value={dash.data?.monthlyRevenue ?? 0}
          valueFormat="currency"
          delta={
            dash.data !== undefined
              ? {
                  value: `${dash.data.monthlyDeltaPct >= 0 ? '+' : ''}${dash.data.monthlyDeltaPct}%`,
                  direction: dash.data.monthlyDeltaPct >= 0 ? 'up' : 'down',
                }
              : { value: '0%', direction: 'neutral' }
          }
        />
        <KpiTile
          icon={FileText}
          label="Outstanding AR"
          value={dash.data?.outstandingAr ?? 0}
          valueFormat="currency"
          footer="Across all wholesale clients"
        />
        <KpiTile
          icon={ClipboardList}
          label="Pending orders"
          value={dash.data?.pendingOrders ?? 0}
          valueFormat="number"
          footer="Processing"
        />
        <KpiTile
          icon={Calendar}
          label="Total orders"
          value={dash.data?.totalOrders ?? 0}
          valueFormat="number"
          footer="All time"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopClientsCard rows={dash.data?.topClients ?? []} loading={dash.isLoading} />
        <RecentOrdersCard rows={dash.data?.recentOrders ?? []} loading={dash.isLoading} />
      </div>

      <AgingSummaryCard buckets={dash.data?.aging ?? []} loading={dash.isLoading} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <QuickLink to="/backoffice/customers" icon={Building2} title="B2B Clients" desc="Browse wholesale customers" />
        <QuickLink to="/backoffice/b2b/payments" icon={CreditCard} title="Payments" desc="Track collections and balances" />
        <QuickLink to="/backoffice/b2b/settings" icon={FileText} title="B2B Settings" desc="Payment terms & aging buckets" />
      </div>

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
                <div className="font-mono text-text-primary">{formatIdr(c.total_spent)}</div>
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
                <div className="font-mono text-text-primary">{o.order_number}</div>
                <div className="text-xs text-text-secondary">
                  {new Date(o.created_at).toLocaleDateString()} • {o.status}
                </div>
              </div>
              <span className="font-mono text-text-primary">{formatIdr(o.total)}</span>
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {buckets.map((b) => (
            <div key={b.label} className="rounded-md border border-border-subtle bg-bg-base/40 p-3">
              <div className={['text-xs font-semibold uppercase tracking-widest', AGING_TONES[b.label] ?? 'text-text-secondary'].join(' ')}>
                {b.label}
              </div>
              <div className="mt-1 text-xs text-text-muted">{b.range}</div>
              <div className="mt-2 font-mono text-lg text-text-primary">{formatIdr(b.total)}</div>
              <div className="text-xs text-text-secondary">{b.count} clients</div>
            </div>
          ))}
        </div>
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

function QuickLink({
  to, icon: Icon, title, desc,
}: { to: string; icon: typeof Building2; title: string; desc: string }): JSX.Element {
  return (
    <Link
      to={to}
      className="group block rounded-lg border border-border-subtle bg-bg-elevated p-4 transition-colors duration-fast hover:border-gold/40"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gold-soft text-gold" aria-hidden>
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="font-medium text-text-primary">{title}</div>
            <div className="text-xs text-text-secondary">{desc}</div>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-text-muted transition-transform duration-fast group-hover:translate-x-0.5" aria-hidden />
      </div>
    </Link>
  );
}
