// packages/domain/src/customerCategories/__tests__/types.test.ts
import { describe, it, expect } from 'vitest';
import type { CustomerCategory, PriceModifierType } from '../types.js';

describe('CustomerCategory types', () => {
  it('constructs a valid retail category', () => {
    const category: CustomerCategory = {
      id: 'cat-001',
      name: 'Retail',
      slug: 'retail',
      color: '#64748B',
      icon: null,
      price_modifier_type: 'retail',
      discount_percentage: 0,
      loyalty_enabled: true,
      points_multiplier: 1.0,
      is_default: true,
    };
    expect(category.slug).toBe('retail');
    expect(category.is_default).toBe(true);
    expect(category.price_modifier_type).toBe('retail');
  });

  it('constructs a discount_percentage category with null color/icon', () => {
    const category: CustomerCategory = {
      id: 'cat-002',
      name: 'VIP',
      slug: 'vip',
      color: null,
      icon: null,
      price_modifier_type: 'discount_percentage',
      discount_percentage: 5,
      loyalty_enabled: true,
      points_multiplier: 1.2,
      is_default: false,
    };
    expect(category.discount_percentage).toBe(5);
    expect(category.color).toBeNull();
  });

  it('PriceModifierType covers all four variants', () => {
    const types: PriceModifierType[] = ['retail', 'wholesale', 'discount_percentage', 'custom'];
    expect(types).toHaveLength(4);
    types.forEach((t) => {
      expect(typeof t).toBe('string');
    });
  });
});
