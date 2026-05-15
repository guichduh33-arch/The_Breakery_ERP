// packages/domain/src/production/__tests__/recipeCostCalculator.test.ts
// Session 15 — Phase 1.B — Unit tests for the recursive recipe cost calculator.

import { describe, it, expect } from 'vitest';
import {
  calculateRecipeCost,
  tryCalculateRecipeCost,
  RecipeCycleError,
  RecipeDepthExceededError,
  type RecipeGraph,
  type RecipeGraphProduct,
  type RecipeGraphRow,
} from '../recipeCostCalculator.js';

// -------- helpers -----------------------------------------------------------

function leafProduct(
  id: string,
  cost: number,
  unit = 'kg',
  name = id,
): RecipeGraphProduct {
  return { id, name, unit, cost_price: cost };
}

function recipeProduct(
  id: string,
  unit = 'pcs',
  name = id,
): RecipeGraphProduct {
  // Recipe products carry a placeholder cost_price (DB column NOT NULL with
  // default 0) ; the calculator must NOT read it because the product is in
  // the recipes index.
  return { id, name, unit, cost_price: 0 };
}

function row(
  product_id: string,
  material_id: string,
  quantity: number,
  unit: string,
): RecipeGraphRow {
  return { product_id, material_id, quantity, unit };
}

// -------- 1. Flat recipe ----------------------------------------------------

describe('calculateRecipeCost — flat recipe (1 level)', () => {
  it('sums leaf material costs in their stock unit', () => {
    // Pain de mie A : 1 kg flour @ 10000/kg + 0.2 kg sugar @ 50000/kg
    const graph: RecipeGraph = {
      products: {
        A: recipeProduct('A', 'pcs', 'Pain de mie'),
        flour: leafProduct('flour', 10_000, 'kg', 'Flour'),
        sugar: leafProduct('sugar', 50_000, 'kg', 'Sugar'),
      },
      recipes: [
        row('A', 'flour', 1, 'kg'),
        row('A', 'sugar', 0.2, 'kg'),
      ],
    };

    const result = calculateRecipeCost(graph, 'A');

    expect(result.product_id).toBe('A');
    expect(result.cost_per_unit).toBe(20_000); // 10000 + 10000
    expect(result.has_cycle).toBe(false);
    expect(result.depth_reached).toBe(0);
    expect(result.breakdown).toHaveLength(2);

    const flourLine = result.breakdown[0]!;
    const sugarLine = result.breakdown[1]!;
    expect(flourLine.material_id).toBe('flour');
    expect(flourLine.material_name).toBe('Flour');
    expect(flourLine.is_recipe).toBe(false);
    expect(flourLine.qty_per_unit).toBe(1);
    expect(flourLine.unit_cost).toBe(10_000);
    expect(flourLine.subtotal).toBe(10_000);
    expect(flourLine.sub_breakdown).toBeUndefined();

    expect(sugarLine.material_id).toBe('sugar');
    expect(sugarLine.subtotal).toBe(10_000);
  });
});

// -------- 2. Two-level recipe (croissant dough → pain au chocolat) ----------

describe('calculateRecipeCost — 2-level recipe', () => {
  it('cascades through a sub-recipe and exposes sub_breakdown', () => {
    // Croissant dough = 0.6 flour + 0.3 butter + 0.1 water (per 1 kg dough).
    // Pain au chocolat = 0.1 kg dough + 0.02 kg chocolate (per 1 pcs).
    const graph: RecipeGraph = {
      products: {
        PAC: recipeProduct('PAC', 'pcs', 'Pain au chocolat'),
        dough: recipeProduct('dough', 'kg', 'Croissant dough'),
        flour: leafProduct('flour', 10_000, 'kg', 'Flour'),
        butter: leafProduct('butter', 80_000, 'kg', 'Butter'),
        water: leafProduct('water', 0, 'kg', 'Water'),
        choco: leafProduct('choco', 200_000, 'kg', 'Chocolate'),
      },
      recipes: [
        row('dough', 'flour', 0.6, 'kg'),
        row('dough', 'butter', 0.3, 'kg'),
        row('dough', 'water', 0.1, 'kg'),
        row('PAC', 'dough', 0.1, 'kg'),
        row('PAC', 'choco', 0.02, 'kg'),
      ],
    };

    const result = calculateRecipeCost(graph, 'PAC');

    // Dough cost = 0.6*10000 + 0.3*80000 + 0.1*0 = 6000 + 24000 + 0 = 30000/kg
    // PAC cost  = 0.1*30000 + 0.02*200000           = 3000 + 4000 = 7000/pcs
    expect(result.cost_per_unit).toBe(7_000);
    expect(result.depth_reached).toBe(1);
    expect(result.has_cycle).toBe(false);
    expect(result.breakdown).toHaveLength(2);

    const doughLine = result.breakdown.find((b) => b.material_id === 'dough')!;
    expect(doughLine.is_recipe).toBe(true);
    expect(doughLine.unit_cost).toBe(30_000);
    expect(doughLine.subtotal).toBeCloseTo(3_000, 5);
    expect(doughLine.sub_breakdown).toBeDefined();
    expect(doughLine.sub_breakdown).toHaveLength(3);

    const chocoLine = result.breakdown.find((b) => b.material_id === 'choco')!;
    expect(chocoLine.is_recipe).toBe(false);
    expect(chocoLine.subtotal).toBeCloseTo(4_000, 5);
    expect(chocoLine.sub_breakdown).toBeUndefined();
  });
});

// -------- 3. 5-level chain --------------------------------------------------

function buildChainGraph(levels: number): RecipeGraph {
  // L1 → L2 → ... → L{levels} → leaf.
  // Each link consumes 1 unit of the next layer.
  const products: Record<string, RecipeGraphProduct> = {
    leaf: leafProduct('leaf', 100, 'kg', 'Leaf material'),
  };
  const recipes: RecipeGraphRow[] = [];
  for (let i = 1; i <= levels; i++) {
    products[`L${i}`] = recipeProduct(`L${i}`, 'kg', `Layer ${i}`);
  }
  for (let i = 1; i < levels; i++) {
    recipes.push(row(`L${i}`, `L${i + 1}`, 1, 'kg'));
  }
  recipes.push(row(`L${levels}`, 'leaf', 1, 'kg'));
  return { products, recipes };
}

describe('calculateRecipeCost — 5-level chain', () => {
  it('cascades cost through 5 nested recipes (within default maxDepth=5)', () => {
    const graph = buildChainGraph(5);
    const result = calculateRecipeCost(graph, 'L1');
    expect(result.cost_per_unit).toBe(100);
    expect(result.depth_reached).toBe(4); // 0=L1, 1=L2, ..., 4=L5
    expect(result.has_cycle).toBe(false);

    // Spot-check the deepest sub_breakdown chain.
    let cursor: import('../recipeCostCalculator.js').RecipeCostBreakdownItem =
      result.breakdown[0]!;
    let depth = 0;
    while (cursor.sub_breakdown && cursor.sub_breakdown.length > 0) {
      cursor = cursor.sub_breakdown[0]!;
      depth++;
    }
    expect(depth).toBe(4);
    expect(cursor.material_id).toBe('leaf');
    expect(cursor.is_recipe).toBe(false);
    expect(cursor.unit_cost).toBe(100);
  });
});

// -------- 4. 6-level chain → depth exceeded --------------------------------

describe('calculateRecipeCost — depth limit', () => {
  it('throws RecipeDepthExceededError when chain length > maxDepth', () => {
    const graph = buildChainGraph(7);
    expect(() => calculateRecipeCost(graph, 'L1')).toThrow(
      RecipeDepthExceededError,
    );
  });

  it('respects a caller-supplied maxDepth (e.g. 3)', () => {
    const graph = buildChainGraph(5);
    expect(() =>
      calculateRecipeCost(graph, 'L1', { maxDepth: 3 }),
    ).toThrow(RecipeDepthExceededError);
  });

  it('rejects maxDepth < 1', () => {
    const graph = buildChainGraph(2);
    expect(() => calculateRecipeCost(graph, 'L1', { maxDepth: 0 })).toThrow(
      /maxDepth/,
    );
  });
});

// -------- 5. Direct cycle --------------------------------------------------

describe('calculateRecipeCost — direct cycle', () => {
  it('throws RecipeCycleError with the offending path', () => {
    // A uses B uses A.
    const graph: RecipeGraph = {
      products: {
        A: recipeProduct('A'),
        B: recipeProduct('B'),
      },
      recipes: [
        row('A', 'B', 1, 'kg'),
        row('B', 'A', 1, 'kg'),
      ],
    };

    expect.assertions(2);
    try {
      calculateRecipeCost(graph, 'A');
    } catch (err) {
      expect(err).toBeInstanceOf(RecipeCycleError);
      expect((err as RecipeCycleError).path).toEqual(['A', 'B', 'A']);
    }
  });
});

// -------- 6. Indirect cycle ------------------------------------------------

describe('calculateRecipeCost — indirect cycle', () => {
  it('throws RecipeCycleError on A → B → C → A', () => {
    const graph: RecipeGraph = {
      products: {
        A: recipeProduct('A'),
        B: recipeProduct('B'),
        C: recipeProduct('C'),
      },
      recipes: [
        row('A', 'B', 1, 'kg'),
        row('B', 'C', 1, 'kg'),
        row('C', 'A', 1, 'kg'),
      ],
    };

    expect.assertions(2);
    try {
      calculateRecipeCost(graph, 'A');
    } catch (err) {
      expect(err).toBeInstanceOf(RecipeCycleError);
      expect((err as RecipeCycleError).path).toEqual(['A', 'B', 'C', 'A']);
    }
  });
});

// -------- 7. Missing product -----------------------------------------------

describe('calculateRecipeCost — missing product', () => {
  it('throws when productId is absent from graph.products', () => {
    const graph: RecipeGraph = { products: {}, recipes: [] };
    expect(() => calculateRecipeCost(graph, 'ghost')).toThrow(
      /Product ghost not found/,
    );
  });

  it('throws when a referenced material_id is absent from graph.products', () => {
    const graph: RecipeGraph = {
      products: {
        A: recipeProduct('A'),
        // 'missing' material intentionally absent.
      },
      recipes: [row('A', 'missing', 1, 'kg')],
    };
    expect(() => calculateRecipeCost(graph, 'A')).toThrow(/missing/);
  });
});

// -------- 8/9. tryCalculateRecipeCost -------------------------------------

describe('tryCalculateRecipeCost', () => {
  it('returns { ok: true, value } on happy path', () => {
    const graph: RecipeGraph = {
      products: {
        A: recipeProduct('A'),
        flour: leafProduct('flour', 10_000, 'kg'),
      },
      recipes: [row('A', 'flour', 0.5, 'kg')],
    };
    const result = tryCalculateRecipeCost(graph, 'A');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cost_per_unit).toBe(5_000);
      expect(result.value.has_cycle).toBe(false);
    }
  });

  it('returns { ok: false, error: RecipeCycleError } on cycle', () => {
    const graph: RecipeGraph = {
      products: {
        A: recipeProduct('A'),
        B: recipeProduct('B'),
      },
      recipes: [
        row('A', 'B', 1, 'kg'),
        row('B', 'A', 1, 'kg'),
      ],
    };
    const result = tryCalculateRecipeCost(graph, 'A');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(RecipeCycleError);
      expect((result.error as RecipeCycleError).path).toEqual(['A', 'B', 'A']);
    }
  });

  it('returns { ok: false, error: RecipeDepthExceededError } on too-deep chain', () => {
    const graph = buildChainGraph(7);
    const result = tryCalculateRecipeCost(graph, 'L1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(RecipeDepthExceededError);
    }
  });

  it('passes through arbitrary errors (e.g. missing product) as { ok: false }', () => {
    const graph: RecipeGraph = { products: {}, recipes: [] };
    const result = tryCalculateRecipeCost(graph, 'ghost');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toMatch(/ghost/);
    }
  });
});

// -------- Bonus : unit converter hook --------------------------------------

describe('calculateRecipeCost — custom unit converter', () => {
  it('uses the injected convertUnit to align recipe-unit and material-unit', () => {
    // Recipe says 250 g of flour ; flour stock unit is kg @ 10000/kg.
    // With identity converter this would be 250 × 10000 = 2_500_000 (wrong).
    // With g→kg converter (×0.001) → 0.25 × 10000 = 2500 (correct).
    const graph: RecipeGraph = {
      products: {
        A: recipeProduct('A'),
        flour: leafProduct('flour', 10_000, 'kg', 'Flour'),
      },
      recipes: [row('A', 'flour', 250, 'g')],
    };
    const convertUnit = (qty: number, from: string, to: string): number => {
      if (from === to) return qty;
      if (from === 'g' && to === 'kg') return qty * 0.001;
      throw new Error(`unsupported conversion ${from} → ${to}`);
    };
    const result = calculateRecipeCost(graph, 'A', { convertUnit });
    expect(result.cost_per_unit).toBe(2_500);
    expect(result.breakdown[0]!.qty_per_unit).toBe(0.25);
  });
});
