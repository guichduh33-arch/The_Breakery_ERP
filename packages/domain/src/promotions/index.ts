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
// Session 13 / Phase 2.C — new shapes + offline fallback
export {
  isNewBogoShape,
  evaluateBogoNew,
  evaluateThreshold,
  evaluateBundle,
  computePromotion,
  evaluatePromotionsFallback,
  type EvaluatePromotionsFallbackOptions,
} from './bogoEngine.js';
