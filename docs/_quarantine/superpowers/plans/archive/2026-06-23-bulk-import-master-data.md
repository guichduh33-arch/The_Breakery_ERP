# Bulk Import — Master Data (Suppliers + Customers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add working bulk Excel import (+ template + export) to the Suppliers and Customers back-office pages, reusing a new generic single-sheet import framework modeled on the S41 `catalog-import` pattern.

**Architecture:** A new `features/data-import/` framework provides a typed column-def, a pure `.xlsx` parser, workbook builders (template/export), an import hook, and a 3-step `ImportEntityModal`. Two `SECURITY DEFINER` RPCs (`import_suppliers_v1`, `import_customers_v1`) validate (dry-run) then commit (suppliers upsert-by-code, customers create-only) with a shared idempotency table. The existing "Template / Import / Export" placeholder buttons on both pages get wired up.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, `xlsx` (SheetJS), `@breakery/ui` Dialog primitives, Vitest, Supabase Postgres (cloud V3 dev `ikcyvlovptebroadgtvd`), pgTAP.

## Global Constraints

- **DB target is Supabase cloud V3 dev `ikcyvlovptebroadgtvd`** — Docker is retired. Migrations are applied via MCP `apply_migration`, SQL/pgTAP via MCP `execute_sql` (BEGIN/ROLLBACK), types regen via MCP `generate_typescript_types`. **Subagents cannot call Supabase MCP** — all MCP steps (apply migration, regen types, run pgTAP) are executed by the **controller/lead**, not the implementing subagent. The subagent authors the SQL file; the controller applies it.
- **RPC versioning is monotonic** — new RPCs are `_v1`; never edit a published signature.
- **Anon defense-in-depth (S20):** every new function gets `REVOKE ALL ... FROM PUBLIC`, `REVOKE EXECUTE ... FROM anon`, `GRANT EXECUTE ... TO authenticated`, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. New tables get `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + RLS enabled, no policy (RPC-only access).
- **Idempotency = S25 flavor 2** — `p_idempotency_key UUID` REQUIRED on commit; dedicated keys table; replay returns the stored report with `idempotent_replay:true`; concurrency race handled via PK `unique_violation` catch + re-read.
- **After any migration, regen types** → write `packages/supabase/src/types.generated.ts` and commit. Missing regen is the #1 CI break.
- **Permission gate inside the RPC** via `has_permission(v_caller, '<key>')` (`suppliers.create` / `customers.create`).
- **Files under 500 lines**, tests co-located in `__tests__/`, conventional commits, co-author Claude.
- **Branch:** `feat/bulk-import-master-data` (already created; the design doc is committed there).
- **Run tests** with `pnpm --filter @breakery/backoffice test <pattern>` ; build with `pnpm --filter @breakery/backoffice build`.

---

## File Structure

New (framework — `apps/backoffice/src/features/data-import/`):
- `entityImportDef.ts` — types (`EntityColumnDef`, `EntityImportDef`, `EntityRow`, `StructureError`, `ImportError`, `ImportReport`) + `coerceCell()`.
- `parseEntityWorkbook.ts` — pure `(buf, def) → { rows, structureErrors, rowMap }`.
- `buildEntityWorkbook.ts` — `buildTemplateWorkbook(def)`, `buildExportWorkbook(def, rows)`, `downloadWorkbook(wb, filename)`.
- `hooks/useImportEntity.ts` — generic import mutation.
- `components/EntitySummaryGrid.tsx` — generic summary cards (iterates report summary keys).
- `components/ImportEntityModal.tsx` — 3-step dialog flow.
- `__tests__/parseEntityWorkbook.test.ts`, `__tests__/buildEntityWorkbook.test.ts`, `__tests__/ImportEntityModal.smoke.test.tsx`.

New (entity defs):
- `apps/backoffice/src/features/suppliers/import/suppliersImportDef.ts`
- `apps/backoffice/src/features/customers/import/customersImportDef.ts`
- `apps/backoffice/src/features/customers/hooks/useCustomersExport.ts`

New (DB):
- `supabase/migrations/20260706000025_create_import_master_data_idem_and_suppliers_rpc.sql`
- `supabase/migrations/20260706000026_create_import_customers_rpc.sql`

Reused as-is from `features/catalog-import/components/`: `ImportDropzone`, `ImportErrorsTable`.

Modified:
- `apps/backoffice/src/pages/Suppliers.tsx`
- `apps/backoffice/src/pages/customers/CustomersListPage.tsx`
- `packages/supabase/src/types.generated.ts` (regen)

---

## Task 1: Framework core — types, coercion, parser

**Files:**
- Create: `apps/backoffice/src/features/data-import/entityImportDef.ts`
- Create: `apps/backoffice/src/features/data-import/parseEntityWorkbook.ts`
- Test: `apps/backoffice/src/features/data-import/__tests__/parseEntityWorkbook.test.ts`

**Interfaces:**
- Produces:
  - `type EntityColumnType = 'text' | 'number' | 'boolean' | 'tags'`
  - `interface EntityColumnDef { key: string; required: boolean; type: EntityColumnType }`
  - `interface EntityImportDef { entity: string; sheetName: string; rpcName: string; columns: readonly EntityColumnDef[]; example: Record<string, string | number | boolean>; queryKeysToInvalidate: readonly (readonly unknown[])[] }`
  - `type EntityRow = Record<string, string | number | boolean | string[] | null>`
  - `interface StructureError { sheet: string; row: number; column?: string; message: string }`
  - `interface ImportError { sheet: string; row: number; sku: string | null; code: string; message: string }`
  - `interface ImportReport { valid: boolean; errors: ImportError[]; summary: Record<string, Record<string, number>>; idempotent_replay: boolean }`
  - `function coerceCell(type: EntityColumnType, raw: unknown): { value: EntityRow[string]; error: string | null }`
  - `function parseEntityWorkbook(buf: ArrayBuffer, def: EntityImportDef): { rows: EntityRow[]; structureErrors: StructureError[]; rowMap: number[] }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backoffice/src/features/data-import/__tests__/parseEntityWorkbook.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseEntityWorkbook } from '../parseEntityWorkbook.js';
import type { EntityImportDef } from '../entityImportDef.js';

const DEF: EntityImportDef = {
  entity: 'widgets',
  sheetName: 'Widgets',
  rpcName: 'import_widgets_v1',
  columns: [
    { key: 'code',   required: true,  type: 'text' },
    { key: 'qty',    required: false, type: 'number' },
    { key: 'active', required: false, type: 'boolean' },
  ],
  example: { code: 'W-1', qty: 3, active: true },
  queryKeysToInvalidate: [['widgets']],
};

function toBuf(aoa: unknown[][], sheetName = 'Widgets'): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('parseEntityWorkbook', () => {
  it('parses typed rows and skips blank rows', () => {
    const buf = toBuf([
      ['code', 'qty', 'active'],
      ['W-1', '3', 'true'],
      [null, null, null],
      ['W-2', '5', 'no'],
    ]);
    const { rows, structureErrors, rowMap } = parseEntityWorkbook(buf, DEF);
    expect(structureErrors).toEqual([]);
    expect(rows).toEqual([
      { code: 'W-1', qty: 3, active: true },
      { code: 'W-2', qty: 5, active: false },
    ]);
    expect(rowMap).toEqual([2, 4]); // 1-based Excel rows, blank row 3 skipped
  });

  it('flags missing sheet, unknown column, missing required column and bad number', () => {
    const missing = parseEntityWorkbook(toBuf([['code']], 'Other'), DEF);
    expect(missing.structureErrors.some((e) => e.message.includes('Missing sheet'))).toBe(true);

    const bad = parseEntityWorkbook(
      toBuf([['name', 'qty'], ['x', 'abc']]),
      DEF,
    );
    expect(bad.structureErrors.some((e) => e.message.includes('Unknown column "name"'))).toBe(true);
    expect(bad.structureErrors.some((e) => e.message.includes('Required column "code" is missing'))).toBe(true);
    expect(bad.structureErrors.some((e) => e.message.includes('is not a number'))).toBe(true);
  });

  it('flags a missing required value on a present column', () => {
    const { structureErrors } = parseEntityWorkbook(
      toBuf([['code', 'qty'], ['', '3']]),
      DEF,
    );
    expect(structureErrors.some((e) => e.message === 'Required value missing')).toBe(true);
  });

  it('returns a fatal structure error for an unreadable buffer', () => {
    const { rows, structureErrors } = parseEntityWorkbook(new ArrayBuffer(4), DEF);
    expect(rows).toEqual([]);
    expect(structureErrors[0]?.message).toContain('not a readable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/backoffice test parseEntityWorkbook`
Expected: FAIL — cannot find module `../parseEntityWorkbook.js` / `../entityImportDef.js`.

- [ ] **Step 3: Write `entityImportDef.ts`**

```ts
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
```

- [ ] **Step 4: Write `parseEntityWorkbook.ts`**

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @breakery/backoffice test parseEntityWorkbook`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/features/data-import/entityImportDef.ts \
        apps/backoffice/src/features/data-import/parseEntityWorkbook.ts \
        apps/backoffice/src/features/data-import/__tests__/parseEntityWorkbook.test.ts
git commit -m "feat(data-import): generic single-sheet workbook parser + typed column defs"
```

---

## Task 2: Workbook builders (template + export + download)

**Files:**
- Create: `apps/backoffice/src/features/data-import/buildEntityWorkbook.ts`
- Test: `apps/backoffice/src/features/data-import/__tests__/buildEntityWorkbook.test.ts`

**Interfaces:**
- Consumes: `EntityImportDef`, `EntityRow`, `parseEntityWorkbook` (Task 1).
- Produces:
  - `function buildTemplateWorkbook(def: EntityImportDef): XLSX.WorkBook`
  - `function buildExportWorkbook(def: EntityImportDef, rows: ReadonlyArray<Record<string, unknown>>): XLSX.WorkBook`
  - `function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backoffice/src/features/data-import/__tests__/buildEntityWorkbook.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildTemplateWorkbook, buildExportWorkbook } from '../buildEntityWorkbook.js';
import { parseEntityWorkbook } from '../parseEntityWorkbook.js';
import type { EntityImportDef } from '../entityImportDef.js';

const DEF: EntityImportDef = {
  entity: 'widgets',
  sheetName: 'Widgets',
  rpcName: 'import_widgets_v1',
  columns: [
    { key: 'code',   required: true,  type: 'text' },
    { key: 'qty',    required: false, type: 'number' },
    { key: 'active', required: false, type: 'boolean' },
  ],
  example: { code: 'W-1', qty: 3, active: true },
  queryKeysToInvalidate: [['widgets']],
};

function bufOf(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('buildEntityWorkbook', () => {
  it('template has the sheet, the headers and the example row', () => {
    const { rows, structureErrors } = parseEntityWorkbook(bufOf(buildTemplateWorkbook(DEF)), DEF);
    expect(structureErrors).toEqual([]);
    expect(rows).toEqual([{ code: 'W-1', qty: 3, active: true }]);
  });

  it('export round-trips through the parser', () => {
    const wb = buildExportWorkbook(DEF, [
      { code: 'A', qty: 1, active: false, ignored: 'x' },
      { code: 'B', qty: null, active: true },
    ]);
    const { rows, structureErrors } = parseEntityWorkbook(bufOf(wb), DEF);
    expect(structureErrors).toEqual([]);
    expect(rows).toEqual([
      { code: 'A', qty: 1, active: false },
      { code: 'B', qty: null, active: true },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/backoffice test buildEntityWorkbook`
Expected: FAIL — cannot find module `../buildEntityWorkbook.js`.

- [ ] **Step 3: Write `buildEntityWorkbook.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/backoffice test buildEntityWorkbook`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/data-import/buildEntityWorkbook.ts \
        apps/backoffice/src/features/data-import/__tests__/buildEntityWorkbook.test.ts
git commit -m "feat(data-import): template + export workbook builders (round-trip)"
```

---

## Task 3: Generic import hook

**Files:**
- Create: `apps/backoffice/src/features/data-import/hooks/useImportEntity.ts`

**Interfaces:**
- Consumes: `EntityImportDef`, `EntityRow`, `ImportReport` (Task 1); `supabase` from `@/lib/supabase.js`.
- Produces: `function useImportEntity(def: EntityImportDef)` → TanStack mutation with vars `{ payload: EntityRow[]; dryRun: boolean; idempotencyKey?: string }` returning `ImportReport`.

- [ ] **Step 1: Write `useImportEntity.ts`**

```ts
// apps/backoffice/src/features/data-import/hooks/useImportEntity.ts
// Wraps def.rpcName(p_payload, p_dry_run, p_idempotency_key). dryRun=true → report only.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { EntityImportDef, EntityRow, ImportReport } from '../entityImportDef.js';

interface ImportVars {
  payload: EntityRow[];
  dryRun: boolean;
  idempotencyKey?: string;
}

export function useImportEntity(def: EntityImportDef) {
  const qc = useQueryClient();
  return useMutation<ImportReport, Error, ImportVars>({
    mutationFn: async ({ payload, dryRun, idempotencyKey }) => {
      const { data, error } = await supabase.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        def.rpcName as any,
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          p_payload: payload as any,
          p_dry_run: dryRun,
          p_idempotency_key: idempotencyKey ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      if (error !== null) throw new Error(error.message);
      return data as unknown as ImportReport;
    },
    onSuccess: async (_report, vars) => {
      if (!vars.dryRun) {
        await Promise.all(
          def.queryKeysToInvalidate.map((key) => qc.invalidateQueries({ queryKey: key as unknown[] })),
        );
      }
    },
  });
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm --filter @breakery/backoffice exec tsc --noEmit -p tsconfig.json`
Expected: no new errors referencing `useImportEntity.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/data-import/hooks/useImportEntity.ts
git commit -m "feat(data-import): generic useImportEntity hook"
```

---

## Task 4: Import modal + summary grid

**Files:**
- Create: `apps/backoffice/src/features/data-import/components/EntitySummaryGrid.tsx`
- Create: `apps/backoffice/src/features/data-import/components/ImportEntityModal.tsx`
- Test: `apps/backoffice/src/features/data-import/__tests__/ImportEntityModal.smoke.test.tsx`

**Interfaces:**
- Consumes: `EntityImportDef`, `ImportReport`, `ImportError` (Task 1); `parseEntityWorkbook` (Task 1); `useImportEntity` (Task 3); `ImportDropzone`, `ImportErrorsTable` from `@/features/catalog-import/components/`.
- Produces:
  - `function EntitySummaryGrid({ summary }: { summary: ImportReport['summary'] }): JSX.Element`
  - `function ImportEntityModal({ open, onClose, def, title, description }: { open: boolean; onClose: () => void; def: EntityImportDef; title: string; description: string }): JSX.Element`

Note: the catalog `ImportSummaryCards` is hard-coded to the 6 catalog sheets, so this framework needs its own generic grid. `ImportDropzone` and `ImportErrorsTable` are generic (structural types) and are reused directly.

- [ ] **Step 1: Write `EntitySummaryGrid.tsx`**

```tsx
// apps/backoffice/src/features/data-import/components/EntitySummaryGrid.tsx
// Generic summary grid: one card per top-level summary key, one row per metric.
import type { JSX } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';
import type { ImportReport } from '../entityImportDef.js';

function metricLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function EntitySummaryGrid({ summary }: { summary: ImportReport['summary'] }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="entity-summary-grid">
      {Object.entries(summary).map(([section, metrics]) => (
        <Card key={section} className="p-0">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-text-muted">
              {section}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            {Object.entries(metrics).map(([metricKey, count]) => (
              <div key={metricKey} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-text-secondary">{metricLabel(metricKey)}</span>
                <span className={count > 0 ? 'font-semibold text-text-primary' : 'text-text-muted'}>
                  {count}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `ImportEntityModal.tsx`**

```tsx
// apps/backoffice/src/features/data-import/components/ImportEntityModal.tsx
// 3-step import flow inside a Dialog: idle → parsed → previewed → done.
// Fresh idempotency key on new file AND after a successful commit.

import { useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle,
} from '@breakery/ui';
import { ImportDropzone } from '@/features/catalog-import/components/ImportDropzone.js';
import { ImportErrorsTable } from '@/features/catalog-import/components/ImportErrorsTable.js';
import { EntitySummaryGrid } from './EntitySummaryGrid.js';
import { useImportEntity } from '../hooks/useImportEntity.js';
import { parseEntityWorkbook } from '../parseEntityWorkbook.js';
import type {
  EntityImportDef, EntityRow, ImportError, ImportReport, StructureError,
} from '../entityImportDef.js';

interface Props {
  open: boolean;
  onClose: () => void;
  def: EntityImportDef;
  title: string;
  description: string;
}

type Stage =
  | { step: 'idle' }
  | { step: 'parsed'; payload: EntityRow[]; structureErrors: StructureError[]; filename: string; rowMap: number[] }
  | { step: 'previewed'; payload: EntityRow[]; report: ImportReport; filename: string; rowMap: number[] }
  | { step: 'done'; report: ImportReport };

function toExcelRows(errors: ImportError[], rowMap: number[]): ImportError[] {
  return errors.map((err) => {
    const excelRow = rowMap[err.row - 1];
    return excelRow === undefined ? err : { ...err, row: excelRow };
  });
}

export function ImportEntityModal({ open, onClose, def, title, description }: Props): JSX.Element {
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const importMutation = useImportEntity(def);
  const idemKeyRef = useRef<string>(crypto.randomUUID());

  function reset(): void {
    idemKeyRef.current = crypto.randomUUID();
    setStage({ step: 'idle' });
    importMutation.reset();
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  async function handleFile(buf: ArrayBuffer, filename: string): Promise<void> {
    idemKeyRef.current = crypto.randomUUID();
    const { rows, structureErrors, rowMap } = parseEntityWorkbook(buf, def);
    setStage({ step: 'parsed', payload: rows, structureErrors, filename, rowMap });
    if (structureErrors.length === 0 && rows.length > 0) {
      try {
        const report = await importMutation.mutateAsync({ payload: rows, dryRun: true });
        setStage({ step: 'previewed', payload: rows, report, filename, rowMap });
      } catch (e) {
        setStage({ step: 'idle' });
        toast.error(`Validation failed: ${(e as Error).message}`);
      }
    }
  }

  async function handleConfirm(): Promise<void> {
    if (stage.step !== 'previewed') return;
    try {
      const report = await importMutation.mutateAsync({
        payload: stage.payload, dryRun: false, idempotencyKey: idemKeyRef.current,
      });
      if (!report.valid) {
        setStage({ ...stage, report });
        toast.error('Validation failed at import time — review the errors below');
        return;
      }
      idemKeyRef.current = crypto.randomUUID();
      setStage({ step: 'done', report });
      toast.success(`${title} imported successfully`);
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
  }

  const importTotal =
    stage.step === 'previewed'
      ? Object.values(stage.report.summary).reduce(
          (sum, section) => sum + (section['create'] ?? 0) + (section['update'] ?? 0), 0)
      : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>

        <div className="space-y-4 py-2">
          {(stage.step === 'idle' ||
            (stage.step === 'parsed' && (stage.payload.length === 0 || stage.structureErrors.length > 0))) && (
            <>
              <ImportDropzone onFile={(buf, name) => void handleFile(buf, name)} disabled={importMutation.isPending} />
              {stage.step === 'parsed' && stage.structureErrors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-danger">
                    {stage.structureErrors.length} structure error
                    {stage.structureErrors.length !== 1 ? 's' : ''} in{' '}
                    <span className="font-mono">{stage.filename}</span>. Fix and re-upload.
                  </p>
                  <ImportErrorsTable structureErrors={stage.structureErrors} />
                </div>
              )}
            </>
          )}

          {stage.step === 'parsed' && stage.payload.length > 0 &&
            stage.structureErrors.length === 0 && importMutation.isPending && (
              <p className="text-sm text-text-muted">Validating {stage.filename}…</p>
          )}

          {stage.step === 'previewed' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <p className="text-sm text-text-secondary">
                  Ready to import <span className="font-mono font-medium">{stage.filename}</span>
                </p>
                {stage.report.valid
                  ? <Badge variant="default">Valid</Badge>
                  : <Badge variant="destructive">{stage.report.errors.length} error{stage.report.errors.length !== 1 ? 's' : ''}</Badge>}
              </div>
              <EntitySummaryGrid summary={stage.report.summary} />
              {stage.report.errors.length > 0 && (
                <ImportErrorsTable errors={toExcelRows(stage.report.errors, stage.rowMap)} />
              )}
              <div className="flex items-center gap-3">
                <Button data-testid="confirm-import" onClick={() => void handleConfirm()}
                  disabled={!stage.report.valid || importMutation.isPending}>
                  {importMutation.isPending ? 'Importing…'
                    : importTotal > 0 ? `Import ${importTotal} row${importTotal !== 1 ? 's' : ''}` : 'Import'}
                </Button>
                <Button variant="secondary" onClick={reset}>Cancel</Button>
              </div>
            </div>
          )}

          {stage.step === 'done' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="default">Import complete</Badge>
                {stage.report.idempotent_replay && <Badge variant="secondary">Idempotent replay</Badge>}
              </div>
              <EntitySummaryGrid summary={stage.report.summary} />
              <div className="flex items-center gap-3">
                <Button variant="secondary" onClick={reset}>Import another file</Button>
                <Button variant="primary" onClick={handleClose}>Done</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write the smoke test**

```tsx
// apps/backoffice/src/features/data-import/__tests__/ImportEntityModal.smoke.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportEntityModal } from '../components/ImportEntityModal.js';
import type { EntityImportDef } from '../entityImportDef.js';

const DEF: EntityImportDef = {
  entity: 'widgets', sheetName: 'Widgets', rpcName: 'import_widgets_v1',
  columns: [{ key: 'code', required: true, type: 'text' }],
  example: { code: 'W-1' }, queryKeysToInvalidate: [['widgets']],
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('ImportEntityModal', () => {
  it('renders the dropzone in the idle state', () => {
    render(wrap(<ImportEntityModal open def={DEF} title="Import suppliers" description="desc" onClose={() => {}} />));
    expect(screen.getByTestId('import-dropzone')).toBeInTheDocument();
    expect(screen.getByText('Import suppliers')).toBeInTheDocument();
  });

  it('renders nothing visible when closed', () => {
    render(wrap(<ImportEntityModal open={false} def={DEF} title="Import suppliers" description="desc" onClose={() => {}} />));
    expect(screen.queryByTestId('import-dropzone')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the smoke test**

Run: `pnpm --filter @breakery/backoffice test ImportEntityModal`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/data-import/components/ \
        apps/backoffice/src/features/data-import/__tests__/ImportEntityModal.smoke.test.tsx
git commit -m "feat(data-import): generic ImportEntityModal + summary grid"
```

---

## Task 5: Migration — idempotency table + `import_suppliers_v1` RPC

**Files:**
- Create: `supabase/migrations/20260706000025_create_import_master_data_idem_and_suppliers_rpc.sql`
- Modify: `packages/supabase/src/types.generated.ts` (regen — controller)

**Interfaces:**
- Produces (DB): table `import_master_data_idempotency_keys`; function `public.import_suppliers_v1(p_payload jsonb, p_dry_run boolean, p_idempotency_key uuid) returns jsonb`.
- Return JSON shape: `{ valid, errors:[{sheet,row,sku,code,message}], summary:{Suppliers:{create,update}}, idempotent_replay }`.

> **Controller-only steps:** Steps 2 (apply), 4 (pgTAP), 5 (regen). Subagents author the `.sql` file (Step 1) and stop — flag to the controller that MCP application is required.

- [ ] **Step 1: Author the migration SQL**

```sql
-- 20260706000025_create_import_master_data_idem_and_suppliers_rpc.sql
-- Phase 1 bulk import — shared idempotency table + suppliers import (upsert by code).
-- Dry-run = validate + summary, zero writes. Commit = validate then atomic upsert.
-- Gate suppliers.create. Idempotency S25 flavor 2. Anon defense-in-depth S20.

CREATE TABLE import_master_data_idempotency_keys (
  key        UUID PRIMARY KEY,
  entity     TEXT NOT NULL,
  report     JSONB NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE import_master_data_idempotency_keys IS
  'Phase 1 bulk import idempotency keys (suppliers/customers), S25 flavor 2. Replay returns stored report.';

ALTER TABLE import_master_data_idempotency_keys ENABLE ROW LEVEL SECURITY;
-- No policy: RPC-only access (SECURITY DEFINER bypasses RLS).
REVOKE ALL ON import_master_data_idempotency_keys FROM PUBLIC;
REVOKE ALL ON import_master_data_idempotency_keys FROM anon;
REVOKE ALL ON import_master_data_idempotency_keys FROM authenticated;

CREATE OR REPLACE FUNCTION public.import_suppliers_v1(
  p_payload         JSONB,
  p_dry_run         BOOLEAN DEFAULT TRUE,
  p_idempotency_key UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  r           RECORD;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'suppliers.create') THEN
    RAISE EXCEPTION 'permission denied: suppliers.create required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_sup, t_err;

  CREATE TEMP TABLE t_sup ON COMMIT DROP AS
  SELECT ord::INT                                AS row_num,
         NULLIF(trim(elt->>'code'), '')          AS code,
         NULLIF(trim(elt->>'name'), '')          AS name,
         NULLIF(trim(elt->>'contact_phone'), '') AS contact_phone,
         NULLIF(trim(elt->>'contact_email'), '') AS contact_email,
         NULLIF(trim(elt->>'address'), '')       AS address,
         (elt->>'payment_terms_days')::NUMERIC   AS payment_terms_days,
         NULLIF(elt->>'notes', '')               AS notes,
         (elt->>'is_active')::BOOLEAN            AS is_active
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  -- validation
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'missing_required', 'code and name are required'
    FROM t_sup WHERE code IS NULL OR name IS NULL;
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'too_long', 'code must be <= 32 chars'
    FROM t_sup WHERE code IS NOT NULL AND char_length(code) > 32;
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'too_long', 'name must be <= 120 chars'
    FROM t_sup WHERE name IS NOT NULL AND char_length(name) > 120;
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'invalid_payment_terms',
         'payment_terms_days must be an integer between 0 and 365'
    FROM t_sup WHERE payment_terms_days IS NOT NULL
       AND (payment_terms_days <> floor(payment_terms_days) OR payment_terms_days < 0 OR payment_terms_days > 365);
  INSERT INTO t_err SELECT 'Suppliers', MIN(row_num), code, 'duplicate_code',
         format('code "%s" appears %s times in the file', code, COUNT(*))
    FROM t_sup WHERE code IS NOT NULL GROUP BY code HAVING COUNT(*) > 1;

  -- summary (create = new code, update = existing non-deleted code)
  SELECT jsonb_build_object('Suppliers', jsonb_build_object(
    'create', (SELECT COUNT(*) FROM t_sup s WHERE s.code IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM suppliers x WHERE x.code = s.code AND x.deleted_at IS NULL)),
    'update', (SELECT COUNT(*) FROM t_sup s WHERE s.code IS NOT NULL
                 AND EXISTS (SELECT 1 FROM suppliers x WHERE x.code = s.code AND x.deleted_at IS NULL))
  )) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY row_num),
         '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors,
                                 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  -- writes: upsert by code
  FOR r IN SELECT * FROM t_sup ORDER BY row_num LOOP
    IF EXISTS (SELECT 1 FROM suppliers WHERE code = r.code AND deleted_at IS NULL) THEN
      UPDATE suppliers SET
        name               = r.name,
        contact_phone      = r.contact_phone,
        contact_email      = r.contact_email,
        address            = r.address,
        payment_terms_days = COALESCE(r.payment_terms_days::INT, payment_terms_days),
        notes              = r.notes,
        is_active          = COALESCE(r.is_active, is_active),
        updated_at         = now()
      WHERE code = r.code AND deleted_at IS NULL;
    ELSE
      INSERT INTO suppliers (code, name, contact_phone, contact_email, address, payment_terms_days, notes, is_active)
      VALUES (r.code, r.name, r.contact_phone, r.contact_email, r.address,
              COALESCE(r.payment_terms_days::INT, 30), r.notes, COALESCE(r.is_active, TRUE));
    END IF;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller, 'suppliers.imported', 'supplier', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'suppliers', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.import_suppliers_v1(JSONB, BOOLEAN, UUID) IS
  'Phase 1 bulk import — suppliers upsert-by-code. Dry-run validation report + atomic commit. Gate suppliers.create.';

REVOKE ALL ON FUNCTION public.import_suppliers_v1(JSONB, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_suppliers_v1(JSONB, BOOLEAN, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_suppliers_v1(JSONB, BOOLEAN, UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: (Controller) Apply the migration via MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` with `project_id='ikcyvlovptebroadgtvd'`, `name='create_import_master_data_idem_and_suppliers_rpc'`, body = the SQL above.
Before applying, verify the permission key exists:
`SELECT 1 FROM permissions WHERE key = 'suppliers.create';` via `execute_sql` (if the project stores permission keys in a table; otherwise confirm `has_permission` resolves it). If the key differs, adjust the gate string in the SQL before applying.
Expected: migration applies without error.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/20260706000025_create_import_master_data_idem_and_suppliers_rpc.sql
git commit -m "feat(db): import_suppliers_v1 RPC + shared import idempotency table"
```

- [ ] **Step 4: (Controller) Run pgTAP via MCP `execute_sql` (BEGIN/ROLLBACK)**

```sql
BEGIN;
SELECT plan(6);

-- a known admin user id with suppliers.create; replace :admin via a lookup in the project.
-- For the suite, impersonate by setting auth.uid() through the test helper used elsewhere,
-- or call as the service role and assert on the report JSON shape + table effects.

-- 1. dry-run writes nothing
SELECT lives_ok($$ SELECT import_suppliers_v1(
  '[{"code":"SUP-T1","name":"Test One"}]'::jsonb, TRUE, NULL) $$, 'dry-run runs');
SELECT is(
  (SELECT COUNT(*)::int FROM suppliers WHERE code = 'SUP-T1'), 0,
  'dry-run created no supplier');

-- 2. valid commit inserts
SELECT is(
  (import_suppliers_v1('[{"code":"SUP-T1","name":"Test One"}]'::jsonb, FALSE,
     '11111111-1111-1111-1111-111111111111'::uuid) ->> 'valid'), 'true',
  'commit reports valid');
SELECT is(
  (SELECT COUNT(*)::int FROM suppliers WHERE code = 'SUP-T1' AND deleted_at IS NULL), 1,
  'commit inserted the supplier');

-- 3. idempotent replay (same key) does not double-insert
SELECT is(
  (import_suppliers_v1('[{"code":"SUP-T1","name":"Test One"}]'::jsonb, FALSE,
     '11111111-1111-1111-1111-111111111111'::uuid) ->> 'idempotent_replay'), 'true',
  'same key replays');

-- 4. missing required → invalid, no write
SELECT is(
  (import_suppliers_v1('[{"name":"No Code"}]'::jsonb, TRUE, NULL) ->> 'valid'), 'false',
  'missing code is invalid');

SELECT finish();
ROLLBACK;
```
Adjust impersonation to the project's pgTAP auth helper (see `supabase/tests/inventory.test.sql` for the established pattern of setting `request.jwt.claims` / `auth.uid()`). Expected: all assertions pass. Also assert `anon` cannot execute:
```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT import_suppliers_v1('[]'::jsonb, TRUE, NULL) $$, '42501');
ROLLBACK;
```

- [ ] **Step 5: (Controller) Regen types + commit**

Run MCP `generate_typescript_types` (project `ikcyvlovptebroadgtvd`), write the result to `packages/supabase/src/types.generated.ts`.

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): regen after import_suppliers_v1 + idempotency table"
```

---

## Task 6: Suppliers def + wire Suppliers page

**Files:**
- Create: `apps/backoffice/src/features/suppliers/import/suppliersImportDef.ts`
- Modify: `apps/backoffice/src/pages/Suppliers.tsx`
- Test: `apps/backoffice/src/pages/suppliers/__tests__/SuppliersImport.smoke.test.tsx`

**Interfaces:**
- Consumes: `EntityImportDef` (Task 1), `ImportEntityModal` (Task 4), `buildTemplateWorkbook`/`buildExportWorkbook`/`downloadWorkbook` (Task 2), `useSuppliersList` + `SUPPLIERS_QUERY_KEY` (existing).
- Produces: `export const suppliersImportDef: EntityImportDef`.

- [ ] **Step 1: Write `suppliersImportDef.ts`**

```ts
// apps/backoffice/src/features/suppliers/import/suppliersImportDef.ts
import type { EntityImportDef } from '@/features/data-import/entityImportDef.js';
import { SUPPLIERS_QUERY_KEY } from '@/features/suppliers/hooks/useSuppliersList.js';

export const suppliersImportDef: EntityImportDef = {
  entity: 'suppliers',
  sheetName: 'Suppliers',
  rpcName: 'import_suppliers_v1',
  columns: [
    { key: 'code',               required: true,  type: 'text' },
    { key: 'name',               required: true,  type: 'text' },
    { key: 'contact_phone',      required: false, type: 'text' },
    { key: 'contact_email',      required: false, type: 'text' },
    { key: 'address',            required: false, type: 'text' },
    { key: 'payment_terms_days', required: false, type: 'number' },
    { key: 'notes',              required: false, type: 'text' },
    { key: 'is_active',          required: false, type: 'boolean' },
  ],
  example: {
    code: 'SUP-FLOUR', name: 'PT Tepung Jaya', contact_phone: '+62 812 0000 0000',
    contact_email: 'sales@tepungjaya.co.id', address: 'Jakarta', payment_terms_days: 30, is_active: true,
  },
  queryKeysToInvalidate: [SUPPLIERS_QUERY_KEY],
};
```

- [ ] **Step 2: Wire `Suppliers.tsx` — imports + state**

Add imports near the existing ones (after line 38):
```tsx
import { ImportEntityModal } from '@/features/data-import/components/ImportEntityModal.js';
import { buildTemplateWorkbook, buildExportWorkbook, downloadWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { suppliersImportDef } from '@/features/suppliers/import/suppliersImportDef.js';
```
Add state next to the other `useState` calls (after `const [deleting, setDeleting] = useState<SupplierRow | undefined>(undefined);`):
```tsx
const [importing, setImporting] = useState(false);
```
Add handlers right before `const rows = list.data ?? [];`:
```tsx
function handleTemplate(): void {
  downloadWorkbook(buildTemplateWorkbook(suppliersImportDef), 'breakery-suppliers-template.xlsx');
}
function handleExport(): void {
  downloadWorkbook(
    buildExportWorkbook(suppliersImportDef, allList.data ?? []),
    `breakery-suppliers-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}
```

- [ ] **Step 3: Wire `Suppliers.tsx` — replace the 3 disabled buttons**

Replace the Template / Import / Export `<Button>` block (lines 102-110, the three `disabled` buttons) with:
```tsx
<Button variant="ghost" size="sm" onClick={handleTemplate} aria-label="Download suppliers template">
  <FileText className="h-4 w-4" aria-hidden /> Template
</Button>
{canCreate && (
  <Button variant="ghost" size="sm" onClick={() => setImporting(true)} aria-label="Import suppliers">
    <Upload className="h-4 w-4" aria-hidden /> Import
  </Button>
)}
<Button variant="ghost" size="sm" onClick={handleExport} aria-label="Export suppliers">
  <Download className="h-4 w-4" aria-hidden /> Export
</Button>
```
(Leave the "Categories" disabled button untouched.)

- [ ] **Step 4: Wire `Suppliers.tsx` — render the modal**

Add right after the `<SupplierDeleteConfirm ... />` element (before the closing `</div>`):
```tsx
<ImportEntityModal
  open={importing}
  onClose={() => setImporting(false)}
  def={suppliersImportDef}
  title="Import suppliers"
  description="Upload a filled .xlsx template. Existing codes are updated; new codes are created. The file is validated before any writes."
/>
```

- [ ] **Step 5: Write the page smoke test**

```tsx
// apps/backoffice/src/pages/suppliers/__tests__/SuppliersImport.smoke.test.tsx
import { describe, it, expect } from 'vitest';
import { suppliersImportDef } from '@/features/suppliers/import/suppliersImportDef.js';
import { buildTemplateWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { parseEntityWorkbook } from '@/features/data-import/parseEntityWorkbook.js';
import * as XLSX from 'xlsx';

describe('suppliersImportDef', () => {
  it('produces a template that round-trips with the required columns', () => {
    const buf = XLSX.write(buildTemplateWorkbook(suppliersImportDef), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { rows, structureErrors } = parseEntityWorkbook(buf, suppliersImportDef);
    expect(structureErrors).toEqual([]);
    expect(rows[0]?.code).toBe('SUP-FLOUR');
    expect(rows[0]?.is_active).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests + build**

Run: `pnpm --filter @breakery/backoffice test SuppliersImport`
Expected: PASS.
Run: `pnpm --filter @breakery/backoffice build`
Expected: build succeeds (no TS errors).

- [ ] **Step 7: Commit**

```bash
git add apps/backoffice/src/features/suppliers/import/suppliersImportDef.ts \
        apps/backoffice/src/pages/Suppliers.tsx \
        apps/backoffice/src/pages/suppliers/__tests__/SuppliersImport.smoke.test.tsx
git commit -m "feat(suppliers): wire Template/Import/Export buttons to bulk-import framework"
```

---

## Task 7: Migration — `import_customers_v1` RPC (create-only)

**Files:**
- Create: `supabase/migrations/20260706000026_create_import_customers_rpc.sql`
- Modify: `packages/supabase/src/types.generated.ts` (regen — controller)

**Interfaces:**
- Consumes (DB): `import_master_data_idempotency_keys` (Task 5).
- Produces (DB): `public.import_customers_v1(p_payload jsonb, p_dry_run boolean, p_idempotency_key uuid) returns jsonb`.
- Return JSON shape: `{ valid, errors:[...], summary:{Customers:{create}}, idempotent_replay }`.

> **Controller-only steps:** Steps 2 (apply), 4 (pgTAP), 5 (regen).

- [ ] **Step 1: Author the migration SQL**

```sql
-- 20260706000026_create_import_customers_rpc.sql
-- Phase 1 bulk import — customers CREATE-ONLY. Resolves category by name or slug.
-- Flags duplicates (in-file and vs DB) by phone (fallback email). Excludes
-- system-managed columns (balance, points, totals). Gate customers.create.

CREATE OR REPLACE FUNCTION public.import_customers_v1(
  p_payload         JSONB,
  p_dry_run         BOOLEAN DEFAULT TRUE,
  p_idempotency_key UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  r           RECORD;
  v_cat_id    UUID;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'customers.create') THEN
    RAISE EXCEPTION 'permission denied: customers.create required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_cust, t_err;

  CREATE TEMP TABLE t_cust ON COMMIT DROP AS
  SELECT ord::INT                                              AS row_num,
         NULLIF(trim(elt->>'name'), '')                       AS name,
         NULLIF(trim(elt->>'phone'), '')                      AS phone,
         NULLIF(trim(elt->>'email'), '')                      AS email,
         COALESCE(NULLIF(trim(elt->>'customer_type'), ''), 'retail') AS customer_type,
         NULLIF(trim(elt->>'category'), '')                   AS category,
         NULLIF(trim(elt->>'birth_date'), '')                 AS birth_date,
         (elt->>'marketing_consent')::BOOLEAN                 AS marketing_consent,
         NULLIF(trim(elt->>'b2b_company_name'), '')           AS b2b_company_name,
         NULLIF(trim(elt->>'b2b_tax_id'), '')                 AS b2b_tax_id,
         (elt->>'b2b_payment_terms_days')::NUMERIC            AS b2b_payment_terms_days,
         (elt->>'b2b_credit_limit')::NUMERIC                  AS b2b_credit_limit
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  -- validation
  INSERT INTO t_err SELECT 'Customers', row_num, name, 'missing_required', 'name is required'
    FROM t_cust WHERE name IS NULL;
  INSERT INTO t_err SELECT 'Customers', row_num, COALESCE(phone, name), 'invalid_customer_type',
         format('customer_type "%s" must be retail or b2b', customer_type)
    FROM t_cust WHERE customer_type NOT IN ('retail', 'b2b');
  INSERT INTO t_err SELECT 'Customers', row_num, COALESCE(phone, name), 'invalid_birth_date',
         format('birth_date "%s" must be YYYY-MM-DD', birth_date)
    FROM t_cust WHERE birth_date IS NOT NULL AND birth_date !~ '^\d{4}-\d{2}-\d{2}$';
  INSERT INTO t_err SELECT 'Customers', c.row_num, COALESCE(c.phone, c.name), 'unknown_category',
         format('category "%s" not found (by name or slug)', c.category)
    FROM t_cust c
   WHERE c.category IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM customer_categories cc
                      WHERE cc.deleted_at IS NULL AND (cc.name = c.category OR cc.slug = c.category));
  -- in-file duplicate by phone / email
  INSERT INTO t_err SELECT 'Customers', MIN(row_num), phone, 'duplicate_in_file',
         format('phone "%s" appears %s times in the file', phone, COUNT(*))
    FROM t_cust WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1;
  INSERT INTO t_err SELECT 'Customers', MIN(row_num), email, 'duplicate_in_file',
         format('email "%s" appears %s times in the file', email, COUNT(*))
    FROM t_cust WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;
  -- already exists in DB by phone / email (create-only)
  INSERT INTO t_err SELECT 'Customers', c.row_num, c.phone, 'duplicate_exists',
         format('a customer with phone "%s" already exists', c.phone)
    FROM t_cust c WHERE c.phone IS NOT NULL
     AND EXISTS (SELECT 1 FROM customers x WHERE x.deleted_at IS NULL AND x.phone = c.phone);
  INSERT INTO t_err SELECT 'Customers', c.row_num, c.email, 'duplicate_exists',
         format('a customer with email "%s" already exists', c.email)
    FROM t_cust c WHERE c.email IS NOT NULL
     AND EXISTS (SELECT 1 FROM customers x WHERE x.deleted_at IS NULL AND x.email = c.email);

  -- birth_date validity probe (regex-passing but impossible dates)
  FOR r IN SELECT row_num, birth_date FROM t_cust
            WHERE birth_date IS NOT NULL AND birth_date ~ '^\d{4}-\d{2}-\d{2}$' LOOP
    BEGIN
      PERFORM r.birth_date::date;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO t_err VALUES ('Customers', r.row_num, NULL, 'invalid_birth_date',
        format('birth_date "%s" is not a valid calendar date', r.birth_date));
    END;
  END LOOP;

  SELECT jsonb_build_object('Customers', jsonb_build_object(
    'create', (SELECT COUNT(*) FROM t_cust WHERE name IS NOT NULL)
  )) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY row_num),
         '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors,
                                 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  -- writes: create only
  FOR r IN SELECT * FROM t_cust ORDER BY row_num LOOP
    v_cat_id := NULL;
    IF r.category IS NOT NULL THEN
      SELECT id INTO v_cat_id FROM customer_categories
       WHERE deleted_at IS NULL AND (name = r.category OR slug = r.category) LIMIT 1;
    END IF;
    INSERT INTO customers (
      name, phone, email, customer_type, category_id, birth_date, marketing_consent,
      b2b_company_name, b2b_tax_id, b2b_payment_terms_days, b2b_credit_limit
    ) VALUES (
      r.name, r.phone, r.email, r.customer_type::customer_type, v_cat_id,
      NULLIF(r.birth_date, '')::date, COALESCE(r.marketing_consent, FALSE),
      r.b2b_company_name, r.b2b_tax_id, r.b2b_payment_terms_days::INT, r.b2b_credit_limit
    );
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller, 'customers.imported', 'customer', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'customers', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.import_customers_v1(JSONB, BOOLEAN, UUID) IS
  'Phase 1 bulk import — customers create-only, category by name/slug, duplicate detection. Gate customers.create.';

REVOKE ALL ON FUNCTION public.import_customers_v1(JSONB, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_customers_v1(JSONB, BOOLEAN, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_customers_v1(JSONB, BOOLEAN, UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: (Controller) Apply the migration via MCP**

`apply_migration` `project_id='ikcyvlovptebroadgtvd'`, `name='create_import_customers_rpc'`, body = SQL above. Verify `customers.create` permission key as in Task 5 Step 2.
Expected: applies cleanly. (`customer_type` enum + `customer_categories.slug`/`name` confirmed present in `types.generated.ts`.)

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/20260706000026_create_import_customers_rpc.sql
git commit -m "feat(db): import_customers_v1 RPC (create-only, category by name/slug)"
```

- [ ] **Step 4: (Controller) Run pgTAP via MCP `execute_sql` (BEGIN/ROLLBACK)**

```sql
BEGIN;
SELECT plan(5);

-- valid create
SELECT is(
  (import_customers_v1('[{"name":"Imported Cust","phone":"081234ZZZ"}]'::jsonb, FALSE,
     '22222222-2222-2222-2222-222222222222'::uuid) ->> 'valid'), 'true',
  'commit reports valid');
SELECT is(
  (SELECT COUNT(*)::int FROM customers WHERE phone = '081234ZZZ' AND deleted_at IS NULL), 1,
  'commit created the customer');

-- duplicate vs DB → invalid
SELECT is(
  (import_customers_v1('[{"name":"Dupe","phone":"081234ZZZ"}]'::jsonb, TRUE, NULL) ->> 'valid'), 'false',
  'existing phone is flagged duplicate');

-- unknown category → invalid
SELECT is(
  (import_customers_v1('[{"name":"X","category":"___nope___"}]'::jsonb, TRUE, NULL) ->> 'valid'), 'false',
  'unknown category is invalid');

-- bad customer_type → invalid
SELECT is(
  (import_customers_v1('[{"name":"X","customer_type":"vip"}]'::jsonb, TRUE, NULL) ->> 'valid'), 'false',
  'bad customer_type is invalid');

SELECT finish();
ROLLBACK;
```
Use the project's pgTAP auth-impersonation helper so `auth.uid()` resolves to a user with `customers.create`. Also assert `anon` is denied with `42501`.
Expected: all pass.

- [ ] **Step 5: (Controller) Regen types + commit**

Run MCP `generate_typescript_types`, write to `packages/supabase/src/types.generated.ts`.
```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): regen after import_customers_v1"
```

---

## Task 8: Customers def + export hook + wire Customers page

**Files:**
- Create: `apps/backoffice/src/features/customers/import/customersImportDef.ts`
- Create: `apps/backoffice/src/features/customers/hooks/useCustomersExport.ts`
- Modify: `apps/backoffice/src/pages/customers/CustomersListPage.tsx`
- Test: `apps/backoffice/src/pages/customers/__tests__/CustomersImport.smoke.test.tsx`

**Interfaces:**
- Consumes: `EntityImportDef` (Task 1), `ImportEntityModal` (Task 4), workbook builders (Task 2), `CUSTOMERS_LIST_QUERY_KEY` (existing), `supabase`.
- Produces:
  - `export const customersImportDef: EntityImportDef`
  - `function useCustomersExport()` → mutation returning `Record<string, unknown>[]` shaped by the def's column keys.

- [ ] **Step 1: Write `customersImportDef.ts`**

```ts
// apps/backoffice/src/features/customers/import/customersImportDef.ts
import type { EntityImportDef } from '@/features/data-import/entityImportDef.js';
import { CUSTOMERS_LIST_QUERY_KEY } from '@/features/customers/hooks/useCustomersList.js';

export const customersImportDef: EntityImportDef = {
  entity: 'customers',
  sheetName: 'Customers',
  rpcName: 'import_customers_v1',
  columns: [
    { key: 'name',                   required: true,  type: 'text' },
    { key: 'phone',                  required: false, type: 'text' },
    { key: 'email',                  required: false, type: 'text' },
    { key: 'customer_type',          required: false, type: 'text' },
    { key: 'category',               required: false, type: 'text' },
    { key: 'birth_date',             required: false, type: 'text' },
    { key: 'marketing_consent',      required: false, type: 'boolean' },
    { key: 'b2b_company_name',       required: false, type: 'text' },
    { key: 'b2b_tax_id',             required: false, type: 'text' },
    { key: 'b2b_payment_terms_days', required: false, type: 'number' },
    { key: 'b2b_credit_limit',       required: false, type: 'number' },
  ],
  example: {
    name: 'Budi Santoso', phone: '081234567890', email: 'budi@example.com',
    customer_type: 'retail', category: 'Regular', marketing_consent: true,
  },
  queryKeysToInvalidate: [CUSTOMERS_LIST_QUERY_KEY],
};
```

- [ ] **Step 2: Write `useCustomersExport.ts`**

```ts
// apps/backoffice/src/features/customers/hooks/useCustomersExport.ts
// One-shot fetch of all customers shaped to the import template column keys.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

const SELECT = `
  name, phone, email, customer_type, birth_date, marketing_consent,
  b2b_company_name, b2b_tax_id, b2b_payment_terms_days, b2b_credit_limit,
  customer_categories!left(name)
`.replace(/\s+/g, ' ').trim();

interface RawRow {
  name: string;
  phone: string | null;
  email: string | null;
  customer_type: string;
  birth_date: string | null;
  marketing_consent: boolean;
  b2b_company_name: string | null;
  b2b_tax_id: string | null;
  b2b_payment_terms_days: number | null;
  b2b_credit_limit: number | null;
  customer_categories: { name: string } | { name: string }[] | null;
}

function catName(raw: RawRow['customer_categories']): string | null {
  if (raw === null) return null;
  if (Array.isArray(raw)) return raw[0]?.name ?? null;
  return raw.name;
}

export function useCustomersExport() {
  return useMutation<Record<string, unknown>[], Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select(SELECT)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error !== null) throw new Error(error.message);
      return ((data ?? []) as unknown as RawRow[]).map((r) => ({
        name: r.name,
        phone: r.phone,
        email: r.email,
        customer_type: r.customer_type,
        category: catName(r.customer_categories),
        birth_date: r.birth_date,
        marketing_consent: r.marketing_consent,
        b2b_company_name: r.b2b_company_name,
        b2b_tax_id: r.b2b_tax_id,
        b2b_payment_terms_days: r.b2b_payment_terms_days,
        b2b_credit_limit: r.b2b_credit_limit,
      }));
    },
  });
}
```

- [ ] **Step 3: Wire `CustomersListPage.tsx` — imports + state + handlers**

Add imports after the existing feature imports (after line 53):
```tsx
import { toast } from 'sonner';
import { ImportEntityModal } from '@/features/data-import/components/ImportEntityModal.js';
import { buildTemplateWorkbook, buildExportWorkbook, downloadWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { customersImportDef } from '@/features/customers/import/customersImportDef.js';
import { useCustomersExport } from '@/features/customers/hooks/useCustomersExport.js';
```
Add state after `const [creating, setCreating] = useState<boolean>(false);`:
```tsx
const [importing, setImporting] = useState<boolean>(false);
const exportMut = useCustomersExport();
```
Add handlers after the `list/cats/stats` hooks (before the `if (!canRead)` guard):
```tsx
function handleTemplate(): void {
  downloadWorkbook(buildTemplateWorkbook(customersImportDef), 'breakery-customers-template.xlsx');
}
async function handleExport(): Promise<void> {
  try {
    const rows = await exportMut.mutateAsync();
    downloadWorkbook(
      buildExportWorkbook(customersImportDef, rows),
      `breakery-customers-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  } catch (e) {
    toast.error(`Export failed: ${(e as Error).message}`);
  }
}
```

- [ ] **Step 4: Wire `CustomersListPage.tsx` — replace the 3 disabled buttons**

Replace the Template / Import / Export disabled `<Button>` block (lines 207-215) with:
```tsx
<Button variant="ghost" size="md" onClick={handleTemplate} aria-label="Download customers template">
  <FileText className="h-4 w-4" aria-hidden /> Template
</Button>
{canCreate && (
  <Button variant="ghost" size="md" onClick={() => setImporting(true)} aria-label="Import customers">
    <Upload className="h-4 w-4" aria-hidden /> Import
  </Button>
)}
<Button variant="ghost" size="md" onClick={() => void handleExport()} disabled={exportMut.isPending} aria-label="Export customers">
  <Download className="h-4 w-4" aria-hidden /> {exportMut.isPending ? 'Exporting…' : 'Export'}
</Button>
```

- [ ] **Step 5: Wire `CustomersListPage.tsx` — render the modal**

Add right after the `<CustomerFormModal ... />` element (before the final `</div>`):
```tsx
<ImportEntityModal
  open={importing}
  onClose={() => setImporting(false)}
  def={customersImportDef}
  title="Import customers"
  description="Upload a filled .xlsx template. New customers are created; duplicates (by phone or email) are flagged before any writes."
/>
```

- [ ] **Step 6: Write the page smoke test**

```tsx
// apps/backoffice/src/pages/customers/__tests__/CustomersImport.smoke.test.tsx
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { customersImportDef } from '@/features/customers/import/customersImportDef.js';
import { buildTemplateWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { parseEntityWorkbook } from '@/features/data-import/parseEntityWorkbook.js';

describe('customersImportDef', () => {
  it('template round-trips with name required and consent boolean', () => {
    const buf = XLSX.write(buildTemplateWorkbook(customersImportDef), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { rows, structureErrors } = parseEntityWorkbook(buf, customersImportDef);
    expect(structureErrors).toEqual([]);
    expect(rows[0]?.name).toBe('Budi Santoso');
    expect(rows[0]?.marketing_consent).toBe(true);
  });
});
```

- [ ] **Step 7: Run tests + build**

Run: `pnpm --filter @breakery/backoffice test CustomersImport`
Expected: PASS.
Run: `pnpm --filter @breakery/backoffice build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/backoffice/src/features/customers/import/customersImportDef.ts \
        apps/backoffice/src/features/customers/hooks/useCustomersExport.ts \
        apps/backoffice/src/pages/customers/CustomersListPage.tsx \
        apps/backoffice/src/pages/customers/__tests__/CustomersImport.smoke.test.tsx
git commit -m "feat(customers): wire Template/Import/Export buttons to bulk-import framework"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full backoffice test suite**

Run: `pnpm --filter @breakery/backoffice test`
Expected: PASS (modulo the project's known env-gated baseline — do not conflate with regressions).

- [ ] **Step 2: Typecheck + build the whole workspace**

Run: `pnpm typecheck && pnpm --filter @breakery/backoffice build`
Expected: success.

- [ ] **Step 3: Manual smoke (optional, controller)**

Launch the backoffice (`pnpm --filter @breakery/backoffice dev`), open Suppliers → download template, fill 2 rows, Import → verify dry-run preview, confirm, see the grid refresh. Repeat on Customers. Verify Export downloads a round-trip-able file.

- [ ] **Step 4: Update CLAUDE.md Active Workplan note (1 line)**

Add under "In flight / Latest": a one-liner that Phase 1 master-data bulk import shipped and the generic `features/data-import/` framework is ready to extend to Phase 2 (sales/expenses/purchases + PO page button). Commit:
```bash
git add CLAUDE.md
git commit -m "docs: note Phase 1 bulk-import shipped; framework ready for Phase 2"
```

---

## Self-Review

**Spec coverage:**
- Generic framework (§3) → Tasks 1-4. ✓
- Suppliers upsert-by-code (§4.1, §5) → Task 5 (RPC) + Task 6 (UI). ✓
- Customers create-only + category-by-name/slug + duplicate detection (§4.2, §5) → Task 7 (RPC) + Task 8 (UI). ✓
- Modal 3-step flow (§3, §7) → Task 4. ✓
- Template + Import + Export wired (§6, user: "câble aussi l'export") → Tasks 6 & 8. ✓
- Idempotency table + S25 flavor 2 + anon defense-in-depth (§5) → Task 5 (table + suppliers), reused Task 7. ✓
- Tests: parser/builders/modal/RPC pgTAP (§8) → Tasks 1,2,4,5,7 + page smokes 6,8 + Task 9. ✓
- Types regen after each migration → Tasks 5 & 7 Step 5. ✓
- PO page untouched in Phase 1 (§6, §10) → not modified; noted in Task 9 Step 4. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; pgTAP auth-impersonation explicitly delegates to the existing project helper rather than hand-waving.

**Type consistency:** `EntityImportDef`/`EntityRow`/`ImportReport`/`ImportError`/`StructureError` defined in Task 1 and consumed unchanged in Tasks 2-8. `useImportEntity` vars `{ payload, dryRun, idempotencyKey }` match the modal's calls. RPC return shape `{ valid, errors, summary, idempotent_replay }` matches `ImportReport`. Summary key = sheet name (`Suppliers`/`Customers`) consumed generically by `EntitySummaryGrid`. Error `sku` field carries the natural id and is rendered by the reused `ImportErrorsTable`.

**Known assumptions to verify at execution time (flagged in-task):**
- `has_permission(uuid,'suppliers.create'|'customers.create')` keys exist (Task 5/7 Step 2).
- `audit_logs(actor_id, action, entity_type, entity_id, payload)` columns (confirmed used by `import_catalog_v1`).
- `suppliers.deleted_at`, `suppliers.code` semantics (confirmed: `useSuppliersList` filters `deleted_at`, form treats `code` as unique).
