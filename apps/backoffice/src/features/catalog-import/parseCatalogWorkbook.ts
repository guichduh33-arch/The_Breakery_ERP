// apps/backoffice/src/features/catalog-import/parseCatalogWorkbook.ts
// S41 — pure ArrayBuffer → { payload, structure errors }. No network, no DOM.
// Structure errors are exhaustive (never fail-fast). Semantic validation
// (category resolution, cycles, conversions…) lives in import_catalog_v1.

import * as XLSX from 'xlsx';
import { CATALOG_SHEETS, type PayloadKey, type SheetDef } from './templateDefinition.js';

export interface StructureError {
  sheet: string;
  row: number;          // 1-based Excel row (header = 1)
  column?: string;
  message: string;
}

export type SheetRow = Record<string, string | number | boolean | string[] | null>;

export interface CatalogPayload {
  categories: SheetRow[];
  ingredients: SheetRow[];
  products: SheetRow[];
  units: SheetRow[];
  variants: SheetRow[];
  recipes: SheetRow[];
}

const TRUTHY = new Set(['true', '1', 'yes', 'oui', 'vrai']);
const FALSY  = new Set(['false', '0', 'no', 'non', 'faux']);

function coerce(
  def: SheetDef, key: string, type: string, raw: unknown,
  rowIdx: number, errors: StructureError[],
): string | number | boolean | string[] | null {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (Number.isNaN(n)) {
        errors.push({ sheet: def.name, row: rowIdx, column: key, message: `"${String(raw)}" is not a number` });
        return null;
      }
      return n;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).trim().toLowerCase();
      if (TRUTHY.has(s)) return true;
      if (FALSY.has(s)) return false;
      errors.push({ sheet: def.name, row: rowIdx, column: key, message: `"${String(raw)}" is not a boolean (TRUE/FALSE)` });
      return null;
    }
    case 'tags': {
      const parts = String(raw).split(',').map((p) => p.trim()).filter((p) => p !== '');
      return parts;
    }
    default:
      return String(raw).trim() === '' ? null : String(raw).trim();
  }
}

// rowMaps maps each PayloadKey to an array of Excel row numbers (1-based).
// rowMaps[key][ordinalIndex] = the Excel row number of the (ordinalIndex+1)-th
// data row that was accepted into payload[key]. This lets callers translate
// RPC error.row (1-based ordinal in the JSONB array) back to the original
// Excel row shown in the spreadsheet — skipped blank rows mean the two
// numbering schemes diverge whenever blank lines appear in the file.
export type RowMaps = { [K in PayloadKey]: number[] };

export function parseCatalogWorkbook(buf: ArrayBuffer): {
  payload: CatalogPayload | null;
  errors: StructureError[];
  rowMaps: RowMaps;
} {
  const errors: StructureError[] = [];
  const rowMaps: RowMaps = {
    categories: [], ingredients: [], products: [],
    units: [], variants: [], recipes: [],
  };
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array' });
  } catch {
    return {
      payload: null,
      errors: [{ sheet: '—', row: 0, message: 'File is not a readable .xlsx workbook' }],
      rowMaps,
    };
  }

  const payload: CatalogPayload = {
    categories: [], ingredients: [], products: [], units: [], variants: [], recipes: [],
  };

  for (const def of CATALOG_SHEETS) {
    const ws = wb.Sheets[def.name];
    if (ws === undefined) {
      errors.push({ sheet: def.name, row: 0, message: `Missing sheet "${def.name}"` });
      continue;
    }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as unknown[][];
    if (aoa.length === 0) continue; // empty sheet = no rows, fine
    const headers = (aoa[0] ?? []).map((h) => String(h ?? '').trim());
    const known = new Set(def.columns.map((c) => c.key));
    const headerCounts = new Map<string, number>();
    headers.forEach((h) => {
      if (h === '') return;
      headerCounts.set(h, (headerCounts.get(h) ?? 0) + 1);
      if (!known.has(h) && headerCounts.get(h) === 1) {
        errors.push({ sheet: def.name, row: 1, column: h, message: `Unknown column "${h}"` });
      }
    });
    for (const [h, n] of headerCounts) {
      if (n > 1) {
        errors.push({ sheet: def.name, row: 1, column: h, message: `Duplicate column "${h}" (${n} occurrences) — only the first is read` });
      }
    }

    const headerSet = new Set(headers.filter((h) => h !== ''));
    const hasDataRows = aoa.slice(1).some(
      (cells) => (cells ?? []).some((c) => c !== null && String(c).trim() !== ''),
    );
    if (hasDataRows) {
      for (const col of def.columns) {
        if (col.required && !headerSet.has(col.key)) {
          errors.push({ sheet: def.name, row: 1, column: col.key, message: `Required column "${col.key}" is missing` });
        }
      }
    }

    for (let i = 1; i < aoa.length; i++) {
      const cells = aoa[i] ?? [];
      if (cells.every((c) => c === null || String(c).trim() === '')) continue; // skip blank rows
      const rowIdx = i + 1; // 1-based Excel row
      const row: SheetRow = {};
      for (const col of def.columns) {
        const hIdx = headers.indexOf(col.key);
        const raw = hIdx === -1 ? null : cells[hIdx] ?? null;
        const v = coerce(def, col.key, col.type, raw, rowIdx, errors);
        if (col.required && hIdx !== -1 && (v === null || v === '')) {
          errors.push({ sheet: def.name, row: rowIdx, column: col.key, message: `Required value missing` });
        }
        row[col.key] = v;
      }
      payload[def.payloadKey].push(row);
      rowMaps[def.payloadKey].push(rowIdx);
    }
  }

  // duplicate SKUs across Ingredients / Products / Variants
  const seen = new Map<string, string>();
  const skuSheets: Array<[string, PayloadKey]> = [
    ['Ingredients', 'ingredients'], ['Products', 'products'], ['Variants', 'variants'],
  ];
  for (const [sheet, key] of skuSheets) {
    payload[key].forEach((row, idx) => {
      const sku = typeof row['sku'] === 'string' ? row['sku'] : null;
      if (sku === null) return;
      const prev = seen.get(sku);
      if (prev !== undefined) {
        errors.push({
          sheet,
          row: rowMaps[key][idx] ?? idx + 2,
          column: 'sku',
          message: `Duplicate SKU "${sku}" (already used in ${prev})`,
        });
      } else {
        seen.set(sku, sheet);
      }
    });
  }

  const fatal = errors.some((e) => e.row === 0);
  return { payload: fatal ? null : payload, errors, rowMaps };
}
