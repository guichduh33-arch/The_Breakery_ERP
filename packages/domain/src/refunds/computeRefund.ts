// packages/domain/src/refunds/computeRefund.ts
// Session 10 — pure refund amount + tax computers.
// Mirror of refund_order_rpc server math (kept in sync — server is the source of truth).

import { roundIdr } from '@breakery/utils';
import type { RefundLineDraft, RefundableItem } from './types.js';
import { computeRedemptionRefund, type RefundBreakdown, type RefundRedemptionContext } from './redemptionRefund.js';

/**
 * Pro-rata: refund_amount = round_idr(line_total * qty / line.quantity).
 * The server uses the same formula in refund_order_rpc.
 */
export function computeRefundLineAmount(line: RefundableItem, qty: number): number {
  if (line.quantity <= 0) return 0;
  return roundIdr((line.line_total * qty) / line.quantity);
}

/**
 * Sum of all refund line amounts for the given draft.
 * Returns NaN if any line refers to an item not in the lookup (caller should guard).
 */
export function computeRefundTotal(
  draft: readonly RefundLineDraft[],
  itemsById: ReadonlyMap<string, RefundableItem>,
  redemption?: RefundRedemptionContext,
): number {
  return computeRefundBreakdown(draft, itemsById, redemption).total;
}

export function computeRefundBreakdown(
  draft: readonly RefundLineDraft[],
  itemsById: ReadonlyMap<string, RefundableItem>,
  redemption?: RefundRedemptionContext,
): RefundBreakdown {
  if (redemption && redemption.points_redeemed > 0) {
    return computeRedemptionRefund(draft, itemsById, redemption);
  }
  let sum = 0;
  const amounts = new Map<string, number>();
  for (const d of draft) {
    const it = itemsById.get(d.order_item_id);
    if (!it) return { total: Number.NaN, points_restored: 0, line_amounts: amounts };
    const amount = computeRefundLineAmount(it, d.qty);
    amounts.set(d.order_item_id, amount);
    sum += amount;
  }
  return { total: sum, points_restored: 0, line_amounts: amounts };
}

/**
 * PB1 tax-inclusive: tax = round_idr(refund_total * tax_rate / (1 + tax_rate)).
 * Default tax_rate aligns with business_config (10%).
 */
export function computeRefundTax(refundTotal: number, taxRate = 0.1): number {
  return roundIdr((refundTotal * taxRate) / (1 + taxRate));
}
