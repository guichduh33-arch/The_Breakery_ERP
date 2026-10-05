import type { Employee, Request } from '../model';
import type { Week } from './demoRules';
import { shifts } from './demoRules';

export const presenceStatuses = ['On work', 'On break', 'Day off', 'On leave', 'Not clocked in', 'Clocked out', 'No schedule'] as const;
export type PresenceStatus = typeof presenceStatuses[number];
export interface PresencePunch { label: string; time: string; synced: boolean }
export interface PresenceRow {
  employee: Employee; status: PresenceStatus; shift: string; lastEvent: string;
  time: string; pending: number; source: string;
}
// Le tableau représente le lundi de la semaine de démonstration, pas une date serveur.
export function demoPresence(team: Employee[], week: Week, requests: Request[], punches: PresencePunch[], catalog: { code: string; label: string; hours: string; dayOff?: boolean }[] = shifts): PresenceRow[] {
  return team.map(employee => {
    const code = week[employee.id]?.[0];
    const shift = catalog.find(item => item.code === code);
    const events = employee.id === '001' ? punches : employee.id === '030'
      ? [{ label: 'Masuk', time: '02:00', synced: true }, { label: 'Mulai istirahat', time: '05:00', synced: true }]
      : employee.id === '042' ? [{ label: 'Masuk', time: '10:30', synced: true }] : [];
    const confirmed = events.filter(event => event.synced);
    const last = confirmed[confirmed.length - 1];
    const leave = requests.some(request => request.employee === employee.id && request.date === '2026-10-05'
      && request.status === 'approved' && ['leave', 'sick', 'permission'].includes(request.kind));
    const status: PresenceStatus = last
      ? last.label === 'Pulang' ? 'Clocked out' : last.label === 'Mulai istirahat' ? 'On break' : 'On work'
      : leave ? 'On leave' : (shift?.dayOff ?? code === 'OFF') ? 'Day off' : shift ? 'Not clocked in' : 'No schedule';
    const labels: Record<string, string> = { Masuk: 'Clock in', 'Mulai istirahat': 'Break started', 'Selesai istirahat': 'Break ended', Pulang: 'Clock out' };
    return { employee, status, shift: shift ? shift.label + ' · ' + shift.hours : 'Not assigned',
      lastEvent: last ? labels[last.label] ?? last.label : 'No confirmed punch', time: last?.time ?? '—',
      pending: events.filter(event => !event.synced).length,
      source: employee.id === '001' ? 'Staff app · demo session' : events.length ? 'Illustrative punches' : 'Demo schedule' };
  });
}
