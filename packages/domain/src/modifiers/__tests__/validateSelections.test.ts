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

describe('validateSelections', () => {
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
