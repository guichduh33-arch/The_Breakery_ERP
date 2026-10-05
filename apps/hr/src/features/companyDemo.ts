export interface Notice { id: number; title: string; text: string; published: boolean; }
export interface DocumentEntry { id: number; employee: string; title: string; category: string; expires: string; }
export interface DisciplineEntry { id: number; employee: string; date: string; level: string; reason: string; until: string; }
export interface SettingVersion { id: number; group: string; period: string; reason: string; values: Record<string, string>; }
export interface ThrCampaign { name: string; holiday: string; payment: string; components: string; notes: string; }
export interface CompanyDemo { notices: Notice[]; documents: DocumentEntry[]; discipline: DisciplineEntry[]; settings: SettingVersion[]; thr: ThrCampaign | null; }
export const initialCompany: CompanyDemo = { notices: [
  { id: 1, title: 'Jadwal minggu depan', text: 'Contoh: periksa jadwal yang sudah dipublikasikan dan ajukan perubahan melalui aplikasi.', published: true },
  { id: 2, title: 'Permintaan dan dokumen', text: 'Contoh: sertakan alasan yang jelas untuk permintaan cuti atau koreksi absensi.', published: true },
], documents: [], discipline: [], settings: [], thr: null };
export function readField(data: FormData, key: string): string { const value = data.get(key); return typeof value === 'string' ? value.trim() : ''; }
export function validDate(value: string): boolean {
  const date = new Date(value + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addDiscipline(records: DisciplineEntry[], input: Omit<DisciplineEntry, 'id'>): DisciplineEntry[] {
  if (!input.employee || !validDate(input.date) || !['1', '2', '3', '4', '5'].includes(input.level) || !input.reason.trim()) throw new Error('Choose an employee, valid date, level and reason.');
  if (input.until && (!validDate(input.until) || input.until < input.date)) throw new Error('Validity must end on or after the action date.');
  return [...records, { ...input, reason: input.reason.trim(), id: Math.max(0, ...records.map(item => item.id)) + 1 }];
}
export function validateThr(input: ThrCampaign): ThrCampaign {
  if (!input.name.trim() || !input.notes.trim() || !validDate(input.holiday) || !validDate(input.payment)) throw new Error('Provide a campaign name, valid dates and policy notes.');
  if (input.payment > input.holiday) throw new Error('The proposed payment date must not follow the holiday.');
  return { ...input, name: input.name.trim(), notes: input.notes.trim() };
}
