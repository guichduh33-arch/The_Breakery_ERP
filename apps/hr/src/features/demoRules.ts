import { parseIdr, createRequest } from '../model';
import type { Request, Employee, RequestKind } from '../model';
export interface Adjustment {
  id: number;
  label: string;
  amount: string;
  reason: string;
  type: 'allowance' | 'deduction';
}
export interface Preview {
  base: string;
  gross: string;
  deductions: string;
  net: string;
  lines: Adjustment[];
}
export function salaryPreview(base: string, lines: Adjustment[]): Preview {
  const salary = parseIdr(base);
  if (salary < 0n) throw new Error('Basic salary cannot be negative.');
  let gross = salary;
  let deductions = 0n;
  for (const line of lines) {
    const amount = parseIdr(line.amount);
    if (amount < 0n || !line.label.trim() || !line.reason.trim())
      throw new Error('Use a label, a reason and a non-negative whole IDR amount.');
    if (line.type === 'allowance') gross += amount;
    else deductions += amount;
  }
  return {
    base,
    gross: String(gross),
    deductions: String(deductions),
    net: String(gross - deductions),
    lines: lines.map((l) => ({ ...l })),
  };
}
export function filterRequests(
  requests: Request[],
  query: string,
  status: string,
  kind: string,
  employee?: string,
): Request[] {
  return requests.filter(
    (r) =>
      (!employee || r.employee === employee) &&
      (status === 'all' || r.status === status) &&
      (kind === 'all' || r.kind === kind) &&
      (r.employee + ' ' + r.reason + ' ' + r.date).toLowerCase().includes(query.toLowerCase()),
  );
}
export function cancelRequest(requests: Request[], id: number, employee: string): Request[] {
  const request = requests.find((r) => r.id === id);
  if (request?.employee !== employee || request.status !== 'pending')
    throw new Error('Permintaan ini tidak dapat dibatalkan.');
  return requests.map((r) =>
    r.id === id ? { ...r, status: 'cancelled', decision: 'Dibatalkan oleh karyawan' } : r,
  );
}
export function demoLeaveBalance(requests: Request[], employee: string): number {
  return (
    12 -
    requests.filter((r) => r.employee === employee && r.kind === 'leave' && r.status === 'approved')
      .length
  );
}
export const shifts = [
  { code: 'MORNING', label: 'Morning', hours: '06:30–14:30', break: '10:30–11:30' },
  { code: 'AFTERNOON', label: 'Afternoon', hours: '10:30–18:30', break: '13:30–14:30' },
  { code: 'BAKER', label: 'Baker', hours: '02:00–10:00', break: '05:00–06:00' },
  { code: 'OFF', label: 'Day off', hours: '—', break: '—' },
];
export const weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
export const daysId = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
export type Week = Record<string, string[]>;
export const sampleWeek: Week = {
  '001': ['MORNING', 'MORNING', 'MORNING', 'MORNING', 'MORNING', 'MORNING', 'OFF'],
  '030': ['BAKER', 'BAKER', 'OFF', 'BAKER', 'BAKER', 'BAKER', 'BAKER'],
  '042': ['AFTERNOON', 'AFTERNOON', 'AFTERNOON', 'OFF', 'AFTERNOON', 'AFTERNOON', 'AFTERNOON'],
};
export function changeShift(week: Week, id: string, day: number, code: string, catalog: { code: string; active?: boolean }[] = shifts): Week {
  if (!Number.isInteger(day) || day < 0 || day > 6 || !catalog.some((s) => s.code === code && s.active !== false))
    throw new Error('Invalid shift.');
  const current = week[id] ?? Array<string>(7).fill('OFF');
  return { ...week, [id]: current.map((s, i) => (i === day ? code : s)) };
}
export function duplicateWeek(week: Week): Week {
  return Object.fromEntries(Object.entries(week).map(([id, days]) => [id, [...days]]));
}

export function addEmployee(
  team: Employee[],
  id: string,
  name: string,
  position: string,
  salary: string,
) {
  if (!id.trim() || !name.trim() || !position.trim() || team.some((e) => e.id === id.trim()))
    throw new Error('Use a unique employee ID, full name and position.');
  if (parseIdr(salary) < 0n) throw new Error('Salary cannot be negative.');
  return [...team, { id: id.trim(), name: name.trim(), position: position.trim(), salary }];
}

export function detailedRequest(
  requests: Request[],
  kind: RequestKind,
  date: string,
  reason: string,
  details: string,
  catalog: { code: string; active?: boolean }[] = shifts,
): Request[] {
  const finance = kind === 'advance' || kind === 'reimbursement';
  if (finance && (!/^\d+$/.test(details) || parseIdr(details) <= 0n))
    throw new Error('Jumlah harus berupa Rupiah bulat lebih dari nol.');
  if (kind === 'overtime' && !/^(?:[1-9]\d*(?:\.\d{1,2})?|0\.(?:0[1-9]|[1-9]\d?))$/.test(details))
    throw new Error('Masukkan jumlah jam lembur yang valid.');
  if (kind === 'shift' && !catalog.some((s) => s.code === details && s.active !== false))
    throw new Error('Pilih shift yang diminta.');
  const next = createRequest(requests, kind, date, reason);
  const last = next[next.length - 1]!;
  return next.map((r) =>
    r.id === last.id
      ? {
          ...r,
          details: finance
            ? 'Jumlah: Rp ' + details
            : kind === 'overtime'
              ? 'Lembur: ' + details + ' jam'
              : kind === 'shift'
                ? 'Shift: ' + details
                : details,
        }
      : r,
  );
}
