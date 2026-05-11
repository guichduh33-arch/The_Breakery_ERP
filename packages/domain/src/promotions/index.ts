// packages/domain/src/promotions/index.ts
// Session 9 — promotions barrel export
export * from './types.js';
export {
  matchDateRange,
  matchDayOfWeek,
  matchHour,
  matchMinTotal,
  matchCustomerCategory,
  matchCustomerTier,
  matchAllConditions,
} from './matchers.js';
export {
  computePercentage,
  computeFixed,
  computeBogo,
  computeFreeProduct,
} from './computeAmount.js';
export { evaluatePromotions, type EvaluatePromotionsOptions } from './evaluator.js';
