// packages/domain/src/promotions/conditions/evaluators.ts
// Spec §3.4 — 9 condition types. Mirror server-side logic.

import type { EvaluationContext, PromotionCondition } from '../types.js';

export function evaluateCartTotalMin(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'cart_total_min' }>,
): boolean {
  const subtotal = ctx.items.reduce(
    (sum, i) => sum + i.qty * (i.unit_price + i.modifier_total) - i.manual_discount_amount,
    0,
  );
  return subtotal >= cond.value;
}

export function evaluateProductInCart(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'product_in_cart' }>,
): boolean {
  const qty = ctx.items
    .filter((i) => i.product_id === cond.product_id)
    .reduce((sum, i) => sum + i.qty, 0);
  return qty >= cond.min_qty;
}

export function evaluateCategoryInCart(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'category_in_cart' }>,
): boolean {
  const qty = ctx.items
    .filter((i) => i.category_id === cond.category_id)
    .reduce((sum, i) => sum + i.qty, 0);
  return qty >= cond.min_qty;
}

export function evaluateCustomerCategoryIn(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'customer_category_in' }>,
): boolean {
  if (ctx.customer_category_id === null) return false;
  return cond.category_ids.includes(ctx.customer_category_id);
}

function localTimeFields(ts: Date, tz: string): { time: string; dow: number; date: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(ts).map((p) => [p.type, p.value]));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    time: `${parts.hour}:${parts.minute}`,
    dow: dowMap[parts.weekday] ?? 0,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function evaluateTimeWindow(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'time_window' }>,
): boolean {
  const { time } = localTimeFields(ctx.evaluation_ts, cond.tz);
  return time >= cond.start && time <= cond.end;
}

export function evaluateWeekdayIn(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'weekday_in' }>,
): boolean {
  const { dow } = localTimeFields(ctx.evaluation_ts, 'Asia/Jakarta');
  return cond.days.includes(dow);
}

export function evaluateValidDates(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'valid_dates' }>,
): boolean {
  const { date } = localTimeFields(ctx.evaluation_ts, 'Asia/Jakarta');
  return date >= cond.from && date <= cond.until;
}

export function evaluateCustomerInLoyaltyTier(
  ctx: EvaluationContext,
  cond: Extract<PromotionCondition, { type: 'customer_in_loyalty_tier' }>,
): boolean {
  return cond.tiers.includes(ctx.customer_tier);
}

export function evaluateFirstOrderOnly(
  ctx: EvaluationContext,
  _cond: Extract<PromotionCondition, { type: 'first_order_only' }>,
): boolean {
  return ctx.customer_first_order;
}
