// apps/backoffice/src/features/data-import/entityImportDef.ts
// Generic single-sheet import framework (generalizes S41 catalog-import).
// Column keys are the exact Excel headers AND the exact JSONB payload keys.

export type EntityColumnType = 'text' | 'number' | 'boolean' | 'tags';

export interface EntityColumnDef {
  key: string;
  required: boolean;
  type: EntityColumnType;
}

export interface EntityImportDef {
  entity: string;        // logical name, e.g. 'suppliers' (labels/toasts)
  sheetName: string;     // exact Excel tab name, e.g. 'Suppliers'
  rpcName: string;       // e.g. 'import_suppliers_v1'
  columns: readonly EntityColumnDef[];
  example: Record<string, string | number | boolean>;
  queryKeysToInvalidate: readonly (readonly unknown[])[];
}

export type EntityCell = string | number | boolean | string[] | null;
export type EntityRow = Record<string, EntityCell>;

export interface StructureError {
  sheet: string;
  row: number;          // 1-based Excel row (header = 1); 0 = sheet/file-level
  column?: string;
  message: string;
}

export interface ImportError {
  sheet: string;
  row: number;
  sku: string | null;   // carries the natural identifier (code / phone / name)
  code: string;
  message: string;
}

export interface ImportReport {
  valid: boolean;
  errors: ImportError[];
  summary: Record<string, Record<string, number>>;
  idempotent_replay: boolean;
}

const TRUTHY = new Set(['true', '1', 'yes', 'oui', 'vrai']);
const FALSY  = new Set(['false', '0', 'no', 'non', 'faux']);

export function coerceCell(
  type: EntityColumnType,
  raw: unknown,
): { value: EntityCell; error: string | null } {
  if (raw === null || raw === undefined || raw === '') return { value: null, error: null };
  switch (type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (Number.isNaN(n)) return { value: null, error: `"${String(raw)}" is not a number` };
      return { value: n, error: null };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw, error: null };
      const s = String(raw).trim().toLowerCase();
      if (TRUTHY.has(s)) return { value: true, error: null };
      if (FALSY.has(s)) return { value: false, error: null };
      return { value: null, error: `"${String(raw)}" is not a boolean (TRUE/FALSE)` };
    }
    case 'tags': {
      const parts = String(raw).split(',').map((p) => p.trim()).filter((p) => p !== '');
      return { value: parts, error: null };
    }
    default: {
      const s = String(raw).trim();
      return { value: s === '' ? null : s, error: null };
    }
  }
}
