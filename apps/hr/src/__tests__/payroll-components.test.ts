import { describe, expect, it } from 'vitest';
import { componentAmount, saveComponent } from '../features/payrollComponents';
describe('payroll component calculations', () => {
  it('uses exact IDR arithmetic and rounds fractional quantities', () => {
    expect(componentAmount('15000', '16', 'quantity')).toBe('240000');
    expect(componentAmount('101', '1.50', 'quantity')).toBe('152');
    expect(componentAmount('9007199254740993', '', 'fixed')).toBe('9007199254740993');
  });
  it('rejects malformed rates and quantities', () => {
    expect(() => componentAmount('-1', '2', 'quantity')).toThrow();
    expect(() => componentAmount('100', '1.001', 'quantity')).toThrow();
    expect(() => componentAmount('100', '', 'quantity')).toThrow();
  });
  it('replaces a component without duplicating it or mutating inputs', () => {
    const before = [{ id: 1, label: 'Bonus', type: 'allowance' as const, amount: '100', reason: 'Example' }];
    const next = saveComponent(before, { ...before[0]!, amount: '200' }, 1);
    expect(next).toHaveLength(1); expect(next[0]!.amount).toBe('200'); expect(before[0]!.amount).toBe('100');
    expect(() => saveComponent(before, { ...before[0]!, reason: '' }, 1)).toThrow();
  });
});
