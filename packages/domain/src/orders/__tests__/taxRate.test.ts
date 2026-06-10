// packages/domain/src/orders/__tests__/taxRate.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_TAX_RATE } from '../taxRate.js';

describe('DEFAULT_TAX_RATE', () => {
  it('equals 0.10 (10% PB1/VAT composite)', () => {
    expect(DEFAULT_TAX_RATE).toBe(0.10);
  });
});
