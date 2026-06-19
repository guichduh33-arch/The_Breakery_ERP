# Configurable Combos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-bundle combo model with configurable combos (choice groups: single/multi, required/optional, per-option surcharge + default), with a back-office builder and a POS configuration flow that sells a combo as one order line while deducting each chosen component's stock.

**Architecture:** A combo stays a `products` row (`product_type='combo'`). Two new tables (`combo_groups`, `combo_group_options`) hold its choice structure. Writes go through `upsert_combo_v1` / `delete_combo_v1` SECURITY DEFINER RPCs. At POS a combo is configured in a modal and rides into the cart as one line whose chosen options are stored in the existing `order_items.modifiers` JSONB snapshot; the sale RPC is bumped `v12 → v13` to deduct the chosen **components'** stock instead of the (virtual) combo product.

**Tech Stack:** Supabase Postgres (cloud V3 dev `ikcyvlovptebroadgtvd`, MCP-applied migrations), pgTAP, React 18 + TanStack Query v5 + Zustand, Vitest, `@breakery/domain` (IO-free), Tailwind + `@breakery/ui`.

## Global Constraints

- **DB target = Supabase cloud V3 dev `ikcyvlovptebroadgtvd`** via MCP (`apply_migration` / `execute_sql` / `generate_typescript_types`). Docker is retired — never run `supabase start` / `db reset` / `run_pgtap.sh`.
- **Migration numbering monotone.** Prior max NAME-block ends `20260701000019` (Session 46). This session uses NAME-block **`20260702000010..0NN`**. Verify with `list_migrations` before applying; pick the next free number.
- **RPC versioning monotone** — never edit a published `_vN` signature; create `_vN+1` and `DROP FUNCTION ... vN(<old args>)` in the same migration.
- **Anon defense-in-depth** — every new RPC gets the canonical pair: `REVOKE EXECUTE ... FROM PUBLIC` **and** `FROM anon`, plus `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` where the migration creates functions. New tables get `ENABLE ROW LEVEL SECURITY` + an `auth_read` SELECT policy + no write policy.
- **Subagents cannot reach Supabase MCP** — the db-engineer authors SQL; the controller applies migrations, runs pgTAP (BEGIN/ROLLBACK envelope), regenerates types, and writes `packages/supabase/src/types.generated.ts`. After ANY schema change, regen types and commit.
- **`packages/domain` is IO-free** — no fetch/Supabase/React.
- **Money** rounds via the server `round_idr(numeric)` helper; client uses existing IDR formatting.
- **`@breakery/ui` has no `Select`/`SelectItem`/`RadioGroup` exports** — use native `<select>` and button-group fallbacks.
- **Conventional commits**, scope `db|domain|backoffice|pos|inventory`. Co-author Claude on AI-assisted commits.
- **Permission to add:** `products.combos.write` (MANAGER/ADMIN/SUPER_ADMIN). Extend the `PermissionCode` union in `packages/supabase/src/rls/permissions.ts`.

---

## File Structure

**Wave A (DB)** — `supabase/migrations/20260702000010..0NN_*.sql`, `supabase/tests/combo_crud.test.sql`, `supabase/tests/combo_sale.test.sql`, `supabase/tests/combo_migration.test.sql`, `supabase/tests/combo_reversal.test.sql`, regen `packages/supabase/src/types.generated.ts`, `packages/supabase/src/rls/permissions.ts`.

**Wave B (domain)** — `packages/domain/src/combos/types.ts` (rewrite), `packages/domain/src/combos/pricing.ts` (new), `packages/domain/src/combos/validateSelection.ts` (new), `packages/domain/src/combos/index.ts`, co-located `__tests__/`.

**Wave C (back-office)** — `apps/backoffice/src/features/combos/` (types, hooks `useCombos`/`useComboDetail`/`useUpsertCombo`/`useDeleteCombo`, components `ComboBuilderPage`, `GeneralInfoSection`, `PricePreview`, `ChoiceGroupCard`, `ComboOptionRow`, `ComboProductPicker`), `apps/backoffice/src/pages/products/CombosPage.tsx` (rewire), `apps/backoffice/src/routes/index.tsx` (routes).

**Wave D (POS)** — `apps/pos/src/features/combos/hooks/useComboConfig.ts` (new), `apps/pos/src/features/combos/components/ComboConfigModal.tsx` (new), `apps/pos/src/features/products/ProductTapHandler.tsx` (modify), `apps/pos/src/stores/cartStore.ts` + `packages/domain/src/cart/addItem.ts` + `packages/domain/src/types/cart.ts` (combo line), POS payload builders (`useFireToStations`, `useCheckout`), `supabase/functions/process-payment/index.ts` (forward `combo_components`).

**Wave E** — `docs/workplan/plans/2026-06-19-session-47-INDEX.md`, `CLAUDE.md` Active Workplan bump.

---

## WAVE A — Database

### Task A1: Schema — combo metadata columns + 2 tables + guards

**Files:**
- Create: `supabase/migrations/20260702000010_combo_schema.sql`
- Test: `supabase/tests/combo_crud.test.sql` (guard section only in this task)

**Interfaces:**
- Produces: tables `combo_groups(id, combo_product_id, name, group_type, is_required, min_select, max_select, sort_order, created_at)`, `combo_group_options(id, group_id, component_product_id, surcharge, is_default, sort_order, created_at)`; columns `products.combo_base_price`, `products.combo_available_from`, `products.combo_available_to`, `products.combo_display_order`; trigger `enforce_combo_option_rules()`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260702000010_combo_schema.sql
-- Session 47 / Wave A — configurable-combo schema (choice groups).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS combo_base_price     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS combo_available_from TIME,
  ADD COLUMN IF NOT EXISTS combo_available_to   TIME,
  ADD COLUMN IF NOT EXISTS combo_display_order  INTEGER NOT NULL DEFAULT 0;
-- "Show in POS" reuses the existing products.visible_on_pos (S27).

CREATE TABLE combo_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  group_type       TEXT NOT NULL CHECK (group_type IN ('single','multi')),
  is_required      BOOLEAN NOT NULL DEFAULT false,
  min_select       INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select       INTEGER NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_select <= max_select),
  CHECK (group_type <> 'single' OR max_select = 1),
  CHECK (NOT is_required OR min_select >= 1)
);
CREATE INDEX idx_combo_groups_combo ON combo_groups(combo_product_id, sort_order);

CREATE TABLE combo_group_options (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             UUID NOT NULL REFERENCES combo_groups(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  surcharge            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (surcharge >= 0),
  is_default           BOOLEAN NOT NULL DEFAULT false,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, component_product_id)
);
CREATE INDEX idx_combo_group_options_group ON combo_group_options(group_id, sort_order);

-- Parent-type guard: a group's combo must be product_type='combo'.
CREATE OR REPLACE FUNCTION enforce_combo_group_parent() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products
                 WHERE id = NEW.combo_product_id AND product_type = 'combo') THEN
    RAISE EXCEPTION 'combo_product_id must be a combo product'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_combo_groups_parent
  BEFORE INSERT OR UPDATE ON combo_groups
  FOR EACH ROW EXECUTE FUNCTION enforce_combo_group_parent();

-- Anti-nesting guard: an option cannot itself be a combo.
CREATE OR REPLACE FUNCTION enforce_combo_option_not_combo() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM products
             WHERE id = NEW.component_product_id AND product_type = 'combo') THEN
    RAISE EXCEPTION 'combo option cannot itself be a combo (no nested combos)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_combo_options_not_combo
  BEFORE INSERT OR UPDATE ON combo_group_options
  FOR EACH ROW EXECUTE FUNCTION enforce_combo_option_not_combo();

ALTER TABLE combo_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_group_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON combo_groups        FOR SELECT USING (is_authenticated());
CREATE POLICY "auth_read" ON combo_group_options FOR SELECT USING (is_authenticated());

REVOKE ALL ON combo_groups        FROM anon;
REVOKE ALL ON combo_group_options FROM anon;
```

- [ ] **Step 2: Apply via MCP (controller)**

Use `mcp__plugin_supabase_supabase__apply_migration` with `project_id='ikcyvlovptebroadgtvd'`, `name='combo_schema'`, body = the SQL above. First run `list_migrations` to confirm `20260702000010` is free; bump if not.

- [ ] **Step 3: Write the guard pgTAP (start `combo_crud.test.sql`)**

```sql
-- supabase/tests/combo_crud.test.sql  (guard section)
BEGIN;
SELECT plan(6);
-- seed a combo product + a finished product in a temp tx
INSERT INTO products (id, sku, name, category_id, retail_price, product_type)
  SELECT '00000000-0000-0000-0000-0000000c0001','T-COMBO','T Combo', c.id, 0, 'combo'
  FROM categories c LIMIT 1;
INSERT INTO products (id, sku, name, category_id, retail_price, product_type)
  SELECT '00000000-0000-0000-0000-0000000f0001','T-FIN','T Fin', c.id, 1000, 'finished'
  FROM categories c LIMIT 1;

-- T1 single ⇒ max_select must be 1
SELECT throws_ok($$
  INSERT INTO combo_groups (combo_product_id, name, group_type, max_select)
  VALUES ('00000000-0000-0000-0000-0000000c0001','G','single',2) $$,
  '23514', NULL, 'single group rejects max_select<>1');
-- T2 required ⇒ min_select>=1
SELECT throws_ok($$
  INSERT INTO combo_groups (combo_product_id, name, group_type, is_required, min_select)
  VALUES ('00000000-0000-0000-0000-0000000c0001','G','single',true,0) $$,
  '23514', NULL, 'required group rejects min_select 0');
-- T3 parent must be combo
SELECT throws_ok($$
  INSERT INTO combo_groups (combo_product_id, name, group_type)
  VALUES ('00000000-0000-0000-0000-0000000f0001','G','single') $$,
  'check_violation', NULL, 'parent must be combo');
-- T4 valid group inserts
PREPARE g AS INSERT INTO combo_groups (id, combo_product_id, name, group_type, is_required, min_select, max_select)
  VALUES ('00000000-0000-0000-0000-0000000g0001','00000000-0000-0000-0000-0000000c0001','Drinks','single',true,1,1);
SELECT lives_ok('EXECUTE g', 'valid single group inserts');
-- T5 option cannot be a combo
SELECT throws_ok($$
  INSERT INTO combo_group_options (group_id, component_product_id)
  VALUES ('00000000-0000-0000-0000-0000000g0001','00000000-0000-0000-0000-0000000c0001') $$,
  'check_violation', NULL, 'option cannot be a combo');
-- T6 valid option inserts
SELECT lives_ok($$
  INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default)
  VALUES ('00000000-0000-0000-0000-0000000g0001','00000000-0000-0000-0000-0000000f0001',0,true) $$,
  'valid option inserts');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run pgTAP via MCP (controller)**

Run the file body through `mcp__plugin_supabase_supabase__execute_sql`. Expected: `6/6` pass. (UUIDs above use non-hex chars `g` — replace with valid hex like `...0a0001` when authoring; keep them valid 8-4-4-4-12.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260702000010_combo_schema.sql supabase/tests/combo_crud.test.sql
git commit -m "feat(db): session 47 — combo choice-group schema + guards"
```

---

### Task A2: `upsert_combo_v1` RPC

**Files:**
- Create: `supabase/migrations/20260702000011_create_upsert_combo_v1.sql`
- Create: `supabase/migrations/20260702000012_revoke_anon_upsert_combo_v1.sql`
- Modify: `supabase/tests/combo_crud.test.sql` (add RPC section)

**Interfaces:**
- Produces: `upsert_combo_v1(p_combo jsonb, p_idempotency_key uuid) RETURNS jsonb` — returns `{ combo_product_id, sku, idempotent_replay }`. Payload shape:
  ```json
  {
    "combo_product_id": "uuid|null",   // null = create
    "sku": "string|null",              // null on create ⇒ auto-generate COMBO-<n>
    "name": "string", "description": "string|null", "image_url": "string|null",
    "category_id": "uuid", "base_price": 100000, "display_order": 0,
    "available_from": "07:00|null", "available_to": "11:00|null",
    "is_active": true, "visible_on_pos": true,
    "groups": [
      { "name":"Drinks","group_type":"single","is_required":true,"min_select":1,"max_select":1,"sort_order":0,
        "options":[ {"component_product_id":"uuid","surcharge":0,"is_default":true,"sort_order":0} ] }
    ]
  }
  ```

- [ ] **Step 1: Write the RPC migration**

Structure (SECURITY DEFINER, `SET search_path=public`):
1. `v_user := auth.uid()`; `NULL ⇒ P0001 Not authenticated`.
2. Gate: `IF NOT has_permission(v_user,'products.combos.write') THEN RAISE ... P0003`.
3. Idempotency (flavor 2): dedicated table `combo_upsert_idempotency_keys(key uuid PRIMARY KEY, combo_product_id uuid, created_at timestamptz default now())`. On replay return `{combo_product_id, sku, idempotent_replay:true}`.
4. Resolve combo product: if `combo_product_id` null ⇒ INSERT a `products` row with `product_type='combo'`, generated SKU (`'COMBO-'||lpad(nextval-ish, 3,'0')` — use `SELECT count(*)+1 FROM products WHERE product_type='combo'` then ensure uniqueness, retry suffix on 23505); else UPDATE the allowlisted columns (`name, description, image_url, category_id, retail_price := base_price, combo_base_price := base_price, combo_display_order, combo_available_from, combo_available_to, is_active, visible_on_pos`). Force `product_type='combo'`.
5. Validate invariants per group: `single ⇒ max_select=1`; `is_required ⇒ min_select>=1`; `single & required ⇒ exactly one option with is_default=true` (else `P0001 'single required group needs exactly one default'`); each group has ≥1 option; `min_select <= count(options)`; surcharges ≥ 0. Raise `P0001` with explicit messages.
6. REPLACE semantics: `DELETE FROM combo_groups WHERE combo_product_id = v_combo_id` (cascades options), then re-INSERT groups + options from the payload.
7. Audit: `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)` with `action='combo.upserted'`.
8. Record idempotency key; `RETURN jsonb_build_object('combo_product_id', v_combo_id, 'sku', v_sku, 'idempotent_replay', false)`.

Create the `combo_upsert_idempotency_keys` table at the top of this migration (RLS enabled, no policy, `REVOKE ALL FROM anon`).

- [ ] **Step 2: Write the REVOKE migration** (`_000012`)

```sql
REVOKE EXECUTE ON FUNCTION public.upsert_combo_v1(jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_combo_v1(jsonb, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 3: Apply both via MCP (controller).** `list_migrations` first.

- [ ] **Step 4: Add RPC pgTAP to `combo_crud.test.sql`**

Cover: create-combo happy path (returns product_id + sku, groups/options persisted); CASHIER role ⇒ 42501/P0003; single-required group with 0 defaults ⇒ P0001; REPLACE semantics (second upsert with fewer groups removes the old); idempotency replay returns same product_id with `idempotent_replay:true`; anon EXECUTE revoked (`has_function_privilege('anon', ...) = false`). Use `set_config('request.jwt.claims', ...)` to simulate roles as in existing tests (see `supabase/tests/orders_list_v2.test.sql` for the JWT-claims pattern).

- [ ] **Step 5: Run pgTAP via MCP.** Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260702000011_create_upsert_combo_v1.sql supabase/migrations/20260702000012_revoke_anon_upsert_combo_v1.sql supabase/tests/combo_crud.test.sql
git commit -m "feat(db): session 47 — upsert_combo_v1 RPC + REVOKE pair"
```

---

### Task A3: `delete_combo_v1` RPC (soft delete)

**Files:**
- Create: `supabase/migrations/20260702000013_create_delete_combo_v1.sql`
- Create: `supabase/migrations/20260702000014_revoke_anon_delete_combo_v1.sql`
- Modify: `supabase/tests/combo_crud.test.sql`

**Interfaces:**
- Produces: `delete_combo_v1(p_combo_product_id uuid) RETURNS jsonb` — `{combo_product_id, deleted:boolean}`.

- [ ] **Step 1: Write RPC** — auth + gate `products.combos.write`; verify the product is `product_type='combo'` and not already deleted (replay returns `deleted:false` if `deleted_at IS NOT NULL`); `UPDATE products SET is_active=false, deleted_at=now()`; audit `combo.deleted`; return. Mirror `delete_product_v1` (S45) semantics.
- [ ] **Step 2: REVOKE migration** (PUBLIC + anon + ALTER DEFAULT PRIVILEGES).
- [ ] **Step 3: Apply both via MCP.**
- [ ] **Step 4: pgTAP** — happy soft-delete (`deleted_at` set, excluded from active list); CASHIER ⇒ P0003; replay on already-deleted ⇒ `deleted:false`; anon revoked.
- [ ] **Step 5: Run pgTAP via MCP.** Expected pass.
- [ ] **Step 6: Commit** `feat(db): session 47 — delete_combo_v1 RPC + REVOKE pair`.

---

### Task A4: Migrate existing combos + drop `combo_items`

**Files:**
- Create: `supabase/migrations/20260702000015_migrate_combos_to_groups.sql`
- Create: `supabase/tests/combo_migration.test.sql`

**Interfaces:**
- Consumes: `combo_items`, `upsert`-built tables. Produces: every legacy combo has ≥1 `combo_groups` row; `combo_items` dropped.

- [ ] **Step 1: Write the data migration**

For each existing combo product (data-driven — there may be more than COMBO-001 in V3 dev):
```sql
-- backfill: one single+required group per legacy component, default option surcharge 0
INSERT INTO combo_groups (id, combo_product_id, name, group_type, is_required, min_select, max_select, sort_order)
SELECT gen_random_uuid(), ci.parent_product_id,
       comp.name, 'single', true, 1, 1, ci.sort_order
FROM combo_items ci
JOIN products comp ON comp.id = ci.component_product_id;

INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default, sort_order)
SELECT g.id, ci.component_product_id, 0, true, 0
FROM combo_items ci
JOIN combo_groups g ON g.combo_product_id = ci.parent_product_id
                   AND g.name = (SELECT name FROM products WHERE id = ci.component_product_id)
                   AND g.sort_order = ci.sort_order;

-- seed combo_base_price from retail_price where null
UPDATE products SET combo_base_price = retail_price
  WHERE product_type = 'combo' AND combo_base_price IS NULL;

-- drop the legacy model
DROP TRIGGER IF EXISTS trg_combo_items_parent_type ON combo_items;
DROP FUNCTION IF EXISTS enforce_combo_parent_type();
DROP TABLE combo_items;
```
> If a legacy combo has two components with the same product name, the group-name join is ambiguous — author the backfill with a row_number()/CTE keyed on `(parent_product_id, component_product_id, sort_order)` instead. Verify the actual V3 dev `combo_items` rows via `execute_sql SELECT ... FROM combo_items` before finalizing.

- [ ] **Step 2: Pre-flight read (controller).** `execute_sql`: `SELECT parent_product_id, component_product_id, sort_order FROM combo_items` — confirm no same-name collisions; adjust the join to a CTE if needed.
- [ ] **Step 3: Apply via MCP.**
- [ ] **Step 4: pgTAP `combo_migration.test.sql`** — assert COMBO-001 now has ≥1 group + option referencing BEV-AMER/PAS-CROI, `combo_base_price` non-null, and `combo_items` no longer exists (`hasnt_table('combo_items')`).
- [ ] **Step 5: Run pgTAP via MCP.** Expected pass.
- [ ] **Step 6: Rewrite legacy consumers to compile-safe stubs** — `apps/pos/src/features/combos/hooks/useComboItems.ts` and `apps/backoffice/src/features/combos/hooks/useCombos.ts` currently `from('combo_items')`. Repoint them in Wave B/C; for now leave a `// TODO Wave C` and ensure typecheck — actually defer the query change to C1/D1. (No code change here; just note the dependency.)
- [ ] **Step 7: Commit** `feat(db): session 47 — migrate combos to choice groups + drop combo_items`.

---

### Task A5: Sale RPC `complete_order_with_payment_v13` (combo-aware stock)

**Files:**
- Create: `supabase/migrations/20260702000016_bump_complete_order_v13.sql`
- Create: `supabase/migrations/20260702000017_revoke_anon_complete_order_v13.sql`
- Create: `supabase/tests/combo_sale.test.sql`

**Interfaces:**
- Consumes: `complete_order_with_payment_v12` (full body — copy forward). Produces: `complete_order_with_payment_v13(... same signature ...)`. Item payload gains optional `combo_components` for combo lines:
  ```json
  { "product_id":"<combo uuid>", "quantity":1, "unit_price":100000,
    "modifiers":[{"group_name":"Drinks","option_label":"Affogato","price_adjustment":10000}],
    "combo_components":[ {"product_id":"<component uuid>","quantity":1} ] }
  ```

- [ ] **Step 1: Copy v12 → v13**, DROP v12 in the same migration (`DO $drop$ ... DROP FUNCTION complete_order_with_payment_v12(...) CASCADE`). Keep the exact 16-arg signature.

- [ ] **Step 2: In the totals loop (the `FOR v_item ... LOOP` around v12 lines 195–262), branch on combo.** Add near the top of the loop body:

```sql
-- v13: combo lines are virtual — stock & price come from components/base.
IF v_product.product_type = 'combo' THEN
  -- price reconciliation: combo unit_price MUST equal combo_base_price
  v_expected_price := v_product.combo_base_price;
  IF v_unit_price IS DISTINCT FROM v_expected_price THEN
    v_unit_price := v_expected_price;  -- trust server base
  END IF;
  -- validate declared surcharges against combo_group_options (anti-tamper)
  -- (sum of modifiers[].price_adjustment must equal the sum of matching option surcharges)
  -- stock check is done per component, below, not on the combo product.
  FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'combo_components','[]'::jsonb)) LOOP
    SELECT * INTO v_comp_product FROM products WHERE id = (v_comp->>'product_id')::uuid FOR UPDATE;
    IF v_comp_product.id IS NULL THEN
      RAISE EXCEPTION 'Combo component not found: %', v_comp->>'product_id' USING ERRCODE='P0002';
    END IF;
    v_comp_qty := (v_comp->>'quantity')::DECIMAL * v_quantity;
    IF v_comp_product.is_display_item THEN
      IF COALESCE((SELECT quantity FROM display_stock WHERE product_id=v_comp_product.id),0) < v_comp_qty THEN
        RAISE EXCEPTION 'Insufficient display stock for %', v_comp_product.name USING ERRCODE='P0002';
      END IF;
    ELSIF v_comp_product.track_inventory AND v_comp_product.current_stock < v_comp_qty THEN
      RAISE EXCEPTION 'Insufficient stock for %', v_comp_product.name USING ERRCODE='P0002';
    END IF;
  END LOOP;
  -- skip the normal per-product stock check (CONTINUE past it via flag)
ELSE
  <existing non-combo stock check block>
END IF;
```
Declare new vars: `v_comp jsonb; v_comp_product RECORD; v_comp_qty DECIMAL(10,3);`. Surcharges still fold via the existing `v_modifiers_per_unit` sum (unchanged), so `line_total` already = base + surcharges. **Do not** call `get_customer_product_price` for combo lines (combos are not in the customer-price table; base price is canonical).

- [ ] **Step 3: In the INSERT loop (v12 lines 497–571), branch the stock writes.** For a combo line: insert the `order_items` row as today (product_id=combo, name_snapshot=combo name, modifiers snapshot, line_total) **plus** a new `combo_components` snapshot column; then, instead of decrementing the combo product, loop `v_item->'combo_components'` and for each do the `stock_movements 'sale'` insert + `current_stock` decrement + display-stock handling (copy the existing per-product block, keyed on the component id and `v_comp_qty`). Add the snapshot column in this migration:
```sql
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS combo_components JSONB;
```

- [ ] **Step 4: REVOKE migration** (`_000017`): PUBLIC + anon + ALTER DEFAULT PRIVILEGES on `complete_order_with_payment_v13(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text)`.

- [ ] **Step 5: Apply both via MCP. Regen types** (`generate_typescript_types` → write `packages/supabase/src/types.generated.ts`).

- [ ] **Step 6: pgTAP `combo_sale.test.sql`** (BEGIN/ROLLBACK, JWT claims for a cashier with `pos.sale.create`):
  - Seed a combo + 2 finished components (with stock). Build `p_items` with one combo line + `combo_components`.
  - **T1**: after the RPC, the combo product's `current_stock` is unchanged; each component's `current_stock` dropped by qty.
  - **T2**: one `order_items` row (product_id = combo), `line_total` = base + surcharge, `modifiers` snapshot present, `combo_components` snapshot present.
  - **T3**: insufficient component stock ⇒ P0002.
  - **T4**: non-combo lines still deduct the product itself (regression).
  - **T5**: anon revoked on v13; v12 gone (`hasnt_function`).

- [ ] **Step 7: Run pgTAP via MCP.** Expected pass.

- [ ] **Step 8: Update `process-payment` EF call site reference only if it pins a version string** — it calls `complete_order_with_payment_v12`; bump to `v13` in Wave D (Task D4). Note the dependency here.

- [ ] **Step 9: Commit** `feat(db): session 47 — complete_order_with_payment_v13 (combo component stock)`.

---

### Task A6: Reversal RPCs restore component stock for combo lines

**Files:**
- Create: `supabase/migrations/20260702000018_combo_aware_reversals.sql`
- Create: `supabase/tests/combo_reversal.test.sql`

**Interfaces:**
- Consumes: `void_order_rpc_v2`, `refund_order_rpc_v3`, `cancel_order_item_rpc_v2` (current versions — verify with `list_migrations`/`pg_get_functiondef`). Produces: bumped versions (or `CREATE OR REPLACE` with unchanged signature using the S38 `pg_get_functiondef`+replace corrective pattern) that, for `order_items` rows where the product is a combo, restore each `combo_components[]` product's stock instead of the combo product's.

- [ ] **Step 1: Inspect current reversal functions (controller).** `execute_sql SELECT pg_get_functiondef('void_order_rpc_v2'::regproc)` etc. Identify each stock-restore block.
- [ ] **Step 2: Author the corrective** — wherever a reversal restores `current_stock`/`display_stock` per `order_items` row, add: `IF (SELECT product_type FROM products WHERE id = oi.product_id)='combo' THEN` loop `oi.combo_components` and restore each component (`stock_movements 'adjustment' +qty`, `current_stock += qty`, display-stock aware) `ELSE` existing block. Use `CREATE OR REPLACE`, signatures unchanged.
- [ ] **Step 3: Apply via MCP.**
- [ ] **Step 4: pgTAP `combo_reversal.test.sql`** — sell a combo, then void → each component stock restored, combo stock untouched; same for refund.
- [ ] **Step 5: Run pgTAP via MCP.** Expected pass.
- [ ] **Step 6: Commit** `fix(db): session 47 — combo-aware stock restore on void/refund/cancel`.

---

### Task A7: Permission seed + `PermissionCode` union + types regen

**Files:**
- Create: `supabase/migrations/20260702000019_seed_combos_write_perm.sql`
- Modify: `packages/supabase/src/rls/permissions.ts`
- Modify: `packages/supabase/src/types.generated.ts` (regen)

- [ ] **Step 1: Seed migration** — insert permission `products.combos.write` and grant to roles MANAGER/ADMIN/SUPER_ADMIN, following the pattern in `supabase/migrations/20260513000004_seed_backoffice_crud_perms.sql`.
- [ ] **Step 2: Apply via MCP.**
- [ ] **Step 3: Extend the `PermissionCode` union** in `packages/supabase/src/rls/permissions.ts` — add `'products.combos.write'`. Grep for the union and add the member alphabetically near the other `products.*` codes.
- [ ] **Step 4: Regen types via MCP**, write `types.generated.ts`.
- [ ] **Step 5: Typecheck** `pnpm --filter @breakery/supabase typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(db): session 47 — seed products.combos.write perm + types regen`.

---

## WAVE B — Domain (IO-free helpers)

### Task B1: Combo domain types + pricing + selection validation

**Files:**
- Rewrite: `packages/domain/src/combos/types.ts`
- Create: `packages/domain/src/combos/pricing.ts`
- Create: `packages/domain/src/combos/validateSelection.ts`
- Modify: `packages/domain/src/combos/index.ts`
- Test: `packages/domain/src/combos/__tests__/pricing.test.ts`, `.../validateSelection.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ComboOption { id: string; component_product_id: string; label: string;
    surcharge: number; is_default: boolean; sort_order: number; }
  export interface ComboGroup { id: string; name: string; group_type: 'single'|'multi';
    is_required: boolean; min_select: number; max_select: number; sort_order: number;
    options: ComboOption[]; }
  export interface ComboDefinition { combo_product_id: string; name: string;
    base_price: number; groups: ComboGroup[]; }
  export interface ComboSelection { group_id: string; option_ids: string[]; }
  // pricing.ts
  export function configuredPrice(def: ComboDefinition, sel: ComboSelection[]): number;
  export function priceRange(def: ComboDefinition): { min: number; max: number };
  export function valuePrice(def: ComboDefinition, componentRetail: Record<string, number>): number | null;
  export function savingsPct(value: number | null, base: number): number | null;
  // validateSelection.ts
  export function validateSelection(def: ComboDefinition, sel: ComboSelection[]):
    { ok: true } | { ok: false; errors: string[] };
  ```

- [ ] **Step 1: Write failing tests `pricing.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { configuredPrice, priceRange, savingsPct } from '../pricing.js';
import type { ComboDefinition } from '../types.js';

const def: ComboDefinition = {
  combo_product_id: 'c', name: 'French Platter', base_price: 100000,
  groups: [
    { id: 'g1', name: 'Drinks', group_type: 'single', is_required: true, min_select: 1, max_select: 1, sort_order: 0,
      options: [
        { id: 'o1', component_product_id: 'p1', label: 'Americano', surcharge: 0, is_default: true, sort_order: 0 },
        { id: 'o2', component_product_id: 'p2', label: 'Affogato', surcharge: 10000, is_default: false, sort_order: 1 },
      ] },
  ],
};

it('configuredPrice = base + chosen surcharges', () => {
  expect(configuredPrice(def, [{ group_id: 'g1', option_ids: ['o2'] }])).toBe(110000);
});
it('priceRange spans cheapest..dearest required picks', () => {
  expect(priceRange(def)).toEqual({ min: 100000, max: 110000 });
});
it('savingsPct null when value <= base', () => {
  expect(savingsPct(90000, 100000)).toBeNull();
  expect(savingsPct(120000, 100000)).toBe(17);
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @breakery/domain test pricing`
- [ ] **Step 3: Implement `types.ts` + `pricing.ts`.** `configuredPrice` = base + Σ surcharge of selected option ids. `priceRange.min` = base + Σ over groups of (required ? min option surcharge : 0); `.max` = base + Σ over groups of (single ? max option surcharge : sum of top `max_select` surcharges). `savingsPct` = `value>base ? round((value-base)/value*100) : null`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Write failing `validateSelection.test.ts`** — required-single with 0 picks ⇒ error; multi over `max_select` ⇒ error; multi under `min_select` ⇒ error; valid ⇒ `{ok:true}`.
- [ ] **Step 6: Run → FAIL, implement `validateSelection.ts`, run → PASS.**
- [ ] **Step 7: Export from `index.ts`.** Remove the now-dead `ComboItem`/`ComboWithComponents` (or keep if other code imports — grep first; the POS `useComboItems` import dies in D1).
- [ ] **Step 8: Commit** `feat(domain): session 47 — combo pricing + selection validation helpers`.

---

## WAVE C — Back-office builder

### Task C1: `useCombos` (list) + `useComboDetail` rewrite

**Files:**
- Rewrite: `apps/backoffice/src/features/combos/hooks/useCombos.ts`
- Create: `apps/backoffice/src/features/combos/hooks/useComboDetail.ts`
- Rewrite: `apps/backoffice/src/features/combos/types.ts`
- Test: `apps/backoffice/src/features/combos/__tests__/useCombos.smoke.test.tsx`

**Interfaces:**
- Consumes: tables `combo_groups`, `combo_group_options`, products combo columns. Produces: `useCombos()` → list with groups (by name) + `priceRange` + `valuePrice`; `useComboDetail(comboId)` → full `ComboDefinition` + metadata for the editor.

- [ ] **Step 1: Rewrite `useCombos`** to query `products` (product_type='combo', deleted_at null) embedding `combo_groups ( *, combo_group_options ( *, component:products!component_product_id (name, retail_price) ) )`. Map to a `Combo` card type carrying `groups: {name, options:{label, surcharge}[]}[]`, `base_price`, `priceRange`, `valuePrice`. Reuse domain `priceRange`/`valuePrice`/`savingsPct`.
- [ ] **Step 2: Write `useComboDetail`** returning a `ComboDefinition` + general-info fields for the builder.
- [ ] **Step 3: Smoke test** the mapping (mock supabase, assert groups + price range derived).
- [ ] **Step 4: Run** `pnpm --filter @breakery/backoffice test useCombos` → PASS.
- [ ] **Step 5: Commit** `feat(backoffice): session 47 — combo list/detail hooks on choice-group schema`.

### Task C2: `useUpsertCombo` + `useDeleteCombo`

**Files:** Create `.../hooks/useUpsertCombo.ts`, `.../hooks/useDeleteCombo.ts`; tests co-located.
- [ ] **Step 1: `useUpsertCombo`** — `supabase.rpc('upsert_combo_v1', { p_combo, p_idempotency_key })` with a `useRef(crypto.randomUUID())` idempotency key reset on success; invalidate `['combos']`. Bind via the project RPC pattern (no `as never`).
- [ ] **Step 2: `useDeleteCombo`** — `supabase.rpc('delete_combo_v1', { p_combo_product_id })`; invalidate `['combos']`.
- [ ] **Step 3: Smoke** both call the right RPC with the right args.
- [ ] **Step 4: Run tests → PASS.**
- [ ] **Step 5: Commit** `feat(backoffice): session 47 — combo upsert/delete mutation hooks`.

### Task C3: Combo builder page + sub-components + routes

**Files:** Create `.../components/ComboBuilderPage.tsx`, `GeneralInfoSection.tsx`, `PricePreview.tsx`, `ChoiceGroupCard.tsx`, `ComboOptionRow.tsx`, `ComboProductPicker.tsx`; modify `apps/backoffice/src/routes/index.tsx`.

**Interfaces:** Consumes `useComboDetail`, `useUpsertCombo`, domain `priceRange`. Produces routes `/backoffice/products/combos/new` and `/backoffice/products/combos/:comboId/edit`, both behind `PermissionGate requiredPermission="products.combos.write"`.

- [ ] **Step 1: Build `ComboBuilderPage`** — controlled form state (`ComboDefinition` + general-info). General Information (name*, description, base price IDR*, display order, image URL, available from/to time inputs, Active + Show in POS toggles). PricePreview (live min/max via `priceRange`). Choice Groups list with "Add Group"; each `ChoiceGroupCard` has name, `group_type` native `<select>` (Single/Multi), Required toggle, min/max (multi only), and `ComboOptionRow[]` (surcharge number input, Set Default / Default badge, remove) + "Add Product" → `ComboProductPicker` (raw product search, parents-of-variants & combos excluded). Footer Cancel / Save|Update → `useUpsertCombo`.
- [ ] **Step 2: `ComboProductPicker`** — search products by name/SKU (`product_type='finished'`, not parent, not combo). Reuse the S39 `ProductPicker` pattern from `EditOrderItemsModal` if present.
- [ ] **Step 3: Add lazy routes** in `routes/index.tsx` — place `combos/new` and `combos/:comboId/edit` **before** any `products/:productId` catch to avoid route capture (mirror the S41 import-export ordering note).
- [ ] **Step 4: Smoke tests** — builder renders, add-group/add-option/set-default mutate state, Save calls `useUpsertCombo` with the assembled payload; price preview reflects a surcharge edit.
- [ ] **Step 5: Run** `pnpm --filter @breakery/backoffice test ComboBuilder` → PASS.
- [ ] **Step 6: Commit** `feat(backoffice): session 47 — combo builder page + routes`.

### Task C4: CombosPage list rewire

**Files:** Modify `apps/backoffice/src/pages/products/CombosPage.tsx`, `apps/backoffice/src/features/combos/components/{CombosHeader,ComboCard}.tsx`; test `CombosPage.test.tsx`.
- [ ] **Step 1: Wire `CombosHeader.onCreate`** to `navigate('/backoffice/products/combos/new')`; make cards clickable → `/:comboId/edit`. Gate the Create button on `products.combos.write`.
- [ ] **Step 2: Update `ComboCard`** to render groups by name + option pills + `+N more`, struck-through value price, **min→max** bundle range, Save% badge (from `savingsPct`).
- [ ] **Step 3: Update `CombosPage.test.tsx`** for the new shape; KPIs unchanged (total/active/inactive).
- [ ] **Step 4: Run** `pnpm --filter @breakery/backoffice test Combos` → PASS.
- [ ] **Step 5: Commit** `feat(backoffice): session 47 — wire combo management list to builder`.

---

## WAVE D — POS consumption

### Task D1: `useComboConfig` hook

**Files:** Create `apps/pos/src/features/combos/hooks/useComboConfig.ts`; delete/repoint `useComboItems.ts`; test co-located.
**Interfaces:** Produces `useComboConfig(comboProductId)` → `ComboDefinition` (domain type) via `combo_groups` embed.
- [ ] **Step 1: Implement** the query (mirror C1's embed) mapping to the domain `ComboDefinition`. Remove `useComboItems` (grep consumers — `combo.smoke.test.tsx`, `ComboBadge`; update them).
- [ ] **Step 2: Smoke** the mapping.
- [ ] **Step 3: Run** `pnpm --filter @breakery/app-pos test useComboConfig` → PASS.
- [ ] **Step 4: Commit** `feat(pos): session 47 — useComboConfig on choice-group schema`.

### Task D2: `ComboConfigModal`

**Files:** Create `apps/pos/src/features/combos/components/ComboConfigModal.tsx`; test co-located.
**Interfaces:** Consumes `useComboConfig`, domain `validateSelection`/`configuredPrice`. Produces `<ComboConfigModal open product onConfirm(selection, components, unitPrice) onClose />` where `selection: ComboSelection[]`, `components: {product_id, quantity}[]`, `unitPrice = base` (surcharges ride as modifiers).
- [ ] **Step 1: Build** one section per group (single = radio buttons, multi = checkboxes bounded by min/max), defaults pre-selected, live `configuredPrice` summary, Confirm disabled until `validateSelection().ok`. On confirm, emit the chosen `combo_components` (component_product_id × qty 1) and a `modifiers` snapshot `[{group_name, option_label, price_adjustment: surcharge}]`.
- [ ] **Step 2: Smoke** — required-single enforced, multi min/max enforced, default preselect, price summary updates, confirm payload shape.
- [ ] **Step 3: Run tests → PASS.**
- [ ] **Step 4: Commit** `feat(pos): session 47 — ComboConfigModal`.

### Task D3: Wire tap → modal → cart line

**Files:** Modify `apps/pos/src/features/products/ProductTapHandler.tsx`, `apps/pos/src/stores/cartStore.ts`, `packages/domain/src/cart/addItem.ts`, `packages/domain/src/types/cart.ts`.
**Interfaces:** `CartItem` gains `combo_components?: { product_id: string; quantity: number }[]`. cartStore gains `addCombo(product, modifiers, components, unitPrice)`.
- [ ] **Step 1: Extend `CartItem`** with optional `combo_components`. Extend `addItem` (or add `addComboItem`) to set it. Add `addCombo` to `cartStore`.
- [ ] **Step 2: In `ProductTapHandler`,** replace the "Modifiers not supported on combos" branch: for `product_type==='combo'`, open `ComboConfigModal` (state), and on confirm call `addCombo`. Keep the non-combo flow intact.
- [ ] **Step 3: Smoke** — tapping a combo opens the modal; confirming adds one cart line carrying `combo_components` + `modifiers`; line total = base + surcharge.
- [ ] **Step 4: Run** domain + POS tests → PASS.
- [ ] **Step 5: Commit** `feat(pos): session 47 — combo config flow into cart`.

### Task D4: Payload + checkout forward `combo_components`; bump to v13

**Files:** Modify the POS order-payload builders (`apps/pos/src/features/cart/hooks/useFireToStations.ts`, `apps/pos/src/features/payment/hooks/useCheckout.ts`, and any `buildOrderPayload`), and `supabase/functions/process-payment/index.ts`.
- [ ] **Step 1: Map `combo_components`** into each item in the order payload (grep the payload builders for where `modifiers` is mapped and add `combo_components` alongside).
- [ ] **Step 2: Bump the EF** — `process-payment/index.ts` calls `complete_order_with_payment_v12`; change to `v13`. Deploy via MCP `deploy_edge_function` (controller).
- [ ] **Step 3: Smoke/lint** — payload builder test asserts a combo line carries `combo_components`.
- [ ] **Step 4: Run** POS tests + typecheck 6/6 → PASS.
- [ ] **Step 5: Commit** `feat(pos): session 47 — forward combo_components + process-payment v13`.

---

## WAVE E — Closeout

### Task E1: Full sweeps + INDEX + CLAUDE.md
- [ ] **Step 1: Run** `pnpm typecheck` (6/6), domain/ui/pos/backoffice Vitest sweeps; record the known env-gated/flake baseline (don't confuse with regressions).
- [ ] **Step 2: Re-run all session pgTAP via MCP** — `combo_crud`, `combo_sale`, `combo_migration`, `combo_reversal` all green in cloud.
- [ ] **Step 3: Write INDEX** `docs/workplan/plans/2026-06-19-session-47-INDEX.md` (waves, migrations NAME-block used, deviations table).
- [ ] **Step 4: Bump `CLAUDE.md`** Active Workplan with a Session 47 reference bullet + the migration-sequence entry.
- [ ] **Step 5: Commit** `docs(combos): session 47 — INDEX + workplan bump`.
- [ ] **Step 6: Open PR** `swarm/session-47-combos → master` once reviews pass.

---

## Self-Review

**Spec coverage:** §3 schema → A1; §3.4 RLS/grants → A1; §4 pricing → B1 + PricePreview C3; §5 write RPCs → A2/A3; §6 POS persistence + v13 → A5 + D1–D4; §6.3 refund/void → A6; §7 migration → A4; §8 BO UI → C1–C4; §9 permission → A7; §10 testing → pgTAP A1/A2/A3/A4/A5/A6 + smokes C/D + domain B1; §11 waves → A–E; §12 out-of-scope respected (no quantity-per-option, no nested combos, no tablet). All covered.

**Placeholder scan:** Deliberate plan-time verifications remain (exact reversal RPC versions in A6; V3 `combo_items` data in A4; payload-builder grep in D4) — each is an explicit controller action, not a vague requirement. The v13 RPC shows the combo-branch deltas with insertion points rather than re-pasting 700 lines (modify-existing-large-file).

**Type consistency:** `ComboDefinition`/`ComboGroup`/`ComboOption`/`ComboSelection` defined in B1 and consumed identically in C1/C3/D1/D2; `combo_components: {product_id, quantity}[]` consistent across CartItem (D3), payload (D4), and the RPC `v_item->'combo_components'` (A5); `upsert_combo_v1(p_combo, p_idempotency_key)` signature matches between A2 and C2.
