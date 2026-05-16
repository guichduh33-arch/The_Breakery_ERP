// packages/domain/src/production/__tests__/expandRecipeCascade.test.ts
// Session 16 / Phase 2.C — leaf-only cascade walker.

import { describe, it, expect } from 'vitest';
import {
  expandRecipeCascade,
  RecipeCycleError,
  RecipeDepthExceededError,
  type RecipeGraph,
} from '../index.js';

function product(id: string, unit = 'g', cost = 0): RecipeGraph['products'][string] {
  return { id, name: id, unit, cost_price: cost };
}

describe('expandRecipeCascade', () => {
  it('returns leaves directly for a flat recipe', () => {
    const graph: RecipeGraph = {
      products: {
        croissant: product('croissant', 'pcs'),
        flour:     product('flour', 'g', 0.01),
        butter:    product('butter', 'g', 0.05),
      },
      recipes: [
        { product_id: 'croissant', material_id: 'flour',  quantity: 50, unit: 'g' },
        { product_id: 'croissant', material_id: 'butter', quantity: 30, unit: 'g' },
      ],
    };
    const result = expandRecipeCascade(graph, 'croissant', 1);
    expect(result.size).toBe(2);
    expect(result.get('flour')?.qty).toBe(50);
    expect(result.get('butter')?.qty).toBe(30);
  });

  it('walks 2 levels and aggregates leaves (sub-recipes NOT in output)', () => {
    const graph: RecipeGraph = {
      products: {
        pain_choco: product('pain_choco', 'pcs'),
        dough:      product('dough', 'kg'),
        flour:      product('flour', 'g', 0.01),
        butter:     product('butter', 'g', 0.05),
        chocolate:  product('chocolate', 'g', 0.10),
      },
      recipes: [
        { product_id: 'pain_choco', material_id: 'dough',     quantity: 0.05, unit: 'kg' },
        { product_id: 'pain_choco', material_id: 'chocolate', quantity: 20,   unit: 'g' },
        { product_id: 'dough', material_id: 'flour',  quantity: 500, unit: 'g' },
        { product_id: 'dough', material_id: 'butter', quantity: 500, unit: 'g' },
      ],
    };
    const result = expandRecipeCascade(graph, 'pain_choco', 1);
    expect(result.has('dough')).toBe(false);
    expect(result.get('flour')?.qty).toBeCloseTo(25, 5);
    expect(result.get('butter')?.qty).toBeCloseTo(25, 5);
    expect(result.get('chocolate')?.qty).toBe(20);
  });

  it('multiplies by the requested batch size', () => {
    const graph: RecipeGraph = {
      products: {
        product: product('product', 'pcs'),
        leaf:    product('leaf', 'g'),
      },
      recipes: [
        { product_id: 'product', material_id: 'leaf', quantity: 10, unit: 'g' },
      ],
    };
    const result = expandRecipeCascade(graph, 'product', 7);
    expect(result.get('leaf')?.qty).toBe(70);
  });

  it('handles a 5-level deep chain', () => {
    const products: RecipeGraph['products'] = {
      L0: product('L0'), L1: product('L1'), L2: product('L2'),
      L3: product('L3'), L4: product('L4'), leaf: product('leaf', 'g'),
    };
    const recipes: RecipeGraph['recipes'] = [
      { product_id: 'L0',   material_id: 'L1', quantity: 1, unit: 'g' },
      { product_id: 'L1',   material_id: 'L2', quantity: 1, unit: 'g' },
      { product_id: 'L2',   material_id: 'L3', quantity: 1, unit: 'g' },
      { product_id: 'L3',   material_id: 'L4', quantity: 1, unit: 'g' },
      { product_id: 'L4',   material_id: 'leaf', quantity: 1, unit: 'g' },
    ];
    const result = expandRecipeCascade({ products, recipes }, 'L0', 1);
    expect(result.size).toBe(1);
    expect(result.get('leaf')?.qty).toBe(1);
  });

  it('throws RecipeCycleError on a direct cycle', () => {
    const graph: RecipeGraph = {
      products: { A: product('A'), B: product('B') },
      recipes: [
        { product_id: 'A', material_id: 'B', quantity: 1, unit: 'g' },
        { product_id: 'B', material_id: 'A', quantity: 1, unit: 'g' },
      ],
    };
    expect(() => expandRecipeCascade(graph, 'A', 1)).toThrow(RecipeCycleError);
  });

  it('throws RecipeDepthExceededError beyond maxDepth', () => {
    const products: RecipeGraph['products'] = {};
    const recipes: RecipeGraph['recipes'] = [];
    for (let i = 0; i < 7; i++) products[`L${i}`] = product(`L${i}`);
    for (let i = 0; i < 6; i++) {
      recipes.push({ product_id: `L${i}`, material_id: `L${i + 1}`, quantity: 1, unit: 'g' });
    }
    expect(() => expandRecipeCascade({ products, recipes }, 'L0', 1, { maxDepth: 3 }))
      .toThrow(RecipeDepthExceededError);
  });

  it('aggregates same leaf reached by multiple paths', () => {
    const graph: RecipeGraph = {
      products: {
        pain_special: product('pain_special'),
        dough:        product('dough', 'kg'),
        flour:        product('flour', 'g'),
      },
      recipes: [
        { product_id: 'pain_special', material_id: 'dough', quantity: 0.05, unit: 'kg' },
        { product_id: 'pain_special', material_id: 'flour', quantity: 10,   unit: 'g' },
        { product_id: 'dough',        material_id: 'flour', quantity: 500,  unit: 'g' },
      ],
    };
    const result = expandRecipeCascade(graph, 'pain_special', 1);
    expect(result.get('flour')?.qty).toBeCloseTo(35, 5);
  });
});
