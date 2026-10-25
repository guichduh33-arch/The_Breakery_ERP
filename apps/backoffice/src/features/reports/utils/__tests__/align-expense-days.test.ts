import { describe, expect, it } from 'vitest';
import { alignExpenseDays } from '../alignExpenseDays.js';

describe('expense comparison by calendar rank', () => {
  it('fills both sparse calendars before aligning their days', () => {
    expect(alignExpenseDays('2026-06-01', '2026-06-03', '2026-05-29', '2026-05-31', [
      { date: '2026-06-01', total: 10 }, { date: '2026-06-03', total: 30 },
    ], [
      { date: '2026-05-30', total: 20 },
    ])).toEqual([
      { date: '2026-06-01', current: 10, compare: 0 },
      { date: '2026-06-02', current: 0, compare: 20 },
      { date: '2026-06-03', current: 30, compare: 0 },
    ]);
  });

  it('keeps a day outside the shorter comparison calendar unknown', () => {
    const rows = alignExpenseDays('2026-03-01', '2026-03-31', '2026-02-01', '2026-02-28', [], [
      { date: '2026-02-28', total: 28 },
    ]);
    expect(rows).toHaveLength(31);
    expect(rows[27]).toEqual({ date: '2026-03-28', current: 0, compare: 28 });
    expect(rows[28]).toEqual({ date: '2026-03-29', current: 0, compare: null });
  });

  it('ignores rows outside the requested windows', () => {
    expect(alignExpenseDays('2026-06-01', '2026-06-01', '2026-05-31', '2026-05-31', [
      { date: '2026-05-01', total: 999 },
    ], [])).toEqual([{ date: '2026-06-01', current: 0, compare: 0 }]);
  });
});
