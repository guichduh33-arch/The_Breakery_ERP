import { describe, expect, it } from 'vitest';
import { employees } from '../model';
import { updateEmployeeDetails } from '../features/employeeFields';
const at = '2026-10-05T06:00:00Z';
describe('employee details demo', () => {
  it('preserves identifiers, stores exact IDR and records the change reason without mutating input', () => {
    const updated = updateEmployeeDetails(employees, '001', { hireDate: '2026-01-01', maritalStatus: 'Married', bpjsBase: '9007199254740993' }, 'Demo setup', at);
    expect(updated[0]?.id).toBe('001'); expect(updated[0]?.details?.bpjsBase).toBe('9007199254740993');
    expect(updated[0]?.details?.ptkp).toBeUndefined(); expect(employees[0]?.details).toBeUndefined();
    expect(updated[0]?.profileChanges?.[0]?.reason).toBe('Demo setup');
    expect(updated[1]).toBe(employees[1]);
  });
  it('validates identifiers, dates, choices, amounts and the update boundary', () => {
    for (const fields of [{ ktp: '123' }, { hireDate: '2026-02-30' }, { ptkp: 'unknown' }, { bpjsBase: '1.5' }, { children: '-1' }, { unknown: 'value' }])
      expect(() => updateEmployeeDetails(employees, '001', fields, 'Example', at)).toThrow();
    expect(() => updateEmployeeDetails(employees, '001', {}, '', at)).toThrow();
    expect(() => updateEmployeeDetails(employees, '999', {}, 'Example', at)).toThrow();
    expect(() => updateEmployeeDetails(employees, '001', { hireDate: '2026-10-05', contractEnd: '2026-01-01' }, 'Example', at)).toThrow();
  });
  it('keeps unknown separate from No and does not create an audit entry on identical saves', () => {
    const updated = updateEmployeeDetails(employees, '001', { bpjsHealth: 'No' }, 'Example', at);
    expect(updated[0]?.details?.bpjsHealth).toBe('No');
    expect(updated[0]?.details?.bpjsJht).toBeUndefined();
    expect(updateEmployeeDetails(updated, '001', { bpjsHealth: 'No' }, 'Same', at)).toBe(updated);
  });
});
