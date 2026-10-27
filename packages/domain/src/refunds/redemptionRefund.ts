import type { RefundableItem, RefundLineDraft } from './types.js';

export interface RefundRedemptionContext {
  order_total: number;
  prior_refunds_total: number;
  points_redeemed: number;
}

export interface RefundBreakdown {
  total: number;
  points_restored: number;
  line_amounts: ReadonlyMap<string, number>;
}

interface Fraction { n: bigint; d: bigint }
const zero: Fraction = { n: 0n, d: 1n };

function fraction(n: bigint, d = 1n): Fraction {
  let a = n < 0n ? -n : n;
  let b = d;
  while (b !== 0n) [a, b] = [b, a % b];
  return { n: n / (a || 1n), d: d / (a || 1n) };
}
function add(a: Fraction, b: Fraction): Fraction {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}
function share(value: bigint, part: Fraction, whole: Fraction): Fraction {
  return fraction(value * part.n * whole.d, part.d * whole.n);
}
function scaled(value: number, scale: number): bigint {
  const integer = Math.round(value * scale);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(integer)) {
    throw new Error('invalid_refund_value');
  }
  return BigInt(integer);
}
function roundCash(value: Fraction): bigint {
  // Même quantum positif que round_idr : 100 IDR, représentés en centimes.
  const quantum = 10_000n;
  return ((2n * value.n + value.d * quantum) / (2n * value.d * quantum)) * quantum;
}

/** Répartit le paiement net et restitue les points utilisés, sans IO ni arrondi flottant. */
export function computeRedemptionRefund(
  draft: readonly RefundLineDraft[],
  items: ReadonlyMap<string, RefundableItem>,
  context: RefundRedemptionContext,
): RefundBreakdown {
  const invalid = (): RefundBreakdown => ({ total: Number.NaN, points_restored: 0, line_amounts: new Map() });
  try {
    if (!draft.length) return { total: 0, points_restored: 0, line_amounts: new Map() };
    const requested = new Map<string, bigint>();
    for (const line of draft) {
      if (!items.has(line.order_item_id) || requested.has(line.order_item_id)) return invalid();
      requested.set(line.order_item_id, scaled(line.qty, 1000));
    }
    let gross = zero;
    let prior = zero;
    let selected = zero;
    let allReturned = true;
    const weights = new Map<string, Fraction>();
    for (const item of items.values()) {
      if (item.is_cancelled) continue;
      const quantity = scaled(item.quantity, 1000);
      if (quantity === 0n) return invalid();
      const amount = scaled(item.line_total, 100);
      const already = scaled(item.qty_already_refunded, 1000);
      const qty = requested.get(item.order_item_id) ?? 0n;
      if (already + qty > quantity) return invalid();
      gross = add(gross, fraction(amount));
      prior = add(prior, fraction(amount * already, quantity));
      const weight = fraction(amount * qty, quantity);
      selected = add(selected, weight);
      weights.set(item.order_item_id, weight);
      if (amount > 0n && already + qty < quantity) allReturned = false;
    }
    if (gross.n <= 0n || selected.n <= 0n) return invalid();
    const cumulative = allReturned ? gross : add(prior, selected);
    const paid = scaled(context.order_total, 100);
    const refunded = scaled(context.prior_refunds_total, 100);
    const target = allReturned ? paid : roundCash(share(paid, cumulative, gross));
    const capped = target > paid ? paid : target;
    const cash = capped > refunded ? capped - refunded : 0n;
    const points = scaled(context.points_redeemed, 1);
    const after = share(points, cumulative, gross);
    const before = share(points, prior, gross);
    const restored = after.n / after.d - before.n / before.d;
    const lineAmounts = new Map<string, number>();
    let cumulativeWeight = zero;
    let allocated = 0n;
    for (const line of draft) {
      cumulativeWeight = add(cumulativeWeight, weights.get(line.order_item_id) ?? zero);
      const last = cumulativeWeight.n * selected.d === selected.n * cumulativeWeight.d;
      const next = last ? cash : roundCash(share(cash, cumulativeWeight, selected));
      const limited = next > cash ? cash : next;
      lineAmounts.set(line.order_item_id, Number(limited - allocated) / 100);
      allocated = limited;
    }
    return { total: Number(cash) / 100, points_restored: Number(restored), line_amounts: lineAmounts };
  } catch {
    return invalid();
  }
}
