// packages/domain/src/reports/__tests__/toLocalDateStr.test.ts
import { describe, it, expect } from 'vitest';
import { toLocalDateStr, toLocalDayStartUTC, DEFAULT_TIMEZONE } from '../toLocalDateStr.js';

describe('toLocalDateStr', () => {
  it('defaults to Asia/Makassar (+08)', () => {
    // 2026-05-14T23:30Z = 2026-05-15T07:30 in +08
    expect(toLocalDateStr(new Date('2026-05-14T23:30:00Z'))).toBe('2026-05-15');
  });

  it('explicit UTC returns the UTC-day', () => {
    expect(toLocalDateStr('2026-05-14T15:00:00Z', 'UTC')).toBe('2026-05-14');
  });

  it('accepts Date, string, and epoch number', () => {
    const d = new Date('2026-05-10T00:00:00Z');
    expect(toLocalDateStr(d)).toBe(toLocalDateStr(d.toISOString()));
    expect(toLocalDateStr(d.getTime())).toBe(toLocalDateStr(d));
  });

  it('throws on invalid input', () => {
    expect(() => toLocalDateStr('not-a-date')).toThrow(TypeError);
  });

  it('matches DEFAULT_TIMEZONE when no tz arg passed', () => {
    expect(DEFAULT_TIMEZONE).toBe('Asia/Makassar');
  });

  it('handles a near-midnight UTC that flips local day', () => {
    // 2026-01-01T16:01Z = 2026-01-02T00:01 in +08 (Asia/Makassar)
    expect(toLocalDateStr('2026-01-01T16:01:00Z')).toBe('2026-01-02');
  });
});

describe('toLocalDayStartUTC', () => {
  it('returns the UTC instant of local midnight (Asia/Makassar +08)', () => {
    const utc = toLocalDayStartUTC('2026-05-14');
    // Local midnight Asia/Makassar = 2026-05-13T16:00Z
    expect(utc.toISOString()).toBe('2026-05-13T16:00:00.000Z');
  });

  it('UTC tz returns the UTC midnight of the same day', () => {
    const utc = toLocalDayStartUTC('2026-05-14', 'UTC');
    expect(utc.toISOString()).toBe('2026-05-14T00:00:00.000Z');
  });

  it('throws on bad input', () => {
    expect(() => toLocalDayStartUTC('not-a-date')).toThrow(TypeError);
  });
});
