// packages/domain/src/inventory/deriveStockIncrements.ts
// Session 72 — POS "Stock vitrine" quick-entry increments.
//
// The POS cafe-stock card offered hard-coded +5 / +10 / +20 chips — sensible
// for a tray of viennoiseries, absurd for a whole cake sold "à la pièce".
// There is NO `batch_size`/`pack_size` column on `products` (verified against
// types.generated.ts), so we derive sensible quick-add increments from the
// product's `unit`, with the alert threshold as a secondary hint.
//
// Pure, IO-free (packages/domain rule). Consumed by POSStockCard / POSStockRow.

/** Units sold "by the piece" — bakery counts naturally go by the dozen. */
const PIECE_UNITS = new Set([
  'piece',
  'pièce',
  'pieces',
  'pièces',
  'pc',
  'pcs',
  'unit',
  'unité',
  'unités',
  'u',
  'ea',
  'each',
]);

/** Units for heavy / whole / weighed items — small increments only. */
const WHOLE_UNITS = new Set([
  'cake',
  'gâteau',
  'gateau',
  'entier',
  'whole',
  'kg',
  'g',
  'gram',
  'gramme',
  'grammes',
  'l',
  'litre',
  'liter',
  'ml',
]);

function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? '').trim().toLowerCase();
}

/**
 * Derive up to three quick-add increments for the POS display-stock card.
 *
 * Rules (first match wins):
 *   - "piece" units  → [1, 6, 12]  (bakery dozen logic)
 *   - "whole"/weight → [1, 2]      (no bulk chips for a whole cake / by weight)
 *   - default        → [1, 5, 10]
 *
 * When `minStockThreshold >= 12`, a "restock to a batch" increment equal to the
 * threshold is appended (deduped, kept sorted) so a high-turnover item gets a
 * one-tap "fill the shelf" option. Result is always ascending, positive, unique.
 */
export function deriveStockIncrements(
  unit: string | null | undefined,
  minStockThreshold = 0,
): number[] {
  const u = normalizeUnit(unit);

  let base: number[];
  if (PIECE_UNITS.has(u)) base = [1, 6, 12];
  else if (WHOLE_UNITS.has(u)) base = [1, 2];
  else base = [1, 5, 10];

  const threshold = Math.floor(minStockThreshold);
  if (threshold >= 12 && !base.includes(threshold)) {
    base = [...base, threshold];
  }

  return Array.from(new Set(base.filter((n) => n > 0))).sort((a, b) => a - b);
}
