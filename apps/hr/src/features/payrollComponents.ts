import type { Adjustment } from './demoRules';
export const componentTemplates = [
  { label: 'Uang makan', type: 'allowance', basis: 'quantity' },
  { label: 'Tunjangan tempat tinggal', type: 'allowance', basis: 'fixed' },
  { label: 'Bonus', type: 'allowance', basis: 'fixed' },
  { label: 'Service charge', type: 'allowance', basis: 'fixed' },
  { label: 'Lembur', type: 'allowance', basis: 'quantity' },
  { label: 'Konsumsi', type: 'deduction', basis: 'fixed' },
  { label: 'Kasbon', type: 'deduction', basis: 'fixed' },
] as const;
export function componentAmount(rate: string, quantity: string, basis: string): string {
  if (!/^\d+$/.test(rate)) throw new Error('Enter a non-negative whole IDR rate.');
  if (basis !== 'fixed' && basis !== 'quantity') throw new Error('Select a calculation basis.');
  if (basis === 'fixed') return String(BigInt(rate));
  if (!/^\d+(?:\.\d{1,2})?$/.test(quantity)) throw new Error('Enter a quantity with at most two decimal places.');
  const [whole, decimal = ''] = quantity.split('.');
  const hundredths = BigInt(whole!) * 100n + BigInt(decimal.padEnd(2, '0'));
  return String((BigInt(rate) * hundredths + 50n) / 100n);
}
export function saveComponent(lines: Adjustment[], line: Adjustment, editing: number | null): Adjustment[] {
  if (!line.label.trim() || !line.reason.trim()) throw new Error('A payslip label and change reason are required.');
  if (editing !== null && !lines.some(item => item.id === editing)) throw new Error('The component no longer exists.');
  return editing === null ? [...lines, line] : lines.map(item => item.id === editing ? line : item);
}
