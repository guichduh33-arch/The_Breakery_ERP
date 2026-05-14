// apps/backoffice/src/pages/inventory/ProductDashboardPage.tsx
// Session 13 / Phase 2.D — product dashboard with sales velocity chart,
// stock-by-section, recent movements, expiring lots, top customers.

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useProductDashboard } from '@/features/inventory-dashboard/hooks/useProductDashboard.js';
import { SalesVelocityChart } from '@/features/inventory-dashboard/components/SalesVelocityChart.js';
import { StockBySectionList } from '@/features/inventory-dashboard/components/StockBySectionList.js';

export default function ProductDashboardPage() {
  const { productId } = useParams<{ productId: string }>();
  const [days, setDays] = useState<number>(30);
  const dash = useProductDashboard(productId ?? null, days);

  if (dash.isLoading) return <div className="text-sm text-text-secondary">Loading dashboard…</div>;
  if (dash.error !== null) return <div className="text-sm text-rose-600">Failed: {String(dash.error)}</div>;
  if (dash.data === null || dash.data === undefined) return <div className="text-sm text-text-secondary">No data.</div>;

  const d = dash.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/backoffice/products" className="text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <h1 className="text-2xl font-serif text-text-primary">{d.product.name}</h1>
        <span className="text-xs text-text-secondary font-mono">{d.product.sku}</span>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <label htmlFor="dash-days" className="text-text-secondary">Window:</label>
        <select
          id="dash-days"
          value={days}
          onChange={(e) => { setDays(Number(e.target.value)); }}
          className="px-2 py-1 bg-bg-base border border-border-subtle rounded"
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-4 gap-4 text-sm">
        <Card label="Current stock" value={`${d.product.current_stock} ${d.product.unit}`} />
        <Card label="Value @ cost" value={Number(d.product.value_at_cost).toFixed(0)} />
        <Card label="Units sold" value={String(d.summary.units_sold)} />
        <Card label="Avg / day" value={Number(d.summary.avg_daily_units).toFixed(2)} />
      </div>

      <SalesVelocityChart data={d.sales_velocity_daily} unit={d.product.unit} />

      <div className="grid grid-cols-2 gap-4">
        <StockBySectionList rows={d.stock_by_section} />

        <div className="border border-border-subtle rounded-md bg-bg-elevated">
          <div className="text-xs uppercase tracking-wider text-text-secondary px-4 py-2 border-b border-border-subtle">
            Expiring lots
          </div>
          {d.expiring_lots.length === 0 ? (
            <div className="text-sm text-text-secondary p-4">No active lots.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-text-secondary">
                <tr>
                  <th className="text-left py-2 px-3">Batch</th>
                  <th className="text-right py-2 px-3">Qty</th>
                  <th className="text-right py-2 px-3">Expires in</th>
                </tr>
              </thead>
              <tbody>
                {d.expiring_lots.map((l) => (
                  <tr key={l.id} className="border-t border-border-subtle">
                    <td className="py-2 px-3 font-mono text-xs">{l.batch_number ?? l.id.slice(0, 8)}</td>
                    <td className="py-2 px-3 text-right font-mono">{Number(l.quantity)} {l.unit}</td>
                    <td className={`py-2 px-3 text-right font-mono ${l.hours_until_expiry < 24 ? 'text-rose-600' : 'text-text-secondary'}`}>
                      {Number(l.hours_until_expiry).toFixed(1)}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border border-border-subtle rounded-md bg-bg-elevated">
          <div className="text-xs uppercase tracking-wider text-text-secondary px-4 py-2 border-b border-border-subtle">
            Recent movements
          </div>
          {d.recent_movements.length === 0 ? (
            <div className="text-sm text-text-secondary p-4">No movements yet.</div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {d.recent_movements.map((m) => (
                  <tr key={m.id} className="border-t border-border-subtle">
                    <td className="py-1 px-3 font-mono text-text-secondary">
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                    <td className="py-1 px-3 font-mono">{m.movement_type}</td>
                    <td className={`py-1 px-3 text-right font-mono ${m.quantity > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {m.quantity > 0 ? '+' : ''}{m.quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border border-border-subtle rounded-md bg-bg-elevated">
          <div className="text-xs uppercase tracking-wider text-text-secondary px-4 py-2 border-b border-border-subtle">
            Top customers ({days}d)
          </div>
          {d.top_customers.length === 0 ? (
            <div className="text-sm text-text-secondary p-4">No retail sales tracked.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-text-secondary">
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
        </div>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border-subtle rounded p-3 bg-bg-elevated">
      <div className="text-xs uppercase text-text-secondary">{label}</div>
      <div className="text-lg font-mono">{value}</div>
    </div>
  );
}
