# Bulk import — master data (Suppliers + Customers) — Design

- **Date:** 2026-06-23
- **Status:** Approved (design) — ready for implementation plan
- **Scope:** Phase 1 of a 2-tier "import my own data in one block" initiative.
- **App:** `apps/backoffice`
- **Author:** session 2026-06-23

## 1. Context & goal

The user wants an **Import** button on the Suppliers, Customers (and later Purchase
Orders) pages to load their own data in bulk ("ajouter mes propres données d'un
seul bloc"), and ultimately to bring historical Sales / Expenses / Purchases up to
date.

This was decomposed into two tiers (user decisions, 2026-06-23):

| Decision | Choice |
|---|---|
| History posting (sales/expenses/purchases) | **Reports & lists only** — no live money-path side effects |
| Phasing | **Phase 1 master data first**, Phase 2 transactional history |
| UI surface | **Modal dialog** on the existing list page |
| File format | **Excel `.xlsx`** (reuse S41 infra) |
| Suppliers semantics | **Upsert by `code`** |
| Customers semantics | **Create-only** (duplicates flagged) |
| Export | **Wired too** (Template + Import + Export) |

**This spec covers Phase 1 only: Suppliers + Customers bulk import + export.**
Phase 2 (historical Sales / Expenses / Purchases, reports-only, incl. the PO page
Import button) is a separate, later spec.

## 2. Existing foundation to reuse (S41 `catalog-import`)

The project already has a mature, proven bulk-import pattern in
`apps/backoffice/src/features/catalog-import/`:

- `templateDefinition.ts` — typed column defs (`text|number|boolean|tags`) as the
  single source of truth for parser + template + export.
- `parseCatalogWorkbook.ts` — pure `ArrayBuffer → { payload, structureErrors, rowMaps }`,
  exhaustive (never fail-fast), with typed coercion + duplicate detection.
- `hooks/useImportCatalog.ts` — wraps `import_catalog_v1(p_payload, p_dry_run, p_idempotency_key)`,
  returns `ImportReport { valid, errors[], summary, idempotent_replay }`.
- UI components: `ImportDropzone`, `ImportSummaryCards`, `ImportErrorsTable`.
- Page flow `ProductsImportExportPage.tsx`: state machine `idle → parsed → previewed → done`,
  fresh idempotency key (`useRef(crypto.randomUUID())`) on new file AND after commit.

All three target list pages (`Suppliers.tsx`, `CustomersListPage.tsx`,
`PurchaseOrdersListPage.tsx`) already render **disabled "Template / Import / Export"
buttons** as placeholders — this spec wires them up (PO in Phase 2).

## 3. Architecture — generic single-sheet import framework

Generalize the catalog pattern into a reusable single-sheet framework so suppliers,
customers (and later Phase 2 entities) share one code path.

New folder: `apps/backoffice/src/features/data-import/`

- **`entityImportDef.ts`** — types + shared coercion:
  - `EntityColumnDef { key; required; type: 'text'|'number'|'boolean'|'tags' }`
  - `EntityImportDef { sheetName; columns; example; rpcName; queryKeysToInvalidate }`
  - `coerceCell(...)` — extracted from `parseCatalogWorkbook` (text/number/boolean/tags,
    TRUTHY/FALSY sets). The catalog parser should later be refactored onto this shared
    helper, but **Phase 1 does not modify `catalog-import`** (no regression risk) — it
    only copies/extracts the coercion logic into the shared module.
- **`parseEntityWorkbook.ts`** — generic `(buf, def) → { rows, structureErrors, rowMap }`
  for a single sheet: missing-sheet, unknown/duplicate/required columns, per-cell
  coercion, blank-row skipping, `rowMap` (ordinal → Excel row) for error translation.
- **`buildEntityWorkbook.ts`** — `buildTemplate(def)` (header + 1 example row) and
  `buildExport(def, rows)` (round-trip shape) + `downloadWorkbook(wb, filename)`.
- **`useImportEntity.ts`** — generic hook: `def.rpcName(p_payload, p_dry_run, p_idempotency_key)`,
  returns the shared `ImportReport`; on commit success invalidates `def.queryKeysToInvalidate`.
- **`ImportEntityModal.tsx`** — the 3-step flow inside a `@breakery/ui` `Dialog`:
  - State machine `idle → parsed → previewed → done` (mirrors `ProductsImportExportPage`).
  - Reuses `ImportDropzone`, `ImportSummaryCards`, `ImportErrorsTable` (imported from
    `catalog-import` — they are already generic).
  - Idempotency key in `useRef`, reset on new file and after successful commit.
  - Props: `{ open, onClose, def, title, description }`.

`ImportReport` / `ImportError` types are shared (re-exported from `data-import`, structurally
identical to the catalog ones).

## 4. Entity definitions

### 4.1 Suppliers — `suppliersImportDef`

Sheet `Suppliers`. Columns (from `suppliers` table / `SupplierFormModal`):

| key | required | type | notes |
|---|---|---|---|
| `code` | yes | text | unique natural key, ≤32, uppercased |
| `name` | yes | text | ≤120 |
| `contact_phone` | no | text | ≤32 |
| `contact_email` | no | text | ≤120, format check |
| `address` | no | text | ≤255 |
| `payment_terms_days` | no | number | int 0..365, default 30 |
| `notes` | no | text | ≤500 |
| `is_active` | no | boolean | default true |

Semantics: **upsert by `code`** — existing code → update (counts as `update`), new
code → insert (`create`). RPC `import_suppliers_v1`. Gate `suppliers.create`.

### 4.2 Customers — `customersImportDef`

Sheet `Customers`. Columns (from `customers` table):

| key | required | type | notes |
|---|---|---|---|
| `name` | yes | text | |
| `phone` | no | text | |
| `email` | no | text | format check |
| `customer_type` | no | text | `retail`\|`b2b`, default `retail` |
| `category` | no | text | resolved by category **name or slug** → `category_id` |
| `birth_date` | no | text | ISO date `YYYY-MM-DD` |
| `marketing_consent` | no | boolean | default false |
| `b2b_company_name` | no | text | |
| `b2b_tax_id` | no | text | |
| `b2b_payment_terms_days` | no | number | |
| `b2b_credit_limit` | no | number | |

Excluded (system-managed): `b2b_current_balance`, `loyalty_points`, `lifetime_points`,
`total_spent`, `total_visits`, `last_visit_at`.

Semantics: **create-only**. Duplicate detection (in-file AND vs DB) by `phone`
(fallback `email`) surfaced as a `duplicate` error in the dry-run so the user can
clean up before committing. RPC `import_customers_v1`. Gate `customers.create`.
Unknown `category` → error. `customer_type='b2b'` without `b2b_company_name` is **allowed** (not blocking; the DB column is nullable) — no error.

## 5. RPCs (new migration)

Two `SECURITY DEFINER` RPCs, monotonic `_v1`, mirroring `import_catalog_v1`:

- `import_suppliers_v1(p_payload jsonb, p_dry_run boolean, p_idempotency_key uuid) returns jsonb`
- `import_customers_v1(p_payload jsonb, p_dry_run boolean, p_idempotency_key uuid) returns jsonb`

Behavior:
- Validate every row (exhaustive, collect all errors); never fail-fast.
- `p_dry_run=true` → validate + compute summary, **write nothing**.
- `p_dry_run=false` → if valid, apply (suppliers upsert by code / customers insert),
  record idempotency key + report. If invalid at commit time, write nothing, return
  the fresh error report (caller stays in preview).
- Return shape: `{ valid bool, errors [{sheet,row,key,code,message}], summary {Suppliers:{create,update,skip}}, idempotent_replay bool }`.

Idempotency: shared dedicated table
`import_idempotency_keys(key uuid primary key, entity text not null, report jsonb not null, created_at timestamptz default now())`.
Replay (same key) → return stored report with `idempotent_replay=true`. Concurrency
race handled via PK `unique_violation` catch + re-read (project idempotency pattern flavor 2).

Security (CLAUDE.md S20 defense-in-depth):
- `REVOKE EXECUTE ON FUNCTION ... FROM anon, PUBLIC`.
- `GRANT EXECUTE ... TO authenticated` (gate enforced inside via permission check on
  the caller's role/claims, consistent with how other admin RPCs check permissions).
- Permission gate inside the RPC: caller must hold `suppliers.create` / `customers.create`.
- `import_idempotency_keys`: `REVOKE ALL FROM anon`, RLS as appropriate (written only
  by the SECURITY DEFINER RPCs).

After migration: **regen types** via MCP `generate_typescript_types` → write to
`packages/supabase/src/types.generated.ts` and commit.

## 6. UI wiring

`Suppliers.tsx` and `CustomersListPage.tsx`:
- **Template** button → `downloadWorkbook(buildTemplate(def), '<entity>-template.xlsx')`.
- **Import** button → opens `ImportEntityModal` (enabled only when `canCreate`).
- **Export** button → fetch current rows (existing list hook / a small export query)
  → `downloadWorkbook(buildExport(def, rows), '<entity>-export-<date>.xlsx')`.
- Remove the `disabled` / "coming soon" affordances for these three buttons.
- On successful import, the modal invalidates the list query so the page refreshes.

**Purchase Orders page: unchanged in Phase 1** (Import stays Phase 2). A short note is
added so the next session knows the framework is ready to extend.

## 7. Data flow

1. User clicks **Import** → modal opens (`idle`).
2. Drop `.xlsx` → `parseEntityWorkbook` → `parsed`. Structure errors → shown, stay.
3. No structure errors → auto dry-run RPC → `previewed` (summary cards + error rows
   translated to Excel rows via `rowMap`).
4. **Confirm** → commit RPC (idempotent). Valid → `done` + toast + list invalidated.
   Invalid-at-commit → stay in preview with fresh errors.
5. **Cancel / new file** → fresh idempotency key.

## 8. Testing

- **Parser unit** (`data-import/__tests__/parseEntityWorkbook.test.ts`): coercion per
  type, unknown/duplicate/missing-required columns, blank-row skipping, rowMap,
  in-file duplicate detection.
- **Template/export roundtrip** unit.
- **RPC pgTAP** (via MCP `execute_sql`, BEGIN/ROLLBACK): dry-run writes nothing;
  valid commit inserts/upserts; idempotent replay returns stored report; permission
  gate denies without `*.create`; `anon` EXECUTE revoked; supplier upsert-by-code;
  customer create-only + duplicate detection; unknown customer category → error.
- **Modal smoke** (`ImportEntityModal.smoke.test.tsx`): renders dropzone, shows
  preview/errors, confirm enabled only when valid.
- Reuse the project's env-gated baseline; don't conflate with regressions.

## 9. Files (anticipated)

New:
- `apps/backoffice/src/features/data-import/entityImportDef.ts`
- `apps/backoffice/src/features/data-import/parseEntityWorkbook.ts`
- `apps/backoffice/src/features/data-import/buildEntityWorkbook.ts`
- `apps/backoffice/src/features/data-import/hooks/useImportEntity.ts`
- `apps/backoffice/src/features/data-import/components/ImportEntityModal.tsx`
- `apps/backoffice/src/features/suppliers/import/suppliersImportDef.ts`
- `apps/backoffice/src/features/customers/import/customersImportDef.ts`
- `supabase/migrations/<ts>_import_master_data_rpcs.sql`
- tests as in §8.

Modified:
- `apps/backoffice/src/pages/Suppliers.tsx`
- `apps/backoffice/src/pages/customers/CustomersListPage.tsx`
- `packages/supabase/src/types.generated.ts` (regen)

## 10. Out of scope (Phase 2, separate spec)

- Historical **Sales / Expenses / Purchases** import (reports & lists only).
- **Purchase Orders** page Import button.
- Refactoring `catalog-import` onto the shared framework (optional cleanup later).
