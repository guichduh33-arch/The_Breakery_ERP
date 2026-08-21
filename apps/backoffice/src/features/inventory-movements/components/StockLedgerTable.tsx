// apps/backoffice/src/features/inventory-movements/components/StockLedgerTable.tsx
// 2026-06-27 — slim stock-card table: 10 value columns kept light, every row
// expandable for the movement detail (created_time, user, origin, ref_no,
// product group). Rows must already be enriched (ref_no + type_label + origin)
// via enrichLedgerLines.
//
// 2026-08-18 — fenêtre de rendu de 200 lignes + « Load more ». La table peignait
// les 5 000 lignes que la RPC peut rendre, soit ~55 000 nœuds DOM d'un coup.

import { useEffect, useMemo, useState, type JSX } from 'react';
import { ChevronRight, ChevronsUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@breakery/ui';
import { formatCurrency, formatDateTimeShortWita } from '@breakery/utils';
import type { StockLedgerRow } from '../stockLedgerColumns.js';

type SortKey = 'date' | 'type' | 'product';
type SortDir = 'asc' | 'desc';

export interface StockLedgerTableProps {
  rows:       StockLedgerRow[];
  truncated:  boolean;
  isLoading:  boolean;
  rowCap?:    number;
}

// Ce tableau était le seul du back-office à formater en `id-ID` : il rendait
// « 1.234,56 » là où tout le reste rend « 1,234.56 ». Comparer un montant du
// grand livre à celui d'un autre écran demandait de changer de convention de
// lecture en cours de route.
const qtyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

function fmtQty(n: number): string    { return qtyFmt.format(n); }
// `price` et `movement_amount` sont de l'argent : ils prennent la source unique,
// qui porte la devise et refuse les décimales — le rupiah n'en a pas.
function fmtAmt(n: number): string    { return formatCurrency(n); }
// L'ISO était tronquée à la main, donc rendue en UTC. Le jour et l'heure métier
// sont ceux d'Asia/Makassar.
function fmtTime(iso: string): string { return formatDateTimeShortWita(iso); }

// Slim main columns — keep the page readable. Detail goes in the expandable panel.
// `sort` marks the columns the user can order by (date / type / product).
// Labels are the human wording of the page subtitle (opening → in/out →
// balance), not the ledger column names: every other table in the Backoffice
// heads its columns in plain words, and a snake_case header reads as a leaked
// query. The CSV export keeps the raw field names — see stockLedgerColumns.ts.
const HEADERS: readonly { label: string; align: 'left' | 'right'; sort?: SortKey }[] = [
  { label: 'Date',    align: 'left',  sort: 'date'    },
  { label: 'Type',    align: 'left',  sort: 'type'    },
  { label: 'Product', align: 'left',  sort: 'product' },
  { label: 'Unit',    align: 'left'  },
  { label: 'Opening', align: 'right' },
  { label: 'In',      align: 'right' },
  { label: 'Out',     align: 'right' },
  { label: 'Balance', align: 'right' },
  { label: 'Price',   align: 'right' },
  { label: 'Amount',  align: 'right' },
];

const TOTAL_COLS = HEADERS.length + 1; // + the expand-toggle column

// Fenêtre de RENDU, pas de chargement. La RPC rend jusqu'à 5 000 lignes d'un
// coup et ce tableau les posait toutes dans le DOM : onze cellules par ligne,
// soit ~55 000 nœuds sur l'écran que le responsable stock ouvre le plus, depuis
// un portable de boutique. Le solde courant étant calculé SERVEUR et l'ordre
// (par produit, chronologique) portant l'information, on ne peut pas fenêtrer
// côté base sans changer la sémantique du solde d'ouverture — c'est un autre
// chantier, gaté par un bump de RPC. Ici on ne change que ce qui est PEINT.
const RENDER_PAGE = 200;

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
      <span className="text-xs uppercase tracking-wide text-text-muted">{label}</span>
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
      if (prev?.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  const sortedRows = useMemo(() => {
    if (sort === null) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => factor * compareRows(a, b, sort.key));
  }, [rows, sort]);

  // Le tri porte sur TOUTES les lignes reçues, la fenêtre ne coupe qu'après :
  // trier la fenêtre rendrait « les 200 premières, triées », ce qui n'est pas
  // la même table. Un changement de filtre ramène la fenêtre à son premier cran
  // — sans quoi une recherche plus étroite garderait le déroulé de la
  // précédente et le pied mentirait sur ce qui reste à voir.
  const [visible, setVisible] = useState<number>(RENDER_PAGE);
  useEffect(() => { setVisible(RENDER_PAGE); }, [rows]);

  const shownRows = useMemo(() => sortedRows.slice(0, visible), [sortedRows, visible]);
  const hasMore   = sortedRows.length > shownRows.length;

  return (
    <div className="space-y-3">
      {truncated && (
        <div role="alert" className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
          Showing the first {rowCap.toLocaleString('id-ID')} rows. Narrow the date range or filters to see the rest.
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border-subtle">
        <table className="w-full text-xs" data-testid="stock-ledger-table">
          <caption className="sr-only">Date, type, product, unit, opening, in, out, balance, price and amount per stock movement</caption>
          <thead className="sticky top-0 bg-surface-inert text-xs uppercase tracking-wide text-text-secondary">
            <tr className="border-b border-border-subtle">
              <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Expand</span></th>
              {HEADERS.map((h) => {
                const active = h.sort !== undefined && sort?.key === h.sort;
                const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : (h.sort ? 'none' : undefined);
                const SortIcon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
                return (
                  <th scope="col"
                    key={h.label}
                    aria-sort={ariaSort}
                    className={`whitespace-nowrap px-2 py-2 font-medium ${h.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {h.sort ? (
                      <button
                        type="button"
                        onClick={() => { onSort(h.sort!); }}
                        // `uppercase` is repeated here on purpose: the UA
                        // stylesheet sets `text-transform: none` on <button>,
                        // so the sortable headers dropped out of the thead's
                        // uppercase and rendered in a different case than the
                        // plain ones.
                        className={`inline-flex items-center gap-1 uppercase hover:text-text-primary ${active ? 'text-text-primary' : ''}`}
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
            {shownRows.flatMap((r) => {
              const isOpen = open.has(r.id);
              const mainRow = (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-border-subtle hover:bg-surface-4"
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
                    <span className="rounded border border-border-subtle bg-bg-base px-1.5 py-0.5 font-mono text-xs text-text-secondary">
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
                <tr key={`${r.id}-detail`} className="border-b border-border-subtle bg-surface-4">
                  <td className="px-2 py-2" />
                  <td colSpan={HEADERS.length} className="px-2 py-2">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
                      {/* Ces libellés étaient les noms des colonnes SQL. Le
                          fichier explique plus haut pourquoi les EN-TÊTES ont été
                          humanisés ; le panneau de détail était resté en arrière. */}
                      <DetailField label="Recorded at"   value={fmtTime(r.created_time)} />
                      <DetailField label="User"          value={r.created_by_name ?? ''} />
                      <DetailField label="Origin"        value={r.origin} />
                      <DetailField label="Reference"     value={r.ref_no} />
                      <DetailField label="Product group" value={r.product_group ?? ''} />
                    </div>
                  </td>
                </tr>
              );
              return [mainRow, detailRow];
            })}
          </tbody>
        </table>
      </div>

      {/* Le pied se rend MÊME quand la table est vide : « 0 of 0 » est une
          information, pas un vide (DESIGN.md § Tableaux). Il dit RENDU contre
          REÇU — deux nombres qui viennent de deux endroits différents — et le
          bandeau `truncated` au-dessus dit, lui, reçu contre existant. */}
      <div className="flex items-center justify-between">
        <span
          className="font-data text-xs tabular-nums text-text-muted"
          data-testid="stock-ledger-footer-count"
        >
          {shownRows.length.toLocaleString('id-ID')} of {sortedRows.length.toLocaleString('id-ID')} shown
        </span>
        {hasMore && (
          <Button
            variant="secondary"
            // `sm` (36 px) : le cran unique de « Load more » du back-office.
            // Sans lui le primitif rend son défaut `md`, soit 56 px.
            size="sm"
            onClick={() => { setVisible((n) => n + RENDER_PAGE); }}
            data-testid="stock-ledger-load-more"
          >
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}
