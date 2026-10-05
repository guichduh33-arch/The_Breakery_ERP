export type RequestKind =
  | 'leave'
  | 'correction'
  | 'overtime'
  | 'shift'
  | 'advance'
  | 'sick'
  | 'permission'
  | 'reimbursement';
export interface Request {
  id: number;
  employee: string;
  kind: RequestKind;
  date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  details?: string;
  attachment?: File;
  decision: string;
}
export interface Employee {
  id: string;
  name: string;
  position: string;
  salary: string;
  details?: Record<string, string>;
  profileChanges?: { at: string; reason: string; fields: string[]; actor: string }[];
}
export const employees: Employee[] = [
  { id: '001', name: 'Dewi Lestari', position: 'Cashier', salary: '3500000' },
  { id: '030', name: 'Raka Pratama', position: 'Baker', salary: '4200000' },
  { id: '042', name: 'Sari Putri', position: 'Service', salary: '3200000' },
];
export const initialRequests: Request[] = [
  {
    id: 1,
    employee: '001',
    kind: 'leave',
    date: '2026-10-08',
    reason: 'Acara keluarga',
    status: 'pending',
    decision: '',
  },
  {
    id: 2,
    employee: '030',
    kind: 'correction',
    date: '2026-10-03',
    reason: 'Lupa absen pulang',
    status: 'pending',
    decision: '',
  },
];
export const kindLabels: Record<RequestKind, [string, string]> = {
  leave: ['Leave', 'Cuti'],
  correction: ['Attendance correction', 'Koreksi absensi'],
  overtime: ['Overtime', 'Lembur'],
  shift: ['Shift change', 'Ganti shift'],
  advance: ['Cash advance', 'Kasbon'],
  sick: ['Sick leave', 'Sakit'],
  permission: ['Permission', 'Izin'],
  reimbursement: ['Reimbursement', 'Penggantian biaya'],
};
export function decideRequest(
  requests: Request[],
  id: number,
  status: 'approved' | 'rejected',
  reason: string,
): Request[] {
  if (!reason.trim()) throw new Error('A decision reason is required.');
  return requests.map((r) =>
    r.id === id && r.status === 'pending' ? { ...r, status, decision: reason.trim() } : r,
  );
}
export function parseIdr(value: string): bigint {
  if (!/^-?\d+$/.test(value)) throw new Error('Enter a whole IDR amount.');
  return BigInt(value);
}
export function demoNet(base: string, adjustment: string): bigint {
  return parseIdr(base) + parseIdr(adjustment);
}
export const money = (value: string | bigint) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(BigInt(value));
export function createRequest(
  requests: Request[],
  kind: RequestKind,
  date: string,
  reason: string,
): Request[] {
  const timestamp = new Date(date + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString().slice(0, 10) !== date ||
    !reason.trim()
  )
    throw new Error('Tanggal dan alasan wajib diisi.');
  return [
    ...requests,
    {
      id: Math.max(0, ...requests.map((r) => r.id)) + 1,
      employee: '001',
      kind,
      date,
      reason: reason.trim(),
      status: 'pending',
      decision: '',
    },
  ];
}
export const punchLabels = ['Masuk', 'Mulai istirahat', 'Selesai istirahat', 'Pulang'];
