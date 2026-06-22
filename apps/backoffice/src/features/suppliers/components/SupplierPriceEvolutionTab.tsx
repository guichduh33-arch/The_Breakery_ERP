// apps/backoffice/src/features/suppliers/components/SupplierPriceEvolutionTab.tsx
//
// Price Evolution tab of the supplier detail page: pick products to compare,
// see their unit-price-over-time line chart, and a flat line-item table.
// Pure presentational over the supplier's purchase items.

import { useMemo, useState, type JSX } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, EmptyState, SectionLabel } from '@breakery/ui';
import { TrendingUp } from 'lucide-react';
import { formatIdr } from '@breakery/utils';
import type { SupplierPurchaseItem } from '@/features/suppliers/hooks/useSupplierPurchaseItems.js';

const PALETTE = ['var(--gold-base, #c8a874)', '#6366f1', '#16a34a', '#dc2626', '#0891b2', '#d946ef'];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' });
}

export interface SupplierPriceEvolutionTabProps {
  items: SupplierPurchaseItem[];
}

export function SupplierPriceEvolutionTab({ items }: SupplierPriceEvolutionTabProps): JSX.Element {
  const products = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of items) if (!seen.has(it.product_id)) seen.set(it.product_id, it.product_name);
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [items]);

  const colorFor = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach((p, i) => m.set(p.id, PALETTE[i % PALETTE.length] ?? 'var(--gold-base, #c8a874)'));
    return m;
  }, [products]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(products.map((p) => p.id)));

  // Re-seed selection if the product set changes (async load).
  const productKey = products.map((p) => p.id).join(',');
  const [seededKey, setSeededKey] = useState(productKey);
  if (productKey !== seededKey) {
    setSeededKey(productKey);
    setSelected(new Set(products.map((p) => p.id)));
  }

  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const it of items) {
      if (!selected.has(it.product_id)) continue;
      const point = byDate.get(it.order_date) ?? { date: it.order_date, label: fmtDate(it.order_date) };
      point[it.product_id] = it.unit_cost;
      byDate.set(it.order_date, point);
    }
    return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [items, selected]);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No price history yet"
        description="Unit-price trends appear once this supplier has purchase orders with line items."
        size="md"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <SectionLabel as="div" size="xs" className="mb-2">Select products to compare</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {products.map((p) => {
            const on = selected.has(p.id);
            const color = colorFor.get(p.id) ?? 'var(--gold-base, #c8a874)';
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                  on ? 'text-text-primary' : 'border-border-subtle text-text-muted'
                }`}
                style={on ? { borderColor: color, backgroundColor: `${color}1a` } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? color : '#cbd5e1' }} />
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      <Card variant="default" padding="md">
        <h3 className="mb-3 font-display text-base text-text-primary">Unit Price Over Time</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={56} tickFormatter={(v) => `${formatIdr(Number(v))}`} />
              <Tooltip formatter={(v: number, name: string) => [`${formatIdr(v)}`, products.find((p) => p.id === name)?.name ?? name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend formatter={(value) => products.find((p) => p.id === value)?.name ?? value} />
              {products.filter((p) => selected.has(p.id)).map((p) => (
                <Line
                  key={p.id}
                  type="monotone"
                  dataKey={p.id}
                  name={p.id}
                  stroke={colorFor.get(p.id)}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated">
        <table className="w-full text-sm">
          <thead className="border-b border-border-subtle bg-bg-base/40">
            <tr>
              <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Date</SectionLabel></th>
              <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">PO #</SectionLabel></th>
              <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Product</SectionLabel></th>
              <th className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Qty</SectionLabel></th>
              <th className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Unit Price</SectionLabel></th>
              <th className="px-4 py-3 text-right"><SectionLabel as="span" size="xs">Total</SectionLabel></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={`${it.po_id}-${it.product_id}-${i}`} className="border-t border-border-subtle">
                <td className="px-4 py-3 tabular-nums text-text-secondary">{fmtDate(it.order_date)}</td>
                <td className="px-4 py-3 font-mono text-text-primary">{it.po_number}</td>
                <td className="px-4 py-3">{it.product_name}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.quantity} {it.unit}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatIdr(it.unit_cost)}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{formatIdr(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
