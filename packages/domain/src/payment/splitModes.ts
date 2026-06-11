// packages/domain/src/payment/splitModes.ts
// S38 POS-15 — pure helpers for equal/custom split-bill modes. IO-free.
// IDR has no decimals: amounts are integers; the LAST payer absorbs the
// rounding remainder so that sum(parts) === total exactly (RPC v11 enforces it).

export function splitEqualAmounts(total: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 2 || count > 5) {
    throw new Error(`splitEqualAmounts: count must be 2..5, got ${count}`);
  }
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`splitEqualAmounts: total must be > 0, got ${total}`);
  }
  const base = Math.floor(total / count);
  const parts = Array.from({ length: count }, () => base);
  parts[count - 1] = total - base * (count - 1);
  return parts;
}

export type CustomSplitValidation =
  | { ok: true }
  | { ok: false; reason: 'sum_mismatch'; delta: number }
  | { ok: false; reason: 'bad_count' | 'nonpositive_amount' };

export function validateCustomSplit(total: number, amounts: number[]): CustomSplitValidation {
  if (amounts.length < 2 || amounts.length > 5) return { ok: false, reason: 'bad_count' };
  if (amounts.some((a) => !Number.isFinite(a) || a <= 0)) {
    return { ok: false, reason: 'nonpositive_amount' };
  }
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (sum !== total) return { ok: false, reason: 'sum_mismatch', delta: total - sum };
  return { ok: true };
}
