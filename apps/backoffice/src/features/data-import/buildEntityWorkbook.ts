// apps/backoffice/src/features/data-import/buildEntityWorkbook.ts
// Template (headers + 1 example row) and export (current rows) workbooks,
// both shaped exactly like the import template so they round-trip.

import * as XLSX from 'xlsx';
import type { EntityImportDef } from './entityImportDef.js';

function cellFor(type: string, value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (type === 'boolean') return value === true ? 'TRUE' : 'FALSE';
  if (type === 'number') return typeof value === 'number' ? value : Number(value);
  if (type === 'tags') return Array.isArray(value) ? value.join(',') : String(value);
  return String(value);
}

export function buildTemplateWorkbook(def: EntityImportDef): XLSX.WorkBook {
  const headers = def.columns.map((c) => c.key);
  const exampleRow = def.columns.map((c) => cellFor(c.type, def.example[c.key]));
  const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, def.sheetName);
  return wb;
}

export function buildExportWorkbook(
  def: EntityImportDef,
  rows: ReadonlyArray<Record<string, unknown>>,
): XLSX.WorkBook {
  const headers = def.columns.map((c) => c.key);
  const aoa: (string | number | boolean)[][] = [headers];
  for (const row of rows) {
    aoa.push(def.columns.map((c) => cellFor(c.type, row[c.key])));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, def.sheetName);
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void {
  XLSX.writeFile(wb, filename);
}
