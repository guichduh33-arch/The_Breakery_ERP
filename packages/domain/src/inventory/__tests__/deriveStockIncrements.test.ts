// packages/domain/src/inventory/__tests__/deriveStockIncrements.test.ts
import { describe, it, expect } from 'vitest';
import { deriveStockIncrements } from '../deriveStockIncrements.js';

describe('deriveStockIncrements', () => {
  it('uses bakery dozen logic for "piece" units', () => {
    expect(deriveStockIncrements('piece')).toEqual([1, 6, 12]);
    expect(deriveStockIncrements('pièce')).toEqual([1, 6, 12]);
    expect(deriveStockIncrements('pcs')).toEqual([1, 6, 12]);
  });

  it('uses small increments for whole / weighed units', () => {
    expect(deriveStockIncrements('cake')).toEqual([1, 2]);
    expect(deriveStockIncrements('gâteau')).toEqual([1, 2]);
    expect(deriveStockIncrements('kg')).toEqual([1, 2]);
  });

  it('falls back to a generic ramp for unknown units', () => {
    expect(deriveStockIncrements('tray')).toEqual([1, 5, 10]);
    expect(deriveStockIncrements('')).toEqual([1, 5, 10]);
    expect(deriveStockIncrements(null)).toEqual([1, 5, 10]);
    expect(deriveStockIncrements(undefined)).toEqual([1, 5, 10]);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(deriveStockIncrements('  PIÈCE  ')).toEqual([1, 6, 12]);
    expect(deriveStockIncrements('KG')).toEqual([1, 2]);
  });

  it('appends a "fill the shelf" increment equal to a high threshold', () => {
    // 24 not already present → appended and kept sorted
    expect(deriveStockIncrements('tray', 24)).toEqual([1, 5, 10, 24]);
  });

  it('does not duplicate the threshold when it already matches a base step', () => {
    expect(deriveStockIncrements('piece', 12)).toEqual([1, 6, 12]);
  });

  it('ignores a threshold below the dozen guard', () => {
    expect(deriveStockIncrements('tray', 8)).toEqual([1, 5, 10]);
    expect(deriveStockIncrements('tray', 0)).toEqual([1, 5, 10]);
  });

  it('floors a fractional threshold', () => {
    expect(deriveStockIncrements('tray', 15.9)).toEqual([1, 5, 10, 15]);
  });

  it('always returns ascending, positive, unique values', () => {
    for (const unit of ['piece', 'kg', 'tray', 'ml', 'unknownxyz']) {
      for (const t of [0, 5, 12, 20, 50]) {
        const out = deriveStockIncrements(unit, t);
        expect(out).toEqual([...out].sort((a, b) => a - b));
        expect(out.every((n) => n > 0)).toBe(true);
        expect(new Set(out).size).toBe(out.length);
      }
    }
  });
});
