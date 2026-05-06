// packages/domain/src/promotions/__tests__/selectBestPromotion.test.ts
import { describe, it, expect } from 'vitest';
import { selectBestPromotion } from '../selectBestPromotion.js';
import type { Promotion } from '../types.js';

const p = (id: string, priority: number, created_at: string): Promotion & { created_at: string } => ({
  id, name: id, slug: id, description: null,
  action_type: 'fixed_off', action_params: {}, conditions: { all: [] },
  priority, is_active: true, created_at,
});

describe('selectBestPromotion', () => {
  it('returns null when input empty', () => {
    expect(selectBestPromotion([])).toBeNull();
  });
  it('returns the only candidate', () => {
    const a = p('A', 0, '2026-01-01');
    expect(selectBestPromotion([{ promo: a, discount: 1000 }])?.promo.id).toBe('A');
  });
  it('picks max discount', () => {
    const a = p('A', 0, '2026-01-01');
    const b = p('B', 0, '2026-01-01');
    expect(selectBestPromotion([
      { promo: a, discount: 1000 },
      { promo: b, discount: 5000 },
    ])?.promo.id).toBe('B');
  });
  it('tie → priority DESC wins', () => {
    const a = p('A', 5, '2026-01-01');
    const b = p('B', 10, '2026-01-01');
    expect(selectBestPromotion([
      { promo: a, discount: 1000 },
      { promo: b, discount: 1000 },
    ])?.promo.id).toBe('B');
  });
  it('tie + same priority → created_at ASC wins', () => {
    const a = p('A', 5, '2026-01-01');
    const b = p('B', 5, '2026-02-01');
    expect(selectBestPromotion([
      { promo: a, discount: 1000 },
      { promo: b, discount: 1000 },
    ])?.promo.id).toBe('A');
  });
});
