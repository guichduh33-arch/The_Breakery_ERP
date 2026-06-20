# Product Modifiers Phase 2 — Order-time Ingredient Stock Deduction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a chosen modifier option's authored `ingredients_to_deduct` actually decrement raw-material stock at order time (converted to base unit, scaled by line qty, display-aware), snapshotted on `order_items`, and restored on void/refund.

**Architecture:** Server-authoritative. Each money-path RPC resolves `ingredients_to_deduct` from `product_modifiers` by `(product_id, group_name, option_label)` via one shared internal helper, converts `qty × factor_to_base × line_qty`, deducts via a direct `stock_movements('sale')` insert (the combo-component pattern), and freezes the resolved set into a new additive `order_items.modifier_ingredients_deducted` JSONB column. Reversals restore from that snapshot.

**Tech Stack:** PostgreSQL (Supabase cloud V3 dev `ikcyvlovptebroadgtvd`), PL/pgSQL SECURITY DEFINER RPCs, pgTAP, Deno edge function (`process-payment`), TypeScript types regen.

## Global Constraints

- **DB target is Supabase cloud V3 dev `ikcyvlovptebroadgtvd`** via MCP (`apply_migration`, `execute_sql`, `generate_typescript_types`). NEVER `supabase start` / `db reset` / local Docker. **Subagents cannot reach MCP** — the controller applies every migration, runs every pgTAP (BEGIN/ROLLBACK envelope), regens types, and verifies in cloud.
- **Migration NAME-block: `20260705000010..` monotonic** (prior max NAME on master = `20260704000022`). Check `supabase/migrations/` before picking the next number.
- **RPC versioning is monotonic** — never edit a published `_vN`. `DROP FUNCTION ... vN(<exact old args>)` + recreate `_vN+1` in the same migration; published signatures already in `types.generated.ts` confirm arg lists.
- **Anon defense-in-depth** — every new/bumped public function needs the canonical REVOKE pair: `REVOKE EXECUTE ... FROM PUBLIC` **and** `FROM anon`, plus `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (3 lines).
- **`stock_movements` is append-only**; `record_stock_movement_v1` FORBIDS `movement_type IN ('sale','sale_void')`. Those rows are inserted DIRECTLY inside the order RPCs (the existing combo path does this) — never via the primitive. `stock_movements.unit` is NOT NULL.
- **Display-stock isolation** — when `products.is_display_item`, also write `display_movements` + update `display_stock` (mirror the combo component loop). Never write `current_stock` for a display item's sale without the display branch.
- **Money-path RPC bodies are large (~600 lines).** Bump technique: fetch the current body with `pg_get_functiondef`, apply the targeted edits at the anchors named in each task, then `DROP FUNCTION old` + `CREATE FUNCTION` the edited body in one migration. Do NOT hand-retype the whole body from scratch.
- **EF `process-payment` redeploy is mandatory** once `complete_order_with_payment_v13` is dropped (it calls the RPC). Deploy with `verify_jwt=false` (5 files: index + `_shared`).
- **Snapshot shape** (one element of `order_items.modifier_ingredients_deducted`):
  `{ "product_id": "<uuid>", "qty_base": <numeric>, "unit": "<base unit>", "group_name": "<text>", "option_label": "<text>" }`.
- **Out of scope:** B2B tablet (`create_tablet_order_v2`, `create_b2b_order_v1`, tablet pickup/complete), category-level ingredient authoring, FIFO lots, reporting. No BO/POS UI change.

## Reference — current money-path code (verified 2026-06-20, base `master` @ `394a3f7`)

| RPC | Version | Migration | Stock loop anchors |
|---|---|---|---|
| `complete_order_with_payment` | v13 | `20260704000016_bump_complete_order_v13.sql` | validate combo 208-227 / non-combo 230-242 ; deduct combo 556-585 / non-combo 586-614 ; persist items 501-554 |
| `pay_existing_order` | v9 | `20260704000021_bump_pay_existing_order_v9.sql` | deduct combo 363-403 / non-combo 404-443 |
| `fire_counter_order` | v3 | `20260704000019_bump_fire_counter_order_v3.sql` | persist items 145-159 (combo_components at 155-157); NO stock deduction |
| `void_order_rpc` | v2 | `20260704000018_combo_aware_reversals.sql` | restore combo 79-96 / non-combo 97-113 |
| `refund_order_rpc` | v3 | `20260704000018_combo_aware_reversals.sql` | restore combo 398-415 / non-combo 416-433 |
| `record_stock_movement_v1` | — | `20260517000020...` | forbids sale/sale_void (line 53-55); unit default (90) |

The combo component loop is the canonical pattern to mirror for both deduction and reversal.

---

## Task 1: Schema — `order_items.modifier_ingredients_deducted` column + types regen

**Files:**
- Create: `supabase/migrations/20260705000010_add_order_items_modifier_ingredients_deducted.sql`
- Modify: `packages/supabase/src/types.generated.ts` (regen)
- Test: `supabase/tests/modifier_ingredient_deduction.test.sql` (create; column-exists assertion only this task)

**Interfaces:**
- Produces: `order_items.modifier_ingredients_deducted JSONB NULL` — the per-line snapshot read by all later tasks.

- [ ] **Step 1: Write the failing pgTAP (column exists)**

Create `supabase/tests/modifier_ingredient_deduction.test.sql`:

```sql
BEGIN;
SELECT plan(1);

SELECT has_column('public', 'order_items', 'modifier_ingredients_deducted',
  'order_items has modifier_ingredients_deducted snapshot column');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run to verify it fails**

Controller runs via MCP `execute_sql` (paste the file body). Expected: FAIL — column does not exist.

- [ ] **Step 3: Apply the migration**

Migration body (`apply_migration`, name `add_order_items_modifier_ingredients_deducted`):

```sql
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS modifier_ingredients_deducted JSONB;

COMMENT ON COLUMN public.order_items.modifier_ingredients_deducted IS
  'Phase 2 snapshot of resolved+converted modifier ingredients deducted for this line: '
  'array of {product_id, qty_base, unit, group_name, option_label}. NULL when no '
  'ingredient-bearing modifiers. Source of truth for void/refund restore.';
```

- [ ] **Step 4: Run pgTAP to verify it passes**

Controller re-runs Step 1 via `execute_sql`. Expected: PASS (1).

- [ ] **Step 5: Regen types + commit**

Controller: `generate_typescript_types` → write to `packages/supabase/src/types.generated.ts`.

```bash
git add supabase/migrations/20260705000010_add_order_items_modifier_ingredients_deducted.sql \
        supabase/tests/modifier_ingredient_deduction.test.sql \
        packages/supabase/src/types.generated.ts
git commit -m "feat(db): order_items.modifier_ingredients_deducted snapshot column"
```

---

## Task 2: Internal helper `_resolve_modifier_ingredients_v1`

**Files:**
- Create: `supabase/migrations/20260705000011_create_resolve_modifier_ingredients_v1.sql`
- Test: `supabase/tests/resolve_modifier_ingredients.test.sql`

**Interfaces:**
- Produces: `_resolve_modifier_ingredients_v1(p_product_id UUID, p_modifiers JSONB, p_line_qty NUMERIC) RETURNS JSONB` — SECURITY DEFINER, internal (REVOKEd from PUBLIC/anon/authenticated). Returns a JSONB array of `{product_id, qty_base, unit, group_name, option_label}` (empty array when no ingredient-bearing modifiers resolve). Used by `complete_order_v14` and `fire_counter_order_v4`.

**Behaviour:**
- For each chosen modifier `{group_name, option_label}` in `p_modifiers`, join `product_modifiers` on `(product_id = p_product_id, group_name, option_label, is_active, deleted_at IS NULL)`, read `ingredients_to_deduct`.
- For each ingredient line: `factor = 1` when `unit` equals the ingredient product's base unit, else `product_unit_alternatives.factor_to_base` for `(ingredient product_id, code = unit)`; `qty_base = qty × factor × p_line_qty`.
- `qty_base` and base `unit` written into the output (the snapshot stores converted base-unit qty so reversal is trivial). `unit` field in output = the **ingredient product's base unit**.
- An option that no longer resolves → contributes nothing (no error).

- [ ] **Step 1: Write the failing pgTAP**

Create `supabase/tests/resolve_modifier_ingredients.test.sql`:

```sql
BEGIN;
SELECT plan(6);

-- Fixtures: a raw material "Oat Milk" base unit 'L', alt 'ml' factor 0.001.
INSERT INTO categories (id, name, slug, category_type, is_active)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'RM P2', 'rm-p2', 'raw_material', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'RAW-OAT-P2', 'Oat Milk P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'ml', 0.001, 1)
ON CONFLICT DO NOTHING;

-- A drink product carrying a Milk modifier with Oat option deducting 30 ml.
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'FIN-LATTE-P2', 'Latte P2', 'pcs', 30000, 0, 0, '00000000-0000-0000-0000-0000000000c1', true, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_modifiers (product_id, group_name, group_sort_order, group_required, group_type, option_label, option_sort_order, price_adjustment, is_default, is_active, ingredients_to_deduct)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'Milk', 0, true, 'single_select', 'Oat', 1, 10000, false, true,
  '[{"product_id":"00000000-0000-0000-0000-0000000000a1","qty":30,"unit":"ml"}]'::jsonb)
ON CONFLICT DO NOTHING;

-- T1: resolves one ingredient line
SELECT is(
  jsonb_array_length(_resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]'::jsonb, 1)),
  1, 'T1: one ingredient line resolved');

-- T2: ml -> L conversion, line qty 1  => 30 * 0.001 * 1 = 0.03
SELECT is(
  (_resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]'::jsonb, 1)->0->>'qty_base')::numeric,
  0.03, 'T2: ml->L converted qty_base = 0.03');

-- T3: scaled by line qty 3 => 0.09
SELECT is(
  (_resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]'::jsonb, 3)->0->>'qty_base')::numeric,
  0.09, 'T3: scaled by line qty');

-- T4: output unit is the ingredient base unit
SELECT is(
  _resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]'::jsonb, 1)->0->>'unit',
  'L', 'T4: output unit = ingredient base unit');

-- T5: unknown/edited-away option resolves to empty array
SELECT is(
  _resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1',
    '[{"group_name":"Milk","option_label":"Almond","price_adjustment":0}]'::jsonb, 1),
  '[]'::jsonb, 'T5: unresolved option => empty');

-- T6: empty modifiers => empty array
SELECT is(
  _resolve_modifier_ingredients_v1(
    '00000000-0000-0000-0000-0000000000b1', '[]'::jsonb, 1),
  '[]'::jsonb, 'T6: no modifiers => empty');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run to verify it fails**

Controller runs via `execute_sql`. Expected: FAIL — function `_resolve_modifier_ingredients_v1` does not exist.

- [ ] **Step 3: Apply the helper migration**

Migration body (name `create_resolve_modifier_ingredients_v1`):

```sql
CREATE OR REPLACE FUNCTION public._resolve_modifier_ingredients_v1(
  p_product_id UUID,
  p_modifiers  JSONB,
  p_line_qty   NUMERIC
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH chosen AS (
    SELECT m->>'group_name'   AS group_name,
           m->>'option_label' AS option_label
    FROM jsonb_array_elements(COALESCE(p_modifiers, '[]'::jsonb)) m
  ),
  opt AS (
    SELECT c.group_name, c.option_label, pm.ingredients_to_deduct
    FROM chosen c
    JOIN product_modifiers pm
      ON pm.product_id  = p_product_id
     AND pm.group_name  = c.group_name
     AND pm.option_label = c.option_label
     AND pm.is_active    = true
     AND pm.deleted_at IS NULL
    WHERE pm.ingredients_to_deduct IS NOT NULL
      AND jsonb_typeof(pm.ingredients_to_deduct) = 'array'
  ),
  line AS (
    SELECT o.group_name,
           o.option_label,
           (i->>'product_id')::uuid AS product_id,
           (i->>'qty')::numeric     AS qty,
           i->>'unit'               AS unit
    FROM opt o,
         jsonb_array_elements(o.ingredients_to_deduct) i
    WHERE (i->>'product_id') IS NOT NULL
      AND (i->>'qty')::numeric > 0
  ),
  conv AS (
    SELECT l.product_id,
           pr.unit AS base_unit,
           l.group_name,
           l.option_label,
           l.qty
             * CASE
                 WHEN l.unit = pr.unit THEN 1
                 ELSE COALESCE(
                   (SELECT pua.factor_to_base
                      FROM product_unit_alternatives pua
                     WHERE pua.product_id = l.product_id
                       AND pua.code = l.unit
                     LIMIT 1), 1)
               END
             * p_line_qty AS qty_base
    FROM line l
    JOIN products pr ON pr.id = l.product_id
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'product_id',   product_id,
      'qty_base',     qty_base,
      'unit',         base_unit,
      'group_name',   group_name,
      'option_label', option_label
    )),
    '[]'::jsonb)
  FROM conv;
$$;

REVOKE EXECUTE ON FUNCTION public._resolve_modifier_ingredients_v1(UUID, JSONB, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_modifier_ingredients_v1(UUID, JSONB, NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public._resolve_modifier_ingredients_v1(UUID, JSONB, NUMERIC) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

> Note: the helper is internal — only the SECURITY DEFINER order RPCs call it. It does not itself check permissions (the calling RPC already gated `sales.create` etc.).

- [ ] **Step 4: Run pgTAP to verify it passes**

Controller runs the file from Step 1 via `execute_sql`. Expected: PASS (6).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260705000011_create_resolve_modifier_ingredients_v1.sql \
        supabase/tests/resolve_modifier_ingredients.test.sql
git commit -m "feat(db): _resolve_modifier_ingredients_v1 helper (resolve + base-unit convert)"
```

---

## Task 3: `complete_order_with_payment_v14` — deduct + snapshot on direct sale

**Files:**
- Create: `supabase/migrations/20260705000012_bump_complete_order_v14.sql`
- Create: `supabase/migrations/20260705000013_revoke_anon_complete_order_v14.sql`
- Modify: `supabase/functions/process-payment/index.ts` (call `complete_order_with_payment_v14`)
- Modify: `packages/supabase/src/types.generated.ts` (regen)
- Test: `supabase/tests/modifier_ingredient_deduction.test.sql` (append T1-T4, T6-T8 — direct-sale cases)

**Interfaces:**
- Consumes: `_resolve_modifier_ingredients_v1` (Task 2); `order_items.modifier_ingredients_deducted` (Task 1).
- Produces: `complete_order_with_payment_v14(<same args as v13>)`. Same return envelope as v13. Drops v13.

**Edit anchors (apply to the v13 body fetched via `pg_get_functiondef`):**

1. **Validation phase**, in the per-item loop, right after the existing non-combo stock check (~line 230-242): for a non-combo line, resolve ingredients and check each ingredient's availability. Add:

```sql
-- Phase 2: modifier ingredient availability check (non-combo lines)
IF v_item_product_type <> 'combo' THEN
  FOR v_ing IN
    SELECT * FROM jsonb_to_recordset(
      _resolve_modifier_ingredients_v1(v_item_product_id, v_item->'modifiers', v_quantity)
    ) AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT)
  LOOP
    SELECT current_stock, is_display_item, COALESCE(track_inventory, true)
      INTO v_ing_stock, v_ing_is_display, v_ing_track
      FROM products WHERE id = v_ing.product_id;
    IF v_ing_is_display THEN
      SELECT quantity INTO v_ing_stock FROM display_stock WHERE product_id = v_ing.product_id;
    END IF;
    IF v_ing_track AND COALESCE(v_ing_stock, 0) < v_ing.qty_base THEN
      RAISE EXCEPTION 'Insufficient stock for modifier ingredient % (need %, have %)',
        v_ing.product_id, v_ing.qty_base, COALESCE(v_ing_stock, 0)
        USING ERRCODE = 'P0002';
    END IF;
  END LOOP;
END IF;
```

2. **Persist phase** (~line 501-554): when inserting each `order_items` row, set the new column from the resolved set:

```sql
-- in the INSERT INTO order_items (...) column list add:
modifier_ingredients_deducted
-- in VALUES add (non-combo lines; NULL for combo):
CASE WHEN v_item_product_type <> 'combo'
     THEN _resolve_modifier_ingredients_v1(v_item_product_id, v_item->'modifiers', v_quantity)
     ELSE NULL END
```

3. **Deduct phase**, right after the existing non-combo deduction block (~line 586-614): loop the persisted snapshot and deduct each ingredient (display-aware), mirroring the combo component loop (556-585):

```sql
-- Phase 2: deduct modifier ingredients for this (non-combo) line
FOR v_ing IN
  SELECT * FROM jsonb_to_recordset(COALESCE(v_oi.modifier_ingredients_deducted, '[]'::jsonb))
    AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT)
LOOP
  INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reason, reference_type, reference_id)
  VALUES (v_ing.product_id, 'sale', -v_ing.qty_base, v_ing.unit,
          'Modifier: '||v_ing.group_name||' / '||v_ing.option_label, 'order', v_order_id);
  UPDATE products SET current_stock = current_stock - v_ing.qty_base WHERE id = v_ing.product_id;

  IF (SELECT is_display_item FROM products WHERE id = v_ing.product_id) THEN
    INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id)
    VALUES (v_ing.product_id, 'sale', -v_ing.qty_base,
            'Modifier: '||v_ing.group_name||' / '||v_ing.option_label, 'order', v_order_id);
    UPDATE display_stock SET quantity = quantity - v_ing.qty_base WHERE product_id = v_ing.product_id;
  END IF;
END LOOP;
```

> Declare the new locals in the DECLARE block: `v_ing RECORD; v_ing_stock NUMERIC; v_ing_is_display BOOLEAN; v_ing_track BOOLEAN; v_oi RECORD;` (reuse `v_oi` if the deduct phase already iterates inserted items; otherwise add an iterator over the just-inserted `order_items` rows for this order). Match the exact local/variable names already used in the v13 body — adapt the fragments to them rather than introducing parallel names.

- [ ] **Step 1: Write the failing pgTAP (append direct-sale cases)**

Append to `supabase/tests/modifier_ingredient_deduction.test.sql` (raise the `plan(N)` count accordingly). Use the Task-2 fixtures (Oat Milk RM + Latte + Milk/Oat modifier) plus an open shift + payment so `complete_order_with_payment_v14` succeeds. Cases:

```sql
-- after a direct sale of 1 Latte with Milk=Oat:
-- T(complete-1): order_items.modifier_ingredients_deducted has the Oat line with qty_base 0.03
-- T(complete-2): a stock_movements row exists: product Oat Milk, movement_type 'sale', quantity -0.03
-- T(complete-3): products.current_stock for Oat Milk decreased by 0.03 (5 -> 4.97)
-- T(complete-4): selling 200 lattes (qty 200 => need 6 L > 5 L) raises P0002 insufficient
-- T(complete-5): a line with NO ingredient-bearing modifier writes NULL snapshot, no extra movement
```

(Author each assertion concretely against the seeded ids; mirror the structure of `supabase/tests/combo_sale.test.sql` for the open-shift + `complete_order_with_payment_v14` call envelope.)

- [ ] **Step 2: Run to verify it fails**

Controller runs via `execute_sql`. Expected: FAIL — `complete_order_with_payment_v14` does not exist (and the column stays NULL under v13).

- [ ] **Step 3: Apply the v14 bump**

Controller: fetch v13 body via `execute_sql` (`SELECT pg_get_functiondef('public.complete_order_with_payment_v13'::regprocedure);`), apply the three anchor edits above + DECLARE additions, then `apply_migration` name `bump_complete_order_v14` with:

```sql
DROP FUNCTION IF EXISTS public.complete_order_with_payment_v13(<exact v13 arg types>);
CREATE FUNCTION public.complete_order_with_payment_v14(<same args>) ... <edited body, renamed to v14> ...;
```

Then `apply_migration` name `revoke_anon_complete_order_v14` with the canonical 3-line REVOKE pair + GRANT EXECUTE to the same roles v13 had (`authenticated`/`service_role` — copy from the v13 grants).

- [ ] **Step 4: Redeploy the EF**

Controller: edit `supabase/functions/process-payment/index.ts` — replace the `.rpc('complete_order_with_payment_v13', …)` call with `…v14`. Deploy via `deploy_edge_function` (`verify_jwt=false`, include `_shared`).

- [ ] **Step 5: Run pgTAP to verify it passes**

Controller runs the full file via `execute_sql`. Expected: all PASS.

- [ ] **Step 6: Regen types + commit**

```bash
git add supabase/migrations/20260705000012_bump_complete_order_v14.sql \
        supabase/migrations/20260705000013_revoke_anon_complete_order_v14.sql \
        supabase/functions/process-payment/index.ts \
        supabase/tests/modifier_ingredient_deduction.test.sql \
        packages/supabase/src/types.generated.ts
git commit -m "feat(db): complete_order_with_payment_v14 — deduct + snapshot modifier ingredients"
```

---

## Task 4: `fire_counter_order_v4` — persist the ingredient snapshot at fire

**Files:**
- Create: `supabase/migrations/20260705000014_bump_fire_counter_order_v4.sql`
- Create: `supabase/migrations/20260705000015_revoke_anon_fire_counter_order_v4.sql`
- Modify: `apps/pos/src/...` fire hook (bump RPC name to v4) + `packages/supabase/src/types.generated.ts`
- Test: `supabase/tests/modifier_ingredient_deduction.test.sql` (append fire-snapshot case)

**Interfaces:**
- Consumes: `_resolve_modifier_ingredients_v1` (Task 2).
- Produces: `fire_counter_order_v4(<same args as v3>)`. Persists `order_items.modifier_ingredients_deducted` at fire; does NOT deduct stock (fire never touches stock). Drops v3.

**Edit anchor:** in the `INSERT INTO order_items` (v3 lines 145-159), where `combo_components` is set via a CASE, add the new column set from the resolver:

```sql
-- column list add:
modifier_ingredients_deducted
-- VALUES add (non-combo lines; NULL for combo):
CASE WHEN p.product_type <> 'combo'
     THEN _resolve_modifier_ingredients_v1(p.id, v_item->'modifiers', v_qty)
     ELSE NULL END
```

(Use the exact item/qty/product locals the v3 body already uses — `v_item`, the joined product alias, and the line quantity variable.)

- [ ] **Step 1: Write the failing pgTAP**

Append a case: fire a counter order with a Latte + Milk=Oat line → `order_items.modifier_ingredients_deducted` is the Oat line (qty_base 0.03) AND `stock_movements` has NO 'sale' row for Oat Milk yet (fire does not deduct), and `products.current_stock` unchanged. Bump `plan(N)`.

- [ ] **Step 2: Run to verify it fails**

Controller via `execute_sql`. Expected: FAIL — `fire_counter_order_v4` does not exist.

- [ ] **Step 3: Apply the v4 bump**

Controller: fetch v3 body, apply the anchor edit, `apply_migration` `bump_fire_counter_order_v4` (`DROP FUNCTION ...v3(<args>)` + `CREATE ...v4`). Then `apply_migration` `revoke_anon_fire_counter_order_v4` (REVOKE pair + GRANT to v3's roles).

- [ ] **Step 4: Wire POS + regen types**

Controller: bump the fire hook's RPC name to `fire_counter_order_v4` (grep `fire_counter_order_v3` under `apps/pos/src`). Regen types.

- [ ] **Step 5: Run pgTAP to verify it passes**

Controller via `execute_sql`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260705000014_bump_fire_counter_order_v4.sql \
        supabase/migrations/20260705000015_revoke_anon_fire_counter_order_v4.sql \
        apps/pos/src packages/supabase/src/types.generated.ts \
        supabase/tests/modifier_ingredient_deduction.test.sql
git commit -m "feat(db): fire_counter_order_v4 — persist modifier ingredient snapshot at fire"
```

---

## Task 5: `pay_existing_order_v10` — deduct from the persisted snapshot

**Files:**
- Create: `supabase/migrations/20260705000016_bump_pay_existing_order_v10.sql`
- Create: `supabase/migrations/20260705000017_revoke_anon_pay_existing_order_v10.sql`
- Modify: POS pickup/pay hook(s) calling `pay_existing_order_v9` + `packages/supabase/src/types.generated.ts`
- Test: `supabase/tests/modifier_ingredient_deduction.test.sql` (append fire→pay case)

**Interfaces:**
- Consumes: `order_items.modifier_ingredients_deducted` (snapshot written by complete/fire).
- Produces: `pay_existing_order_v10(<same args as v9>)`. Deducts ingredient stock from each item's persisted snapshot (display-aware), with availability check from the snapshot. Drops v9.

**Edit anchors:** mirror Task 3's deduct fragment, but read the snapshot off the already-persisted `order_items` row (v9 already iterates `order_items` in lines 355-444). After the existing non-combo deduction (404-443):

```sql
-- availability check (before any write, in v9's existing validation pass if present;
-- else immediately before the deduction insert):
FOR v_ing IN
  SELECT * FROM jsonb_to_recordset(COALESCE(v_item.modifier_ingredients_deducted, '[]'::jsonb))
    AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT)
LOOP
  -- same insufficient-stock check as Task 3 Step anchor 1 (display-aware), RAISE P0002 on shortfall
  -- then deduct (same insert+update as Task 3 anchor 3)
END LOOP;
```

(Use v9's existing item iterator variable — confirm whether it selects `modifier_ingredients_deducted`; extend its SELECT list to include the column.)

- [ ] **Step 1: Write the failing pgTAP (fire→pay)**

Append: fire a Latte+Oat counter order (Task 4 leaves the snapshot, no deduction) → call `pay_existing_order_v10` → assert exactly ONE 'sale' stock_movement for Oat Milk at -0.03 and `current_stock` 5→4.97 (no double-deduct, no miss). Also a replay assertion: calling pay again (idempotent envelope) does not deduct twice. Bump `plan(N)`.

- [ ] **Step 2: Run to verify it fails**

Controller via `execute_sql`. Expected: FAIL — `pay_existing_order_v10` does not exist.

- [ ] **Step 3: Apply the v10 bump**

Controller: fetch v9 body, extend the item iterator SELECT + add the check/deduct fragment, `apply_migration` `bump_pay_existing_order_v10` (`DROP ...v9(<args>)` + `CREATE ...v10`). Then `apply_migration` `revoke_anon_pay_existing_order_v10` (REVOKE pair + GRANT to v9's roles).

- [ ] **Step 4: Wire POS + regen types**

Controller: grep `pay_existing_order_v9` under `apps/pos/src`, bump to v10. Regen types.

- [ ] **Step 5: Run pgTAP to verify it passes**

Controller via `execute_sql`. Expected: PASS (incl. no-double-deduct on replay).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260705000016_bump_pay_existing_order_v10.sql \
        supabase/migrations/20260705000017_revoke_anon_pay_existing_order_v10.sql \
        apps/pos/src packages/supabase/src/types.generated.ts \
        supabase/tests/modifier_ingredient_deduction.test.sql
git commit -m "feat(db): pay_existing_order_v10 — deduct modifier ingredients from snapshot"
```

---

## Task 6: Reversals — `void_order_rpc_v3` + `refund_order_rpc_v4` restore from snapshot

**Files:**
- Create: `supabase/migrations/20260705000018_bump_reversals_modifier_ingredients.sql` (both RPCs + their REVOKE pairs in one block)
- Modify: BO/POS void+refund hooks (bump RPC names) + `packages/supabase/src/types.generated.ts`
- Test: `supabase/tests/modifier_ingredient_deduction.test.sql` (append void + refund cases)

**Interfaces:**
- Consumes: `order_items.modifier_ingredients_deducted`.
- Produces: `void_order_rpc_v3(<same args as v2>)`, `refund_order_rpc_v4(<same args as v3>)`. Restore ingredient stock (`sale_void`, display-aware); refund scales by refunded fraction. Drops v2/v3.

**Edit anchors:**
- `void_order_rpc_v2` after the non-combo restore (97-113): for each item, loop `modifier_ingredients_deducted` and restore:

```sql
FOR v_ing IN
  SELECT * FROM jsonb_to_recordset(COALESCE(v_item.modifier_ingredients_deducted, '[]'::jsonb))
    AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT)
LOOP
  INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reason, reference_type, reference_id)
  VALUES (v_ing.product_id, 'sale_void', v_ing.qty_base, v_ing.unit,
          'Void modifier: '||v_ing.group_name||' / '||v_ing.option_label, 'order', v_order_id);
  UPDATE products SET current_stock = current_stock + v_ing.qty_base WHERE id = v_ing.product_id;
  IF (SELECT is_display_item FROM products WHERE id = v_ing.product_id) THEN
    INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id)
    VALUES (v_ing.product_id, 'adjustment', v_ing.qty_base,
            'Void modifier: '||v_ing.group_name||' / '||v_ing.option_label, 'order', v_order_id);
    UPDATE display_stock SET quantity = quantity + v_ing.qty_base WHERE product_id = v_ing.product_id;
  END IF;
END LOOP;
```

- `refund_order_rpc_v3` after the non-combo restore (416-433): same fragment, but scale `qty_base` by the refunded fraction the body already computes for the line (use the same scaling factor the existing combo/main-line refund uses — e.g. `v_refund_qty / v_item.quantity`).

- [ ] **Step 1: Write the failing pgTAP (void + refund)**

Append: (a) complete a Latte+Oat sale (Oat 5→4.97), void it → assert `sale_void` +0.03 and `current_stock` back to 5; (b) complete, then partial refund of the line → assert the restored `qty_base` is scaled by the refunded fraction. Bump `plan(N)`.

- [ ] **Step 2: Run to verify it fails**

Controller via `execute_sql`. Expected: FAIL — `void_order_rpc_v3` / `refund_order_rpc_v4` do not exist.

- [ ] **Step 3: Apply the reversals bump**

Controller: fetch v2/v3 bodies, apply the anchor edits, `apply_migration` `bump_reversals_modifier_ingredients` with `DROP ...void_order_rpc_v2(<args>)` + `CREATE ...v3`, `DROP ...refund_order_rpc_v3(<args>)` + `CREATE ...v4`, and both canonical REVOKE pairs + GRANTs in the same migration.

- [ ] **Step 4: Wire hooks + regen types**

Controller: grep `void_order_rpc_v2` / `refund_order_rpc_v3` under `apps/` and bump. Regen types.

- [ ] **Step 5: Run pgTAP to verify it passes**

Controller via `execute_sql`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260705000018_bump_reversals_modifier_ingredients.sql \
        apps packages/supabase/src/types.generated.ts \
        supabase/tests/modifier_ingredient_deduction.test.sql
git commit -m "feat(db): void_v3 + refund_v4 — restore modifier ingredient stock from snapshot"
```

---

## Task 7: Non-regression, pattern-guardian, and final verification

**Files:**
- Modify: existing pgTAP suites referencing the bumped RPCs (`combo_sale`, `combo_fire_pay`, `combo_reversal`, `s44_*`, `order_discount_gate`, `pay_existing_discount_gate`, `loyalty_transactions_append_only`) — update RPC version names v13/v9/v2/v3 → v14/v10/v3/v4.

**Interfaces:** none new — verification only.

- [ ] **Step 1: Update non-regression suites**

Grep `supabase/tests` for `complete_order_with_payment_v13`, `pay_existing_order_v9`, `void_order_rpc_v2`, `refund_order_rpc_v3`, `fire_counter_order_v3`; bump each to the new version (named args, behavior unchanged for the existing assertions).

- [ ] **Step 2: Run the full pgTAP set in cloud**

Controller runs each suite via `execute_sql` (BEGIN/ROLLBACK). Expected: all PASS — `modifier_ingredient_deduction`, `resolve_modifier_ingredients`, plus the bumped combo/S44 suites.

- [ ] **Step 3: Pattern-guardian review**

Dispatch the `pattern-guardian` agent on the branch diff. Expected: 0 HIGH. Fix any REVOKE-pair / append-only / display-aware finding via a corrective migration in the same NAME-block.

- [ ] **Step 4: Typecheck 6/6**

Run: `pnpm typecheck`. Expected: all packages PASS (types regen already committed per task).

- [ ] **Step 5: Confirm types regen committed & no drift**

Controller: `list_migrations` (cloud == local) + `generate_typescript_types` diff is empty (already committed). 

- [ ] **Step 6: Final commit (if suites/regen changed)**

```bash
git add supabase/tests packages/supabase/src/types.generated.ts
git commit -m "test(db): bump non-regression suites to v14/v10/v4/v3 for Phase 2"
```

---

## Self-Review notes

- **Spec coverage:** Goal 1 (direct sale) → Task 3. Goal 2 (fire→pay, pickup) → Tasks 4+5. Goal 3 (void/refund restore, scaled) → Task 6. Goal 4 (reversal fidelity via snapshot) → Task 1 column + Tasks 3-6 read/write it. Goal 5 (pgTAP) → Tasks 2-7 (`resolve_modifier_ingredients` + `modifier_ingredient_deduction` 9 cases + non-regression). Unit conversion via `factor_to_base` → Task 2 helper + T2/T3. B2B tablet deferred → no task touches `create_tablet_order_v2` / `create_b2b_order_v1`. EF redeploy → Task 3 Step 4.
- **Atomic set:** deduction (Task 3/5) and restore (Task 6) ship on the same branch; no intermediate merge leaks stock.
- **Type/name consistency:** helper `_resolve_modifier_ingredients_v1(UUID, JSONB, NUMERIC)` used verbatim in Tasks 3 & 4; snapshot column `modifier_ingredients_deducted` and its element shape `{product_id, qty_base, unit, group_name, option_label}` consistent across Tasks 1, 3, 4, 5, 6; movement types `sale` (deduct) / `sale_void` (restore) consistent with the combo path and the `record_stock_movement_v1` forbid-list (direct inserts only).
- **Process:** subagents author SQL/tests; the controller applies migrations, runs pgTAP in cloud, regens types, redeploys the EF, and runs pattern-guardian (project memory: subagents have no MCP).
- **Adapt-to-body caveat:** the v13/v9/v2/v3 bodies use their own local variable names; each bump task fetches the real body via `pg_get_functiondef` and adapts the fragments to the existing locals rather than introducing parallel names.
