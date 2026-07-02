import { describe, expect, it } from 'vitest';
import { classifyCloseFiscalYearError } from '../hooks/useCloseFiscalYear.js';

describe('classifyCloseFiscalYearError', () => {
  it.each([
    ['fiscal_year_invalid', 'fiscal_year_invalid'],
    ['pin_required', 'pin_required'],
    ['forbidden', 'forbidden'],
    ['invalid_pin', 'invalid_pin'],
    ['fiscal_year_periods_missing: 3 of 12 seeded for 2026', 'periods_missing'],
    ['fiscal_year_periods_open: 2 period(s) of 2026 not closed/locked', 'periods_open'],
    ['year_already_closed: 2026', 'year_already_closed'],
    ['retained_earnings_account_missing: 3200', 'retained_earnings_missing'],
    ['anything else', 'unknown'],
  ])('classifies %s → %s', (message, code) => {
    expect(classifyCloseFiscalYearError(message)).toBe(code);
  });
});
