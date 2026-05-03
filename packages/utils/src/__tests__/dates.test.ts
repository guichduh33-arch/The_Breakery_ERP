// packages/utils/src/__tests__/dates.test.ts
import { describe, it, expect } from 'vitest';
import { formatDateTimeWita, formatTimeWita, formatDateLong, todayIsoDate } from '../dates';

describe('dates', () => {
  const utc = new Date('2026-05-03T10:30:00Z');  // 18:30 WITA

  it('formatDateTimeWita renders WITA', () => {
    expect(formatDateTimeWita(utc)).toBe('2026-05-03 18:30:00');
  });

  it('formatTimeWita renders HH:mm WITA', () => {
    expect(formatTimeWita(utc)).toBe('18:30');
  });

  it('formatDateLong renders Month d, yyyy', () => {
    expect(formatDateLong(utc)).toMatch(/^May \d+, 2026$/);
  });

  it('todayIsoDate returns YYYY-MM-DD', () => {
    expect(todayIsoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts string input for formatDateTimeWita', () => {
    expect(formatDateTimeWita('2026-05-03T10:30:00Z')).toBe('2026-05-03 18:30:00');
  });

  it('accepts string input for formatTimeWita', () => {
    expect(formatTimeWita('2026-05-03T10:30:00Z')).toBe('18:30');
  });

  it('accepts string input for formatDateLong', () => {
    expect(formatDateLong('2026-05-03T10:30:00Z')).toMatch(/^May \d+, 2026$/);
  });
});
