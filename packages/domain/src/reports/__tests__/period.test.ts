import { describe, expect, it } from 'vitest';
import { previousPeriod, formatDelta } from '../period.js';

describe('previousPeriod', () => {
  it('shifts a calendar month back', () => {
    expect(previousPeriod('2026-05-01', '2026-05-31'))
      .toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('shifts a 7-day window back by 7 days', () => {
    expect(previousPeriod('2026-05-15', '2026-05-21'))
      .toEqual({ start: '2026-05-08', end: '2026-05-14' });
  });

  it('handles year crossing', () => {
    expect(previousPeriod('2026-01-01', '2026-01-31'))
      .toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('handles same-day range (1-day period)', () => {
    expect(previousPeriod('2026-05-24', '2026-05-24'))
      .toEqual({ start: '2026-05-23', end: '2026-05-23' });
  });

  it('falls back to n-day shift when calendar-month not aligned', () => {
    expect(previousPeriod('2026-05-10', '2026-05-21'))
      .toEqual({ start: '2026-04-28', end: '2026-05-09' });
  });
});

describe('formatDelta', () => {
  it('returns abs + pct + sign for normal case', () => {
    expect(formatDelta(120, 100)).toEqual({ abs: 20, pct: 0.20, sign: 1 });
  });

  it('returns negative sign when current < previous', () => {
    expect(formatDelta(80, 100)).toEqual({ abs: -20, pct: -0.20, sign: -1 });
  });

  it('returns null pct when previous is zero', () => {
    expect(formatDelta(50, 0)).toEqual({ abs: 50, pct: null, sign: 1 });
  });

  it('returns sign=0 when both zero', () => {
    expect(formatDelta(0, 0)).toEqual({ abs: 0, pct: null, sign: 0 });
  });
});
