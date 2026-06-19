// packages/domain/src/combos/__tests__/validateSelection.test.ts
import { describe, it, expect } from 'vitest';
import { validateSelection } from '../validateSelection.js';
import type { ComboDefinition } from '../types.js';

const singleDef: ComboDefinition = {
  combo_product_id: 'c1',
  name: 'French Platter',
  base_price: 100000,
  groups: [
    {
      id: 'g1',
      name: 'Drinks',
      group_type: 'single',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 0,
      options: [
        { id: 'o1', component_product_id: 'p1', label: 'Americano', surcharge: 0, is_default: true, sort_order: 0 },
        { id: 'o2', component_product_id: 'p2', label: 'Affogato', surcharge: 10000, is_default: false, sort_order: 1 },
      ],
    },
  ],
};

const multiDef: ComboDefinition = {
  combo_product_id: 'c2',
  name: 'Party Pack',
  base_price: 50000,
  groups: [
    {
      id: 'g2',
      name: 'Toppings',
      group_type: 'multi',
      is_required: true,
      min_select: 1,
      max_select: 3,
      sort_order: 0,
      options: [
        { id: 'm1', component_product_id: 'px', label: 'Cheese', surcharge: 3000, is_default: false, sort_order: 0 },
        { id: 'm2', component_product_id: 'py', label: 'Bacon', surcharge: 4000, is_default: false, sort_order: 1 },
        { id: 'm3', component_product_id: 'pz', label: 'Mushroom', surcharge: 2000, is_default: false, sort_order: 2 },
        { id: 'm4', component_product_id: 'pw', label: 'Onion', surcharge: 1000, is_default: false, sort_order: 3 },
      ],
    },
  ],
};

const optionalMultiDef: ComboDefinition = {
  combo_product_id: 'c3',
  name: 'Snack Box',
  base_price: 30000,
  groups: [
    {
      id: 'g3',
      name: 'Extras',
      group_type: 'multi',
      is_required: false,
      min_select: 0,
      max_select: 2,
      sort_order: 0,
      options: [
        { id: 'x1', component_product_id: 'pa', label: 'Sauce', surcharge: 2000, is_default: false, sort_order: 0 },
        { id: 'x2', component_product_id: 'pb', label: 'Dip', surcharge: 3000, is_default: false, sort_order: 1 },
      ],
    },
  ],
};

describe('validateSelection — required single group', () => {
  it('required single with 0 picks => error', () => {
    const result = validateSelection(singleDef, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/Drinks/);
    }
  });

  it('required single with 1 valid pick => ok', () => {
    const result = validateSelection(singleDef, [{ group_id: 'g1', option_ids: ['o1'] }]);
    expect(result).toEqual({ ok: true });
  });

  it('single group with 2 picks => error (exceeds max_select=1)', () => {
    const result = validateSelection(singleDef, [{ group_id: 'g1', option_ids: ['o1', 'o2'] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('validateSelection — required multi group', () => {
  it('multi with 0 picks when min_select=1 => error', () => {
    const result = validateSelection(multiDef, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/Toppings/);
    }
  });

  it('multi with 1 pick (meets min_select) => ok', () => {
    const result = validateSelection(multiDef, [{ group_id: 'g2', option_ids: ['m1'] }]);
    expect(result).toEqual({ ok: true });
  });

  it('multi with max_select=3 and 3 picks => ok', () => {
    const result = validateSelection(multiDef, [
      { group_id: 'g2', option_ids: ['m1', 'm2', 'm3'] },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it('multi over max_select => error', () => {
    const result = validateSelection(multiDef, [
      { group_id: 'g2', option_ids: ['m1', 'm2', 'm3', 'm4'] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/Toppings/);
    }
  });

  it('multi under min_select => error', () => {
    const result = validateSelection(multiDef, [{ group_id: 'g2', option_ids: [] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('validateSelection — optional multi group', () => {
  it('optional multi with 0 picks => ok (min_select=0)', () => {
    const result = validateSelection(optionalMultiDef, []);
    expect(result).toEqual({ ok: true });
  });

  it('optional multi with 1 pick => ok', () => {
    const result = validateSelection(optionalMultiDef, [
      { group_id: 'g3', option_ids: ['x1'] },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it('optional multi over max_select => error', () => {
    const result = validateSelection(optionalMultiDef, [
      { group_id: 'g3', option_ids: ['x1', 'x2', 'x1'] }, // 3 picks, max=2
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('validateSelection — invalid option ids', () => {
  it('unknown option id in selection => error', () => {
    const result = validateSelection(singleDef, [{ group_id: 'g1', option_ids: ['INVALID'] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('validateSelection — multiple groups', () => {
  const twoGroupDef: ComboDefinition = {
    combo_product_id: 'c4',
    name: 'Full Meal',
    base_price: 120000,
    groups: [
      {
        id: 'ga',
        name: 'Main',
        group_type: 'single',
        is_required: true,
        min_select: 1,
        max_select: 1,
        sort_order: 0,
        options: [
          { id: 'a1', component_product_id: 'pa1', label: 'Burger', surcharge: 0, is_default: true, sort_order: 0 },
        ],
      },
      {
        id: 'gb',
        name: 'Side',
        group_type: 'single',
        is_required: true,
        min_select: 1,
        max_select: 1,
        sort_order: 1,
        options: [
          { id: 'b1', component_product_id: 'pb1', label: 'Fries', surcharge: 5000, is_default: true, sort_order: 0 },
          { id: 'b2', component_product_id: 'pb2', label: 'Salad', surcharge: 3000, is_default: false, sort_order: 1 },
        ],
      },
    ],
  };

  it('both required groups satisfied => ok', () => {
    const result = validateSelection(twoGroupDef, [
      { group_id: 'ga', option_ids: ['a1'] },
      { group_id: 'gb', option_ids: ['b1'] },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it('one required group missing => error with that group name', () => {
    const result = validateSelection(twoGroupDef, [{ group_id: 'ga', option_ids: ['a1'] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should mention "Side" but not "Main"
      expect(result.errors.some((e) => e.includes('Side'))).toBe(true);
      expect(result.errors.some((e) => e.includes('Main'))).toBe(false);
    }
  });

  it('collects errors from multiple invalid groups', () => {
    const result = validateSelection(twoGroupDef, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should have errors for both required groups
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});
