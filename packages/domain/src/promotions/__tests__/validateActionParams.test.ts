// packages/domain/src/promotions/__tests__/validateActionParams.test.ts
import { describe, it, expect } from 'vitest';
import { validateActionParams } from '../validateActionParams.js';

describe('validateActionParams', () => {
  it('percentage_off cart valid', () => {
    expect(validateActionParams('percentage_off', { percentage: 20, target: 'cart' })).toEqual({ ok: true });
  });
  it('percentage_off product missing target_id → invalid', () => {
    const r = validateActionParams('percentage_off', { percentage: 20, target: 'product' });
    expect(r.ok).toBe(false);
  });
  it('percentage_off > 100 invalid', () => {
    expect(validateActionParams('percentage_off', { percentage: 150, target: 'cart' }).ok).toBe(false);
  });
  it('fixed_off non-cart target invalid', () => {
    expect(validateActionParams('fixed_off', { amount: 1000, target: 'product' }).ok).toBe(false);
  });
  it('bogo missing buy_product_id invalid', () => {
    expect(validateActionParams('bogo', { buy_qty: 1, get_qty: 1, get_discount_pct: 100 }).ok).toBe(false);
  });
  it('free_product valid', () => {
    expect(validateActionParams('free_product', { product_id: 'P', qty: 1 }).ok).toBe(true);
  });
  it('percentage_off category with target_id valid', () => {
    expect(validateActionParams('percentage_off', { percentage: 15, target: 'category', target_id: 'BEV' }).ok).toBe(true);
  });
  it('percentage_off invalid target string', () => {
    expect(validateActionParams('percentage_off', { percentage: 15, target: 'line' }).ok).toBe(false);
  });
  it('fixed_off valid cart', () => {
    expect(validateActionParams('fixed_off', { amount: 5000, target: 'cart' }).ok).toBe(true);
  });
  it('fixed_off amount missing → invalid', () => {
    expect(validateActionParams('fixed_off', { target: 'cart' }).ok).toBe(false);
  });
  it('bogo invalid buy_qty → invalid', () => {
    expect(validateActionParams('bogo', { buy_product_id: 'P', buy_qty: 0, get_qty: 1, get_discount_pct: 100 }).ok).toBe(false);
  });
  it('bogo invalid get_qty → invalid', () => {
    expect(validateActionParams('bogo', { buy_product_id: 'P', buy_qty: 1, get_qty: 0, get_discount_pct: 100 }).ok).toBe(false);
  });
  it('bogo invalid get_discount_pct → invalid', () => {
    expect(validateActionParams('bogo', { buy_product_id: 'P', buy_qty: 1, get_qty: 1, get_discount_pct: 0 }).ok).toBe(false);
  });
  it('free_product missing product_id → invalid', () => {
    expect(validateActionParams('free_product', { qty: 1 }).ok).toBe(false);
  });
  it('free_product invalid qty → invalid', () => {
    expect(validateActionParams('free_product', { product_id: 'P', qty: 0 }).ok).toBe(false);
  });
});
