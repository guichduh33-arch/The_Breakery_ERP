import { describe, it, expect } from 'vitest';
import { decideRequest, createRequest, demoNet, initialRequests, parseIdr } from '../model';
describe('HR demo boundaries', () => {
  it('rejects impossible calendar dates', () => {
    for (const date of ['2026-02-30', '2026-99-01'])
      expect(() => createRequest(initialRequests, 'leave', date, 'Example')).toThrow();
  });
  it('requires a decision reason', () =>
    expect(() => decideRequest(initialRequests, 1, 'approved', ' ')).toThrow());
  it('keeps a decision immutable on repeated review', () => {
    const reviewed = decideRequest(initialRequests, 1, 'approved', 'Approved by HR');
    expect(decideRequest(reviewed, 1, 'rejected', 'Retry')).toEqual(reviewed);
    expect(initialRequests[0]?.status).toBe('pending');
  });
  it('creates a pending staff request without changing the input', () => {
    const result = createRequest(initialRequests, 'leave', '2026-10-09', 'Family');
    expect(result).toHaveLength(3);
    expect(result[2]?.employee).toBe('001');
    expect(initialRequests).toHaveLength(2);
  });
  it('rejects incomplete requests', () =>
    expect(() => createRequest(initialRequests, 'leave', '', '')).toThrow());
  it('uses integer IDR for positive and negative adjustments', () => {
    expect(demoNet('3500000', '-100000')).toBe(3400000n);
    expect(demoNet('3500000', '250000')).toBe(3750000n);
  });
  it('rejects fractional and invalid amounts', () => {
    for (const value of ['1.5', 'NaN', '1e3', '']) expect(() => parseIdr(value)).toThrow();
  });
  it('preserves amounts beyond floating point precision', () =>
    expect(demoNet('9007199254740993', '1')).toBe(9007199254740994n));
});
