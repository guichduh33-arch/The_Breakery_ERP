// apps/backoffice/src/features/settings/__tests__/holiday-name-for.test.ts
// Settings §6.A — pure matcher behind the holiday consumers (dashboard banner
// + daily sales annotation): exact date for fixed holidays, month+day for
// recurring ones.

import { describe, it, expect } from 'vitest';
import { holidayNameFor, type HolidayRow } from '../hooks/useHolidays.js';

function row(partial: Partial<HolidayRow> & Pick<HolidayRow, 'name' | 'date'>): HolidayRow {
  return {
    id: 'h-' + partial.name,
    type: 'national',
    is_recurring: false,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...partial,
  } as HolidayRow;
}

const HOLIDAYS: HolidayRow[] = [
  row({ name: 'Hari Kemerdekaan', date: '2026-08-17', is_recurring: true }),
  row({ name: 'Nyepi', date: '2026-03-19', is_recurring: false }),
];

describe('holidayNameFor', () => {
  it('matches a fixed-date holiday on the exact date only', () => {
    expect(holidayNameFor(HOLIDAYS, '2026-03-19')).toBe('Nyepi');
    expect(holidayNameFor(HOLIDAYS, '2027-03-19')).toBeNull();
  });

  it('matches a recurring holiday on month+day across years', () => {
    expect(holidayNameFor(HOLIDAYS, '2026-08-17')).toBe('Hari Kemerdekaan');
    expect(holidayNameFor(HOLIDAYS, '2030-08-17')).toBe('Hari Kemerdekaan');
  });

  it('returns null on no match, undefined list, or malformed date', () => {
    expect(holidayNameFor(HOLIDAYS, '2026-01-02')).toBeNull();
    expect(holidayNameFor(undefined, '2026-08-17')).toBeNull();
    expect(holidayNameFor(HOLIDAYS, '')).toBeNull();
  });
});
