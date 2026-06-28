# Historical Purchases Bulk Import (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working bulk Excel import (+ template + export) of **historical purchases** to the Purchase Orders page, landing them as `status='received'` POs flagged `is_historical_import` with zero money-path side effects (no GRN, no stock, no JE), reusing the Phase 1 `data-import/` framework.

**Architecture:** A new `SECURITY DEFINER` RPC `import_purchases_v1` receives the flat line rows from the generic parser, groups them by `po_reference`, validates (dry-run) then inserts one `purchase_orders` + N `purchase_order_items` per group. Two new columns (`is_historical_import`, `import_reference`) mark imports; a `BEFORE INSERT` trigger on `purchase_payments` blocks paying a historical PO (receive/cancel are already blocked by their existing `status` guards). The PO list page gets wired Template/Import/Export buttons + an "Imported" badge.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, `xlsx` (SheetJS), `@breakery/ui`, Vitest, Supabase Postgres (cloud V3 dev `ikcyvlovptebroadgtvd`), pgTAP.

## Global Constraints

- **DB target is Supabase cloud V3 dev `ikcyvlovptebroadgtvd`** — Docker retired. Migrations via MCP `apply_migration`, SQL/pgTAP via MCP `execute_sql` (BEGIN/ROLLBACK), types regen via MCP `generate_typescript_types`. **Subagents cannot call Supabase MCP** — all MCP steps (apply migration, regen types, run pgTAP) are executed by the **controller/lead**. The subagent authors the `.sql` and stops.
- **RPC versioning is monotonic** — new RPCs are `_v1`; never edit a published signature. Adding an internal guard via `CREATE OR REPLACE` with the **same** signature is allowed (fix-style).
- **Anon defense-in-depth (S20):** every new function gets `REVOKE ALL … FROM PUBLIC`, `REVOKE EXECUTE … FROM anon`, `GRANT EXECUTE … TO authenticated`, `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`.
- **Idempotency = S25 flavor 2** — `p_idempotency_key UUID` REQUIRED on commit; reuse the shared `import_master_data_idempotency_keys` table (entity `'purchases'`); replay returns the stored report with `idempotent_replay:true`; PK `unique_violation` catch + re-read.
- **Reports-only guarantee:** the import writes **zero** rows to `stock_movements`, `goods_receipt_notes`, `journal_entries`. Asserted by pgTAP (before/after counts equal).
- **After any migration, regen types** → write `packages/supabase/src/types.generated.ts` and commit.
- **Permission gate (verified):** `has_permission(v_caller, 'purchasing.po.create')`.
- **Verified facts:** PO number = `'PO-' || to_char(order_date,'YYYYMMDD') || '-' || lpad(nextval('purchase_orders_seq')::text,4,'0')`. `purchase_orders` money cols: `subtotal, vat_amount, total_amount`. `purchase_order_items` cols: `quantity, received_quantity, unit, unit_cost, subtotal, unit_factor_to_base`. `receive_purchase_order_v2` rejects `status NOT IN ('pending','partial')`; `cancel_purchase_order_v1` rejects `status='received'`; `record_po_payment_v1` has **no** status guard → needs the trigger.
- **Files under 500 lines**, tests co-located in `__tests__/`, conventional commits, co-author Claude.
- **Branch:** `feat/bulk-import-purchases` (already created; spec committed there).
- **Backoffice package filter is `@breakery/app-backoffice`** (NOT `@breakery/backoffice`). Test: `pnpm --filter @breakery/app-backoffice test <pattern>`; build: `pnpm --filter @breakery/app-backoffice build`.

---

## File Structure

New (DB):
- `supabase/migrations/20260708000010_create_purchases_import_flag_and_rpc.sql` — columns + index + `import_purchases_v1`.
- `supabase/migrations/20260708000011_block_payment_on_historical_po.sql` — trigger on `purchase_payments`.

New (front-end):
- `apps/backoffice/src/features/purchasing/import/purchasesImportDef.ts`
- `apps/backoffice/src/features/purchasing/hooks/useHistoricalPurchasesExport.ts`
- `apps/backoffice/src/features/purchasing/__tests__/purchasesImportDef.smoke.test.ts`

Modified:
- `apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx`
- `packages/supabase/src/types.generated.ts` (regen)
- `CLAUDE.md` (Active Workplan note)

Reused unchanged: the entire `apps/backoffice/src/features/data-import/` framework (`ImportEntityModal`, `EntitySummaryGrid`, `parseEntityWorkbook`, `buildTemplateWorkbook`/`buildExportWorkbook`/`downloadWorkbook`, `useImportEntity`).

---

## Task 1: Migration — historical-import columns + `import_purchases_v1` RPC

**Files:**
- Create: `supabase/migrations/20260708000010_create_purchases_import_flag_and_rpc.sql`
- Modify (controller): `packages/supabase/src/types.generated.ts`

**Interfaces:**
- Consumes (DB): `purchase_orders`, `purchase_order_items`, `suppliers`, `products`, `purchase_orders_seq`, `import_master_data_idempotency_keys`, `has_permission`, `audit_logs`.
- Produces (DB): columns `purchase_orders.is_historical_import boolean`, `purchase_orders.import_reference text`; function `public.import_purchases_v1(p_payload jsonb, p_dry_run boolean, p_idempotency_key uuid) returns jsonb`.
- Return JSON shape: `{ valid, errors:[{sheet,row,sku,code,message}], summary:{Purchases:{purchase_orders_created,line_items_created}}, idempotent_replay }`.

- [ ] **Step 1: Author the migration SQL**

```sql
-- 20260708000010_create_purchases_import_flag_and_rpc.sql
-- Phase 2a historical purchases bulk import. Direct insert of received POs + items,
-- grouped by po_reference. NO GRN, NO stock_movement, NO JE (reports-only).
-- Gate purchasing.po.create. Idempotency S25 flavor 2. Anon defense-in-depth S20.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS is_historical_import BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS import_reference TEXT;

COMMENT ON COLUMN purchase_orders.is_historical_import IS
  'TRUE = inserted via import_purchases_v1 (reports-only, no GRN/stock/JE). Blocks live receive/pay.';
COMMENT ON COLUMN purchase_orders.import_reference IS
  'User-supplied po_reference grouping key from the import file (traceability).';

CREATE INDEX IF NOT EXISTS idx_po_historical_import
  ON purchase_orders (is_historical_import) WHERE is_historical_import;

CREATE OR REPLACE FUNCTION public.import_purchases_v1(
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
  g           RECORD;
  v_po_id     UUID;
  v_po_number TEXT;
  v_supplier  UUID;
  v_subtotal  NUMERIC;
  v_terms     TEXT;
  v_date      DATE;
  v_notes     TEXT;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'purchasing.po.create') THEN
    RAISE EXCEPTION 'permission denied: purchasing.po.create required' USING ERRCODE = '42501';
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

  DROP TABLE IF EXISTS t_line, t_err;

  CREATE TEMP TABLE t_line ON COMMIT DROP AS
  SELECT ord::INT                                       AS row_num,
         NULLIF(trim(elt->>'po_reference'), '')         AS po_reference,
         NULLIF(trim(elt->>'supplier_code'), '')        AS supplier_code,
         NULLIF(trim(elt->>'order_date'), '')           AS order_date,
         COALESCE(NULLIF(trim(elt->>'payment_terms'),''),'credit') AS payment_terms,
         NULLIF(elt->>'notes', '')                      AS notes,
         NULLIF(trim(elt->>'product_sku'), '')          AS product_sku,
         (elt->>'quantity')::NUMERIC                    AS quantity,
         (elt->>'unit_cost')::NUMERIC                   AS unit_cost,
         NULLIF(trim(elt->>'unit'), '')                 AS unit
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  -- per-line validation
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'missing_required',
         'po_reference, supplier_code, order_date, product_sku, quantity, unit_cost, unit are required'
    FROM t_line WHERE po_reference IS NULL OR supplier_code IS NULL OR order_date IS NULL
       OR product_sku IS NULL OR quantity IS NULL OR unit_cost IS NULL OR unit IS NULL;
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_amount',
         'quantity and unit_cost must be greater than 0'
    FROM t_line WHERE (quantity IS NOT NULL AND quantity <= 0) OR (unit_cost IS NOT NULL AND unit_cost <= 0);
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_date',
         format('order_date "%s" must be YYYY-MM-DD', order_date)
    FROM t_line WHERE order_date IS NOT NULL AND order_date !~ '^\d{4}-\d{2}-\d{2}$';
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_payment_terms',
         format('payment_terms "%s" must be cash or credit', payment_terms)
    FROM t_line WHERE payment_terms NOT IN ('cash', 'credit');
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_unit',
         'unit must be 1..16 characters'
    FROM t_line WHERE unit IS NOT NULL AND char_length(unit) NOT BETWEEN 1 AND 16;
  INSERT INTO t_err SELECT 'Purchases', l.row_num, l.supplier_code, 'unknown_supplier',
         format('supplier_code "%s" not found', l.supplier_code)
    FROM t_line l WHERE l.supplier_code IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.code = l.supplier_code AND s.deleted_at IS NULL);
  INSERT INTO t_err SELECT 'Purchases', l.row_num, l.product_sku, 'unknown_product',
         format('product_sku "%s" not found', l.product_sku)
    FROM t_line l WHERE l.product_sku IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = l.product_sku AND p.deleted_at IS NULL);
  -- header consistency per po_reference group
  INSERT INTO t_err SELECT 'Purchases', MIN(row_num), po_reference, 'inconsistent_header',
         format('po_reference "%s" has inconsistent supplier_code/order_date/payment_terms across its rows', po_reference)
    FROM t_line WHERE po_reference IS NOT NULL
    GROUP BY po_reference
    HAVING COUNT(DISTINCT supplier_code) > 1 OR COUNT(DISTINCT order_date) > 1
        OR COUNT(DISTINCT payment_terms) > 1;

  SELECT jsonb_build_object('Purchases', jsonb_build_object(
    'purchase_orders_created', (SELECT COUNT(DISTINCT po_reference) FROM t_line WHERE po_reference IS NOT NULL),
    'line_items_created',      (SELECT COUNT(*) FROM t_line WHERE po_reference IS NOT NULL)
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

  -- writes: one PO per po_reference group; status='received', no GRN/stock/JE
  FOR g IN SELECT po_reference, MIN(row_num) AS first_row
             FROM t_line GROUP BY po_reference ORDER BY MIN(row_num) LOOP
    SELECT s.id INTO v_supplier
      FROM t_line l JOIN suppliers s ON s.code = l.supplier_code AND s.deleted_at IS NULL
     WHERE l.po_reference = g.po_reference LIMIT 1;
    SELECT (SELECT payment_terms FROM t_line WHERE po_reference = g.po_reference LIMIT 1),
           (SELECT order_date::DATE FROM t_line WHERE po_reference = g.po_reference LIMIT 1),
           (SELECT notes FROM t_line WHERE po_reference = g.po_reference AND notes IS NOT NULL LIMIT 1),
           (SELECT SUM(quantity * unit_cost) FROM t_line WHERE po_reference = g.po_reference)
      INTO v_terms, v_date, v_notes, v_subtotal;

    v_po_number := 'PO-' || to_char(v_date, 'YYYYMMDD') || '-'
                || lpad(nextval('purchase_orders_seq')::TEXT, 4, '0');

    INSERT INTO purchase_orders (
      po_number, supplier_id, status, payment_terms, subtotal, vat_amount, total_amount,
      order_date, received_date, notes, is_historical_import, import_reference,
      created_by, received_by
    ) VALUES (
      v_po_number, v_supplier, 'received', v_terms, v_subtotal, 0, v_subtotal,
      v_date, v_date, v_notes, TRUE, g.po_reference, v_caller, v_caller
    ) RETURNING id INTO v_po_id;

    INSERT INTO purchase_order_items (
      po_id, product_id, quantity, received_quantity, unit, unit_cost, subtotal, unit_factor_to_base
    )
    SELECT v_po_id, p.id, l.quantity, l.quantity, l.unit, l.unit_cost, l.quantity * l.unit_cost, 1
      FROM t_line l JOIN products p ON p.sku = l.product_sku AND p.deleted_at IS NULL
     WHERE l.po_reference = g.po_reference;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller, 'purchases.imported', 'purchase_order', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'purchases', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.import_purchases_v1(JSONB, BOOLEAN, UUID) IS
  'Phase 2a bulk import — historical purchases grouped by po_reference, inserted as received POs (reports-only, no GRN/stock/JE). Gate purchasing.po.create.';

REVOKE ALL ON FUNCTION public.import_purchases_v1(JSONB, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_purchases_v1(JSONB, BOOLEAN, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_purchases_v1(JSONB, BOOLEAN, UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: (Controller) Verify NOT-NULL columns without defaults before applying**

Run via MCP `execute_sql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='purchase_orders'
  AND is_nullable='NO' AND column_default IS NULL
  AND column_name NOT IN ('id','po_number','supplier_id','status','payment_terms',
        'subtotal','vat_amount','total_amount','order_date','is_historical_import');
```
Expected: empty. If any column is returned (e.g. `metadata`), add it to the INSERT with a sensible default (`metadata` → `'{}'::jsonb`) before applying.

- [ ] **Step 3: (Controller) Apply the migration via MCP**

`mcp__plugin_supabase_supabase__apply_migration` with `project_id='ikcyvlovptebroadgtvd'`, `name='create_purchases_import_flag_and_rpc'`, body = the SQL above. Expected: applies without error.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/20260708000010_create_purchases_import_flag_and_rpc.sql
git commit -m "feat(db): import_purchases_v1 RPC + historical-import flag (reports-only)"
```

- [ ] **Step 5: (Controller) pgTAP via MCP `execute_sql` (BEGIN/ROLLBACK)**

Use the project's pgTAP auth-impersonation helper so `auth.uid()` resolves to a user holding `purchasing.po.create` (see `supabase/tests/inventory.test.sql` for the `request.jwt.claims` pattern). Replace `:sup`/`:sku` with a real live supplier `code` and product `sku` queried first.

```sql
BEGIN;
SELECT plan(8);

-- baseline ledger counts (reports-only guarantee)
CREATE TEMP TABLE _b AS SELECT
  (SELECT COUNT(*) FROM stock_movements)     AS sm,
  (SELECT COUNT(*) FROM goods_receipt_notes) AS grn,
  (SELECT COUNT(*) FROM journal_entries)     AS je;

-- 1. dry-run writes nothing
SELECT is(
  (import_purchases_v1(
     format('[{"po_reference":"R1","supplier_code":"%s","order_date":"2026-01-15","product_sku":"%s","quantity":2,"unit_cost":1000,"unit":"kg"}]', :'sup', :'sku')::jsonb,
     TRUE, NULL) ->> 'valid'), 'true', 'dry-run valid');
SELECT is((SELECT COUNT(*)::int FROM purchase_orders WHERE import_reference = 'R1'), 0, 'dry-run created no PO');

-- 2. valid commit creates one received PO with the flag
SELECT is(
  (import_purchases_v1(
     format('[{"po_reference":"R1","supplier_code":"%s","order_date":"2026-01-15","product_sku":"%s","quantity":2,"unit_cost":1000,"unit":"kg"},{"po_reference":"R1","supplier_code":"%s","order_date":"2026-01-15","product_sku":"%s","quantity":1,"unit_cost":500,"unit":"kg"}]', :'sup', :'sku', :'sup', :'sku')::jsonb,
     FALSE, '33333333-3333-3333-3333-333333333333'::uuid) ->> 'valid'), 'true', 'commit valid');
SELECT is((SELECT COUNT(*)::int FROM purchase_orders WHERE import_reference = 'R1' AND status='received' AND is_historical_import), 1, 'one received historical PO');
SELECT is((SELECT COUNT(*)::int FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE po.import_reference='R1'), 2, 'two line items');

-- 3. reports-only: ledger untouched
SELECT is(
  (SELECT (sm,grn,je) FROM _b)::text,
  ((SELECT COUNT(*) FROM stock_movements), (SELECT COUNT(*) FROM goods_receipt_notes), (SELECT COUNT(*) FROM journal_entries))::text,
  'no stock_movement / GRN / JE written');

-- 4. idempotent replay
SELECT is(
  (import_purchases_v1(
     format('[{"po_reference":"R1","supplier_code":"%s","order_date":"2026-01-15","product_sku":"%s","quantity":2,"unit_cost":1000,"unit":"kg"}]', :'sup', :'sku')::jsonb,
     FALSE, '33333333-3333-3333-3333-333333333333'::uuid) ->> 'idempotent_replay'), 'true', 'same key replays');

-- 5. unknown supplier → invalid
SELECT is(
  (import_purchases_v1('[{"po_reference":"R2","supplier_code":"__nope__","order_date":"2026-01-15","product_sku":"x","quantity":1,"unit_cost":1,"unit":"kg"}]'::jsonb, TRUE, NULL) ->> 'valid'),
  'false', 'unknown supplier invalid');

SELECT finish();
ROLLBACK;
```
Also assert anon denial:
```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT import_purchases_v1('[]'::jsonb, TRUE, NULL) $$, '42501');
ROLLBACK;
```
Expected: all pass. Fix the migration and re-apply if any fail.

- [ ] **Step 6: (Controller) Regen types + commit**

Run MCP `generate_typescript_types` (project `ikcyvlovptebroadgtvd`), write to `packages/supabase/src/types.generated.ts`.
```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): regen after import_purchases_v1 + historical-import columns"
```

---

## Task 2: Migration — block payment on a historical-import PO

**Files:**
- Create: `supabase/migrations/20260708000011_block_payment_on_historical_po.sql`

**Interfaces:**
- Consumes (DB): `purchase_payments` (column `po_id`), `purchase_orders.is_historical_import` (Task 1).
- Produces (DB): trigger function `tr_block_payment_on_historical_po()` + `BEFORE INSERT` trigger `trg_block_payment_on_historical_po` on `purchase_payments`.

- [ ] **Step 1: (Controller) Confirm the FK column name on `purchase_payments`**

Run via MCP `execute_sql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='purchase_payments' AND column_name IN ('po_id','purchase_order_id');
```
Expected: `po_id`. If it is `purchase_order_id`, substitute that name in the SQL below before authoring.

- [ ] **Step 2: Author the migration SQL**

```sql
-- 20260708000011_block_payment_on_historical_po.sql
-- Defense: a historical-import PO (reports-only) must never receive a recorded payment,
-- which would post a payment JE. receive/cancel are already blocked by their status guards.

CREATE OR REPLACE FUNCTION public.tr_block_payment_on_historical_po()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_orders
              WHERE id = NEW.po_id AND is_historical_import) THEN
    RAISE EXCEPTION 'cannot record a payment on a historical-import purchase order'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_payment_on_historical_po ON purchase_payments;
CREATE TRIGGER trg_block_payment_on_historical_po
  BEFORE INSERT ON purchase_payments
  FOR EACH ROW EXECUTE FUNCTION tr_block_payment_on_historical_po();

COMMENT ON TRIGGER trg_block_payment_on_historical_po ON purchase_payments IS
  'Phase 2a — blocks payments against reports-only historical-import POs (no payment JE).';
```

- [ ] **Step 3: (Controller) Apply via MCP**

`apply_migration` `project_id='ikcyvlovptebroadgtvd'`, `name='block_payment_on_historical_po'`, body = SQL above. Expected: applies cleanly.

- [ ] **Step 4: (Controller) pgTAP via MCP `execute_sql` (BEGIN/ROLLBACK)**

```sql
BEGIN;
SELECT plan(1);
-- Insert a historical PO directly, then assert record_po_payment_v1 raises.
-- Use the auth helper to impersonate a user with purchasing.po.pay.
-- Replace :sup with a real supplier code.
WITH po AS (
  INSERT INTO purchase_orders (po_number, supplier_id, status, payment_terms,
      subtotal, vat_amount, total_amount, order_date, received_date, is_historical_import)
  SELECT 'PO-TEST-HIST-0001', s.id, 'received', 'credit', 1000, 0, 1000,
         '2026-01-15', '2026-01-15', TRUE
    FROM suppliers s WHERE s.code = :'sup' AND s.deleted_at IS NULL LIMIT 1
  RETURNING id
)
SELECT throws_ok(
  format($q$ SELECT record_po_payment_v1('%s'::uuid, 1000, 'cash', 'x', gen_random_uuid()) $q$, (SELECT id FROM po)),
  'P0001', 'payment on historical PO is blocked');
SELECT finish();
ROLLBACK;
```
Expected: pass. (No type regen needed — no schema/function signature change visible to the client.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260708000011_block_payment_on_historical_po.sql
git commit -m "feat(db): block payments on historical-import purchase orders"
```

---

## Task 3: `purchasesImportDef` + round-trip test

**Files:**
- Create: `apps/backoffice/src/features/purchasing/import/purchasesImportDef.ts`
- Test: `apps/backoffice/src/features/purchasing/__tests__/purchasesImportDef.smoke.test.ts`

**Interfaces:**
- Consumes: `EntityImportDef` from `@/features/data-import/entityImportDef.js`; the PO list query key (verify its exact export name/value in `PurchaseOrdersListPage.tsx` imports — Step 1).
- Produces: `export const purchasesImportDef: EntityImportDef`.

- [ ] **Step 1: Find the PO list query key**

Run: `grep -rnE "queryKey|QUERY_KEY|usePurchaseOrders" apps/backoffice/src/features/purchasing/hooks/ apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx | head`
Note the exact query-key constant or literal the list uses (e.g. `['purchase-orders', …]`). Use it verbatim in `queryKeysToInvalidate` below; if no exported constant exists, use the literal array the list query uses (the prefix is enough for invalidation, e.g. `['purchase-orders']`).

- [ ] **Step 2: Write the failing test**

```ts
// apps/backoffice/src/features/purchasing/__tests__/purchasesImportDef.smoke.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { purchasesImportDef } from '@/features/purchasing/import/purchasesImportDef.js';
import { buildTemplateWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { parseEntityWorkbook } from '@/features/data-import/parseEntityWorkbook.js';

describe('purchasesImportDef', () => {
  it('template round-trips with the required line columns', () => {
    const buf = XLSX.write(buildTemplateWorkbook(purchasesImportDef), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { rows, structureErrors } = parseEntityWorkbook(buf, purchasesImportDef);
    expect(structureErrors).toEqual([]);
    expect(rows[0]?.po_reference).toBe('PO-2026-001');
    expect(rows[0]?.quantity).toBe(10);
    expect(rows[0]?.unit_cost).toBe(12000);
  });

  it('parses two grouped lines as two flat rows', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['po_reference','supplier_code','order_date','payment_terms','notes','product_sku','quantity','unit_cost','unit'],
      ['PO-A','SUP-FLOUR','2026-01-10','credit','','SKU-1','5','1000','kg'],
      ['PO-A','SUP-FLOUR','2026-01-10','credit','','SKU-2','3','2000','kg'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Purchases');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { rows, structureErrors } = parseEntityWorkbook(buf, purchasesImportDef);
    expect(structureErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.product_sku)).toEqual(['SKU-1', 'SKU-2']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @breakery/app-backoffice test purchasesImportDef`
Expected: FAIL — cannot find module `purchasesImportDef.js`.

- [ ] **Step 4: Write `purchasesImportDef.ts`**

```ts
// apps/backoffice/src/features/purchasing/import/purchasesImportDef.ts
// Historical purchases import: one Excel row = one PO line, grouped by po_reference server-side.
import type { EntityImportDef } from '@/features/data-import/entityImportDef.js';

export const purchasesImportDef: EntityImportDef = {
  entity: 'purchases',
  sheetName: 'Purchases',
  rpcName: 'import_purchases_v1',
  columns: [
    { key: 'po_reference',  required: true,  type: 'text' },
    { key: 'supplier_code', required: true,  type: 'text' },
    { key: 'order_date',    required: true,  type: 'text' },
    { key: 'payment_terms', required: false, type: 'text' },
    { key: 'notes',         required: false, type: 'text' },
    { key: 'product_sku',   required: true,  type: 'text' },
    { key: 'quantity',      required: true,  type: 'number' },
    { key: 'unit_cost',     required: true,  type: 'number' },
    { key: 'unit',          required: true,  type: 'text' },
  ],
  example: {
    po_reference: 'PO-2026-001', supplier_code: 'SUP-FLOUR', order_date: '2026-01-15',
    payment_terms: 'credit', product_sku: 'SKU-FLOUR-25', quantity: 10, unit_cost: 12000, unit: 'kg',
  },
  // Use the verbatim key from Step 1; the prefix below is the documented fallback.
  queryKeysToInvalidate: [['purchase-orders']],
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-backoffice test purchasesImportDef`
Expected: PASS (2 tests). If Step 1 found a different query key, update `queryKeysToInvalidate` (tests still pass — they don't assert the key).

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/features/purchasing/import/purchasesImportDef.ts \
        apps/backoffice/src/features/purchasing/__tests__/purchasesImportDef.smoke.test.ts
git commit -m "feat(purchasing): purchasesImportDef for historical import"
```

---

## Task 4: Historical purchases export hook

**Files:**
- Create: `apps/backoffice/src/features/purchasing/hooks/useHistoricalPurchasesExport.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase.js`.
- Produces: `function useHistoricalPurchasesExport()` → TanStack mutation returning `Record<string, unknown>[]` (one row per line item, shaped to the `purchasesImportDef` columns).

- [ ] **Step 1: Write `useHistoricalPurchasesExport.ts`**

```ts
// apps/backoffice/src/features/purchasing/hooks/useHistoricalPurchasesExport.ts
// One-shot fetch of historical-import POs (is_historical_import=true), flattened to the
// import template column shape: one row per line item, po_reference = import_reference.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

const SELECT = `
  import_reference, order_date, payment_terms, notes,
  suppliers!inner(code),
  purchase_order_items(unit, quantity, unit_cost, products!inner(sku))
`.replace(/\s+/g, ' ').trim();

interface RawItem { unit: string; quantity: number; unit_cost: number; products: { sku: string } | { sku: string }[] | null }
interface RawRow {
  import_reference: string | null;
  order_date: string | null;
  payment_terms: string;
  notes: string | null;
  suppliers: { code: string } | { code: string }[] | null;
  purchase_order_items: RawItem[];
}

function one<T extends object>(v: T | T[] | null): T | null {
  if (v === null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export function useHistoricalPurchasesExport() {
  return useMutation<Record<string, unknown>[], Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(SELECT)
        .eq('is_historical_import', true)
        .is('deleted_at', null)
        .order('order_date', { ascending: true });
      if (error !== null) throw new Error(error.message);
      const out: Record<string, unknown>[] = [];
      for (const po of (data ?? []) as unknown as RawRow[]) {
        const supplierCode = one(po.suppliers)?.code ?? null;
        for (const it of po.purchase_order_items) {
          out.push({
            po_reference: po.import_reference,
            supplier_code: supplierCode,
            order_date: po.order_date,
            payment_terms: po.payment_terms,
            notes: po.notes,
            product_sku: one(it.products)?.sku ?? null,
            quantity: it.quantity,
            unit_cost: it.unit_cost,
            unit: it.unit,
          });
        }
      }
      return out;
    },
  });
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm --filter @breakery/app-backoffice exec tsc --noEmit -p tsconfig.json`
Expected: no new errors referencing `useHistoricalPurchasesExport.ts`. (If the embed alias `suppliers!inner` is ambiguous because `purchase_orders` has one FK to `suppliers`, it resolves fine; if tsc complains about the generated relation type, fall back to `supplier:suppliers(code)` and read `one(po.supplier)`.)

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/purchasing/hooks/useHistoricalPurchasesExport.ts
git commit -m "feat(purchasing): historical purchases export hook"
```

---

## Task 5: Wire the Purchase Orders list page

**Files:**
- Modify: `apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx`

**Interfaces:**
- Consumes: `purchasesImportDef` (Task 3), `useHistoricalPurchasesExport` (Task 4), `ImportEntityModal` + `buildTemplateWorkbook`/`buildExportWorkbook`/`downloadWorkbook` (framework), the page's existing `canCreate`/permission helper and row model.

- [ ] **Step 1: Read the page to locate the header action area and permission gate**

Run: `grep -nE "canCreate|hasPermission|purchasing.po|<Button|header|Toolbar|return \(|POStatusBadge|status" apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx | head -40`
Identify: (a) the JSX region rendering the page-header action buttons, (b) the permission flag for creating POs (mirror it as `canImport`, gating on `purchasing.po.create`), (c) where each row's status badge renders (for the "Imported" badge).

- [ ] **Step 2: Add imports**

Add near the existing feature imports:
```tsx
import { toast } from 'sonner';
import { FileText, Upload, Download } from 'lucide-react';
import { ImportEntityModal } from '@/features/data-import/components/ImportEntityModal.js';
import { buildTemplateWorkbook, buildExportWorkbook, downloadWorkbook } from '@/features/data-import/buildEntityWorkbook.js';
import { purchasesImportDef } from '@/features/purchasing/import/purchasesImportDef.js';
import { useHistoricalPurchasesExport } from '@/features/purchasing/hooks/useHistoricalPurchasesExport.js';
import { Badge } from '@breakery/ui';
```
(Drop any icon already imported by the file to avoid duplicate import errors — check the existing `lucide-react` import line first.)

- [ ] **Step 3: Add state + handlers**

Inside the component, next to existing `useState` calls:
```tsx
const [importing, setImporting] = useState<boolean>(false);
const exportMut = useHistoricalPurchasesExport();

function handleTemplate(): void {
  downloadWorkbook(buildTemplateWorkbook(purchasesImportDef), 'breakery-purchases-template.xlsx');
}
async function handleExport(): Promise<void> {
  try {
    const rows = await exportMut.mutateAsync();
    if (rows.length === 0) { toast.info('No historical imports to export yet'); return; }
    downloadWorkbook(
      buildExportWorkbook(purchasesImportDef, rows),
      `breakery-purchases-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  } catch (e) {
    toast.error(`Export failed: ${(e as Error).message}`);
  }
}
```

- [ ] **Step 4: Add the buttons to the page header action area**

In the header action region located in Step 1:
```tsx
<Button variant="ghost" size="sm" onClick={handleTemplate} aria-label="Download purchases template">
  <FileText className="h-4 w-4" aria-hidden /> Template
</Button>
{canCreate && (
  <Button variant="ghost" size="sm" onClick={() => setImporting(true)} aria-label="Import historical purchases">
    <Upload className="h-4 w-4" aria-hidden /> Import
  </Button>
)}
<Button variant="ghost" size="sm" onClick={() => void handleExport()} disabled={exportMut.isPending} aria-label="Export historical purchases">
  <Download className="h-4 w-4" aria-hidden /> {exportMut.isPending ? 'Exporting…' : 'Export'}
</Button>
```
(Use the page's existing create-permission flag name for `canCreate`; if it is named differently, e.g. `canCreatePo`, use that.)

- [ ] **Step 5: Add the "Imported" badge next to the status of historical rows**

Where each row's status renders (Step 1):
```tsx
{row.is_historical_import && (
  <Badge variant="secondary" className="ml-2">Imported</Badge>
)}
```
(If the row type doesn't yet expose `is_historical_import`, add it to the list query's `select` and the row TS type — the column now exists after Task 1. Find the select in the list hook via `grep -n "select(" apps/backoffice/src/features/purchasing/hooks/*.ts`.)

- [ ] **Step 6: Render the modal**

Before the component's final closing tag:
```tsx
<ImportEntityModal
  open={importing}
  onClose={() => setImporting(false)}
  def={purchasesImportDef}
  title="Import historical purchases"
  description="Upload a filled .xlsx template. Rows are grouped by po_reference into received purchase orders for reporting only — no stock movement, no accounting entry. The file is validated before any writes."
/>
```

- [ ] **Step 7: Typecheck + build**

Run: `pnpm --filter @breakery/app-backoffice build`
Expected: `tsc -b` + vite build succeed.

- [ ] **Step 8: Commit**

```bash
git add apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx
git commit -m "feat(purchasing): wire Template/Import/Export + Imported badge on PO list"
```

---

## Task 6: Final verification + workplan note

- [ ] **Step 1: Targeted tests**

Run: `pnpm --filter @breakery/app-backoffice test purchasesImportDef --reporter=basic`
Expected: PASS.

- [ ] **Step 2: Full backoffice suite + build**

Run: `pnpm --filter @breakery/app-backoffice test --reporter=basic` then `pnpm --filter @breakery/app-backoffice build`
Expected: PASS (modulo the project's known env-gated baseline — do not conflate with regressions) and a clean build.

- [ ] **Step 3: Manual smoke (optional, controller)**

Launch the backoffice, open Purchase Orders → Template, fill 2 lines sharing one `po_reference` + 1 line with another → Import → verify the dry-run preview shows `purchase_orders_created: 2`, confirm, see the list refresh with two "Imported" POs in `received` status. Verify Export downloads a round-trip-able file containing only the historical imports.

- [ ] **Step 4: Update CLAUDE.md Active Workplan note (1 line)**

Update the "In flight" line to note Phase 2a (historical purchases bulk import) shipped on `feat/bulk-import-purchases`, and that Sales + Expenses remain as later Phase 2 specs. Commit:
```bash
git add CLAUDE.md
git commit -m "docs: note Phase 2a historical purchases bulk-import shipped"
```

---

## Self-Review

**Spec coverage:**
- Reports-only landing (spec §2) → Task 1 (insert received POs, no GRN/stock/JE) + Task 1 Step 5 ledger-count assertion. ✓
- Schema flag + dedicated `import_reference` column (spec §3, open-item a) → Task 1 Step 1. ✓
- Grouped-by-`po_reference` Excel model (spec §4) → Task 3 def + Task 1 RPC server-side grouping. ✓
- RPC contract + idempotency + anon defense-in-depth + gate (spec §5) → Task 1. ✓
- Live-flow guards (spec §6) → Task 2 (payment trigger); receive/cancel already blocked by status guards (verified — documented in Global Constraints). ✓
- UI wiring + framework reuse (spec §7) → Tasks 3-5. ✓
- Export = only historical imports (spec open-item b) → Task 4 (`.eq('is_historical_import', true)`). ✓
- Tests: Vitest round-trip + multi-line, pgTAP incl. reports-only + idempotency + anon (spec §8) → Tasks 1, 2, 3, 6. ✓
- Out of scope: Sales/Expenses, live posting, catalog-import refactor (spec §9) → untouched. ✓

**Placeholder scan:** No TBD/TODO. The two `grep` location steps (Task 3 Step 1, Task 5 Step 1) are concrete discovery actions with documented fallbacks, not deferred work. pgTAP impersonation delegates to the established project helper.

**Type consistency:** `EntityImportDef` shape matches Phase 1 (entity/sheetName/rpcName/columns/example/queryKeysToInvalidate). RPC return `{valid,errors,summary,idempotent_replay}` = `ImportReport`. Summary key `Purchases` consumed generically by `EntitySummaryGrid`. Export rows are keyed exactly by the `purchasesImportDef` column keys so `buildExportWorkbook` round-trips. RPC arg order `(p_payload, p_dry_run, p_idempotency_key)` matches `useImportEntity`'s call.

**Known assumptions flagged in-task:**
- `purchase_orders` has no NOT-NULL-without-default column beyond those inserted (Task 1 Step 2 verifies; `metadata` handled if present).
- `purchase_payments` FK column is `po_id` (Task 2 Step 1 verifies).
- PO list query key + create-permission flag names (Task 3 Step 1, Task 5 Step 1 verify).
