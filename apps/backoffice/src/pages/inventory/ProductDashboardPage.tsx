// apps/backoffice/src/pages/inventory/ProductDashboardPage.tsx
// Session 14 / Phase 4.C — product dashboard rewritten on top of KpiTile +
// EmptyState primitives. Mirrors `product stock detail.jpg`: header with back
// link → window selector → KPI tile row (current stock / value / units sold /
// avg per day) → sales velocity chart → 2×2 of stock-by-section, expiring
// lots, recent movements, top customers.

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
import { useProductDashboard } from '@/features/inventory-dashboard/hooks/useProductDashboard.js';
import { SalesVelocityChart } from '@/features/inventory-dashboard/components/SalesVelocityChart.js';
import { StockBySectionList } from '@/features/inventory-dashboard/components/StockBySectionList.js';

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
      <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
        Failed: {String(dash.error)}
      </div>
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
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-text-primary">{d.product.name}</h1>
            <p className="mt-0.5 font-mono text-xs text-text-muted">{d.product.sku}</p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="dash-days" className="text-xs uppercase tracking-widest text-text-secondary">
              Window
            </label>
            <select
              id="dash-days"
              value={days}
              onChange={(e) => { setDays(Number(e.target.value)); }}
              className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
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
          value={valueAtCost}
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
        <StockBySectionList rows={d.stock_by_section} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Recent movements">
          {d.recent_movements.length === 0 ? (
            <EmptyState icon={Inbox} title="No movements yet" size="sm" />
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {d.recent_movements.map((m) => (
                  <tr key={m.id} className="border-t border-border-subtle">
                    <td className="py-1 px-3 font-mono text-text-secondary">
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                    <td className="py-1 px-3 font-mono">{m.movement_type}</td>
                    <td className={`py-1 px-3 text-right font-mono ${m.quantity > 0 ? 'text-success' : 'text-danger'}`}>
                      {m.quantity > 0 ? '+' : ''}{m.quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={`Top customers (${days}d)`}>
          {d.top_customers.length === 0 ? (
            <EmptyState icon={Inbox} title="No retail sales tracked" size="sm" />
          ) : (
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
                    <td className="py-2 px-3 text-right font-mono">{Number(c.spend_total).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
