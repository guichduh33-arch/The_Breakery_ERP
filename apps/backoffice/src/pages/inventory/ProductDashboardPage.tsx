// apps/backoffice/src/pages/inventory/ProductDashboardPage.tsx
// Session 14 / Phase 4.C — product dashboard rewritten on top of KpiTile +
// EmptyState primitives. Mirrors `product stock detail.jpg`: header with back
// link → window selector → KPI tile row (current stock / value / units sold /
// avg per day) → sales velocity chart → recent movements + top customers.
//
// ADR-027 — la carte « Stock by section » a disparu : `products.current_stock`
// est l'unique niveau de stock, la tuile « Current stock » le porte déjà.

import { useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarRange,
  Coins,
  Inbox,
  Package,
  TrendingUp,
} from 'lucide-react';
import { EmptyState, KpiTile } from '@breakery/ui';
import { formatDateTimeShortWita, formatCurrency } from '@breakery/utils';
import { useProductDashboard } from '@/features/inventory-dashboard/hooks/useProductDashboard.js';
import { SalesVelocityChart } from '@/features/inventory-dashboard/components/SalesVelocityChart.js';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';

const WINDOW_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 7,  label: '7 days'  },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
];

export default function ProductDashboardPage(): JSX.Element {
  const { productId } = useParams<{ productId: string }>();
  const [days, setDays] = useState<number>(30);
  const dash = useProductDashboard(productId ?? null, days);

  if (dash.isLoading) {
    return <div className="text-sm text-text-secondary">Loading dashboard…</div>;
  }
  if (dash.error !== null) {
    return (
      <QueryErrorBanner
        detail={errorDetailText(dash.error)}
        onRetry={() => { void dash.refetch(); }}
        data-testid="product-dashboard-error"
      >
        This product dashboard could not be loaded — nothing below is shown, so
        no figure here is a zero.
      </QueryErrorBanner>
    );
  }
  if (dash.data === null || dash.data === undefined) {
    return <div className="text-sm text-text-secondary">No data.</div>;
  }

  const d = dash.data;
  const valueAtCost = Math.round(Number(d.product.value_at_cost) || 0);
  const avgDaily    = Number(d.summary.avg_daily_units);

  return (
    <div className="space-y-6">
      <header>
        <Link
          to="/backoffice/products"
          className="inline-flex items-center gap-1 text-xs text-text-secondary transition-colors duration-fast hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Back to products
        </Link>
        <PageHeader
          className="mt-2"
          title={d.product.name}
          subtitle={<span className="font-mono text-xs text-text-muted">{d.product.sku}</span>}
          actions={
            <>
              <label htmlFor="dash-days" className="text-xs uppercase tracking-widest text-text-secondary">
                Window
              </label>
              <select
                id="dash-days"
                value={days}
                onChange={(e) => { setDays(Number(e.target.value)); }}
                className={`h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
              >
                {WINDOW_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </>
          }
        />
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        aria-label="Product KPIs"
      >
        <KpiTile
          label="Current stock"
          value={`${Number(d.product.current_stock)} ${d.product.unit}`}
          icon={Package}
        />
        <KpiTile
          label="Value at cost"
          value={formatCurrency(valueAtCost)}
          valueFormat="currency"
          icon={Coins}
        />
        <KpiTile
          label="Units sold"
          value={Number(d.summary.units_sold)}
          icon={TrendingUp}
          footer={`${days}-day window`}
        />
        <KpiTile
          label="Avg per day"
          value={Number(avgDaily.toFixed(2))}
          icon={CalendarRange}
        />
      </section>

      <SalesVelocityChart data={d.sales_velocity_daily} unit={d.product.unit} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Recent movements">
          {d.recent_movements.length === 0 ? (
            <EmptyState icon={Inbox} title="No movements yet" size="sm" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <tbody>
                  {d.recent_movements.map((m) => (
                    <tr key={m.id} className="border-t border-border-subtle">
                      <td className="py-1 px-3 font-mono text-text-secondary">
                        {formatDateTimeShortWita(m.created_at)}
                      </td>
                      <td className="py-1 px-3 font-mono">{m.movement_type}</td>
                      <td className={`py-1 px-3 text-right font-mono ${m.quantity > 0 ? 'text-success' : 'text-danger'}`}>
                        {m.quantity > 0 ? '+' : ''}{m.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={`Top customers (${days}d)`}>
          {d.top_customers.length === 0 ? (
            <EmptyState icon={Inbox} title="No retail sales tracked" size="sm" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-text-muted">
                  <tr>
                    <th className="text-left py-2 px-3">Customer</th>
                    <th className="text-right py-2 px-3">Units</th>
                    <th className="text-right py-2 px-3">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {d.top_customers.map((c) => (
                    <tr key={c.customer_id} className="border-t border-border-subtle">
                      <td className="py-2 px-3">{c.customer_name}</td>
                      <td className="py-2 px-3 text-right font-mono">{Number(c.units_bought)}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatCurrency(Number(c.spend_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
      <div className="border-b border-border-subtle px-4 py-2 text-xs uppercase tracking-widest text-text-muted">
        {title}
      </div>
      {children}
    </div>
  );
}
