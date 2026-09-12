import { describe, expect, it } from 'vitest';
import { formatStockQuantity, parseStockQuantity } from '../stockQuantity.js';

describe('stock quantities', () => {
  it.each(['', ' ', '-1', 'NaN', 'Infinity', '1.0001', '0.000000000001', '10000000'])(
    'rejects invalid or unrepresentable input %s', (input) => {
      expect(parseStockQuantity(input)).toBeNull();
    },
  );

  it.each([['0', 0], ['1.375', 1.375], ['9999999.999', 9999999.999]])(
    'preserves %s without truncation', (input, expected) => {
      expect(parseStockQuantity(String(input))).toBe(expected);
    },
  );

  it('keeps fractions for pieces and weight alike', () => {
    expect(formatStockQuantity(1.375, 'pcs')).toBe('1,375 pcs');
    expect(formatStockQuantity(1.375, 'kg')).toBe('1,375 kg');
  });
});
