// apps/backoffice/src/features/data-import/parseEntityWorkbook.ts
// Pure ArrayBuffer → { rows, structureErrors, rowMap } for ONE sheet.
// Exhaustive (never fail-fast). Semantic validation lives in the RPC.

import * as XLSX from 'xlsx';
import { coerceCell, type EntityImportDef, type EntityRow, type StructureError } from './entityImportDef.js';

export function parseEntityWorkbook(
  buf: ArrayBuffer,
  def: EntityImportDef,
): { rows: EntityRow[]; structureErrors: StructureError[]; rowMap: number[] } {
  const structureErrors: StructureError[] = [];
  const rows: EntityRow[] = [];
  const rowMap: number[] = [];

  // XLSX magic bytes: ZIP/OOXML files start with PK (0x50 0x4B)
  const magic = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
    return {
      rows,
      structureErrors: [{ sheet: def.sheetName, row: 0, message: 'File is not a readable .xlsx workbook' }],
      rowMap,
    };
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array' });
  } catch {
    return {
      rows,
      structureErrors: [{ sheet: def.sheetName, row: 0, message: 'File is not a readable .xlsx workbook' }],
      rowMap,
    };
  }

  const ws = wb.Sheets[def.sheetName];
  if (ws === undefined) {
    return {
      rows,
      structureErrors: [{ sheet: def.sheetName, row: 0, message: `Missing sheet "${def.sheetName}"` }],
      rowMap,
    };
  }

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as unknown[][];
  if (aoa.length === 0) return { rows, structureErrors, rowMap };

  const headers = (aoa[0] ?? []).map((h) => String(h ?? '').trim());
  const known = new Set(def.columns.map((c) => c.key));
  const headerCounts = new Map<string, number>();
  headers.forEach((h) => {
    if (h === '') return;
    headerCounts.set(h, (headerCounts.get(h) ?? 0) + 1);
    if (!known.has(h) && headerCounts.get(h) === 1) {
      structureErrors.push({ sheet: def.sheetName, row: 1, column: h, message: `Unknown column "${h}"` });
    }
  });
  for (const [h, n] of headerCounts) {
    if (n > 1) {
      structureErrors.push({ sheet: def.sheetName, row: 1, column: h, message: `Duplicate column "${h}" (${n} occurrences) — only the first is read` });
    }
  }

  const headerSet = new Set(headers.filter((h) => h !== ''));
  const hasDataRows = aoa.slice(1).some(
    (cells) => (cells ?? []).some((c) => c !== null && String(c).trim() !== ''),
  );
  if (hasDataRows) {
    for (const col of def.columns) {
      if (col.required && !headerSet.has(col.key)) {
        structureErrors.push({ sheet: def.sheetName, row: 1, column: col.key, message: `Required column "${col.key}" is missing` });
      }
    }
  }

  for (let i = 1; i < aoa.length; i++) {
    const cells = aoa[i] ?? [];
    if (cells.every((c) => c === null || String(c).trim() === '')) continue;
    const rowIdx = i + 1; // 1-based Excel row
    const row: EntityRow = {};
    for (const col of def.columns) {
      const hIdx = headers.indexOf(col.key);
      const raw = hIdx === -1 ? null : cells[hIdx] ?? null;
      const { value, error } = coerceCell(col.type, raw);
      if (error !== null) {
        structureErrors.push({ sheet: def.sheetName, row: rowIdx, column: col.key, message: error });
      }
      if (col.required && hIdx !== -1 && error === null && (value === null || value === '')) {
        structureErrors.push({ sheet: def.sheetName, row: rowIdx, column: col.key, message: 'Required value missing' });
      }
      row[col.key] = value;
    }
    rows.push(row);
    rowMap.push(rowIdx);
  }

  return { rows, structureErrors, rowMap };
}
