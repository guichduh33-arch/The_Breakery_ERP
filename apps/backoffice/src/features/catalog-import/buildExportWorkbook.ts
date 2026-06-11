// apps/backoffice/src/features/catalog-import/buildExportWorkbook.ts
// S41 — converts the export_catalog_v1 payload back into the 6-sheet workbook.

import * as XLSX from 'xlsx';
import { CATALOG_SHEETS } from './templateDefinition.js';
import type { CatalogPayload, SheetRow } from './parseCatalogWorkbook.js';

function cellValue(v: SheetRow[string]): string | number | boolean | null {
  if (Array.isArray(v)) return v.join(',');
  return v;
}

export function buildExportWorkbook(payload: CatalogPayload): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const def of CATALOG_SHEETS) {
    const headers = def.columns.map((c) => c.key);
    const rows = payload[def.payloadKey].map((row) => headers.map((h) => cellValue(row[h] ?? null)));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, def.name);
  }
  return wb;
}
