// packages/domain/src/reports/index.ts
export {
  toLocalDateStr,
  toLocalDayStartUTC,
  toLocalDayEndUTC,
  DEFAULT_TIMEZONE,
} from './toLocalDateStr.js';

export {
  sumByHour,
  sumByCategory,
  sumByStaff,
  computeStockVariance,
  type SalesHourBucket,
  type OrderForHour,
  type CategoryLine,
  type CategoryBucket,
  type StaffOrder,
  type StaffBucket,
  type StockMovementLite,
  type StockVarianceRow,
} from './aggregations.js';

export * from './csv.js';
export * from './period.js';

export {
  PURCHASE_PRICE_RISE_THRESHOLD_PCT,
  classifyPriceDelta,
  weightedInflationPct,
  risingSpendSharePct,
  type PriceTrendClass,
  type PurchasePriceRowLite,
} from './purchasePrices.js';
