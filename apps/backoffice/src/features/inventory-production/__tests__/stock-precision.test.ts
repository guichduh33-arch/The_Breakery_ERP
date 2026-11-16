import { describe, expect, it } from 'vitest';
import { productionRequirementQuanta, stockQuantityQuanta, stockQuantaValue } from '../stockPrecision.js';

describe('production stock quantum', () => {
  it.each([
    [0.0001882, 0.001, 188n],
    [0.0001062, 0.001, 106n],
    [0.371861, 0.001, 371861n],
    [0.0001332, 2, 266400n],
  ] as const)('matches audited material coefficient %s at output %s', (coefficient, output, expected) => {
    expect(productionRequirementQuanta([coefficient], output)).toBe(expected);
  });
  it.each([[0.000166, 166000n], [9e-8, 90n], [1e-9, 1n]])('preserves calculated requirement %s', (value, expected) => {
    expect(productionRequirementQuanta([Number(value)], 1)).toBe(expected);
  });
  it('rounds each root before batch addition, rather than rounding the raw batch', () => {
    const first = productionRequirementQuanta([0.0000015], 0.001);
    const second = productionRequirementQuanta([0.0000015], 0.001);
    expect(first + second).toBe(4n);
    expect(first + second - stockQuantityQuanta(3e-9)).toBe(1n);
  });
  it('aggregates paths before rounding and adds produced plus waste as decimals', () => {
    expect(productionRequirementQuanta([0.0000000003, 0.0000000003], 1)).toBe(1n);
    expect(productionRequirementQuanta([1], 0.1, 0.2)).toBe(stockQuantityQuanta(0.3));
    expect(productionRequirementQuanta([0.1, 0.2], 1)).toBe(stockQuantityQuanta(0.3));
  });
  it('rounds signed ties away from zero like PostgreSQL numeric', () => {
    expect(stockQuantityQuanta(1.5e-9)).toBe(2n);
    expect(stockQuantityQuanta(-1.5e-9)).toBe(-2n);
    expect(stockQuantityQuanta(1.499999999e-9)).toBe(1n);
    expect(stockQuantityQuanta(-1.499999999e-9)).toBe(-1n);
  });
  it('rejects a positive sub-quantum consumption without skipping it or rounding up', () => {
    expect(() => productionRequirementQuanta([0.0000000004], 1)).toThrow('quantity_below_stock_precision');
    expect(productionRequirementQuanta([0.0000000005], 1)).toBe(1n);
    expect(productionRequirementQuanta([0], 1)).toBe(0n);
  });
  it('supports scientific notation and values above safe scaled integer range', () => {
    expect(productionRequirementQuanta([1e-12], 90000)).toBe(90n);
    expect(stockQuantityQuanta(9999999.999)).toBe(9999999999000000n);
    expect(stockQuantityQuanta(1e21)).toBe(1000000000000000000000000000000n);
    expect(stockQuantaValue(90n)).toBe(9e-8);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid input %s', value => {
    expect(() => stockQuantityQuanta(value)).toThrow('invalid_stock_quantity');
  });
});
