// packages/domain/src/reports/csv.ts
//
// S29 Wave 2.1 — CSV builder centralisé (IO-free, browser-callable via downloadCsv).
// Used by all report pages with CSV export. Replaces 4 ad-hoc implementations
// (Recipe Overview/Timeline, ProductionYield, TrialBalance) via 1 unified helper.

export type CsvFormat = 'idr' | 'idr-round100' | 'number' | 'percent' | 'date' | 'datetime' | 'text';

export interface CsvColumn<T> {
  header:   string;
  accessor: (row: T) => string | number | null | undefined;
  format?:  CsvFormat;
}

export interface CsvOptions {
  bom?:       boolean;
  delimiter?: ',' | ';';
  locale?:    string;
}

const DEFAULT_OPTS: Required<CsvOptions> = {
  bom:       true,
  delimiter: ',',
  locale:    'id-ID',
};

function escapeCell(v: string, delimiter: string): string {
  if (v.includes('"') || v.includes(delimiter) || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function formatCell(value: string | number | null | undefined, format: CsvFormat | undefined, locale: string): string {
  if (value === null || value === undefined) return '';
  if (format === undefined || format === 'text') return String(value);

  const num = typeof value === 'number' ? value : Number(value);
  if (format === 'idr' || format === 'idr-round100') {
    if (!Number.isFinite(num)) return '';
    const rounded = format === 'idr-round100' ? Math.round(num / 100) * 100 : num;
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(rounded);
  }
  if (format === 'number') {
    if (!Number.isFinite(num)) return '';
    return String(num);
  }
  if (format === 'percent') {
    if (!Number.isFinite(num)) return '';
    return `${(num * 100).toFixed(2)}%`;
  }
  if (format === 'date') {
    return String(value).slice(0, 10);
  }
  if (format === 'datetime') {
    return String(value).slice(0, 19).replace('T', ' ');
  }
  return String(value);
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[], opts?: CsvOptions): string {
  const o = { ...DEFAULT_OPTS, ...opts };
  const lines: string[] = [];

  lines.push(columns.map((c) => escapeCell(c.header, o.delimiter)).join(o.delimiter));

  for (const row of rows) {
    lines.push(
      columns
        .map((c) => escapeCell(formatCell(c.accessor(row), c.format, o.locale), o.delimiter))
        .join(o.delimiter)
    );
  }

  const body = lines.join('\r\n') + '\r\n';
  return o.bom ? '﻿' + body : body;
}

export function downloadCsv(csv: string, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
