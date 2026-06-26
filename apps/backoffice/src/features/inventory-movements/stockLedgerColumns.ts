// apps/backoffice/src/features/inventory-movements/stockLedgerColumns.ts
// 2026-06-18 — enrich ledger lines with the generated ref_no + screenshot-style type
// label, and the shared 13-column CSV definition used by both stock-movement pages.

import { assignRefNos, movementTypeLabel, movementOrigin, type CsvColumn } from '@breakery/domain';
import type { StockLedgerLine } from './hooks/useStockLedger.js';

export interface StockLedgerRow extends StockLedgerLine {
  ref_no:     string;
  type_label: string;
  origin:     string;
}

/** Attach the per-document ref_no + uppercase type label + human origin (display order preserved). */
export function enrichLedgerLines(lines: StockLedgerLine[]): StockLedgerRow[] {
  const refs = assignRefNos(
    lines.map((l) => ({
      id:           l.id,
      movementType: l.movement_type,
      referenceId:  l.reference_id,
      createdAt:    l.created_time,
    })),
  );
  return lines.map((l) => ({
    ...l,
    ref_no:     refs.get(l.id) ?? '',
    type_label: movementTypeLabel(l.movement_type),
    origin:     movementOrigin({
      movementType:   l.movement_type,
      referenceLabel: l.reference_label,
      reason:         l.reason,
    }),
  }));
}

/** 13 columns, matching the reference stock-card spreadsheet. */
export const stockLedgerCsvColumns: CsvColumn<StockLedgerRow>[] = [
  { header: 'date',            accessor: (r) => r.movement_date,   format: 'date' },
  { header: 'created_time',    accessor: (r) => r.created_time,    format: 'datetime' },
  { header: 'ref_no',          accessor: (r) => r.ref_no,          format: 'text' },
  { header: 'type',            accessor: (r) => r.type_label,      format: 'text' },
  { header: 'product_group',   accessor: (r) => r.product_group ?? '', format: 'text' },
  { header: 'product',         accessor: (r) => r.product_name  ?? '', format: 'text' },
  { header: 'uom',             accessor: (r) => r.unit          ?? '', format: 'text' },
  { header: 'beginning_qty',   accessor: (r) => r.beginning_qty,   format: 'number' },
  { header: 'incoming_qty',    accessor: (r) => r.incoming_qty,    format: 'number' },
  { header: 'outgoing_qty',    accessor: (r) => r.outgoing_qty,    format: 'number' },
  { header: 'balance_qty',     accessor: (r) => r.balance_qty,     format: 'number' },
  { header: 'price',           accessor: (r) => r.price,           format: 'number' },
  { header: 'movement_amount', accessor: (r) => r.movement_amount, format: 'number' },
  { header: 'origin',          accessor: (r) => r.origin,          format: 'text' },
  { header: 'user',            accessor: (r) => r.created_by_name ?? '', format: 'text' },
];
