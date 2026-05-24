import { describe, expect, it } from 'vitest';
import { buildCsv, type CsvColumn } from '../csv.js';

interface Row { name: string; amount: number; date: string }

describe('buildCsv', () => {
  it('builds header + rows with comma delimiter and BOM by default', () => {
    const cols: CsvColumn<Row>[] = [
      { header: 'Name',   accessor: (r) => r.name },
      { header: 'Amount', accessor: (r) => r.amount, format: 'number' },
    ];
    const csv = buildCsv([{ name: 'A', amount: 10, date: '' }], cols);
    expect(csv.charCodeAt(0)).toBe(0xFEFF); // BOM
    expect(csv).toContain('Name,Amount\r\n');
    expect(csv).toContain('A,10\r\n');
  });

  it('escapes cells containing comma/quote/newline per RFC 4180', () => {
    const cols: CsvColumn<{ v: string }>[] = [{ header: 'V', accessor: (r) => r.v }];
    const csv = buildCsv(
      [{ v: 'has,comma' }, { v: 'has"quote' }, { v: 'has\nnewline' }],
      cols, { bom: false }
    );
    expect(csv).toContain('"has,comma"');
    expect(csv).toContain('"has""quote"');
    expect(csv).toContain('"has\nnewline"');
  });

  it('formats idr-round100 with id-ID locale', () => {
    const cols: CsvColumn<{ v: number }>[] = [
      { header: 'V', accessor: (r) => r.v, format: 'idr-round100' },
    ];
    const csv = buildCsv([{ v: 1500099 }], cols, { bom: false });
    // 1500099 round 100 = 1500100; Math.round(1500099 / 100) * 100 = 1500100
    // Wait — 1500099 / 100 = 15000.99 → round = 15001 → *100 = 1500100
    expect(csv).toContain('1.500.100');
  });

  it('formats idr (no rounding) with id-ID locale separator', () => {
    const cols: CsvColumn<{ v: number }>[] = [
      { header: 'V', accessor: (r) => r.v, format: 'idr' },
    ];
    const csv = buildCsv([{ v: 1500099 }], cols, { bom: false });
    expect(csv).toContain('1.500.099');
  });

  it('uses semicolon delimiter when configured', () => {
    const cols: CsvColumn<{ a: string; b: string }>[] = [
      { header: 'A', accessor: (r) => r.a },
      { header: 'B', accessor: (r) => r.b },
    ];
    const csv = buildCsv([{ a: '1', b: '2' }], cols, { bom: false, delimiter: ';' });
    expect(csv).toContain('A;B');
    expect(csv).toContain('1;2');
  });

  it('handles null/undefined cells as empty string', () => {
    const cols: CsvColumn<{ v: number | null }>[] = [
      { header: 'V', accessor: (r) => r.v },
    ];
    const csv = buildCsv([{ v: null }, { v: 5 }], cols, { bom: false });
    expect(csv).toContain('V\r\n\r\n5\r\n');
  });

  it('formats percent (2 decimals + %)', () => {
    const cols: CsvColumn<{ p: number }>[] = [
      { header: 'P', accessor: (r) => r.p, format: 'percent' },
    ];
    const csv = buildCsv([{ p: 0.123 }], cols, { bom: false });
    expect(csv).toContain('12.30%');
  });

  it('formats date (yyyy-MM-dd from ISO)', () => {
    const cols: CsvColumn<{ d: string }>[] = [
      { header: 'D', accessor: (r) => r.d, format: 'date' },
    ];
    const csv = buildCsv([{ d: '2026-05-24T15:30:00Z' }], cols, { bom: false });
    expect(csv).toContain('2026-05-24');
  });

  it('returns header-only when rows array is empty', () => {
    const cols: CsvColumn<Row>[] = [{ header: 'Name', accessor: (r) => r.name }];
    const csv = buildCsv([], cols, { bom: false });
    expect(csv).toBe('Name\r\n');
  });
});
