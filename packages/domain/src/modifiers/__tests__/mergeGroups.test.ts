// packages/domain/src/modifiers/__tests__/mergeGroups.test.ts
import { describe, it, expect } from 'vitest';
import { mergeGroups } from '../mergeGroups';
import type { ProductModifierRow } from '../types';

function row(p: Partial<ProductModifierRow>): ProductModifierRow {
  return {
    id: 'r' + Math.random().toString(36).slice(2),
    product_id: null,
    category_id: null,
    group_name: 'G',
    group_sort_order: 0,
    group_required: false,
    group_type: 'single_select',
    option_label: 'Opt',
    option_icon: null,
    option_sort_order: 0,
    price_adjustment: 0,
    is_default: false,
    is_active: true,
    ...p,
  };
}

describe('mergeGroups', () => {
  it('returns empty for no rows', () => {
    expect(mergeGroups([])).toEqual([]);
  });

  it('groups product-level rows by group_name', () => {
    const rows = [
      row({ product_id: 'P1', group_name: 'Temperature', option_label: 'Hot', option_sort_order: 1 }),
      row({ product_id: 'P1', group_name: 'Temperature', option_label: 'Ice', option_sort_order: 2 }),
      row({ product_id: 'P1', group_name: 'Milk',        option_label: 'Whole', option_sort_order: 1, group_sort_order: 2 }),
    ];
    const groups = mergeGroups(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.group_name).toBe('Temperature');
    expect(groups[0]?.options.map((o) => o.option_label)).toEqual(['Hot', 'Ice']);
    expect(groups[1]?.group_name).toBe('Milk');
  });

  it('falls back to category-level rows when no product-level group exists', () => {
    const rows = [
      row({ category_id: 'C1', group_name: 'Temperature', option_label: 'Hot' }),
      row({ category_id: 'C1', group_name: 'Temperature', option_label: 'Ice' }),
    ];
    const groups = mergeGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.options).toHaveLength(2);
  });

  it('product-level group OVERRIDES same-name category group entirely', () => {
    const rows = [
      // category default: Temperature has Hot+Ice
      row({ category_id: 'C1', group_name: 'Temperature', option_label: 'Hot' }),
      row({ category_id: 'C1', group_name: 'Temperature', option_label: 'Ice' }),
      // category default: Milk
      row({ category_id: 'C1', group_name: 'Milk', option_label: 'Whole', group_sort_order: 2 }),
      // product override: Temperature only Hot, no Ice
      row({ product_id: 'P1', group_name: 'Temperature', option_label: 'Hot', price_adjustment: 1000 }),
    ];
    const groups = mergeGroups(rows);
    expect(groups).toHaveLength(2);
    const temp = groups.find((g) => g.group_name === 'Temperature');
    expect(temp?.options).toHaveLength(1);
    expect(temp?.options[0]?.option_label).toBe('Hot');
    expect(temp?.options[0]?.price_adjustment).toBe(1000);
    // Milk is inherited from category
    const milk = groups.find((g) => g.group_name === 'Milk');
    expect(milk?.options).toHaveLength(1);
  });

  it('sorts groups by group_sort_order and options by option_sort_order', () => {
    const rows = [
      row({ category_id: 'C1', group_name: 'Milk', group_sort_order: 2, option_label: 'Oat', option_sort_order: 2 }),
      row({ category_id: 'C1', group_name: 'Milk', group_sort_order: 2, option_label: 'Whole', option_sort_order: 1 }),
      row({ category_id: 'C1', group_name: 'Temp', group_sort_order: 1, option_label: 'Hot', option_sort_order: 1 }),
    ];
    const groups = mergeGroups(rows);
    expect(groups.map((g) => g.group_name)).toEqual(['Temp', 'Milk']);
    expect(groups[1]?.options.map((o) => o.option_label)).toEqual(['Whole', 'Oat']);
  });

  it('skips malformed XOR rows (both ids null)', () => {
    const rows = [
      row({ product_id: null, category_id: null, group_name: 'Bad' }),
      row({ category_id: 'C1', group_name: 'Good', option_label: 'X' }),
    ];
    const groups = mergeGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.group_name).toBe('Good');
  });

  it('preserves option_icon when set, drops when null', () => {
    const rows = [
      row({ category_id: 'C1', group_name: 'G', option_label: 'A', option_icon: '☕' }),
      row({ category_id: 'C1', group_name: 'G', option_label: 'B', option_icon: null }),
    ];
    const groups = mergeGroups(rows);
    expect(groups[0]?.options[0]?.option_icon).toBe('☕');
    expect(groups[0]?.options[1]?.option_icon).toBeUndefined();
  });
});
