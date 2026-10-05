import { describe, it, expect } from 'vitest';
import { calendarEvents, monthDates, moveMonth, attendanceFacts, sampleAttendance, correctAttendance } from '../features/operational';
import { employees, initialRequests } from '../model';
import { sampleWeek } from '../features/demoRules';
import { initialShifts } from '../features/shiftRules';
import { addDiscipline, validateThr } from '../features/companyDemo';
describe('operational demo screens', () => {
  it('aligns calendar months to Monday and handles month boundaries and leap years', () => {
    const dates = monthDates('2026-10'); expect(dates).toHaveLength(42); expect(dates[3]).toBe('2026-10-01');
    expect(monthDates('2028-02').filter(Boolean)).toHaveLength(29); expect(moveMonth('2026-12', 1)).toBe('2027-01');
    expect(() => monthDates('2026-13')).toThrow();
  });
  it('includes schedules and open requests but excludes cancelled ones', () => {
    const requests = [{ ...initialRequests[0]!, status: 'cancelled' as const }, initialRequests[1]!];
    const events = calendarEvents(employees, sampleWeek, initialShifts, requests);
    expect(events.filter(item => item.kind === 'schedule')).toHaveLength(21);
    expect(events.filter(item => item.kind === 'request')).toHaveLength(1);
  });
  it('compares break duration and reports missing checkout without fabricated work hours', () => {
    expect(attendanceFacts(sampleAttendance[1]!).status).toBe('Missing clock out');
    expect(attendanceFacts(sampleAttendance[2]!).breakOverrun).toBe(8);
    expect(attendanceFacts(sampleAttendance[2]!).late).toBe(12);
  });
  it('validates corrections, retains prior values and leaves unrelated records untouched', () => {
    const updated = correctAttendance(sampleAttendance, '030', '2026-10-04', '02:01', '10:00', 'Fictional correction', '2026-10-05T06:00:00Z');
    expect(updated[1]?.changes[0]?.before).toBe('02:01 / —'); expect(sampleAttendance[1]?.out).toBe('');
    expect(updated[0]).toBe(sampleAttendance[0]); expect(attendanceFacts(updated[1]!).status).toBe('Late clock in');
    expect(() => correctAttendance(sampleAttendance, '030', '2026-10-04', '25:00', '', 'Example', '')).toThrow();
    expect(() => correctAttendance(sampleAttendance, '030', '2026-10-04', '', '', '', '')).toThrow();
  });
  it('keeps discipline manual and validates proposed THR dates without calculating entitlement', () => {
    expect(addDiscipline([], { employee: '001', date: '2026-10-05', level: '2', reason: 'Fictional example', until: '2027-01-05' })).toHaveLength(1);
    expect(() => addDiscipline([], { employee: '001', date: '2026-10-05', level: '6', reason: 'Example', until: '' })).toThrow();
    expect(() => validateThr({ name: 'THR demo', holiday: '2027-03-01', payment: '2027-03-02', components: 'Basic salary', notes: 'For review' })).toThrow();
  });
});
