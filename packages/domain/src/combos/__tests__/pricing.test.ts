// packages/domain/src/combos/__tests__/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { configuredPrice, priceRange, savingsPct, valuePrice } from '../pricing.js';
import type { ComboDefinition } from '../types.js';

const def: ComboDefinition = {
  combo_product_id: 'c',
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

// --- configuredPrice ---

it('configuredPrice = base + chosen surcharges', () => {
  expect(configuredPrice(def, [{ group_id: 'g1', option_ids: ['o2'] }])).toBe(110000);
});

it('configuredPrice with default (zero surcharge)', () => {
  expect(configuredPrice(def, [{ group_id: 'g1', option_ids: ['o1'] }])).toBe(100000);
});

it('configuredPrice with empty selections = base price', () => {
  expect(configuredPrice(def, [])).toBe(100000);
});

// --- priceRange ---

it('priceRange spans cheapest..dearest required picks', () => {
  expect(priceRange(def)).toEqual({ min: 100000, max: 110000 });
});

describe('priceRange with multi group', () => {
  const multiDef: ComboDefinition = {
    combo_product_id: 'c2',
    name: 'Party Pack',
    base_price: 50000,
    groups: [
      {
        id: 'g2',
        name: 'Extras',
        group_type: 'multi',
        is_required: false,
        min_select: 0,
        max_select: 2,
        sort_order: 0,
        options: [
          { id: 'e1', component_product_id: 'px', label: 'Sauce', surcharge: 5000, is_default: false, sort_order: 0 },
          { id: 'e2', component_product_id: 'py', label: 'Bread', surcharge: 3000, is_default: false, sort_order: 1 },
          { id: 'e3', component_product_id: 'pz', label: 'Salad', surcharge: 7000, is_default: false, sort_order: 2 },
        ],
      },
    ],
  };

  it('min = base + 0 for optional multi group', () => {
    expect(priceRange(multiDef).min).toBe(50000);
  });

  it('max = base + sum of top max_select surcharges for multi group', () => {
    // top 2 surcharges: 7000 + 5000 = 12000
    expect(priceRange(multiDef).max).toBe(62000);
  });
});

describe('priceRange with required multi group', () => {
  const reqMultiDef: ComboDefinition = {
    combo_product_id: 'c3',
    name: 'Bundle',
    base_price: 80000,
    groups: [
      {
        id: 'g3',
        name: 'Toppings',
        group_type: 'multi',
        is_required: true,
        min_select: 1,
        max_select: 2,
        sort_order: 0,
        options: [
          { id: 't1', component_product_id: 'pt1', label: 'Cheese', surcharge: 4000, is_default: false, sort_order: 0 },
          { id: 't2', component_product_id: 'pt2', label: 'Bacon', surcharge: 6000, is_default: false, sort_order: 1 },
          { id: 't3', component_product_id: 'pt3', label: 'Mushroom', surcharge: 2000, is_default: false, sort_order: 2 },
        ],
      },
    ],
  };

  it('min = base + 1 cheapest option surcharge for required multi', () => {
    // min_select = 1, cheapest = 2000
    expect(priceRange(reqMultiDef).min).toBe(82000);
  });

  it('max = base + top 2 surcharges for required multi', () => {
    // top 2: 6000 + 4000 = 10000
    expect(priceRange(reqMultiDef).max).toBe(90000);
  });
});

// --- savingsPct ---

it('savingsPct null when value <= base', () => {
  expect(savingsPct(90000, 100000)).toBeNull();
  expect(savingsPct(120000, 100000)).toBe(17);
});

it('savingsPct null when value equals base', () => {
  expect(savingsPct(100000, 100000)).toBeNull();
});

it('savingsPct null when value is null', () => {
  expect(savingsPct(null, 100000)).toBeNull();
});

// --- valuePrice ---

describe('valuePrice', () => {
  it('returns sum of component retail prices multiplied by options', () => {
    const componentRetail: Record<string, number> = {
      p1: 80000,
      p2: 90000,
    };
    // single group, required, only o1 is default. valuePrice sums ALL components (default options)
    // For single groups: pick the default option's component; for multi: pick all defaults
    // Actually valuePrice sums all option retail prices to give a "value if bought separately"
    // Let's use the spec: sum of retail prices for all component_product_ids in options
    const val = valuePrice(def, componentRetail);
    // def has 1 group (g1) with 2 options: p1=80000, p2=90000
    // For single-choice groups, valuePrice picks the default option's retail price
    // For multi groups, sum all defaults
    // The brief says: "sum of component retail prices for default/required components"
    // We'll test: single group → default option's retail
    expect(val).toBe(80000); // default is o1 -> p1 -> 80000
  });

  it('returns null when a component retail price is missing', () => {
    expect(valuePrice(def, { p2: 90000 })).toBeNull(); // p1 missing
  });

  it('returns null for empty groups', () => {
    const emptyDef: ComboDefinition = {
      combo_product_id: 'cx',
      name: 'Empty',
      base_price: 50000,
      groups: [],
    };
    // No components = null (can't compute a meaningful value)
    expect(valuePrice(emptyDef, {})).toBeNull();
  });
});
