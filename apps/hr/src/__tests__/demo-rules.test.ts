import { describe, it, expect } from 'vitest';
import { initialRequests, employees, decideRequest } from '../model';
import {
  salaryPreview,
  filterRequests,
  cancelRequest,
  demoLeaveBalance,
  changeShift,
  duplicateWeek,
  sampleWeek,
  addEmployee,
  detailedRequest,
} from '../features/demoRules';
describe('Talenta-inspired HR demo functions', () => {
  it('combines allowances and deductions using exact whole IDR', () => {
    const result = salaryPreview('3500000', [
      { id: 1, type: 'allowance', amount: '250000', label: 'Tunjangan kost', reason: 'Example' },
      { id: 2, type: 'deduction', amount: '100000', label: 'Kasbon', reason: 'Example' },
    ]);
    expect(result.gross).toBe('3750000');
    expect(result.deductions).toBe('100000');
    expect(result.net).toBe('3650000');
  });
  it('copies the lines into the payroll preview snapshot', () => {
    const lines = [
      { id: 1, type: 'allowance' as const, amount: '200000', label: 'Bonus', reason: 'Example' },
    ];
    const frozen = salaryPreview('3500000', lines);
    lines[0]!.amount = '999';
    expect(frozen.lines[0]?.amount).toBe('200000');
    expect(frozen.net).toBe('3700000');
  });
  it('rejects signed, fractional or undocumented adjustments', () => {
    for (const amount of ['-1', '1.5'])
      expect(() =>
        salaryPreview('1', [
          { id: 1, type: 'allowance', amount, label: 'Bonus', reason: 'Example' },
        ]),
      ).toThrow();
    expect(() =>
      salaryPreview('1', [{ id: 1, type: 'deduction', amount: '1', label: '', reason: '' }]),
    ).toThrow();
  });
  it('retains a cancelled request in history and rejects cancellation by another employee', () => {
    expect(() => cancelRequest(initialRequests, 1, '030')).toThrow();
    const updated = cancelRequest(initialRequests, 1, '001');
    expect(updated[0]?.status).toBe('cancelled');
    expect(updated).toHaveLength(initialRequests.length);
    expect(initialRequests[0]?.status).toBe('pending');
    expect(() => cancelRequest(updated, 1, '001')).toThrow();
  });
  it('only allows cancellation of pending requests', () =>
    expect(() =>
      cancelRequest(decideRequest(initialRequests, 1, 'approved', 'Example'), 1, '001'),
    ).toThrow());
  it('combines kind, status, search and own-employee filters', () => {
    expect(filterRequests(initialRequests, '2026', 'pending', 'leave', '001')).toHaveLength(1);
    expect(filterRequests(initialRequests, '', 'all', 'all', '042')).toHaveLength(0);
  });
  it('deducts an approved sample leave once and excludes sick or cancelled requests', () => {
    const approved = decideRequest(initialRequests, 1, 'approved', 'Example');
    expect(demoLeaveBalance(initialRequests, '001')).toBe(12);
    expect(demoLeaveBalance(approved, '001')).toBe(11);
    expect(demoLeaveBalance(decideRequest(approved, 1, 'approved', 'Retry'), '001')).toBe(11);
    expect(demoLeaveBalance(cancelRequest(initialRequests, 1, '001'), '001')).toBe(12);
  });
  it('keeps the published schedule independent from draft edits', () => {
    const published = duplicateWeek(sampleWeek);
    const edited = changeShift(sampleWeek, '001', 0, 'OFF');
    expect(edited['001']?.[0]).toBe('OFF');
    expect(sampleWeek['001']?.[0]).toBe('MORNING');
    expect(published['001']?.[0]).toBe('MORNING');
  });
  it('validates the shift code and day boundaries', () => {
    expect(() => changeShift(sampleWeek, '001', 7, 'OFF')).toThrow();
    expect(() => changeShift(sampleWeek, '001', 0, 'unknown')).toThrow();
  });
  it('preserves padded Talenta employee IDs and rejects duplicates', () => {
    expect(addEmployee(employees, '002', 'Demo', 'Baker', '0')[3]?.id).toBe('002');
    expect(() => addEmployee(employees, '001', 'Demo', 'Baker', '0')).toThrow();
    expect(() => addEmployee(employees, '003', 'Demo', 'Baker', '1.5')).toThrow();
  });
  it('validates request-specific amounts, hours and desired shift', () => {
    for (const value of ['', '0', '-1', '1.5'])
      expect(() =>
        detailedRequest(initialRequests, 'advance', '2026-10-08', 'Example', value),
      ).toThrow();
    expect(
      detailedRequest(initialRequests, 'reimbursement', '2026-10-08', 'Example', '10000')[2]
        ?.details,
    ).toBe('Jumlah: Rp 10000');
    expect(() =>
      detailedRequest(initialRequests, 'overtime', '2026-10-08', 'Example', '0'),
    ).toThrow();
    expect(
      detailedRequest(initialRequests, 'overtime', '2026-10-08', 'Example', '1.5')[2]?.details,
    ).toContain('1.5 jam');
    expect(() =>
      detailedRequest(initialRequests, 'shift', '2026-10-08', 'Example', 'INVALID'),
    ).toThrow();
  });
});
