// apps/backoffice/src/pages/customers/customer-detail/AnalyticsTab.tsx
//
// Onglet « Analytics » de la fiche client. Refonte du 2026-11-21, après
// lecture en production : la courbe montrait dix mois vides sur douze, le
// total et le panier moyen étaient calculés sans jamais s'afficher, et rien ne
// disait QUAND le client vient. L'onglet répond désormais, dans l'ordre, à :
// qui est ce client en chiffres, comment sa dépense évolue, quand il vient,
// comment il commande, ce qu'il achète.
//
// Les agrégats viennent de `buildCustomerAnalytics` (fonction pure, fuseau
// métier). Ici : la mise en forme seulement.

import type { JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/BackofficeUi.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { useCustomerAnalytics } from '@/features/customers/hooks/useCustomerAnalytics.js';
import {
  BUSINESS_TZ,
  TOP_PRODUCTS,
  type CustomerAnalytics,
  type ShareRow,
  type TrendPoint,
} from '@/features/customers/customerAnalytics.js';
import { CHART_GRID_STROKE, CHART_AXIS_STROKE } from '@/features/reports/utils/chartColors.js';
import { formatCount, formatIdr, formatIdrShort, formatPct } from '@/features/dashboard/utils/format.js';
import { usePrefersReducedMotion } from '@/features/dashboard/utils/usePrefersReducedMotion.js';

const SECTION_TITLE = 'font-data text-sm font-semibold uppercase tracking-widest text-text-secondary';
const SERIES = 'var(--chart-1)';
const TICK = { fontSize: 11, fill: 'var(--text-secondary)' };

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TZ, day: 'numeric', month: 'short', year: 'numeric' });

function sinceLabel(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${formatCount(days)} days ago`;
}

function rhythmLabel(days: number | null): string {
  if (days === null) return '—';
  // « Every 1,1 days » est exact mais se lit mal : sous un jour et demi, le
  // client vient presque chaque jour. La valeur exacte reste au survol.
  if (days < 1.5) return 'Almost daily';
  return `Every ${days.toLocaleString('id-ID', { maximumFractionDigits: 1 })} days`;
}

const DAY_MONTH_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TZ, day: 'numeric', month: 'short' });

function summaryCounters(a: CustomerAnalytics): ListCounter[] {
  return [
    { id: 'spend', label: 'Total spend', value: formatIdr(a.totalSpend),
      title: 'Recognised sales for this customer, unpaid tabs included from their recognition date.' },
    { id: 'orders', label: 'Orders', value: formatCount(a.ordersConsidered) },
    { id: 'basket', label: 'Average basket', value: formatIdr(a.avgBasket) },
    { id: 'rhythm', label: 'Visit rhythm', value: rhythmLabel(a.avgDaysBetween),
      title: a.avgDaysBetween === null
        ? 'Needs visits on at least two different days.'
        : `Every ${a.avgDaysBetween.toLocaleString('id-ID', { maximumFractionDigits: 1 })} days on average, across ${formatCount(a.visitDays)} days with an order.` },
    { id: 'last', label: 'Last order', value: sinceLabel(a.daysSinceLast),
      ...(a.lastAt === null ? {} : { title: DATE_FMT.format(new Date(a.lastAt)) }) },
    // La première VENTE reconnue, pas la date de création de la fiche.
    { id: 'since', label: 'First sale', value: a.firstAt === null ? '—' : DATE_FMT.format(new Date(a.firstAt)) },
  ];
}

function TrendTooltip({ active, payload, weekly }: { active?: boolean; payload?: { payload: TrendPoint }[]; weekly: boolean }): JSX.Element | null {
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined) return null;
  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-text-primary">{weekly ? `Week of ${point.label}` : point.label}</p>
      <p className="font-data tabular-nums text-text-primary">{formatIdr(point.total)}</p>
      <p className="text-text-secondary">{formatCount(point.orders)} {point.orders === 1 ? 'order' : 'orders'}</p>
    </div>
  );
}

function SpendTrend({ a, reduced }: { a: CustomerAnalytics; reduced: boolean }): JSX.Element {
  const unit = a.granularity === 'week' ? 'week' : 'month';
  // La date du PREMIER ACHAT, pas le lundi de sa semaine : « since 28 Sep »
  // pour un client venu le 1er octobre se lisait comme une erreur. Au-delà de
  // douze mois, les plus anciens sortent du graphe et le sous-titre le dit.
  const sinceText = a.trendClipped
    ? 'last 12 months'
    : `since ${a.firstAt === null ? '—' : DAY_MONTH_FMT.format(new Date(a.firstAt))}`;
  return (
    <Card variant="default" padding="md">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={SECTION_TITLE}>Spend per {unit}</h2>
        <p className="text-xs text-text-secondary">
          {a.granularity === 'week' ? 'Weekly' : 'Monthly'} {sinceText}
        </p>
      </div>
      <div className="h-56 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={a.trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
            <XAxis dataKey="label" tick={TICK} stroke={CHART_AXIS_STROKE} tickLine={false} />
            <YAxis tick={TICK} stroke={CHART_AXIS_STROKE} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => formatIdrShort(v)} width={76} />
            <Tooltip content={<TrendTooltip weekly={a.granularity === 'week'} />} cursor={{ fill: 'var(--surface-4)' }} />
            <Bar isAnimationActive={!reduced} dataKey="total" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={56} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Lecture non visuelle du même graphe : un tableau, pas une phrase. */}
      <table className="sr-only">
        <caption>Spend and order count per {unit}</caption>
        <thead><tr><th scope="col">{a.granularity === 'week' ? 'Week starting' : 'Month'}</th><th scope="col">Spend</th><th scope="col">Orders</th></tr></thead>
        <tbody>
          {a.trend.map((p) => (
            <tr key={p.key}><th scope="row">{p.label}</th><td>{formatIdr(p.total)}</td><td>{formatCount(p.orders)}</td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Liste de parts : libellé, compte, part, et une barre de la même rampe. */
function ShareList({ title, rows, testId }: { title: string; rows: readonly ShareRow[]; testId: string }): JSX.Element {
  const max = Math.max(...rows.map((r) => r.share), 0);
  return (
    <Card variant="default" padding="md" data-testid={testId}>
      <h2 className={`${SECTION_TITLE} mb-3`}>{title}</h2>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={r.orders === 0 ? 'text-text-muted' : 'text-text-primary'}>{r.label}</span>
              <span className="whitespace-nowrap font-data text-xs tabular-nums text-text-secondary">
                {formatCount(r.orders)} · {formatPct(r.share)}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-surface-4" aria-hidden="true">
              {/* Échelle relative au plus haut : la forme se lit d'un coup d'œil. */}
              <div className="h-full rounded-sm bg-chart-1" style={{ width: `${max > 0 ? (r.share / max) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TopProducts({ a }: { a: CustomerAnalytics }): JSX.Element {
  // Barres à l'échelle du produit le plus fort : à l'échelle absolue, 10 % de
  // la dépense ne traçait qu'un trait. Le pourcentage exact reste écrit.
  const maxShare = Math.max(...a.topProducts.map((p) => p.spendShare), 0);
  return (
    <Card variant="default" padding="md">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={SECTION_TITLE}>Favourite products</h2>
        {a.distinctProducts > TOP_PRODUCTS && (
          <p className="text-xs text-text-secondary">
            Top {TOP_PRODUCTS} of {formatCount(a.distinctProducts)} products bought
          </p>
        )}
      </div>
      {a.topProducts.length === 0 ? (
        <p className="text-sm text-text-muted">No item lines on these orders.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Products this customer buys most, by quantity, with spend and share of spend</caption>
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-secondary">
                <th scope="col" className="w-8 py-2 pr-3 font-medium">#</th>
                <th scope="col" className="py-2 pr-3 font-medium">Product</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Qty</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Spend</th>
                <th scope="col" className="w-40 py-2 font-medium">Share of spend</th>
              </tr>
            </thead>
            <tbody>
              {a.topProducts.map((p, i) => (
                <tr key={p.product_id} className="border-b border-border-muted last:border-b-0">
                  <td className="py-2.5 pr-3 font-data tabular-nums text-text-muted">{i + 1}</td>
                  <td className="py-2.5 pr-3 text-text-primary">{p.name}</td>
                  <td className="py-2.5 pr-3 text-right font-data tabular-nums text-text-primary">{formatCount(p.quantity)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-right font-data tabular-nums text-text-primary">{formatIdr(p.spend)}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-surface-4" aria-hidden="true">
                        <div className="h-full rounded-sm bg-chart-1" style={{ width: `${maxShare > 0 ? (p.spendShare / maxShare) * 100 : 0}%` }} />
                      </div>
                      <span className="w-12 text-right font-data text-xs tabular-nums text-text-secondary">{formatPct(p.spendShare)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function AnalyticsTab({ customerId }: { customerId: string | null }): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const { data, isLoading, error, refetch } = useCustomerAnalytics(customerId);

  if (isLoading) {
    return <Card variant="default" padding="lg"><p role="status" className="text-sm text-text-muted">Loading analytics…</p></Card>;
  }
  // Une lecture refusée n'est pas « pas d'historique » : on le dit.
  if (error !== null) {
    return (
      <QueryErrorBanner detail={error.message} onRetry={() => { void refetch(); }} data-testid="customer-analytics-error">
        Purchase analytics could not be loaded.
      </QueryErrorBanner>
    );
  }
  if (!data || data.ordersConsidered === 0) {
    return (
      <Card variant="default" padding="lg">
        <p className="text-sm text-text-muted">No recognised sale for this customer yet — analytics start with the first order.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ListCounterStrip counters={summaryCounters(data)} ariaLabel="Customer summary" data-testid="customer-analytics-summary" />
      <SpendTrend a={data} reduced={reduced} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ShareList title="Day of the week" rows={data.byWeekday} testId="analytics-weekday" />
        <ShareList title="Time of day" rows={data.byDaypart} testId="analytics-daypart" />
        <ShareList title="Order type" rows={data.byType} testId="analytics-type" />
      </div>
      <TopProducts a={data} />
    </div>
  );
}
