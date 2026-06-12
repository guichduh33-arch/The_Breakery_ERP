import { describe, it, expect } from 'vitest';
import { isSellable } from '../sellability.js';

describe('isSellable (P1-1)', () => {
  it('untracked product is always sellable even at 0 stock', () => {
    expect(isSellable(false, null, 0)).toBe(true);
  });
  it('tracked product uses display_stock when a vitrine row exists', () => {
    expect(isSellable(true, 3, 0)).toBe(true);
    expect(isSellable(true, 0, 50)).toBe(false);
  });
  it('tracked product falls back to current_stock without vitrine row', () => {
    expect(isSellable(true, null, 2)).toBe(true);
    expect(isSellable(true, null, 0)).toBe(false);
  });
  it('undefined track_inventory (legacy rows) behaves as tracked', () => {
    expect(isSellable(undefined, null, 0)).toBe(false);
  });
});
