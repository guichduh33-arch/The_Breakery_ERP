import { describe, it, expect } from 'vitest';
import { eligibleRecipeUnits, type UnitRow } from '../useUnits.js';

const UNITS: UnitRow[] = [
  { code: 'mg',  label: 'Milligram', dimension: 'mass',   factor_to_canonical: 0.001 },
  { code: 'g',   label: 'Gram',      dimension: 'mass',   factor_to_canonical: 1 },
  { code: 'gr',  label: 'Gram',      dimension: 'mass',   factor_to_canonical: 1 },
  { code: 'kg',  label: 'Kilogram',  dimension: 'mass',   factor_to_canonical: 1000 },
  { code: 'ml',  label: 'Millilitre',dimension: 'volume', factor_to_canonical: 1 },
  { code: 'lt',  label: 'Litre',     dimension: 'volume', factor_to_canonical: 1000 },
  { code: 'pcs', label: 'Piece',     dimension: 'count',  factor_to_canonical: 1 },
  { code: 'piece',label:'Piece',     dimension: 'count',  factor_to_canonical: 1 },
  { code: 'bag', label: 'Bag',       dimension: 'container', factor_to_canonical: null },
];

describe('eligibleRecipeUnits', () => {
  it('offers all same-dimension units for a kg-based material', () => {
    expect(eligibleRecipeUnits('kg', UNITS)).toEqual(['mg', 'g', 'gr', 'kg']);
  });

  it('offers mass units for a gr-based material', () => {
    expect(eligibleRecipeUnits('gr', UNITS)).toEqual(['mg', 'g', 'gr', 'kg']);
  });

  it('offers volume units for an ml-based material', () => {
    expect(eligibleRecipeUnits('ml', UNITS)).toEqual(['ml', 'lt']);
  });

  it('offers count units for a pcs-based material', () => {
    expect(eligibleRecipeUnits('pcs', UNITS)).toEqual(['pcs', 'piece']);
  });

  it('falls back to just the material unit when it is not in the registry', () => {
    expect(eligibleRecipeUnits('xyz', UNITS)).toEqual(['xyz']);
  });

  it('returns all codes when no material unit is given', () => {
    expect(eligibleRecipeUnits('', UNITS)).toEqual(UNITS.map((u) => u.code));
  });
});
