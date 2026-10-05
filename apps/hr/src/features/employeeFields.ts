import type { Employee } from '../model';
export interface EmployeeField { key: string; label: string; group: string; type?: string; options?: string[]; }
const yesNo = ['Yes', 'No'];
export const employeeFields: EmployeeField[] = [
  { key: 'department', label: 'Department', group: 'Employment' },
  { key: 'workLocation', label: 'Work location', group: 'Employment' },
  { key: 'manager', label: 'Reporting manager', group: 'Employment' },
  { key: 'employmentStatus', label: 'Employment status', group: 'Employment', options: ['Active', 'Resigned'] },
  { key: 'contractType', label: 'Contract type', group: 'Employment', options: ['Permanent', 'Probation', 'PKWT', 'Harian'] },
  { key: 'hireDate', label: 'Hire date', group: 'Employment', type: 'date' },
  { key: 'contractEnd', label: 'Contract end date', group: 'Employment', type: 'date' },
  { key: 'probationEnd', label: 'Probation end date', group: 'Employment', type: 'date' },
  { key: 'resignDate', label: 'Resignation date', group: 'Employment', type: 'date' },
  { key: 'birthPlace', label: 'Place of birth', group: 'Personal & family' },
  { key: 'birthDate', label: 'Date of birth', group: 'Personal & family', type: 'date' },
  { key: 'gender', label: 'Gender', group: 'Personal & family', options: ['Female', 'Male', 'Prefer not to say'] },
  { key: 'maritalStatus', label: 'Marital status', group: 'Personal & family', options: ['Single', 'Married', 'Divorced', 'Widowed'] },
  { key: 'children', label: 'Number of children', group: 'Personal & family', type: 'count' },
  { key: 'dependants', label: 'Family dependants', group: 'Personal & family', type: 'count' },
  { key: 'education', label: 'Highest education level', group: 'Personal & family', options: ['SD', 'SMP', 'SMA / SMK', 'D1', 'D2', 'D3', 'D4 / S1', 'S2', 'S3', 'Other'] },
  { key: 'school', label: 'School / university', group: 'Personal & family' },
  { key: 'major', label: 'Field of study', group: 'Personal & family' },
  { key: 'phone', label: 'Phone number', group: 'Personal & family' },
  { key: 'email', label: 'Personal email', group: 'Personal & family', type: 'email' },
  { key: 'address', label: 'Home address', group: 'Personal & family' },
  { key: 'emergencyName', label: 'Emergency contact name', group: 'Personal & family' },
  { key: 'emergencyRelationship', label: 'Emergency contact relationship', group: 'Personal & family' },
  { key: 'emergencyPhone', label: 'Emergency contact phone', group: 'Personal & family' },
  { key: 'ptkp', label: 'Tax status · PTKP', group: 'Tax & BPJS', options: ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3', 'K/I/0', 'K/I/1', 'K/I/2', 'K/I/3'] },
  { key: 'hasNpwp', label: 'Has NPWP', group: 'Tax & BPJS', options: yesNo },
  { key: 'npwp', label: 'NPWP number', group: 'Tax & BPJS' },
  { key: 'taxMethod', label: 'PPh 21 method', group: 'Tax & BPJS', options: ['Gross', 'Gross-up', 'Net'] },
  { key: 'bpjsHealth', label: 'BPJS Kesehatan enrolled', group: 'Tax & BPJS', options: yesNo },
  { key: 'bpjsHealthNumber', label: 'BPJS Kesehatan number', group: 'Tax & BPJS' },
  { key: 'bpjsEmploymentNumber', label: 'BPJS Ketenagakerjaan number', group: 'Tax & BPJS' },
  { key: 'bpjsJht', label: 'JHT enrolled', group: 'Tax & BPJS', options: yesNo },
  { key: 'bpjsJp', label: 'JP enrolled', group: 'Tax & BPJS', options: yesNo },
  { key: 'bpjsJkkJkm', label: 'JKK / JKM enrolled', group: 'Tax & BPJS', options: yesNo },
  { key: 'bpjsBase', label: 'BPJS salary base · IDR (blank = basic salary)', group: 'Tax & BPJS', type: 'money' },
  { key: 'bankName', label: 'Bank name', group: 'Pay & bank' },
  { key: 'bankAccount', label: 'Bank account number', group: 'Pay & bank' },
  { key: 'bankAccountName', label: 'Bank account holder', group: 'Pay & bank' },
  { key: 'mealAllowance', label: 'Meal allowance per day · IDR (blank = monthly setting)', group: 'Pay & bank', type: 'money' },
  { key: 'housingAllowance', label: 'Housing allowance · IDR', group: 'Pay & bank', type: 'money' },
  { key: 'otherAllowance', label: 'Other fixed allowance · IDR', group: 'Pay & bank', type: 'money' },
  { key: 'otherAllowanceLabel', label: 'Other allowance label', group: 'Pay & bank' },
  { key: 'serviceChargeEligible', label: 'Service charge eligible', group: 'Pay & bank', options: yesNo },
  { key: 'latenessDeductions', label: 'Subject to lateness deductions', group: 'Pay & bank', options: yesNo },
  { key: 'attendanceExcluded', label: 'Excluded from attendance', group: 'Pay & bank', options: yesNo },
  { key: 'ktp', label: 'KTP / NIK number', group: 'Documents', type: 'nik' },
  { key: 'ktpAddress', label: 'Address on KTP', group: 'Documents' },
  { key: 'familyCard', label: 'Family card / KK number', group: 'Documents', type: 'nik' },
  { key: 'documentNotes', label: 'Document checklist / notes', group: 'Documents' },
];
export const employeeGroups = ['Employment', 'Personal & family', 'Tax & BPJS', 'Pay & bank', 'Attendance', 'Documents'];
// Validation de la saisie de démonstration ; aucune formule fiscale ou sociale n'est appliquée.
export function updateEmployeeDetails(team: Employee[], id: string, values: Record<string, string>, reason: string, at: string): Employee[] {
  const employee = team.find(item => item.id === id);
  if (!employee) throw new Error('Employee not found.');
  if (!reason.trim()) throw new Error('A change reason is required.');
  const details = { ...employee.details };
  const fields: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const field = employeeFields.find(item => item.key === key);
    if (!field) throw new Error('Unknown employee field.');
    const value = raw.trim();
    if (value && field.options && !field.options.includes(value)) throw new Error(field.label + ': invalid selection.');
    if (value && ['count', 'money'].includes(field.type ?? '') && !/^\d+$/.test(value)) throw new Error(field.label + ': enter a non-negative whole number.');
    if (value && field.type === 'nik' && !/^\d{16}$/.test(value)) throw new Error(field.label + ': use 16 digits.');
    if (value && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email.');
    if (value && field.type === 'date') {
      const date = new Date(value + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(field.label + ': invalid date.');
    }
    if (value.length > 500) throw new Error(field.label + ': maximum 500 characters.');
    if ((details[key] ?? '') !== value) { if (value) details[key] = value; else delete details[key]; fields.push(field.label); }
  }
  for (const key of ['contractEnd', 'probationEnd', 'resignDate']) {
    if (details.hireDate && details[key] && details[key] < details.hireDate) throw new Error('Employment end dates cannot precede the hire date.');
  }
  if (!fields.length) return team;
  return team.map(item => item.id === id ? { ...item, details, profileChanges: [...(item.profileChanges ?? []), { at, reason: reason.trim(), fields, actor: 'Demo HR admin' }] } : item);
}
