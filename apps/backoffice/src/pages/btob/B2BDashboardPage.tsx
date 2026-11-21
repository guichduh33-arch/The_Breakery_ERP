// apps/backoffice/src/pages/btob/B2BDashboardPage.tsx
//
// Tableau de bord B2B wholesale. La création ouvre le formulaire partagé et
// appelle la famille create_b2b_order. Le titre reprend le libellé du menu
// (« B2B wholesale ») et le fil d'Ariane commence par « Sales », comme toutes
// les pages du domaine (audit Sales 2026-11-21).

import { Link } from 'react-router-dom';
import { useState, type JSX } from 'react';
import {
  AlertTriangle,
  Calendar,
  CreditCard,
  FileText,
  Inbox,
  Plus,
  Users as UsersIcon,
} from 'lucide-react';
import { Card, EmptyState } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { formatCurrency, formatDateTimeShortWita } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { Breadcrumb } from '@/components/Breadcrumb.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { orderStatusLabel } from '@/features/orders/statusMeta.js';
// La tuile du back-office, pas celle de `@breakery/ui` : celle-ci rend la
// valeur à 23 px avec `valueTitle`, l'autre à 34 px sans échappatoire. Dans
// cette grille `xl:grid-cols-5` la tuile mesure 231 px et son contenu 183 px,
// soit HUIT caractères mono — « Rp 80.000 » déborde déjà, et un encours B2B en
// fait neuf. Le compact + l'exact en infobulle est le geste des 46 rapports.
// La pastille d'icône disparaît avec elle, et c'est un gain : elle était un
// aplat `bg-gold-soft`, que The Ink-Not-Gold Rule interdit ici.
import { KpiTile, KPI_NOTE } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { formatCount, formatIdr, formatIdrShort } from '@/features/dashboard/utils/format.js';
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
import {
  TOOLBAR_BTN_PRIMARY,
  TOOLBAR_BTN_SECONDARY,
  TOOLBAR_ICON,
} from '@/components/toolbarButton.js';

// Rampe de GRAVITÉ uniquement — `cat-*` est réservé à l'identité d'une
// catégorie de produit, jamais à une sévérité (DESIGN.md, Named Rules).
const AGING_TONES: Record<string, string> = {
  Current:  'text-success',
  Overdue:  'text-warning',
  Critical: 'text-danger',
  Default:  'text-danger',
};

// Un échec ou un chargement rendent des tirets, jamais des zéros (ADR-025) :
// `formatCount` et `formatIdr*` portent déjà cette règle.

export default function B2BDashboardPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  // Écart de gates ASSUMÉ ici, pas harmonisé : la route est gatée `b2b.read`
  // (routes/index.tsx) mais la page re-vérifie `customers.read` (ses données
  // viennent de la table customers) et la création exige `b2b.order.create`.
  // Toute harmonisation est un changement de sémantique sécurité — hors du
  // chantier de conformité visuelle (validation owner + tests négatifs).
  const canRead   = hasPermission('customers.read');
  const canCreate = hasPermission('b2b.order.create');
  const [createOpen, setCreateOpen] = useState<boolean>(false);

  const dash = useB2bDashboard();

  const canReconcile = hasPermission('b2b.read');
  const driftQuery   = useB2bBalanceDrift(canReconcile);
  const drifted      = (driftQuery.data ?? []).filter((r) => r.has_drift);

  if (!canRead) {
    return <div className="text-text-secondary">No access to B2B wholesale.</div>;
  }

  return (
    <div className="flex flex-col gap-[13px]">
      <Breadcrumb items={[{ label: 'Sales' }, { label: 'B2B wholesale' }]} />

      <PageHeader
        title="B2B wholesale"
        subtitle="Manage your wholesale customers and B2B orders."
        actions={
          <>
            {/* Le bandeau ne mélange pas deux familles de boutons : le lien
                Payments prend la MÊME chaîne de 32 px que l'action voisine —
                `TOOLBAR_BTN_*` s'applique indifféremment à un `<button>` ou à
                un `<Link>`, c'est le motif de la constante. */}
            <Link to="/backoffice/b2b/payments" className={TOOLBAR_BTN_SECONDARY}>
              <CreditCard className={TOOLBAR_ICON} aria-hidden /> Payments
            </Link>
            <button
              type="button"
              className={TOOLBAR_BTN_PRIMARY}
              disabled={!canCreate}
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> New B2B order
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
          {/* Phrase de gérant, pas de jargon : « cache ≠ ledger » ne disait rien
              à celui qui doit agir. Le solde affiché sur la fiche client est
              un cumul tenu à jour ; le grand livre B2B (commandes et
              règlements) est la référence. */}
          <div className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {drifted.length === 1
              ? '1 customer has a balance that does not match their orders and payments'
              : `${drifted.length} customers have a balance that does not match their orders and payments`}
          </div>
          <p className="text-sm text-text-secondary">
            Check these accounts before relying on their balance or credit limit.
          </p>
          <ul className="text-sm text-text-secondary">
            {drifted.map((r) => (
              <li key={r.customer_id}>
                {r.customer_name}: balance shown{' '}
                <span className="font-data tabular-nums">{formatCurrency(r.cached_balance)}</span>, orders and payments add up to{' '}
                <span className="font-data tabular-nums">{formatCurrency(r.derived_balance)}</span> (difference{' '}
                <span className="font-data tabular-nums">{formatCurrency(r.drift)}</span>)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dash.error !== null && (
        <QueryErrorBanner onRetry={() => { void dash.refetch(); }} data-testid="b2b-dashboard-error">
          The B2B dashboard could not be loaded — the tiles below show dashes rather
          than numbers that would be wrong.
        </QueryErrorBanner>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiTile
          label="Active clients"
          value={formatCount(dash.data?.activeClients)}
          unavailable={dash.data === undefined}
          testId="kpi-b2b-active-clients"
        >
          <span className={KPI_NOTE}>With at least one order</span>
        </KpiTile>
        <KpiTile
          label="Monthly B2B revenue"
          value={formatIdrShort(dash.data?.monthlyRevenue)}
          {...(dash.data !== undefined ? { valueTitle: formatIdr(dash.data.monthlyRevenue) } : {})}
          unavailable={dash.data === undefined}
          testId="kpi-b2b-monthly-revenue"
        >
          {dash.data !== undefined && (
            <Delta value={dash.data.monthlyDeltaPct} period="prev month" />
          )}
        </KpiTile>
        <KpiTile
          label="Outstanding AR"
          value={formatIdrShort(dash.data?.outstandingAr)}
          {...(dash.data !== undefined ? { valueTitle: formatIdr(dash.data.outstandingAr) } : {})}
          unavailable={dash.data === undefined}
          testId="kpi-b2b-outstanding-ar"
        >
          <span className={KPI_NOTE}>Across all wholesale clients</span>
        </KpiTile>
        <KpiTile
          label="Pending orders"
          value={formatCount(dash.data?.pendingOrders)}
          unavailable={dash.data === undefined}
          testId="kpi-b2b-pending-orders"
        >
          <span className={KPI_NOTE}>Processing</span>
        </KpiTile>
        <KpiTile
          label="Total orders"
          value={formatCount(dash.data?.totalOrders)}
          unavailable={dash.data === undefined}
          testId="kpi-b2b-total-orders"
        >
          <span className={KPI_NOTE}>All time</span>
        </KpiTile>
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
        <Link to="/backoffice/customers" className={`rounded-sm text-xs text-gold transition-colors duration-fast hover:text-gold-strong ${FOCUS_RING}`}>
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
                <div className="font-data tabular-nums text-text-primary">{formatCurrency(c.total_spent)}</div>
                {Number(c.b2b_current_balance) > 0 && (
                  <div className="text-xs text-warning">
                    {formatCurrency(Number(c.b2b_current_balance))} outstanding
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
        <Link to="/backoffice/b2b/orders" className={`rounded-sm text-xs text-gold transition-colors duration-fast hover:text-gold-strong ${FOCUS_RING}`}>
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
            <li key={o.id}>
              {/* Toute la ligne est un lien vers la fiche : la commande récente
                  se lisait sans pouvoir s'ouvrir. */}
              <Link
                to={`/backoffice/b2b/orders/${o.id}`}
                className={`flex items-center justify-between gap-3 rounded-sm py-2 text-sm hover:bg-surface-4 ${FOCUS_RING}`}
              >
                <div>
                  <div className="font-data tabular-nums text-text-primary">{o.order_number}</div>
                  <div className="text-xs text-text-secondary">
                    <span className="font-data tabular-nums">{formatDateTimeShortWita(o.created_at)}</span> • {orderStatusLabel(o.status)}
                  </div>
                </div>
                <span className="whitespace-nowrap font-data tabular-nums text-text-primary">{formatCurrency(o.total)}</span>
              </Link>
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
        <div className="font-data font-semibold flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest">
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
