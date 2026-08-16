// packages/domain/src/orders/formatOrderNumber.ts
//
// Short display form for the source-coded order numbers introduced 2026-08-16:
// `P16082026001` = <source code><DDMMYYYY><NNN daily shared sequence>.
// Customer/kitchen surfaces (KDS, customer display, queue ticker) show the
// compact `P-001` — the date adds nothing on a same-day screen and eats space
// under rush. Receipts, order history and back office keep the full number.
//
// Legacy formats pass through unchanged: `#0001` (pre-cutover POS), `HELD-…`,
// `B2B-20260816-0001` — history keeps rendering exactly what was stored.

/** Matches <code><DDMMYYYY><seq>: P / Tn / BO + 8-digit date + 3+ digit seq. */
const SOURCE_CODED = /^(P|T[0-9]+|BO)([0-9]{8})([0-9]{3,})$/;

/**
 * Compact display form: `P16082026001` → `P-001`, `T116082026042` → `T1-042`.
 * Anything that doesn't match the source-coded format is returned unchanged.
 */
export function formatOrderNumberShort(orderNumber: string): string {
  const m = SOURCE_CODED.exec(orderNumber);
  if (!m) return orderNumber;
  return `${m[1]}-${m[3]}`;
}
