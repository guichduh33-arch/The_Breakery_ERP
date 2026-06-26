// apps/backoffice/src/features/inventory-movements/components/StockLedgerTable.tsx
// 2026-06-27 — slim stock-card table: 10 value columns kept light, every row
// expandable for the movement detail (created_time, user, origin, ref_no,
// product group). Rows must already be enriched (ref_no + type_label + origin)
// via enrichLedgerLines.

import { useMemo, useState, type JSX } from 'react';
import { ChevronRight, ChevronsUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import type { StockLedgerRow } from '../stockLedgerColumns.js';

type SortKey = 'date' | 'type' | 'product';
type SortDir = 'asc' | 'desc';

export interface StockLedgerTableProps {
  rows:       StockLedgerRow[];
  truncated:  boolean;
  isLoading:  boolean;
  rowCap?:    number;
}

const qtyFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
const amtFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

function fmtQty(n: number): string    { return qtyFmt.format(n); }
function fmtAmt(n: number): string    { return amtFmt.format(n); }
function fmtTime(iso: string): string { return iso.slice(0, 19).replace('T', ' '); }

// Slim main columns — keep the page readable. Detail goes in the expandable panel.
// `sort` marks the columns the user can order by (date / type / product).
const HEADERS: ReadonlyArray<{ label: string; align: 'left' | 'right'; sort?: SortKey }> = [
  { label: 'date',            align: 'left',  sort: 'date'    },
  { label: 'type',            align: 'left',  sort: 'type'    },
  { label: 'product',         align: 'left',  sort: 'product' },
  { label: 'uom',             align: 'left'  },
  { label: 'beginning_qty',   align: 'right' },
  { label: 'incoming_qty',    align: 'right' },
  { label: 'outgoing_qty',    align: 'right' },
  { label: 'balance_qty',     align: 'right' },
  { label: 'price',           align: 'right' },
  { label: 'movement_amount', align: 'right' },
];

const TOTAL_COLS = HEADERS.length + 1; // + the expand-toggle column

const collator = new Intl.Collator('id-ID', { sensitivity: 'base', numeric: true });

/** Comparator for the chosen sort key, with stable chronological tie-breaks. */
function compareRows(a: StockLedgerRow, b: StockLedgerRow, key: SortKey): number {
  switch (key) {
    case 'date':
      return a.created_time.localeCompare(b.created_time);
    case 'type': {
      const t = collator.compare(a.type_label, b.type_label);
      return t !== 0 ? t : a.created_time.localeCompare(b.created_time);
    }
    case 'product': {
      const p = collator.compare(a.product_name ?? '', b.product_name ?? '');
      return p !== 0 ? p : a.created_time.localeCompare(b.created_time);
    }
  }
}

function DetailField({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-xs text-text-primary">{value || '—'}</span>
    </div>
  );
}

export function StockLedgerTable({ rows, truncated, isLoading, rowCap = 5000 }: StockLedgerTableProps): JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // null sort = preserve the server order (per product, chronological — the running-balance order).
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  function toggle(id: string): void {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Click a sortable header: first click → asc, second → desc, third → back to server order.
  function onSort(key: SortKey): void {
    setSort((prev) => {
      if (prev === null || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  const sortedRows = useMemo(() => {
    if (sort === null) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => factor * compareRows(a, b, sort.key));
  }, [rows, sort]);

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
              <th className="w-8 px-2 py-2" aria-label="Expand" />
              {HEADERS.map((h) => {
                const active = h.sort !== undefined && sort?.key === h.sort;
                const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : (h.sort ? 'none' : undefined);
                const SortIcon = !active ? ChevronsUpDown : sort!.dir === 'asc' ? ChevronUp : ChevronDown;
                return (
                  <th
                    key={h.label}
                    aria-sort={ariaSort}
                    className={`whitespace-nowrap px-2 py-2 font-medium ${h.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {h.sort ? (
                      <button
                        type="button"
                        onClick={() => { onSort(h.sort!); }}
                        className={`inline-flex items-center gap-1 hover:text-text-primary ${active ? 'text-text-primary' : ''}`}
                      >
                        {h.label}
                        <SortIcon className="h-3 w-3 opacity-70" aria-hidden />
                      </button>
                    ) : (
                      h.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={TOTAL_COLS} className="px-2 py-4 text-text-secondary">Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={TOTAL_COLS} className="px-2 py-4 text-text-secondary">No stock movements for this period.</td></tr>
            )}
            {sortedRows.flatMap((r) => {
              const isOpen = open.has(r.id);
              const mainRow = (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-border-subtle/60 hover:bg-bg-overlay"
                  onClick={() => { toggle(r.id); }}
                >
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={isOpen ? 'Collapse movement detail' : 'Expand movement detail'}
                      onClick={(e) => { e.stopPropagation(); toggle(r.id); }}
                      className="flex items-center text-text-secondary hover:text-text-primary"
                    >
                      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden />
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-text-secondary">{r.movement_date}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className="rounded border border-border-subtle bg-bg-base px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                      {r.type_label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-medium text-text-primary">{r.product_name ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-text-muted">{r.unit ?? ''}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-secondary">{fmtQty(r.beginning_qty)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${r.incoming_qty > 0 ? 'text-success' : 'text-text-muted'}`}>{fmtQty(r.incoming_qty)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${r.outgoing_qty > 0 ? 'text-danger' : 'text-text-muted'}`}>{fmtQty(r.outgoing_qty)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold text-text-primary">{fmtQty(r.balance_qty)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-secondary">{fmtAmt(r.price)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${r.movement_amount < 0 ? 'text-danger' : 'text-text-secondary'}`}>{fmtAmt(r.movement_amount)}</td>
                </tr>
              );
              if (!isOpen) return [mainRow];
              const detailRow = (
                <tr key={`${r.id}-detail`} className="border-b border-border-subtle/60 bg-bg-base/40">
                  <td className="px-2 py-2" />
                  <td colSpan={HEADERS.length} className="px-2 py-2">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
                      <DetailField label="created_time" value={fmtTime(r.created_time)} />
                      <DetailField label="user"         value={r.created_by_name ?? ''} />
                      <DetailField label="origin"       value={r.origin} />
                      <DetailField label="ref_no"       value={r.ref_no} />
                      <DetailField label="product_group" value={r.product_group ?? ''} />
                    </div>
                  </td>
                </tr>
              );
              return [mainRow, detailRow];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
