// apps/backoffice/src/features/catalog-import/buildTemplateWorkbook.ts
// S41 — generates the empty template workbook (headers + 1 example row per sheet).

import * as XLSX from 'xlsx';
import { CATALOG_SHEETS } from './templateDefinition.js';

export function buildTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const def of CATALOG_SHEETS) {
    const headers = def.columns.map((c) => c.key);
    const example = headers.map((h) => def.example[h] ?? null);
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    XLSX.utils.book_append_sheet(wb, ws, def.name);
  }
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void {
  XLSX.writeFile(wb, filename);
}
