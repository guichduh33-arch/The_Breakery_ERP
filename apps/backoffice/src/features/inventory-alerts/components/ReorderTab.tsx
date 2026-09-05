// apps/backoffice/src/features/inventory-alerts/components/ReorderTab.tsx
// Session 13 / Phase 2.D — Reorder Suggestions tab.
//
// Refonte design 2026-08-08 — DataTable partagé, et les deux réglages de
// fenêtre passent en contrôles étiquetés au-dessus de la table plutôt qu'en
// champs nus. La formule reste affichée : une quantité suggérée dont on ne voit
// pas le calcul est un ordre, pas une suggestion.

import { useState, type JSX } from 'react';
import { DataTable, type DataTableColumn } from '@breakery/ui';
import { formatDateShortWita, formatNumber, formatQuantity } from '@breakery/utils';
import { useReorderSuggestions, type ReorderSuggestion } from '../hooks/useReorderSuggestions.js';
import { ProductCell } from './ProductCell.js';

const FIELD =
  'h-9 w-20 rounded-sm border border-border-strong bg-bg-elevated px-2 font-data text-xs text-text-primary ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

/** Sous 3 jours de couverture, la ligne cesse d'être une suggestion. */
function coverageTone(days: number | null): string {
  if (days === null) return 'text-text-muted';
  return days < 3 ? 'text-danger font-semibold' : 'text-text-primary';
}

const COLUMNS: DataTableColumn<ReorderSuggestion>[] = [
  {
    id: 'product',
    header: 'Product',
    render: (r) => <ProductCell productId={r.product_id} name={r.product_name} secondary={r.product_sku} />,
  },
  {
    id: 'stock',
    header: 'On hand',
    align: 'right',
    render: (r) => (
      <span className="font-data text-xs tabular-nums">{formatQuantity(r.current_stock, r.unit)}</span>
    ),
  },
  {
    id: 'avg_daily',
    header: 'Daily use',
    align: 'right',
    // Une consommation par jour n'est pas un stock : elle se mesure en
    // unités/jour et vaut souvent moins de un. On la passe donc SANS unité,
    // pour garder ses décimales — arrondie à l'entier comme le serait un stock
    // en pièces, une conso de 0,4 pcs/jour se lirait « 0 » ou « 1 ».
    render: (r) => (
      <span className="font-data text-xs tabular-nums">{formatQuantity(r.avg_daily_usage, null)}</span>
    ),
  },
  {
    id: 'coverage',
    header: 'Coverage',
    align: 'right',
    render: (r) => (
      <span className={`font-data text-xs ${coverageTone(r.days_of_stock)}`}>
        {r.days_of_stock === null ? '—' : `${formatNumber(r.days_of_stock, { digits: 1 })} d`}
      </span>
    ),
  },
  {
    id: 'suggested',
    header: 'Order qty',
    align: 'right',
    render: (r) => (
      <span className="font-data text-xs font-semibold tabular-nums">
        {formatQuantity(r.suggested_order_qty, r.unit)}
      </span>
    ),
  },
  {
    id: 'supplier',
    header: 'Last supplier',
    render: (r) => (
      <div className="min-w-0">
        <span className="text-xs text-text-secondary">{r.supplier_name ?? '—'}</span>
        {r.last_purchase_at !== null && (
          <div className="font-data text-xs text-text-muted tabular-nums">
            {formatDateShortWita(r.last_purchase_at)}
          </div>
        )}
      </div>
    ),
  },
];

export function ReorderTab(): JSX.Element {
  const [lookback, setLookback] = useState<number>(30);
  const [buffer, setBuffer] = useState<number>(14);
  const q = useReorderSuggestions(lookback, buffer);

  const rows = q.data ?? [];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="reorder-lookback" className="font-data text-xs uppercase tracking-widest text-text-muted">
            Lookback (days)
          </label>
          <input
            id="reorder-lookback"
            type="number"
            min={1}
            value={lookback}
            onChange={(e) => { setLookback(Math.max(1, Number(e.target.value) || 30)); }}
            className={FIELD}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reorder-buffer" className="font-data text-xs uppercase tracking-widest text-text-muted">
            Buffer (days)
          </label>
          <input
            id="reorder-buffer"
            type="number"
            min={1}
            value={buffer}
            onChange={(e) => { setBuffer(Math.max(1, Number(e.target.value) || 14)); }}
            className={FIELD}
          />
        </div>
        <p className="pb-1 font-data text-xs text-text-muted">
          order qty = max(0, daily use × buffer − on hand)
        </p>
      </div>

      {q.error !== null ? (
        <p className="text-sm text-danger" role="alert">Failed to load suggestions: {q.error.message}</p>
      ) : (
        <DataTable<ReorderSuggestion>
          caption="Product, quantity on hand, daily use, coverage, order quantity and last supplier per reorder suggestion"
          columns={COLUMNS}
          rows={rows}
          getRowKey={(r) => r.product_id}
          isLoading={q.isLoading}
          density="compact"
          emptyTitle="Nothing to reorder"
          emptyDescription="No product runs out within the buffer window."
          data-testid="reorder-table"
          footer={
            <span className="font-data text-xs text-text-muted tabular-nums">
              {rows.length} {rows.length === 1 ? 'suggestion' : 'suggestions'} · {lookback} d lookback · {buffer} d buffer
            </span>
          }
        />
      )}
    </div>
  );
}
