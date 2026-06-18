// apps/backoffice/src/features/inventory-movements/components/StockLedgerTable.tsx
// 2026-06-18 — stock-card ledger table shared by both BO stock-movement pages.
// 13 columns matching the reference spreadsheet: running balance per product +
// incoming/outgoing split + price + movement_amount. Rows must already be enriched
// (ref_no + type_label) via enrichLedgerLines.

import type { JSX } from 'react';
import type { StockLedgerRow } from '../stockLedgerColumns.js';

export interface StockLedgerTableProps {
  rows:       StockLedgerRow[];
  truncated:  boolean;
  isLoading:  boolean;
  rowCap?:    number;
}

const qtyFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
const amtFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

function fmtQty(n: number): string  { return qtyFmt.format(n); }
function fmtAmt(n: number): string  { return amtFmt.format(n); }
function fmtTime(iso: string): string { return iso.slice(0, 19).replace('T', ' '); }

const HEADERS: ReadonlyArray<{ label: string; align: 'left' | 'right' }> = [
  { label: 'date',            align: 'left'  },
  { label: 'created_time',    align: 'left'  },
  { label: 'ref_no',          align: 'left'  },
  { label: 'type',            align: 'left'  },
  { label: 'product_group',   align: 'left'  },
  { label: 'product',         align: 'left'  },
  { label: 'uom',             align: 'left'  },
  { label: 'beginning_qty',   align: 'right' },
  { label: 'incoming_qty',    align: 'right' },
  { label: 'outgoing_qty',    align: 'right' },
  { label: 'balance_qty',     align: 'right' },
  { label: 'price',           align: 'right' },
  { label: 'movement_amount', align: 'right' },
];

export function StockLedgerTable({ rows, truncated, isLoading, rowCap = 5000 }: StockLedgerTableProps): JSX.Element {
  return (
    <div className="space-y-3">
      {truncated && (
        <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700">
          Showing the first {rowCap.toLocaleString()} rows. Narrow the date range or filters to see the rest.
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border-subtle">
        <table className="w-full text-xs" data-testid="stock-ledger-table">
          <thead className="sticky top-0 bg-bg-elevated text-[11px] uppercase tracking-wide text-text-secondary">
            <tr className="border-b border-border-subtle">
              {HEADERS.map((h) => (
                <th key={h.label} className={`whitespace-nowrap px-2 py-2 font-medium ${h.align === 'right' ? 'text-right' : 'text-left'}`}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={HEADERS.length} className="px-2 py-4 text-text-secondary">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={HEADERS.length} className="px-2 py-4 text-text-secondary">No stock movements for this period.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border-subtle/60 hover:bg-bg-overlay">
                <td className="whitespace-nowrap px-2 py-1.5 text-text-secondary">{r.movement_date}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-text-secondary">{fmtTime(r.created_time)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-text-muted">{r.ref_no}</td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <span className="rounded border border-border-subtle bg-bg-base px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                    {r.type_label}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-text-secondary">{r.product_group ?? '—'}</td>
                <td className="px-2 py-1.5 font-medium text-text-primary">{r.product_name ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-text-muted">{r.unit ?? ''}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-secondary">{fmtQty(r.beginning_qty)}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${r.incoming_qty > 0 ? 'text-success' : 'text-text-muted'}`}>{fmtQty(r.incoming_qty)}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${r.outgoing_qty > 0 ? 'text-danger' : 'text-text-muted'}`}>{fmtQty(r.outgoing_qty)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold text-text-primary">{fmtQty(r.balance_qty)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-secondary">{fmtAmt(r.price)}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${r.movement_amount < 0 ? 'text-danger' : 'text-text-secondary'}`}>{fmtAmt(r.movement_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
