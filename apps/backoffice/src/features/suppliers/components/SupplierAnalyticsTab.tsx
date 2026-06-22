// apps/backoffice/src/features/suppliers/components/SupplierAnalyticsTab.tsx
//
// Analytics tab of the supplier detail page: monthly purchase volume (bars),
// monthly spend (area), top products (table), and an avg-delivery placeholder.
// Pure presentational — aggregates the supplier's purchase items + PO totals
// client-side.

import { useMemo, type JSX } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, EmptyState, SectionLabel } from '@breakery/ui';
import { Clock } from 'lucide-react';
import { formatIdr } from '@breakery/utils';
import type { SupplierPurchaseItem } from '@/features/suppliers/hooks/useSupplierPurchaseItems.js';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface MonthlyPoint {
  key: string;
  label: string;
  volume: number;
  spend: number;
}

function buildMonths(): MonthlyPoint[] {
  const now = new Date();
  const out: MonthlyPoint[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      volume: 0,
      spend: 0,
    });
  }
  return out;
}

export interface SupplierAnalyticsTabProps {
  items: SupplierPurchaseItem[];
  spendByPo: Array<{ order_date: string | null; total_amount: number }>;
}

export function SupplierAnalyticsTab({ items, spendByPo }: SupplierAnalyticsTabProps): JSX.Element {
  const monthly = useMemo(() => {
    const buckets = buildMonths();
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    for (const it of items) {
      const i = idx.get(it.order_date.slice(0, 7));
      const b = i !== undefined ? buckets[i] : undefined;
      if (b) b.volume += it.quantity;
    }
    for (const po of spendByPo) {
      if (!po.order_date) continue;
      const i = idx.get(po.order_date.slice(0, 7));
      const b = i !== undefined ? buckets[i] : undefined;
      if (b) b.spend += Number(po.total_amount ?? 0);
    }
    return buckets;
  }, [items, spendByPo]);

  const topProducts = useMemo(() => {
    const agg = new Map<string, { name: string; qty: number; total: number }>();
    for (const it of items) {
      const prev = agg.get(it.product_id) ?? { name: it.product_name, qty: 0, total: 0 };
      prev.qty += it.quantity;
      prev.total += it.subtotal;
      agg.set(it.product_id, prev);
    }
    return Array.from(agg.values())
      .map((p) => ({ ...p, avg: p.qty > 0 ? Math.round(p.total / p.qty) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [items]);

  const hasData = items.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card variant="default" padding="md">
          <h3 className="mb-3 font-display text-base text-text-primary">Monthly Purchase Volume</h3>
          <div className="h-64 w-full">
            {hasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" interval={1} />
                  <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={28} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => [v, 'Qty']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="volume" fill="var(--gold-base, #c8a874)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </div>
        </Card>

        <Card variant="default" padding="md">
          <h3 className="mb-3 font-display text-base text-text-primary">Monthly Spend (IDR)</h3>
          <div className="h-64 w-full">
            {hasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="supplierSpend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" interval={1} />
                  <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={42} tickFormatter={(v) => `${(Number(v) / 1_000_000).toFixed(1)}M`} />
                  <Tooltip formatter={(v: number) => [formatIdr(v), 'Spend']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="spend" stroke="#6366f1" strokeWidth={2} fill="url(#supplierSpend)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card variant="default" padding="md">
          <h3 className="mb-3 font-display text-base text-text-primary">Top 10 Products Purchased</h3>
          {topProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">No products purchased yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border-subtle">
                <tr>
                  <th className="py-2 text-left"><SectionLabel as="span" size="xs">Product</SectionLabel></th>
                  <th className="py-2 text-right"><SectionLabel as="span" size="xs">Qty</SectionLabel></th>
                  <th className="py-2 text-right"><SectionLabel as="span" size="xs">Total</SectionLabel></th>
                  <th className="py-2 text-right"><SectionLabel as="span" size="xs">Avg Price</SectionLabel></th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p) => (
                  <tr key={p.name} className="border-t border-border-subtle">
                    <td className="py-2.5 text-text-primary">{p.name}</td>
                    <td className="py-2.5 text-right tabular-nums">{p.qty}</td>
                    <td className="py-2.5 text-right font-medium tabular-nums">{formatIdr(p.total)}</td>
                    <td className="py-2.5 text-right tabular-nums text-text-secondary">{formatIdr(p.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card variant="default" padding="md">
          <h3 className="mb-3 font-display text-base text-text-primary">Avg Delivery Time (days)</h3>
          <EmptyState
            icon={Clock}
            title="No delivery data yet"
            description="Delivery times appear once purchase orders are marked received."
            size="sm"
          />
        </Card>
      </div>
    </div>
  );
}

function EmptyChart(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center text-sm text-text-muted">
      No purchase data in range.
    </div>
  );
}
