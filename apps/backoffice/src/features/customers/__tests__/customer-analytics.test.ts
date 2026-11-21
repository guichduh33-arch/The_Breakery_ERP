// apps/backoffice/src/features/customers/__tests__/customer-analytics.test.ts
//
// Agrégats de l'onglet Analytics : fuseau métier, courbe qui part du premier
// achat (semaines sous 90 jours, mois au-delà), rythme de visite, parts.

import { describe, it, expect } from 'vitest';
import { bizParts, buildCustomerAnalytics, type RecognizedOrderRow } from '../customerAnalytics.js';

const order = (id: string, at: string, total: number, type: RecognizedOrderRow['order_type'] = 'dine_in'): RecognizedOrderRow =>
  ({ id, recognized_at: at, total, order_type: type });

describe('bizParts', () => {
  it('reads date, hour and weekday in Asia/Makassar, not in the browser zone', () => {
    // 2026-11-20 23:30 UTC = samedi 21 novembre 07:30 à Lombok.
    expect(bizParts('2026-11-20T23:30:00Z')).toMatchObject({ y: 2026, m: 11, d: 21, hour: 7, weekday: 5 });
  });
});

describe('buildCustomerAnalytics', () => {
  const now = new Date('2026-11-21T04:00:00Z'); // samedi 12:00 à Lombok

  it('starts the trend at the first purchase, weekly under 90 days', () => {
    const a = buildCustomerAnalytics([
      order('a', '2026-10-05T01:00:00Z', 50_000),
      order('b', '2026-11-20T01:00:00Z', 30_000),
    ], [], now);
    expect(a.granularity).toBe('week');
    // Semaine du lundi 5 octobre → semaine du lundi 16 novembre : 7 semaines.
    expect(a.trend).toHaveLength(7);
    expect(a.trend[0]).toMatchObject({ label: '5 Oct', total: 50_000, orders: 1 });
    expect(a.trend.at(-1)).toMatchObject({ label: '16 Nov', total: 30_000 });
  });

  it('switches to months past 90 days, capped at 12 points, and says it clipped', () => {
    const a = buildCustomerAnalytics([order('a', '2025-01-10T01:00:00Z', 10_000)], [], now);
    expect(a.granularity).toBe('month');
    expect(a.trend).toHaveLength(12);
    expect(a.trend.at(-1)?.label).toBe('Nov 26');
    expect(a.trendClipped).toBe(true);
  });

  // 85 à 89 jours d'historique = 13 lundis : à la semaine, la première serait
  // tombée du graphe. On passe au mois, et la somme des barres = le total.
  it('never drops early weeks: 13 Mondays switch to months with the full total', () => {
    const a = buildCustomerAnalytics([
      order('a', '2026-08-24T01:00:00Z', 70_000), // lundi, 13 semaines avant le 16 nov.
      order('b', '2026-11-20T01:00:00Z', 30_000),
    ], [], now);
    expect(a.granularity).toBe('month');
    expect(a.trendClipped).toBe(false);
    expect(a.trend.reduce((s, p) => s + p.total, 0)).toBe(a.totalSpend);
  });

  it('keeps the trend when the last sale is later than the local clock', () => {
    const a = buildCustomerAnalytics([order('a', '2026-12-02T01:00:00Z', 10_000)], [], now);
    expect(a.trend.reduce((s, p) => s + p.total, 0)).toBe(10_000);
  });

  it('accepts totals sent as strings and lines without product id', () => {
    const a = buildCustomerAnalytics(
      [{ id: 'a', recognized_at: '2026-11-16T02:00:00Z', total: '45000.00', order_type: 'dine_in' }],
      [{ product_id: null, name_snapshot: 'Custom cake', quantity: '2', line_total: '45000.00' }],
      now,
    );
    expect(a.totalSpend).toBe(45_000);
    expect(a.topProducts[0]).toMatchObject({ product_id: 'Custom cake', quantity: 2, spend: 45_000 });
  });

  it('computes spend, basket, rhythm on distinct business days and days since last order', () => {
    const a = buildCustomerAnalytics([
      order('a', '2026-11-10T01:00:00Z', 40_000),
      order('b', '2026-11-10T05:00:00Z', 20_000), // même jour : une seule visite
      order('c', '2026-11-14T01:00:00Z', 30_000),
      order('d', '2026-11-18T01:00:00Z', 30_000),
    ], [], now);
    expect(a.totalSpend).toBe(120_000);
    expect(a.avgBasket).toBe(30_000);
    expect(a.visitDays).toBe(3);
    expect(a.avgDaysBetween).toBe(4);
    expect(a.daysSinceLast).toBe(3);
  });

  it('has no rhythm with a single visit day', () => {
    const a = buildCustomerAnalytics([order('a', '2026-11-10T01:00:00Z', 10_000)], [], now);
    expect(a.avgDaysBetween).toBeNull();
  });

  it('splits orders by weekday, daypart and order type with shares', () => {
    const a = buildCustomerAnalytics([
      order('a', '2026-11-16T00:30:00Z', 10_000, 'dine_in'),  // lundi 08:30 → avant 9 h
      order('b', '2026-11-16T02:00:00Z', 10_000, 'take_out'), // lundi 10:00 → matin
      order('c', '2026-11-21T02:00:00Z', 10_000, 'dine_in'),  // samedi 10:00 → matin
    ], [], now);
    expect(a.byWeekday[0]).toMatchObject({ label: 'Monday', orders: 2 });
    expect(a.byWeekday[5]).toMatchObject({ label: 'Saturday', orders: 1 });
    expect(a.byDaypart.find((d) => d.key === 'early')?.orders).toBe(1);
    expect(a.byDaypart.find((d) => d.key === 'morning')?.orders).toBe(2);
    expect(a.byType).toEqual([
      expect.objectContaining({ key: 'dine_in', orders: 2 }),
      expect.objectContaining({ key: 'take_out', orders: 1 }),
    ]);
    expect(a.byType[0]?.share).toBeCloseTo(66.67, 1);
  });

  it('ranks products by quantity with their share of spend', () => {
    const a = buildCustomerAnalytics([order('a', '2026-11-16T02:00:00Z', 100_000)], [
      { product_id: 'p1', name_snapshot: 'Croissant', quantity: 3, line_total: 30_000 },
      { product_id: 'p2', name_snapshot: 'Latte', quantity: 2, line_total: 70_000 },
      { product_id: 'p1', name_snapshot: 'Croissant', quantity: 1, line_total: 10_000 },
    ], now);
    expect(a.topProducts.map((p) => p.name)).toEqual(['Croissant', 'Latte']);
    expect(a.topProducts[0]).toMatchObject({ quantity: 4, spend: 40_000 });
    expect(a.topProducts[0]?.spendShare).toBeCloseTo(36.36, 1);
    expect(a.distinctProducts).toBe(2);
  });
});
