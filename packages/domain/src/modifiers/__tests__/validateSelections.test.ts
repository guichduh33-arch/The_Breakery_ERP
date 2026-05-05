// packages/domain/src/modifiers/__tests__/validateSelections.test.ts
import { describe, it, expect } from 'vitest';
import { validateSelections } from '../validateSelections';
import type { ModifierGroup } from '../types';

const requiredGroup: ModifierGroup = {
  group_name: 'Temperature',
  group_sort_order: 1,
  group_required: true,
  group_type: 'single_select',
  options: [
    { option_label: 'Hot', option_sort_order: 1, price_adjustment: 0, is_default: true },
    { option_label: 'Ice', option_sort_order: 2, price_adjustment: 0, is_default: false },
  ],
};

const optionalGroup: ModifierGroup = {
  group_name: 'Milk',
  group_sort_order: 2,
  group_required: false,
  group_type: 'single_select',
  options: [
    { option_label: 'Whole', option_sort_order: 1, price_adjustment: 0, is_default: true },
  ],
};

const requiredMultiGroup: ModifierGroup = {
  group_name: 'Toppings',
  group_sort_order: 3,
  group_required: true,
  group_type: 'multi_select',
  options: [
    { option_label: 'Extra cheese', option_sort_order: 1, price_adjustment: 5000, is_default: false },
    { option_label: 'Bacon', option_sort_order: 2, price_adjustment: 8000, is_default: false },
    { option_label: 'Mushroom', option_sort_order: 3, price_adjustment: 3000, is_default: false },
  ],
};

const optionalMultiGroup: ModifierGroup = {
  group_name: 'Extras',
  group_sort_order: 4,
  group_required: false,
  group_type: 'multi_select',
  options: [
    { option_label: 'Extra sauce', option_sort_order: 1, price_adjustment: 2000, is_default: false },
  ],
};

describe('validateSelections — single_select (existing behaviour)', () => {
  it('returns no errors when required group has a selection', () => {
    const errors = validateSelections([requiredGroup], [
      { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
    ]);
    expect(errors).toEqual([]);
  });

  it('returns required_missing error when required group has no selection', () => {
    const errors = validateSelections([requiredGroup], []);
    expect(errors).toEqual([
      { group_name: 'Temperature', reason: 'required_missing' },
    ]);
  });

  it('does NOT flag optional groups with no selection', () => {
    const errors = validateSelections([optionalGroup], []);
    expect(errors).toEqual([]);
  });

  it('flags only the missing required group, not the satisfied one', () => {
    const errors = validateSelections([requiredGroup, optionalGroup], [
      { group_name: 'Milk', option_label: 'Whole', price_adjustment: 0 },
    ]);
    expect(errors).toEqual([
      { group_name: 'Temperature', reason: 'required_missing' },
    ]);
  });

  it('returns empty for empty groups', () => {
    expect(validateSelections([], [])).toEqual([]);
  });
});

describe('validateSelections — multi_select', () => {
  it('flags required multi_select group with 0 selections', () => {
    const errors = validateSelections([requiredMultiGroup], []);
    expect(errors).toEqual([
      { group_name: 'Toppings', reason: 'required_missing' },
    ]);
  });

  it('returns no error for required multi_select with exactly 1 selection', () => {
    const errors = validateSelections([requiredMultiGroup], [
      { group_name: 'Toppings', option_label: 'Bacon', price_adjustment: 8000 },
    ]);
    expect(errors).toEqual([]);
  });

  it('returns no error for required multi_select with 2 selections', () => {
    const errors = validateSelections([requiredMultiGroup], [
      { group_name: 'Toppings', option_label: 'Extra cheese', price_adjustment: 5000 },
      { group_name: 'Toppings', option_label: 'Bacon', price_adjustment: 8000 },
    ]);
    expect(errors).toEqual([]);
  });

  it('returns no error for required multi_select with 3 selections', () => {
    const errors = validateSelections([requiredMultiGroup], [
      { group_name: 'Toppings', option_label: 'Extra cheese', price_adjustment: 5000 },
      { group_name: 'Toppings', option_label: 'Bacon', price_adjustment: 8000 },
      { group_name: 'Toppings', option_label: 'Mushroom', price_adjustment: 3000 },
    ]);
    expect(errors).toEqual([]);
  });

  it('does not flag optional multi_select with 0 selections', () => {
    const errors = validateSelections([optionalMultiGroup], []);
    expect(errors).toEqual([]);
  });

  it('handles mixed groups: single_select required + multi_select required, all satisfied', () => {
    const errors = validateSelections(
      [requiredGroup, requiredMultiGroup],
      [
        { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
        { group_name: 'Toppings', option_label: 'Bacon', price_adjustment: 8000 },
      ],
    );
    expect(errors).toEqual([]);
  });

  it('flags missing required multi_select in mixed scenario', () => {
    const errors = validateSelections(
      [requiredGroup, requiredMultiGroup],
      [
        { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
        // Toppings missing
      ],
    );
    expect(errors).toEqual([
      { group_name: 'Toppings', reason: 'required_missing' },
    ]);
  });

  it('flags both required groups when neither has selections', () => {
    const errors = validateSelections([requiredGroup, requiredMultiGroup], []);
    expect(errors).toHaveLength(2);
  });

  it('optional multi_select with selections raises no error', () => {
    const errors = validateSelections([optionalMultiGroup], [
      { group_name: 'Extras', option_label: 'Extra sauce', price_adjustment: 2000 },
    ]);
    expect(errors).toEqual([]);
  });
});
