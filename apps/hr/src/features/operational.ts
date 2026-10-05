import type { Employee, Request } from '../model';
import type { Week } from './demoRules';
import type { ShiftConfig } from './shiftRules';
export function monthDates(month: string): (string | null)[] {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('Use YYYY-MM.');
  const first = new Date(month + '-01T00:00:00Z');
  const padding = (first.getUTCDay() + 6) % 7;
  const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCDate(0);
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - padding + 1;
    return day > 0 && day <= next.getUTCDate() ? month + '-' + String(day).padStart(2, '0') : null;
  });
}
export function moveMonth(month: string, offset: number): string {
  monthDates(month); const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset); return date.toISOString().slice(0, 7);
}
export interface CalendarEvent { date: string; employee: string; title: string; detail: string; tone: string; kind: 'schedule' | 'request'; }
export function calendarEvents(team: Employee[], week: Week, catalog: ShiftConfig[], requests: Request[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const employee of team) for (let index = 0; index < 7; index++) {
    const shift = catalog.find(item => item.code === week[employee.id]?.[index]);
    if (shift) events.push({ employee: employee.id, date: '2026-10-' + String(index + 5).padStart(2, '0'),
      title: shift.label, detail: shift.hours, tone: shift.dayOff ? 'neutral' : 'success', kind: 'schedule' });
  }
  for (const request of requests) if (['pending', 'approved'].includes(request.status)) events.push({
    employee: request.employee, date: request.date, title: request.kind, detail: request.status,
    tone: request.status === 'approved' ? 'success' : 'warning', kind: 'request',
  });
  return events;
}
export interface AttendanceRecord {
  id: string; date: string; shift: string; scheduleIn: string; scheduleOut: string;
  scheduleBreak: string; in: string; out: string; break: string;
  source: string; changes: { reason: string; at: string; before: string; after: string }[];
}
export const sampleAttendance: AttendanceRecord[] = [
  { id: '001', date: '2026-10-04', shift: 'MORNING', scheduleIn: '06:30', scheduleOut: '14:30', scheduleBreak: '10:30–11:30', in: '06:28', out: '14:31', break: '10:31–11:30', source: 'Illustrative record', changes: [] },
  { id: '030', date: '2026-10-04', shift: 'BAKER', scheduleIn: '02:00', scheduleOut: '10:00', scheduleBreak: '05:00–06:00', in: '02:01', out: '', break: '05:00–06:00', source: 'Illustrative record', changes: [] },
  { id: '042', date: '2026-10-04', shift: 'AFTERNOON', scheduleIn: '10:30', scheduleOut: '18:30', scheduleBreak: '13:30–14:30', in: '10:42', out: '18:31', break: '13:32–14:40', source: 'Illustrative record', changes: [] },
];
function minute(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Use HH:MM, or leave a missing punch empty.');
  const [hours, minutes] = time.split(':').map(Number); return hours! * 60 + minutes!;
}
function duration(range: string): number {
  const [start, end] = range.split('–'); if (!start || !end) return 0;
  const value = minute(end) - minute(start); return value > 0 ? value : value + 1440;
}
// Indicateurs de lecture des exemples : pas de qualification légale ni de retenue de paie.
export function attendanceFacts(record: AttendanceRecord) {
  const late = record.in ? Math.max(0, minute(record.in) - minute(record.scheduleIn)) : 0;
  const early = record.out ? Math.max(0, minute(record.scheduleOut) - minute(record.out)) : 0;
  const breakOverrun = Math.max(0, duration(record.break) - duration(record.scheduleBreak));
  const status = !record.in ? 'Missing clock in' : !record.out ? 'Missing clock out' : late > 0 ? 'Late clock in' : 'Complete';
  return { late, early, breakOverrun, status, tone: status === 'Complete' ? 'success' : 'warning' };
}
export function correctAttendance(records: AttendanceRecord[], id: string, date: string, clockIn: string, clockOut: string, reason: string, at: string): AttendanceRecord[] {
  if (!reason.trim()) throw new Error('Explain the correction before saving.');
  if (clockIn) minute(clockIn); if (clockOut) minute(clockOut);
  const record = records.find(item => item.id === id && item.date === date);
  if (!record) throw new Error('Attendance record not found.');
  if (record.in === clockIn && record.out === clockOut) return records;
  return records.map(item => item === record ? { ...item, in: clockIn, out: clockOut, source: 'Manual correction · demo',
    changes: [...item.changes, { reason: reason.trim(), at, before: (item.in || '—') + ' / ' + (item.out || '—'), after: (clockIn || '—') + ' / ' + (clockOut || '—') }] } : item);
}
