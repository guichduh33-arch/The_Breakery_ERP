// packages/domain/src/promotions/actions/computePotentialDiscount.ts
// Spec §3.8 — math discount par action_type. Mirror engine RPC.
import { roundIdr } from '@breakery/utils';
import type { EvaluationContext, ItemToAdd, Promotion } from '../types.js';

export interface PotentialDiscount {
  discount: number;
  items_to_add: ItemToAdd[];
  target: 'cart' | 'item';
  target_product_id: string | null;
}

export function computePotentialDiscount(
  promo: Promotion,
  ctx: EvaluationContext,
  retailPrices: Record<string, number>,
): PotentialDiscount {
  const subtotal = ctx.items.reduce(
    (sum, i) => sum + i.qty * (i.unit_price + i.modifier_total) - i.manual_discount_amount,
    0,
  );

  if (promo.action_type === 'percentage_off') {
    return computePercentageOff(promo, ctx, subtotal);
  }

  if (promo.action_type === 'fixed_off') {
    const amount = Number(promo.action_params.amount ?? 0);
    return { discount: Math.min(amount, subtotal), items_to_add: [], target: 'cart', target_product_id: null };
  }

  if (promo.action_type === 'bogo') {
    return computeBogo(promo, ctx, retailPrices);
  }

  return computeFreeProduct(promo, retailPrices);
}

function computePercentageOff(
  promo: Promotion,
  ctx: EvaluationContext,
  subtotal: number,
): PotentialDiscount {
  const pct = Number(promo.action_params.percentage ?? 0);
  const target = String(promo.action_params.target ?? 'cart');
  const targetId = (promo.action_params.target_id as string) ?? null;
  if (target === 'cart') {
    return { discount: roundIdr((subtotal * pct) / 100), items_to_add: [], target: 'cart', target_product_id: null };
  }
  const matchingSubtotal = ctx.items
    .filter((i) => (target === 'category' ? i.category_id === targetId : i.product_id === targetId))
    .reduce((sum, i) => sum + i.qty * (i.unit_price + i.modifier_total) - i.manual_discount_amount, 0);
  return {
    discount: Math.round((matchingSubtotal * pct) / 100),
    items_to_add: [],
    target: 'item',
    target_product_id: target === 'product' ? targetId : null,
  };
}

function computeBogo(
  promo: Promotion,
  ctx: EvaluationContext,
  retailPrices: Record<string, number>,
): PotentialDiscount {
  const buyProductId = String(promo.action_params.buy_product_id);
  const buyQty = Number(promo.action_params.buy_qty ?? 1);
  const getQty = Number(promo.action_params.get_qty ?? 1);
  const getDiscountPct = Number(promo.action_params.get_discount_pct ?? 100);
  const matchingQty = ctx.items.filter((i) => i.product_id === buyProductId).reduce((s, i) => s + i.qty, 0);
  const pairs = Math.floor(matchingQty / (buyQty + getQty));
  const unitPrice = retailPrices[buyProductId] ?? 0;
  const discountPerUnit = roundIdr((unitPrice * getDiscountPct) / 100);
  const discount = pairs * getQty * discountPerUnit;
  return {
    discount,
    items_to_add: pairs > 0 ? [{
      product_id: buyProductId,
      qty: pairs * getQty,
      unit_price: unitPrice,
      promotion_discount: discountPerUnit,
      is_free_from_promo: getDiscountPct === 100,
      split_from_existing: true,
    }] : [],
    target: 'item',
    target_product_id: buyProductId,
  };
}

function computeFreeProduct(
  promo: Promotion,
  retailPrices: Record<string, number>,
): PotentialDiscount {
  const freeProductId = String(promo.action_params.product_id);
  const freeQty = Number(promo.action_params.qty ?? 1);
  const unitPrice = retailPrices[freeProductId] ?? 0;
  return {
    discount: unitPrice * freeQty,
    items_to_add: [{
      product_id: freeProductId,
      qty: freeQty,
      unit_price: unitPrice,
      promotion_discount: unitPrice,
      is_free_from_promo: true,
      split_from_existing: false,
    }],
    target: 'item',
    target_product_id: freeProductId,
  };
}
