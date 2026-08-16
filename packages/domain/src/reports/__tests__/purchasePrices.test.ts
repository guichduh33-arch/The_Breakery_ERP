// packages/domain/src/reports/__tests__/purchasePrices.test.ts
import { describe, expect, it } from 'vitest';
import {
  PURCHASE_PRICE_RISE_THRESHOLD_PCT,
  classifyPriceDelta,
  risingSpendSharePct,
  weightedInflationPct,
} from '../purchasePrices.js';

describe('classifyPriceDelta', () => {
  it('classifies around the ±2% default threshold', () => {
    expect(PURCHASE_PRICE_RISE_THRESHOLD_PCT).toBe(2);
    expect(classifyPriceDelta(5)).toBe('up');
    expect(classifyPriceDelta(2)).toBe('flat');    // borne incluse dans flat
    expect(classifyPriceDelta(-2)).toBe('flat');
    expect(classifyPriceDelta(-2.01)).toBe('down');
    expect(classifyPriceDelta(0)).toBe('flat');
  });

  it('treats a missing comparison as new, never flat', () => {
    expect(classifyPriceDelta(null)).toBe('new');
    expect(classifyPriceDelta(Number.NaN)).toBe('new');
  });

  it('honours a custom threshold', () => {
    expect(classifyPriceDelta(3, 5)).toBe('flat');
    expect(classifyPriceDelta(6, 5)).toBe('up');
  });
});

describe('weightedInflationPct', () => {
  it('weights deltas by current spend', () => {
    // (100×10 + 300×(−2)) / 400 = 1
    expect(weightedInflationPct([
      { spend: 100, delta_pct: 10 },
      { spend: 300, delta_pct: -2 },
    ])).toBe(1);
  });

  it('ignores rows without a comparison and returns null when none is comparable', () => {
    expect(weightedInflationPct([
      { spend: 100, delta_pct: 10 },
      { spend: 900, delta_pct: null },   // nouvel article : hors calcul
    ])).toBe(10);
    expect(weightedInflationPct([{ spend: 100, delta_pct: null }])).toBeNull();
    expect(weightedInflationPct([])).toBeNull();
  });

  it('ignores non-positive spend', () => {
    expect(weightedInflationPct([
      { spend: 0, delta_pct: 50 },
      { spend: 100, delta_pct: 4 },
    ])).toBe(4);
  });
});

describe('risingSpendSharePct', () => {
  it('reports rising spend over the WHOLE basket, new articles included', () => {
    // up: 300 ; total: 300 + 100 + 600 = 1000 → 30 %
    expect(risingSpendSharePct([
      { spend: 300, delta_pct: 8 },
      { spend: 100, delta_pct: -5 },
      { spend: 600, delta_pct: null },
    ])).toBe(30);
  });

  it('returns null on an empty basket', () => {
    expect(risingSpendSharePct([])).toBeNull();
    expect(risingSpendSharePct([{ spend: 0, delta_pct: 5 }])).toBeNull();
  });
});
