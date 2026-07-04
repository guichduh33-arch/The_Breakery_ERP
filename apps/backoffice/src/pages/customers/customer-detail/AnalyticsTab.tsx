// apps/backoffice/src/pages/customers/customer-detail/AnalyticsTab.tsx
//
// "Analytics" tab of the customer detail page: 12-month spend chart, order-type
// breakdown and top products. Co-located split (S57 E-D4) — behaviour unchanged.

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
import { Card } from '@breakery/ui';
import { useCustomerAnalytics } from '@/features/customers/hooks/useCustomerAnalytics.js';
import { CHART_GRID_STROKE, CHART_AXIS_STROKE } from '@/features/reports/utils/chartColors.js';
import { rp } from './shared.js';

export function AnalyticsTab({ customerId }: { customerId: string | null }): JSX.Element {
  const { data, isLoading } = useCustomerAnalytics(customerId);

  if (isLoading) return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">Loading…</p></Card>;
  if (!data || data.ordersConsidered === 0) {
    return <Card variant="default" padding="lg"><p className="text-sm text-text-muted">Not enough purchase history to show analytics.</p></Card>;
  }

  const typeTotal = data.byType.reduce((s, t) => s + t.orders, 0);

  return (
    <div className="space-y-4">
      <Card variant="default" padding="md">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-text-secondary">Spend — last 12 months</h2>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthly} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={CHART_AXIS_STROKE} />
              <YAxis tick={{ fontSize: 11 }} stroke={CHART_AXIS_STROKE} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} width={40} />
              <Tooltip
                formatter={(v: number) => [rp(v), 'Spend']}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="total" fill="var(--gold-base)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card variant="default" padding="md">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-text-secondary">Order type</h2>
          <div className="space-y-3">
            {data.byType.map((t) => (
              <div key={t.type}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{t.label}</span>
                  <span className="tabular-nums text-text-secondary">{t.orders} · {rp(t.total)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-base">
                  <div className="h-full rounded-full bg-gold" style={{ width: `${typeTotal > 0 ? (t.orders / typeTotal) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="default" padding="md">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-text-secondary">Top products</h2>
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-text-muted">No items.</p>
          ) : (
            <ul className="space-y-2">
              {data.topProducts.map((p) => (
                <li key={p.product_id} className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{p.name}</span>
                  <span className="tabular-nums text-text-secondary">×{p.quantity} · {rp(p.spend)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
