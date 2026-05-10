// packages/domain/src/promotions/conditions/isPromotionEligible.ts
import type { EvaluationContext, Promotion, PromotionCondition } from '../types.js';
import {
  evaluateCartTotalMin,
  evaluateProductInCart,
  evaluateCategoryInCart,
  evaluateCustomerCategoryIn,
  evaluateTimeWindow,
  evaluateWeekdayIn,
  evaluateValidDates,
  evaluateCustomerInLoyaltyTier,
  evaluateFirstOrderOnly,
} from './evaluators.js';

export function isPromotionEligible(promo: Promotion, ctx: EvaluationContext): boolean {
  return promo.conditions.all.every((cond) => evaluateCondition(cond, ctx));
}

function evaluateCondition(cond: PromotionCondition, ctx: EvaluationContext): boolean {
  switch (cond.type) {
    case 'cart_total_min':            return evaluateCartTotalMin(ctx, cond);
    case 'product_in_cart':           return evaluateProductInCart(ctx, cond);
    case 'category_in_cart':          return evaluateCategoryInCart(ctx, cond);
    case 'customer_category_in':      return evaluateCustomerCategoryIn(ctx, cond);
    case 'time_window':               return evaluateTimeWindow(ctx, cond);
    case 'weekday_in':                return evaluateWeekdayIn(ctx, cond);
    case 'valid_dates':               return evaluateValidDates(ctx, cond);
    case 'customer_in_loyalty_tier':  return evaluateCustomerInLoyaltyTier(ctx, cond);
    case 'first_order_only':          return evaluateFirstOrderOnly(ctx, cond);
  }
}
