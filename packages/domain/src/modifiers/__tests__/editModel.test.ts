import { describe, it, expect } from 'vitest';
import {
  foldModifierRowsForEdit,
  validateModifierDraft,
  serializeModifierGroups,
} from '../editModel.js';
import type { AdminProductModifierRow, EditableModifierGroup } from '../types.js';

function row(over: Partial<AdminProductModifierRow>): AdminProductModifierRow {
  return {
    id: 'r',
    product_id: 'prod',
    category_id: null,
    group_name: 'Milk',
    group_sort_order: 0,
    group_required: true,
    group_type: 'single_select',
    option_label: 'Fresh milk',
    option_icon: null,
    option_sort_order: 0,
    price_adjustment: 0,
    is_default: true,
    is_active: true,
    ingredients_to_deduct: [],
    ...over,
  };
}

describe('foldModifierRowsForEdit', () => {
  it('folds flat rows into sorted groups with parsed ingredients', () => {
    const rows: AdminProductModifierRow[] = [
      row({ id: '1', group_name: 'Milk', group_sort_order: 0, option_label: 'Oat milk', option_sort_order: 1, price_adjustment: 10000, is_default: false, ingredients_to_deduct: [{ product_id: 'oat', qty: 30, unit: 'ml' }] }),
      row({ id: '2', group_name: 'Milk', group_sort_order: 0, option_label: 'Fresh milk', option_sort_order: 0, is_default: true }),
      row({ id: '3', group_name: 'ICE/HOT', group_sort_order: 1, group_type: 'single_select', option_label: 'Ice', option_sort_order: 0, is_default: true, group_required: true }),
    ];
    const groups = foldModifierRowsForEdit(rows);
    expect(groups.map((g) => g.group_name)).toEqual(['Milk', 'ICE/HOT']);
    expect(groups[0]!.options.map((o) => o.option_label)).toEqual(['Fresh milk', 'Oat milk']);
    expect(groups[0]!.options[1]).toMatchObject({
      option_label: 'Oat milk',
      price_adjustment: 10000,
      is_default: false,
      ingredients_to_deduct: [{ product_id: 'oat', qty: 30, unit: 'ml' }],
    });
  });
});

describe('validateModifierDraft', () => {
  const good: EditableModifierGroup = {
    group_name: 'Milk',
    group_type: 'single_select',
    group_required: true,
    group_sort_order: 0,
    options: [
      { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 0, ingredients_to_deduct: [] },
      { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 1, ingredients_to_deduct: [] },
    ],
  };

  it('passes a valid draft', () => {
    expect(validateModifierDraft([good])).toEqual([]);
  });

  it('flags a blank group name', () => {
    const errs = validateModifierDraft([{ ...good, group_name: '  ' }]);
    expect(errs.length).toBeGreaterThan(0);
  });

  it('flags duplicate group names', () => {
    const errs = validateModifierDraft([good, { ...good }]);
    expect(errs.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it('flags a group with no options', () => {
    const errs = validateModifierDraft([{ ...good, options: [] }]);
    expect(errs.some((e) => /at least one option/i.test(e.message))).toBe(true);
  });

  it('flags duplicate option labels within a group', () => {
    const errs = validateModifierDraft([{
      ...good,
      options: [good.options[0]!, { ...good.options[0]! }],
    }]);
    expect(errs.some((e) => /duplicate option/i.test(e.message))).toBe(true);
  });

  it('flags a required single_select group without exactly one default', () => {
    const noDefault: EditableModifierGroup = { ...good, options: good.options.map((o) => ({ ...o, is_default: false })) };
    expect(validateModifierDraft([noDefault]).some((e) => /default/i.test(e.message))).toBe(true);
    const twoDefault: EditableModifierGroup = { ...good, options: good.options.map((o) => ({ ...o, is_default: true })) };
    expect(validateModifierDraft([twoDefault]).some((e) => /default/i.test(e.message))).toBe(true);
  });

  it('flags an ingredient with non-positive qty', () => {
    const bad: EditableModifierGroup = {
      ...good,
      options: [
        { ...good.options[0]!, ingredients_to_deduct: [{ product_id: 'x', qty: 0, unit: 'g' }] },
        good.options[1]!,
      ],
    };
    expect(validateModifierDraft([bad]).some((e) => /qty/i.test(e.message))).toBe(true);
  });
});

describe('serializeModifierGroups', () => {
  it('reassigns sort orders by index and keeps ingredients', () => {
    const groups: EditableModifierGroup[] = [
      {
        group_name: 'Milk',
        group_type: 'single_select',
        group_required: true,
        group_sort_order: 99,
        options: [
          { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 5, ingredients_to_deduct: [] },
          { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 9, ingredients_to_deduct: [{ product_id: 'oat', qty: 30, unit: 'ml' }] },
        ],
      },
    ];
    const out = serializeModifierGroups(groups) as Record<string, unknown>[];
    expect(out[0]!.group_sort_order).toBe(0);
    const opts = out[0]!.options as Record<string, unknown>[];
    expect(opts[0]!.option_sort_order).toBe(0);
    expect(opts[1]!.option_sort_order).toBe(1);
    expect(opts[1]!.ingredients_to_deduct).toEqual([{ product_id: 'oat', qty: 30, unit: 'ml' }]);
  });
});
