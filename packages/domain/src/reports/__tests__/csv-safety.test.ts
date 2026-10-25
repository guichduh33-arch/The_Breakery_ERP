import { describe, expect, it } from 'vitest';
import { buildCsv } from '../csv.js';

describe('CSV text and business dates', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(A1)', '  =1', '\t=1', '\ttext', '\rtext', '\ntext', '\uFEFF=1'])(
    'keeps %j literal in a spreadsheet',
    (value) => {
      const csv = buildCsv([{ value }], [{ header: 'V', accessor: (r) => r.value }], { bom: false });
      expect(csv).toContain("'" + value);
    },
  );

  it('protects the text header and still quotes embedded delimiters and quotes', () => {
    const csv = buildCsv([{ value: '=HYPERLINK("x";"y")' }], [
      { header: '=header', accessor: (r) => r.value, format: 'text' },
    ], { bom: false, delimiter: ';' });
    expect(csv).toBe("'=header\r\n\"'=HYPERLINK(\"\"x\"\";\"\"y\"\")\"\r\n");
  });

  it('preserves ordinary text and real negative numbers', () => {
    expect(buildCsv([{ name: 'A-B', value: -12 }], [
      { header: 'Name', accessor: (r) => r.name },
      { header: 'Value', accessor: (r) => r.value, format: 'number' },
    ], { bom: false })).toBe('Name,Value\r\nA-B,-12\r\n');
    expect(buildCsv([{ value: -12 }], [
      { header: 'V', accessor: (r) => r.value },
    ], { bom: false })).toBe('V\r\n-12\r\n');
  });

  it('converts instants to the business date while preserving date-only fields', () => {
    const csv = buildCsv([{ date: '2026-06-30T16:05:06Z', day: '2026-06-30' }], [
      { header: 'Date', accessor: (r) => r.date, format: 'date' },
      { header: 'Day', accessor: (r) => r.day, format: 'date' },
      { header: 'Time', accessor: (r) => r.date, format: 'datetime' },
    ], { bom: false });
    expect(csv).toBe('Date,Day,Time\r\n2026-07-01,2026-06-30,2026-07-01 00:05:06\r\n');
  });

  it('does not emit a formula or an invalid timestamp from a date column', () => {
    expect(buildCsv([{ value: '=NOW()' }], [
      { header: 'D', accessor: (r) => r.value, format: 'datetime' },
    ], { bom: false })).toBe('D\r\n\r\n');
  });
});
