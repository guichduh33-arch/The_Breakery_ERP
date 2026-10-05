import { describe, expect, it } from 'vitest';
import { saveShift, initialShifts, blankShift } from '../features/shiftRules';
import { changeShift, sampleWeek, detailedRequest } from '../features/demoRules';
import { initialRequests } from '../model';
describe('configurable demo shifts', () => {
  const night = { ...blankShift, code: 'NIGHT', label: 'Night', staffLabel: 'Malam', start: '22:00', end: '06:00', nextDay: true, breakStart: '01:00', breakEnd: '02:00' };
  it('creates overnight shifts and uses them in schedules and staff requests', () => {
    const catalog = saveShift(initialShifts, night, null);
    expect(catalog.at(-1)?.hours).toBe('22:00–06:00 (+1)'); expect(catalog.at(-1)?.breakMinutes).toBe('60');
    expect(changeShift(sampleWeek, '001', 0, 'NIGHT', catalog)['001']?.[0]).toBe('NIGHT');
    expect(detailedRequest(initialRequests, 'shift', '2026-10-08', 'Example', 'NIGHT', catalog)).toHaveLength(3);
    expect(initialShifts).toHaveLength(4);
  });
  it('rejects duplicates, invalid time ranges, breaks and tolerances', () => {
    for (const patch of [{ code: 'MORNING' }, { nextDay: false }, { breakEnd: '07:00' }, { start: '25:00' }, { lateTolerance: '-1' }])
      expect(() => saveShift(initialShifts, { ...night, ...patch }, null)).toThrow();
  });
  it('handles duration-only breaks, day off and inactive shifts', () => {
    const catalog = saveShift(initialShifts, { ...night, breakMode: 'flexible', breakMinutes: '45' }, null);
    expect(catalog.at(-1)?.break).toBe('45 min');
    const off = saveShift(catalog, { ...night, code: 'REST', dayOff: true }, null).at(-1);
    expect(off?.requireIn).toBe(false); expect(off?.hours).toBe('—');
    const inactive = saveShift(catalog, { ...night, active: false }, 'NIGHT');
    expect(() => changeShift(sampleWeek, '001', 0, 'NIGHT', inactive)).toThrow();
    expect(catalog.at(-1)?.active).toBe(true);
  });
});
