import { shifts } from './demoRules';
export interface ShiftConfig {
  code: string; label: string; staffLabel: string; hours: string; break: string;
  start: string; end: string; nextDay: boolean; dayOff: boolean;
  breakMode: string; breakStart: string; breakEnd: string; breakMinutes: string;
  paidBreak: boolean; requireIn: boolean; requireOut: boolean; requireBreak: boolean;
  lateTolerance: string; breakTolerance: string; active: boolean;
}
export const initialShifts: ShiftConfig[] = shifts.map((shift, index) => ({
  ...shift, staffLabel: ['Pagi', 'Siang', 'Baker', 'Libur'][index] ?? shift.code,
  start: shift.hours.split('–')[0] ?? '', end: shift.hours.split('–')[1] ?? '',
  nextDay: false, dayOff: shift.code === 'OFF', breakMode: shift.code === 'OFF' ? 'none' : 'fixed',
  breakStart: shift.break.split('–')[0] ?? '', breakEnd: shift.break.split('–')[1] ?? '', breakMinutes: shift.code === 'OFF' ? '' : '60',
  paidBreak: false, requireIn: shift.code !== 'OFF', requireOut: shift.code !== 'OFF', requireBreak: shift.code !== 'OFF',
  lateTolerance: '', breakTolerance: '', active: true,
}));
export const blankShift: ShiftConfig = { code: '', label: '', staffLabel: '', hours: '', break: '',
  start: '06:30', end: '14:30', nextDay: false, dayOff: false, breakMode: 'fixed',
  breakStart: '10:30', breakEnd: '11:30', breakMinutes: '60', paidBreak: false,
  requireIn: true, requireOut: true, requireBreak: true, lateTolerance: '', breakTolerance: '', active: true };
function minute(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Use a valid HH:MM time.');
  const [hour, min] = time.split(':').map(Number); return hour! * 60 + min!;
}
// Options enregistrées pour la démo ; aucun impact financier avant branchement du moteur.
export function saveShift(catalog: ShiftConfig[], input: ShiftConfig, editingCode: string | null): ShiftConfig[] {
  const shift = { ...input, code: input.code.trim(), label: input.label.trim(), staffLabel: input.staffLabel.trim() };
  if (!/^[A-Z0-9_]{1,32}$/.test(shift.code) || !shift.label || !shift.staffLabel) throw new Error('Use a unique uppercase code and both shift names.');
  if (shift.label.length > 100 || shift.staffLabel.length > 100) throw new Error('Shift names must be under 100 characters.');
  if (editingCode && shift.code !== editingCode) throw new Error('An existing shift code cannot change.');
  if (!editingCode && catalog.some(item => item.code === shift.code)) throw new Error('This shift code already exists.');
  if (editingCode && !catalog.some(item => item.code === editingCode)) throw new Error('Shift not found.');
  for (const value of [shift.lateTolerance, shift.breakTolerance]) if (value && (!/^\d+$/.test(value) || Number(value) > 1440)) throw new Error('Tolerance must be blank or 0–1440 whole minutes.');
  if (!['none', 'fixed', 'flexible'].includes(shift.breakMode)) throw new Error('Invalid break mode.');
  if (shift.dayOff) {
    Object.assign(shift, { start: '', end: '', hours: '—', break: '—', breakMode: 'none', breakStart: '', breakEnd: '', breakMinutes: '', nextDay: false, requireIn: false, requireOut: false, requireBreak: false, paidBreak: false });
  } else {
    const start = minute(shift.start); const end = minute(shift.end) + (shift.nextDay ? 1440 : 0);
    const duration = end - start;
    if (duration <= 0 || duration > 1440) throw new Error('Shift duration must be between 1 minute and 24 hours. Use next-day end for overnight shifts.');
    if (shift.breakMode === 'fixed') {
      let breakStart = minute(shift.breakStart); if (breakStart < start) breakStart += 1440;
      let breakEnd = minute(shift.breakEnd); if (breakEnd <= breakStart) breakEnd += 1440;
      if (breakStart < start || breakEnd > end || breakEnd <= breakStart || breakEnd - breakStart >= duration) throw new Error('The break must fit inside the shift.');
      shift.breakMinutes = String(breakEnd - breakStart); shift.break = shift.breakStart + '–' + shift.breakEnd;
    } else if (shift.breakMode === 'flexible') {
      if (!/^\d+$/.test(shift.breakMinutes) || Number(shift.breakMinutes) <= 0 || Number(shift.breakMinutes) >= duration) throw new Error('Flexible break duration must be positive and shorter than the shift.');
      shift.break = shift.breakMinutes + ' min'; shift.breakStart = ''; shift.breakEnd = '';
    } else { shift.break = '—'; shift.breakMinutes = ''; shift.breakStart = ''; shift.breakEnd = ''; shift.requireBreak = false; shift.paidBreak = false; }
    shift.hours = shift.start + '–' + shift.end + (shift.nextDay ? ' (+1)' : '');
  }
  return editingCode ? catalog.map(item => item.code === editingCode ? shift : item) : [...catalog, shift];
}
