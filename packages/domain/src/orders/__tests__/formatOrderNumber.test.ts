import { describe, expect, it } from 'vitest';
import { formatOrderNumberShort } from '../formatOrderNumber.js';

describe('formatOrderNumberShort', () => {
  it('compacts POS numbers', () => {
    expect(formatOrderNumberShort('P16082026001')).toBe('P-001');
  });

  it('compacts tablet numbers, keeping the tablet index', () => {
    expect(formatOrderNumberShort('T116082026042')).toBe('T1-042');
    expect(formatOrderNumberShort('T216082026007')).toBe('T2-007');
  });

  it('compacts back office numbers', () => {
    expect(formatOrderNumberShort('BO16082026003')).toBe('BO-003');
  });

  it('keeps the overflow sequence intact beyond 999/day', () => {
    expect(formatOrderNumberShort('P160820261042')).toBe('P-1042');
  });

  it('passes legacy formats through unchanged', () => {
    expect(formatOrderNumberShort('#0001')).toBe('#0001');
    expect(formatOrderNumberShort('B2B-20260816-0001')).toBe('B2B-20260816-0001');
    expect(formatOrderNumberShort('HELD-3f2a')).toBe('HELD-3f2a');
    expect(formatOrderNumberShort('')).toBe('');
  });
});
