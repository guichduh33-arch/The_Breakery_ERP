// apps/backoffice/src/features/accounting/pages/ARAgingPage.tsx
// Session 26c / Wave 2 — AR Aging pivot table (customer × bucket).

import { useMemo, type JSX } from 'react';
import { useArAging, type ArAgingRow } from '@/features/accounting/hooks/useArAging.js';

const BUCKETS = ['current', '31-60', '61-90', '90+'] as const;
type Bucket = typeof BUCKETS[number];

function fmt(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function bucketCellClass(bucket: Bucket, hasValue: boolean): string {
  if (!hasValue) return 'text-text-muted';
  switch (bucket) {
    case 'current': return 'text-green-700 font-mono';
    case '31-60':   return 'text-amber-700 font-mono';
    case '61-90':   return 'text-orange-700 font-mono';
    case '90+':     return 'text-red font-mono font-semibold';
    default:        return 'font-mono';
  }
}

interface PivotedRow {
  customer_id:       string;
  label:             string;
  buckets:           Record<Bucket, number>;
  total_outstanding: number;
  invoice_count:     number;
}

function pivot(rows: ArAgingRow[]): PivotedRow[] {
  const map = new Map<string, PivotedRow>();
  for (const r of rows) {
    const label = r.b2b_company_name ?? r.customer_name ?? '(unknown)';
    let cur = map.get(r.customer_id);
    if (!cur) {
      cur = {
        customer_id:       r.customer_id,
        label,
        buckets:           { current: 0, '31-60': 0, '61-90': 0, '90+': 0 },
        total_outstanding: 0,
        invoice_count:     0,
      };
      map.set(r.customer_id, cur);
    }
    if (BUCKETS.includes(r.bucket as Bucket)) {
      cur.buckets[r.bucket as Bucket] += Number(r.total_outstanding);
    }
    cur.total_outstanding += Number(r.total_outstanding);
    cur.invoice_count     += Number(r.invoice_count);
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export default function ARAgingPage(): JSX.Element {
  const aging = useArAging();
  const pivoted = useMemo(() => pivot(aging.data ?? []), [aging.data]);
  const totals = useMemo(() => {
    const totals: Record<Bucket, number> & { all: number } = {
      current: 0, '31-60': 0, '61-90': 0, '90+': 0, all: 0,
    };
    for (const p of pivoted) {
      for (const b of BUCKETS) totals[b] += p.buckets[b];
      totals.all += p.total_outstanding;
    }
    return totals;
  }, [pivoted]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-text-primary">AR Aging</h1>
        <p className="text-sm text-text-secondary italic">
          Outstanding B2B receivables aged by days-since-issue
          (current / 31-60 / 61-90 / 90+)
        </p>
      </div>

      {aging.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {!aging.isLoading && pivoted.length === 0 && (
        <p className="text-sm text-text-secondary">No outstanding B2B receivables.</p>
      )}

      {pivoted.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-hidden">
          <table className="w-full text-sm" data-testid="ar-aging-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2 text-right">Invoices</th>
                <th className="px-3 py-2 text-right">Current</th>
                <th className="px-3 py-2 text-right">31-60</th>
                <th className="px-3 py-2 text-right">61-90</th>
                <th className="px-3 py-2 text-right">90+</th>
                <th className="px-3 py-2 text-right">Total outstanding</th>
              </tr>
            </thead>
            <tbody>
              {pivoted.map((row) => (
                <tr
                  key={row.customer_id}
                  data-testid={`ar-aging-row-${row.customer_id}`}
                  className="border-t border-border-subtle"
                >
                  <td className="px-3 py-2">{row.label}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.invoice_count}</td>
                  {BUCKETS.map((b) => {
                    const v = row.buckets[b];
                    return (
                      <td
                        key={b}
                        className={`px-3 py-2 text-right ${bucketCellClass(b, v > 0)}`}
                      >
                        {v > 0 ? fmt(v) : '—'}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {fmt(row.total_outstanding)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-strong font-semibold">
                <td className="px-3 py-2 text-right">Total</td>
                <td></td>
                {BUCKETS.map((b) => (
                  <td
                    key={b}
                    className={`px-3 py-2 text-right ${bucketCellClass(b, totals[b] > 0)}`}
                  >
                    {totals[b] > 0 ? fmt(totals[b]) : '—'}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono" data-testid="ar-aging-grand-total">
                  {fmt(totals.all)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
