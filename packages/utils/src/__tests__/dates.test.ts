// packages/utils/src/__tests__/dates.test.ts
import { describe, it, expect } from 'vitest';
import { formatDateTimeWita, formatDateTimeShortWita, formatTimeWita, formatDateLong, todayIsoDate } from '../dates';

describe('dates', () => {
  const utc = new Date('2026-05-03T10:30:00Z');  // 18:30 WITA

  it('formatDateTimeWita renders WITA', () => {
    expect(formatDateTimeWita(utc)).toBe('2026-05-03 18:30:00');
  });

  it('formatDateTimeShortWita renders dd MMM yyyy, HH:mm WITA', () => {
    expect(formatDateTimeShortWita(utc)).toBe('03 May 2026, 18:30');
  });

  // Le mois en lettres est la raison d'être du helper : un 03/05 rendu par le
  // navigateur se lit 3 mai ou 5 mars selon la locale.
  it('formatDateTimeShortWita names the month rather than numbering it', () => {
    expect(formatDateTimeShortWita('2026-08-03T19:47:02Z')).toBe('04 Aug 2026, 03:47');
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
