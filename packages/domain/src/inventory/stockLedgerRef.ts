// packages/domain/src/inventory/stockLedgerRef.ts
// 2026-06-18 — stock-card ledger presentation helpers (pure, IO-free).
// Drive the generated `ref_no` code + screenshot-style `type` label rendered on
// the Backoffice stock-movement pages. The DB RPC returns raw rows; the ref_no is
// synthesized here so the sequence is per loaded result set.

/** Screenshot-style uppercase label for a movement_type. */
export function movementTypeLabel(movementType: string): string {
  switch (movementType) {
    case 'sale':                  return 'POS_SALE';
    case 'opname_in':
    case 'opname_out':            return 'OPNAME';
    case 'cost_price_correction': return 'COST_CORRECTION';
    default:                      return movementType.toUpperCase();
  }
}

/** 2-letter prefix for the generated ref_no, keyed by movement_type. */
export function movementRefPrefix(movementType: string): string {
  switch (movementType) {
    case 'sale':
    case 'sale_void':             return 'SL';
    case 'production':
    case 'production_in':
    case 'production_out':        return 'SP';
    case 'purchase':
    case 'purchase_return':       return 'PO';
    case 'incoming':              return 'IN';
    case 'transfer_in':
    case 'transfer_out':          return 'TR';
    case 'adjustment':
    case 'adjustment_in':
    case 'adjustment_out':        return 'AD';
    case 'opname_in':
    case 'opname_out':            return 'OP';
    case 'waste':                 return 'WS';
    case 'cost_price_correction': return 'CC';
    case 'reservation_hold':
    case 'reservation_release':   return 'RS';
    default:                      return 'MV';
  }
}

function yymmdd(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

export interface BuildRefNoInput {
  movementType: string;
  date:         string | Date;
  seq:          number;
}

/** `<PREFIX><yymmdd><8-digit seq>` — e.g. OP26061500000081. */
export function buildMovementRefNo({ movementType, date, seq }: BuildRefNoInput): string {
  return movementRefPrefix(movementType) + yymmdd(date) + String(seq).padStart(8, '0');
}

export interface LedgerLineForRef {
  id:          string;
  movementType: string;
  referenceId: string | null;
  createdAt:   string;
}

/**
 * Assign a generated ref_no to each line, walking them in display order.
 * - Lines sharing a `referenceId` share one code (one source document).
 * - Lines with a null `referenceId` each get their own code (keyed by row id).
 * - The sequence increments per prefix, in order of first appearance.
 *
 * Returns a Map keyed by line id → ref_no.
 */
export function assignRefNos(lines: ReadonlyArray<LedgerLineForRef>): Map<string, string> {
  const out            = new Map<string, string>();
  const perPrefixCount = new Map<string, number>(); // prefix -> last seq assigned
  const groupCode      = new Map<string, string>(); // groupKey -> ref_no

  for (const line of lines) {
    const groupKey = line.referenceId ?? `row:${line.id}`;
    let code = groupCode.get(groupKey);
    if (code === undefined) {
      const prefix = movementRefPrefix(line.movementType);
      const next   = (perPrefixCount.get(prefix) ?? 0) + 1;
      perPrefixCount.set(prefix, next);
      code = buildMovementRefNo({ movementType: line.movementType, date: line.createdAt, seq: next });
      groupCode.set(groupKey, code);
    }
    out.set(line.id, code);
  }
  return out;
}
