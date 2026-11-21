// Valeur, fenêtre et compteurs de la liste Promotions (audit Sales 2026-11-21).
import { describe, expect, it } from 'vitest';
import { emptyPromotionValues } from '@breakery/ui';
import type { PromotionListRow } from '../hooks/usePromotionsList.js';
import {
  PROMOTION_TYPES,
  activationSentence,
  promotionValueText,
  promotionWindowState,
  promotionWindowText,
  summarisePromotions,
} from '../promotionSummary.js';

const NOW = Date.parse('2026-11-21T04:00:00Z');
const row = (over: Partial<PromotionListRow>): PromotionListRow => ({
  ...emptyPromotionValues(), id: 'p', created_at: '2026-11-01T00:00:00Z', name: 'Promo', ...over,
});

describe('promotion types', () => {
  // L'exhaustivité est garantie au build (Record sur l'enum généré) ; ce test
  // garde la trace du défaut : le filtre ignorait threshold et bundle.
  it('include threshold and bundle', () => {
    expect(PROMOTION_TYPES).toEqual(expect.arrayContaining(['threshold', 'bundle']));
  });
});

describe('promotionValueText', () => {
  it('reads each promotion type', () => {
    expect(promotionValueText(row({ type: 'percentage', discount_value: 15 }))).toBe('15%');
    expect(promotionValueText(row({ type: 'fixed_amount', discount_value: 10_000 }))).toMatch(/^Rp\s?10\.000 off$/);
    expect(promotionValueText(row({ type: 'bogo', bogo_buy_quantity: 2, bogo_get_quantity: 1 }))).toBe('Buy 2 get 1');
    expect(promotionValueText(row({ type: 'bogo', bogo_trigger_qty: 1, bogo_reward_qty: 1, bogo_reward_discount_pct: 50 })))
      .toBe('Buy 1, 50% off 1');
    expect(promotionValueText(row({ type: 'free_product', gift_qty: 1 }))).toBe('Free product');
    expect(promotionValueText(row({ type: 'threshold', threshold_type: 'subtotal', threshold_amount: 100_000,
      discount_value: 10, max_discount_amount: 20_000 }))).toMatch(/^10% off from Rp\s?100\.000$/);
    expect(promotionValueText(row({ type: 'bundle', bundle_price: 45_000 }))).toMatch(/^Bundle at Rp\s?45\.000$/);
    expect(promotionValueText(row({ type: 'percentage', discount_value: null }))).toBe('—');
  });
});

describe('promotion window', () => {
  it('classifies the date window', () => {
    expect(promotionWindowState(row({ start_at: null, end_at: null }), NOW)).toBe('always');
    expect(promotionWindowState(row({ start_at: '2026-12-01T00:00:00Z', end_at: null }), NOW)).toBe('scheduled');
    expect(promotionWindowState(row({ start_at: '2026-11-01T00:00:00Z', end_at: '2026-11-20T00:00:00Z' }), NOW)).toBe('expired');
    expect(promotionWindowState(row({ start_at: '2026-11-01T00:00:00Z', end_at: '2026-12-01T00:00:00Z' }), NOW)).toBe('live');
    expect(promotionWindowText(row({ start_at: null, end_at: null }))).toBe('No dates');
    expect(promotionWindowText(row({ start_at: '2026-11-01T00:00:00Z', end_at: null }))).toMatch(/→ no end date$/);
  });

  it('says from when to when an activation applies', () => {
    expect(activationSentence(row({ start_at: null, end_at: null }), NOW)).toBe('Applies at the POS from now until no end date.');
    expect(activationSentence(row({ start_at: '2026-12-01T00:00:00Z', end_at: null }), NOW)).toMatch(/^Applies at the POS from 01 Dec 2026/);
    expect(activationSentence(row({ end_at: '2026-11-20T00:00:00Z' }), NOW)).toMatch(/has passed/);
  });
});

describe('summarisePromotions', () => {
  it('counts live promotions on the date window, not on is_active alone', () => {
    const rows = [
      row({ is_active: true }),                                          // always → live
      row({ is_active: true, end_at: '2026-11-20T00:00:00Z' }),          // expired
      row({ is_active: true, start_at: '2026-12-01T00:00:00Z' }),        // scheduled
      row({ is_active: false, type: 'bogo' }),                           // inactive
      row({ is_active: true, type: 'fixed_amount', start_at: '2026-11-01T00:00:00Z', end_at: '2026-12-01T00:00:00Z' }),
    ];
    expect(summarisePromotions(rows, NOW)).toEqual({ total: 5, liveNow: 2, scheduled: 1, bogo: 1, discount: 4 });
  });
});
