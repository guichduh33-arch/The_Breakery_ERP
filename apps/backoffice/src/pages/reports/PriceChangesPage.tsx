// apps/backoffice/src/pages/reports/PriceChangesPage.tsx
// S40 Wave B3 — Price changes report: product filter, old→new price, delta %, truncated banner.

import { useState } from 'react';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import {
  usePriceChanges,
  type PriceChangeLine,
} from '@/features/reports/hooks/usePriceChanges.js';

const csvColumns: CsvColumn<PriceChangeLine>[] = [
  { header: 'Date',          accessor: (r) => r.changed_at.slice(0, 10), format: 'text' },
  { header: 'Product',       accessor: (r) => r.product_name,            format: 'text' },
  { header: 'Actor',         accessor: (r) => r.actor_name,              format: 'text' },
  { header: 'Old Price',     accessor: (r) => r.old_price ?? '',         format: 'text' },
  { header: 'New Price',     accessor: (r) => r.new_price,               format: 'idr-round100' },
  { header: 'Delta (%)',     accessor: (r) => r.delta_pct ?? '',         format: 'text' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

interface ProductOption {
  id:   string;
  name: string;
}

function useActiveProducts() {
  return useQuery<ProductOption[]>({
    queryKey: ['products-for-price-filter'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ProductOption[];
    },
  });
}

function fmtIdr(v: number): string {
  return v.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

function deltaBadge(pct: number | null): JSX.Element {
  if (pct === null) {
    return <span className="text-text-secondary text-xs">—</span>;
  }
  const cls = pct > 0
    ? 'inline-flex rounded px-1 py-0.5 text-xs font-medium bg-red-100 text-red-700'
    : pct < 0
      ? 'inline-flex rounded px-1 py-0.5 text-xs font-medium bg-green-100 text-green-700'
      : 'inline-flex rounded px-1 py-0.5 text-xs font-medium bg-surface-raised text-text-secondary';
  return <span className={cls}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>;
}

export default function PriceChangesPage() {
  const [start,     setStart]     = useState<string>(defaultStart);
  const [end,       setEnd]       = useState<string>(() => toLocalDateStr(new Date()));
  const [productId, setProductId] = useState<string>('');

  const { data, isLoading, error } = usePriceChanges({
    start,
    end,
    product_id: productId || null,
  });

  const { data: products } = useActiveProducts();

  const changes = data?.changes ?? [];

  return (
    <ReportPage
      title="Price Changes"
      subtitle="Retail price change log for all products across a date range."
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          {/* Native product filter — NOT @breakery/ui Select per task spec */}
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <span>Product</span>
            <select
              className="h-9 rounded-md border border-border-subtle bg-surface px-2 text-sm text-text-primary"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              aria-label="Filter by product"
            >
              <option value="">All products</option>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {data && (
            <ExportButtons
              csv={{ rows: changes, columns: csvColumns, filename: `price-changes-${start}_${end}` }}
            />
          )}
        </div>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load report.'}
        </p>
      )}
      {data?.truncated && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700" role="status">
          First 500 rows shown — narrow the date range to see all changes.
        </p>
      )}
      {data && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">Date</th>
              <th className="py-2 text-left">Product</th>
              <th className="py-2 text-left">Actor</th>
              <th className="py-2 text-right">Old Price</th>
              <th className="py-2 text-right">New Price</th>
              <th className="py-2 text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {changes.length === 0 && (
              <tr>
                <td className="py-3 text-text-secondary" colSpan={6}>
                  No price changes recorded for this period.
                </td>
              </tr>
            )}
            {changes.map((r, idx) => (
              <tr key={`${r.product_id}-${r.changed_at}-${idx}`} className="border-b border-border-subtle">
                <td className="py-2 text-text-secondary">{r.changed_at.slice(0, 10)}</td>
                <td className="py-2 font-medium">
                  <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                </td>
                <td className="py-2 text-text-secondary">{r.actor_name}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">
                  {r.old_price === null ? <span className="italic">first recorded</span> : fmtIdr(r.old_price)}
                </td>
                <td className="py-2 text-right tabular-nums">{fmtIdr(r.new_price)}</td>
                <td className="py-2 text-right tabular-nums">{deltaBadge(r.delta_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportPage>
  );
}
