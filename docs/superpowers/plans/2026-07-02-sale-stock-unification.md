# Sale-Stock Unification (`_record_sale_stock_v1`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every sale-time stock deduction through one flag-aware internal helper `_record_sale_stock_v1`, eliminating the 9 raw `INSERT INTO stock_movements` in the 3 sale RPCs.

**Architecture:** A new `SECURITY DEFINER` helper owns the stock write (ledger + `products.current_stock` + `display_stock`/`display_movements` isolation + sufficiency guard). The 3 sale RPCs keep their business expansion (combo loop, `_resolve_recipe_consumption_v1`, modifier `jsonb_to_recordset`) and call the helper once per resolved terminal product. `complete_order_with_payment_v15` is refactored in place; `create_b2b_order_v2→v3` (becomes display-aware) and `pay_existing_order_v10→v11` (becomes flag-aware) are version-bumped.

**Tech Stack:** PostgreSQL/plpgsql on Supabase cloud V3 dev (`ikcyvlovptebroadgtvd`), pgTAP, TypeScript (React Query hooks), pnpm/turbo.

**Spec:** `docs/superpowers/specs/2026-07-02-sale-stock-unification-design.md`

## Global Constraints

- **DB target = Supabase cloud V3 dev `ikcyvlovptebroadgtvd`.** Docker is retired. Apply migrations via MCP `apply_migration`, run SQL/pgTAP via MCP `execute_sql` (`BEGIN … ROLLBACK` envelope), regen types via MCP `generate_typescript_types`. Never `supabase start`/`db reset`.
- **Subagents cannot reach Supabase MCP.** A subagent authors the `.sql`/`.ts` files; the **controller** performs every `apply_migration`, `execute_sql` (pgTAP), and `generate_typescript_types`. Plan steps marked **[CONTROLLER]** must run on the controller.
- **Monotonic migration numbers.** Highest existing = `20260710000072`. New files start at `20260710000073`.
- **RPC versioning:** never edit a published `_vN` *signature*; a behavior change bumps the version and `DROP FUNCTION …vN(<exact args>)` in the same migration. `create_b2b_order_v2` and `pay_existing_order_v10` bump; `complete_order_with_payment_v15` is a behavior-identical refactor → `CREATE OR REPLACE`, same v15.
- **Anon defense-in-depth:** every function migration ends with `REVOKE ALL … FROM PUBLIC` **and** `FROM anon`; the helper is additionally `REVOKE … FROM authenticated` (internal-only). Public RPCs keep `GRANT EXECUTE … TO authenticated`.
- **`complete_order_with_payment_v15` MUST keep `GRANT EXECUTE TO authenticated`** — the `process-payment` EF calls it via user JWT; without the grant the whole money-path breaks with `permission denied`.
- **Preserve the reference_type asymmetry:** `stock_movements.reference_type = 'orders'` (plural) but `display_movements.reference_type = 'order'` (singular). The BO `MovementHistoryDrawer.tsx:100` and reversal migration `20260628000017` depend on display `'order'`. The helper hardcodes `display_movements.reference_type = 'order'`.
- **Keep every existing upfront/inline stock validation in the flag-aware RPCs** (`v15`, `create_b2b_v3`) — the helper's own guard is redundant belt-and-suspenders there, guaranteeing byte-identical error behavior. **Exception:** `pay_existing_v11` must *drop* its inline unconditional sufficiency checks (they'd defeat the new flag) and rely on the helper's flag-aware guard.
- **Every helper call passes `p_allow_negative := <resolved flag>`** so a globally-allowed negative stock is not re-rejected at the write.
- **Idempotency stays at the order level** — the helper takes no idempotency key.
- Co-author commits: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Conventional commits.

---

### Task 1: Helper `_record_sale_stock_v1` + REVOKE + existence test

**Files:**
- Create: `supabase/migrations/20260710000073_record_sale_stock_v1.sql`
- Test: `supabase/tests/sale_stock_unification.test.sql` (Task 1 seeds the file with the existence/REVOKE assertions; later tasks append)

**Interfaces:**
- Produces: `_record_sale_stock_v1(p_product_id uuid, p_quantity numeric, p_reference_id uuid, p_created_by uuid, p_reason text, p_movement_type movement_type DEFAULT 'sale', p_reference_type text DEFAULT 'orders', p_unit text DEFAULT NULL, p_allow_negative boolean DEFAULT false) RETURNS void`. Deducts `p_quantity` (positive magnitude) from one resolved product: writes `stock_movements` (`quantity = -p_quantity`, `reference_type = p_reference_type`), decrements `products.current_stock`, and if `is_display_item` writes `display_movements` (`reference_type='order'`) + decrements `display_stock`. Raises on insufficiency unless `p_allow_negative`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260710000073_record_sale_stock_v1.sql`:

```sql
-- S53 P1.4 — single flag-aware sale-stock deduction helper.
-- Owns: stock_movements ledger + products.current_stock + display_stock/display_movements
-- isolation + sufficiency guard. Called once per resolved terminal product by the sale RPCs.
CREATE OR REPLACE FUNCTION public._record_sale_stock_v1(
  p_product_id     uuid,
  p_quantity       numeric,
  p_reference_id   uuid,
  p_created_by     uuid,
  p_reason         text,
  p_movement_type  movement_type DEFAULT 'sale',
  p_reference_type text          DEFAULT 'orders',
  p_unit           text          DEFAULT NULL,
  p_allow_negative boolean       DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_display boolean;
  v_current    numeric;
  v_unit       text;
  v_name       text;
  v_disp_qty   numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid sale quantity % for product %', p_quantity, p_product_id;
  END IF;

  SELECT is_display_item, current_stock, COALESCE(p_unit, unit, 'pcs'), name
    INTO v_is_display, v_current, v_unit, v_name
    FROM products WHERE id = p_product_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  -- Sufficiency guard (skipped when negative stock is allowed).
  IF v_is_display THEN
    SELECT quantity INTO v_disp_qty FROM display_stock WHERE product_id = p_product_id;
    IF NOT p_allow_negative AND COALESCE(v_disp_qty, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient display stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_disp_qty, 0);
    END IF;
  ELSE
    IF NOT p_allow_negative AND COALESCE(v_current, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_current, 0);
    END IF;
  END IF;

  -- Ledger (append-only). stock_movements.reference_type stays plural 'orders'.
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
  ) VALUES (
    p_product_id, p_movement_type, -p_quantity, v_unit, p_reference_type, p_reference_id, p_created_by
  );

  UPDATE products
    SET current_stock = current_stock - p_quantity, updated_at = now()
    WHERE id = p_product_id;

  -- Display isolation. display_movements.reference_type is the historical singular 'order'
  -- (read by BO MovementHistoryDrawer.tsx:100). Do NOT unify to 'orders'.
  IF v_is_display THEN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_product_id, p_movement_type, -p_quantity, p_reason, 'order', p_reference_id, p_created_by
    );
    UPDATE display_stock
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE product_id = p_product_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM authenticated;
```

- [ ] **Step 2: [CONTROLLER] Apply the migration**

MCP `apply_migration` on `ikcyvlovptebroadgtvd`, name `record_sale_stock_v1`, body = the file above.
Expected: success (no error).

- [ ] **Step 3: Write the existence/REVOKE pgTAP header + assertions**

Create `supabase/tests/sale_stock_unification.test.sql`:

```sql
BEGIN;
SELECT plan(4);

-- Helper exists with the exact 9-arg signature.
SELECT has_function('public', '_record_sale_stock_v1',
  ARRAY['uuid','numeric','uuid','uuid','text','movement_type','text','text','boolean'],
  'T1: _record_sale_stock_v1 exists (9 args)');

-- Internal-only: no EXECUTE for anon or authenticated or public.
SELECT ok(NOT has_function_privilege('anon',
  '_record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean)', 'EXECUTE'),
  'T2: anon EXECUTE revoked');
SELECT ok(NOT has_function_privilege('authenticated',
  '_record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean)', 'EXECUTE'),
  'T3: authenticated EXECUTE revoked');
SELECT ok(NOT has_function_privilege('public',
  '_record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean)', 'EXECUTE'),
  'T4: public EXECUTE revoked');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: [CONTROLLER] Run the pgTAP file**

MCP `execute_sql` with the file contents.
Expected: `ok 1..4`, no failures.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000073_record_sale_stock_v1.sql supabase/tests/sale_stock_unification.test.sql
git commit -m "feat(stock): _record_sale_stock_v1 — single flag-aware sale deduction helper (S53 P1.4)"
```

---

### Task 2: Refactor `complete_order_with_payment_v15` to call the helper (in place)

**Files:**
- Create: `supabase/migrations/20260710000074_complete_order_v15_use_sale_helper.sql` (full `CREATE OR REPLACE` of v15 with the 4 write blocks swapped)
- Source of truth for the body: `supabase/migrations/20260710000064_complete_order_v15_canonical_line_price.sql`
- Test: append to `supabase/tests/sale_stock_unification.test.sql`

**Interfaces:**
- Consumes: `_record_sale_stock_v1(...)` from Task 1.
- Produces: `complete_order_with_payment_v15(...)` — same 16-arg signature, same behavior, zero raw `INSERT INTO stock_movements`.

- [ ] **Step 1: Write the regression test FIRST (append to the suite)**

Append to `supabase/tests/sale_stock_unification.test.sql` (bump `plan(4)` → `plan(N)` at the top when adding). Add a test that fires a simple tracked line + a combo through `complete_order_with_payment_v15` and asserts exactly one `stock_movements` row per resolved product with the expected negative qty and `reference_type='orders'`, and that a display-item line also produced a `display_movements` row with `reference_type='order'`. Use the seeding pattern from `supabase/tests/s44_display_symmetry.test.sql` (same project fixtures). Concretely assert, after a known order:

```sql
-- (after seeding a tracked product P with current_stock=10 and completing an order of qty 3)
SELECT is(
  (SELECT current_stock FROM products WHERE id = :p_id), 7::numeric,
  'T5: v15 tracked line deducts via helper (10 - 3)');
SELECT is(
  (SELECT count(*) FROM stock_movements WHERE reference_id = :order_id AND product_id = :p_id AND movement_type='sale'),
  1::bigint, 'T6: exactly one sale movement for the line');
SELECT is(
  (SELECT reference_type FROM stock_movements WHERE reference_id = :order_id AND product_id = :p_id LIMIT 1),
  'orders', 'T7: stock_movements.reference_type stays plural');
```

(Replace `:p_id`/`:order_id` with the seeded UUIDs; follow the existing suite's `DECLARE`/`PERFORM` style rather than psql `:vars` if the suite uses a `DO` block.)

- [ ] **Step 2: [CONTROLLER] Run the suite; verify the new assertions FAIL or ERROR**

MCP `execute_sql`. Expected: the Task-2 assertions fail (v15 not yet refactored → the deltas are produced by raw inserts, so they may already pass). NOTE: because the refactor is behavior-identical, these assertions describe behavior that holds **both** before and after. Their job is a regression guard, not red→green. Confirm they PASS against current v15 to validate the fixtures, then keep them to prove the refactor didn't change behavior.

- [ ] **Step 3: Author the refactored v15 migration**

Copy the entire body of `20260710000064_…` into the new file `20260710000074_complete_order_v15_use_sale_helper.sql` as a `CREATE OR REPLACE FUNCTION public.complete_order_with_payment_v15(...)` with the identical 16-arg signature, `GRANT EXECUTE … TO authenticated, service_role` preserved. Then apply these four surgical substitutions:

**(A) Combo components** — replace the block at `…064` lines 655-678 (the `INSERT INTO stock_movements … SELECT … FROM products` + `UPDATE products` + `IF is_display_item … display_movements/display_stock`) with:

```sql
        PERFORM _record_sale_stock_v1(
          p_product_id     := (v_comp->>'product_id')::UUID,
          p_quantity       := v_comp_qty,
          p_reference_id   := v_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'POS combo sale',
          p_allow_negative := v_allow_negative
        );
```

**(B) Simple tracked line** — replace lines 687-710 with:

```sql
        PERFORM _record_sale_stock_v1(
          p_product_id     := v_product_id,
          p_quantity       := v_quantity,
          p_reference_id   := v_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'POS sale',
          p_allow_negative := v_allow_negative
        );
```

**(C) Recipe consumption** — replace lines 715-738 (inside the `FOR v_cons …` loop) with:

```sql
          PERFORM _record_sale_stock_v1(
            p_product_id     := v_cons.product_id,
            p_quantity       := v_cons.qty_base,
            p_reference_id   := v_order_id,
            p_created_by     := v_profile_id,
            p_reason         := 'POS recipe consumption',
            p_unit           := v_cons.unit,
            p_allow_negative := v_allow_negative
          );
```

**(D) Modifier ingredients** — replace lines 750-773 (inside the `FOR v_ing …` loop) with:

```sql
        PERFORM _record_sale_stock_v1(
          p_product_id     := v_ing.product_id,
          p_quantity       := v_ing.qty_base,
          p_reference_id   := v_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'POS modifier: ' || v_ing.group_name || ' / ' || v_ing.option_label,
          p_unit           := v_ing.unit,
          p_allow_negative := v_allow_negative
        );
```

Leave the **upfront validation phase** (the `display_stock`/`current_stock`/`_resolve_recipe_consumption_v1` sufficiency checks earlier in the function) UNCHANGED. Remove the now-unused local vars only if the compiler complains (`v_cons_is_display` becomes unused — delete its `DECLARE` line and the `SELECT is_display_item INTO v_cons_is_display` that no longer exists after substitution C).

- [ ] **Step 4: [CONTROLLER] Apply the migration**

MCP `apply_migration`, name `complete_order_v15_use_sale_helper`.
Expected: success.

- [ ] **Step 5: [CONTROLLER] Re-run the unification suite AND the anchors**

Run `supabase/tests/sale_stock_unification.test.sql`, then `supabase/tests/s44_display_symmetry.test.sql`, `supabase/tests/modifier_ingredient_deduction.test.sql`, `supabase/tests/combo_fire_pay.test.sql` via `execute_sql`.
Expected: all green (behavior-identical).

- [ ] **Step 6: [CONTROLLER] Verify zero raw inserts remain in v15**

Grep the new migration file for `INSERT INTO stock_movements` and `INSERT INTO display_movements`.
Expected: 0 hits.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260710000074_complete_order_v15_use_sale_helper.sql supabase/tests/sale_stock_unification.test.sql
git commit -m "refactor(stock): complete_order_with_payment_v15 deducts via _record_sale_stock_v1 (S53 P1.4)"
```

---

### Task 3: `create_b2b_order_v3` — display-aware via helper (DROP v2)

**Files:**
- Create: `supabase/migrations/20260710000075_create_b2b_order_v3.sql`
- Source of truth for the body: `supabase/migrations/20260710000069_create_b2b_order_v2_toctou.sql`
- Test: append to `supabase/tests/sale_stock_unification.test.sql`

**Interfaces:**
- Consumes: `_record_sale_stock_v1(...)`.
- Produces: `create_b2b_order_v3(p_customer_id uuid, p_items jsonb, p_notes text DEFAULT NULL, p_delivery_date date DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb` — same signature/return as v2. v2 dropped. Now decrements `display_stock` for `is_display_item` products.

- [ ] **Step 1: Write the failing test (append; bump plan count)**

Append an assertion: seed a B2B customer + a display-item product with `display_stock.quantity = 5`, create a B2B order of qty 2 via `create_b2b_order_v3`, assert `display_stock.quantity = 3` and one `display_movements` row (`reference_type='order'`). This is the new behavior (fails against v2 which had no display handling; but v2 is dropped by this task, so run it after apply as a green check).

```sql
SELECT is(
  (SELECT quantity FROM display_stock WHERE product_id = :b2b_disp_id), 3::numeric,
  'T8: B2B display item decrements display_stock via helper');
SELECT is(
  (SELECT count(*) FROM display_movements WHERE product_id = :b2b_disp_id AND reference_id = :b2b_order_id),
  1::bigint, 'T9: B2B display item writes a display_movements row');
```

- [ ] **Step 2: Author the v3 migration**

Copy the body of `20260710000069_…` into `20260710000075_create_b2b_order_v3.sql` as `CREATE OR REPLACE FUNCTION public.create_b2b_order_v3(...)` (rename v2→v3 in the header only; identical params). Replace the two deduction blocks (`…069` lines 203-231):

**Simple tracked** (`IF v_line_track THEN … INSERT stock_movements … UPDATE products …`) →
```sql
  IF v_line_track THEN
    PERFORM _record_sale_stock_v1(
      p_product_id     := v_product_id,
      p_quantity       := v_quantity,
      p_reference_id   := v_order_id,
      p_created_by     := v_profile_id,
      p_reason         := 'B2B sale',
      p_unit           := v_line_unit,
      p_allow_negative := v_allow_negative
    );
```

**Recipe consumption** (`ELSIF v_line_deduct THEN FOR v_cons … INSERT … UPDATE …`) →
```sql
  ELSIF v_line_deduct THEN
    FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_product_id, v_quantity) LOOP
      PERFORM _record_sale_stock_v1(
        p_product_id     := v_cons.product_id,
        p_quantity       := v_cons.qty_base,
        p_reference_id   := v_order_id,
        p_created_by     := v_profile_id,
        p_reason         := 'B2B recipe consumption',
        p_unit           := v_cons.unit,
        p_allow_negative := v_allow_negative
      );
    END LOOP;
  END IF;
```

Keep the upfront validation (lines 126-143) unchanged. Append the DROP + REVOKE/GRANT block at the end of the migration:

```sql
DROP FUNCTION IF EXISTS public.create_b2b_order_v2(uuid, jsonb, text, date, uuid);

REVOKE ALL ON FUNCTION public.create_b2b_order_v3(uuid, jsonb, text, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_b2b_order_v3(uuid, jsonb, text, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_b2b_order_v3(uuid, jsonb, text, date, uuid) TO authenticated;
```

- [ ] **Step 3: [CONTROLLER] Apply the migration**

MCP `apply_migration`, name `create_b2b_order_v3`. Expected: success.

- [ ] **Step 4: [CONTROLLER] Run the new B2B display assertions**

Expected: T8/T9 green.

- [ ] **Step 5: [CONTROLLER] Verify only v3 exists + zero raw inserts**

`execute_sql`: confirm `create_b2b_order_v2` no longer exists and `create_b2b_order_v3` does. Grep the migration file for `INSERT INTO stock_movements` → 0 hits.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260710000075_create_b2b_order_v3.sql supabase/tests/sale_stock_unification.test.sql
git commit -m "feat(b2b): create_b2b_order_v3 — display-aware deduction via helper; DROP v2 (S53 P1.4)"
```

---

### Task 4: `pay_existing_order_v11` — flag-aware via helper (DROP v10)

**Files:**
- Create: `supabase/migrations/20260710000076_pay_existing_order_v11.sql`
- Source of truth for the body: `supabase/migrations/20260705000016_bump_pay_existing_order_v10.sql`
- Test: append to `supabase/tests/sale_stock_unification.test.sql`

**Interfaces:**
- Consumes: `_record_sale_stock_v1(...)`.
- Produces: `pay_existing_order_v11(<same 12 args as v10>) RETURNS jsonb`. v10 dropped. Now reads `business_config.allow_negative_stock` and passes it to the helper; the inline unconditional sufficiency checks are removed.

- [ ] **Step 1: Write the flag-aware test (append; bump plan count)**

Append: with `business_config.allow_negative_stock = true`, fire a counter order (`fire_counter_order_v4`) for a tracked product whose stock is below the ordered qty, then `pay_existing_order_v11` → assert it succeeds and `current_stock` went negative. With `= false`, the same pay raises. Follow the fire→pay seeding in `supabase/tests/combo_fire_pay.test.sql`.

```sql
-- allow_negative_stock = true → negative allowed
SELECT lives_ok($$ SELECT pay_existing_order_v11(p_order_id := '…', p_payment := '{"method":"cash","amount":1000,"cash_received":1000,"change_given":0}'::jsonb) $$,
  'T10: pay_existing_v11 allows negative when flag ON');
-- allow_negative_stock = false → rejected
SELECT throws_ok($$ SELECT pay_existing_order_v11(p_order_id := '…', p_payment := '…'::jsonb) $$,
  NULL, NULL, 'T11: pay_existing_v11 rejects oversell when flag OFF');
```

- [ ] **Step 2: [CONTROLLER] Run; T10 fails against v10 (no flag support)**

Expected: T10 FAILS (v10 rejects unconditionally). This is the red state proving the behavior change is needed.

- [ ] **Step 3: Author the v11 migration**

Copy the body of `20260705000016_…` into `20260710000076_pay_existing_order_v11.sql` as `CREATE OR REPLACE FUNCTION public.pay_existing_order_v11(<same 12 args>)`. Changes:

1. Add a resolved-flag local near the top (after the existing `DECLARE`s):
```sql
  v_allow_negative boolean;
```
and after the initial guards:
```sql
  SELECT COALESCE(allow_negative_stock, false) INTO v_allow_negative FROM business_config LIMIT 1;
```

2. **Combo components** (`…016` lines 369-389) → replace the raw insert/update/display block with:
```sql
        PERFORM _record_sale_stock_v1(
          p_product_id     := v_comp_product.id,
          p_quantity       := v_comp_qty,
          p_reference_id   := p_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'POS combo sale (pay existing)',
          p_allow_negative := v_allow_negative
        );
```

3. **Simple items** (lines 405-427) → remove the inline `IF … < qty THEN RAISE` sufficiency check and the raw insert/update/display block, replace with:
```sql
      PERFORM _record_sale_stock_v1(
        p_product_id     := v_item.product_id,
        p_quantity       := v_item.quantity,
        p_reference_id   := p_order_id,
        p_created_by     := v_profile_id,
        p_reason         := 'POS sale (pay existing)',
        p_unit           := v_item.unit,
        p_allow_negative := v_allow_negative
      );
```

4. **Modifier ingredients** (lines 449-470) → remove the inline `SELECT … FOR UPDATE` availability check and the raw insert/update/display block, replace with:
```sql
      PERFORM _record_sale_stock_v1(
        p_product_id     := v_ing.product_id,
        p_quantity       := v_ing.qty_base,
        p_reference_id   := p_order_id,
        p_created_by     := v_profile_id,
        p_reason         := 'POS modifier (pay existing): ' || COALESCE(v_ing.group_name,'') || ' / ' || COALESCE(v_ing.option_label,''),
        p_unit           := v_ing.unit,
        p_allow_negative := v_allow_negative
      );
```

Append DROP + REVOKE/GRANT (preserve v10's grantees — it was gated on `permissions.process`, granted to `authenticated`):

```sql
DROP FUNCTION IF EXISTS public.pay_existing_order_v10(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb);

REVOKE ALL ON FUNCTION public.pay_existing_order_v11(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_existing_order_v11(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.pay_existing_order_v11(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb) TO authenticated;
```

> Verify the exact 12-arg type list against `20260705000016_…`'s signature before writing the DROP — copy it verbatim.

- [ ] **Step 4: [CONTROLLER] Apply + run T10/T11 + anchors**

Apply `pay_existing_order_v11`. Run the suite (T10/T11 green now), then re-run `s44_display_symmetry.test.sql`, `combo_fire_pay.test.sql`, `modifier_ingredient_deduction.test.sql`, `pay_existing_discount_gate.test.sql` — but note these still reference `pay_existing_order_v10`; they are repointed in Task 5, so expect them to ERROR here (function dropped). Defer their run to Task 5. Only the unification suite must be green now.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000076_pay_existing_order_v11.sql supabase/tests/sale_stock_unification.test.sql
git commit -m "feat(pos): pay_existing_order_v11 — flag-aware deduction via helper; DROP v10 (S53 P1.4)"
```

---

### Task 5: Regen types + repoint app call-sites + repoint existing tests

**Files:**
- Modify: `packages/supabase/src/types.generated.ts` (regen)
- Modify: `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts:124` (and header comment ~line 3)
- Modify: `apps/pos/src/features/payment/hooks/useCheckout.ts:8,169` (+ comments ~72,124,179)
- Modify pgTAP: `supabase/tests/b2b_foundation.test.sql`, `b2b_settlement.test.sql`, `b2b_order_flag_aware_stock.test.sql` (v2→v3); `combo_fire_pay.test.sql`, `s44_display_symmetry.test.sql`, `modifier_ingredient_deduction.test.sql`, `pay_existing_discount_gate.test.sql` (v10→v11)
- Modify Vitest/smoke: `supabase/tests/functions/record-b2b-payment.test.ts` (v2→v3); `apps/pos/src/__tests__/pay-existing.smoke.test.tsx`, `apps/pos/src/features/payment/__tests__/checkout-fired-order-sync.smoke.test.tsx` (v10→v11)
- Modify: `packages/domain/src/types/payment.ts:44` comment (v10→v11)

**Interfaces:**
- Consumes: `create_b2b_order_v3`, `pay_existing_order_v11` from Tasks 3-4.

- [ ] **Step 1: [CONTROLLER] Regen types**

MCP `generate_typescript_types` on `ikcyvlovptebroadgtvd`; write the `types` payload to `packages/supabase/src/types.generated.ts`.
Expected: `create_b2b_order_v3` and `pay_existing_order_v11` present; `…_v2`/`…_v10` gone.

- [ ] **Step 2: Repoint the BO hook**

In `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts`, change `supabase.rpc('create_b2b_order_v2', rpcArgs as any)` → `'create_b2b_order_v3'` and update the header comment referencing `_069`/`v2`.

- [ ] **Step 3: Repoint the POS hook**

In `apps/pos/src/features/payment/hooks/useCheckout.ts`: line 8 `Database['public']['Functions']['pay_existing_order_v10']['Args']` → `['pay_existing_order_v11']['Args']`; line 169 `supabase.rpc('pay_existing_order_v10', …)` → `'pay_existing_order_v11'`; update the surrounding comments (72, 124, 179) mentioning `pay_existing_order_v10`.

- [ ] **Step 4: Repoint the tests (string replacements)**

In each listed pgTAP + Vitest + smoke file, replace `create_b2b_order_v2`→`create_b2b_order_v3` and `pay_existing_order_v10`→`pay_existing_order_v11`. In `combo_fire_pay.test.sql`, also update the anon-EXECUTE assertion's function signature string to `pay_existing_order_v11(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb)`. Update `packages/domain/src/types/payment.ts:44` comment.

- [ ] **Step 5: [CONTROLLER] Run the repointed pgTAP anchors**

`execute_sql` each of `b2b_foundation`, `b2b_settlement`, `b2b_order_flag_aware_stock`, `combo_fire_pay`, `s44_display_symmetry`, `modifier_ingredient_deduction`, `pay_existing_discount_gate`.
Expected: all green.

- [ ] **Step 6: Run app tests**

```bash
pnpm --filter @breakery/backoffice test btob
pnpm --filter @breakery/pos test pay-existing
pnpm --filter @breakery/pos test checkout
```
Expected: green (repointed RPC names match the regenerated types).

- [ ] **Step 7: Commit**

```bash
git add packages/supabase/src/types.generated.ts apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts apps/pos/src/features/payment/hooks/useCheckout.ts packages/domain/src/types/payment.ts supabase/tests/
git commit -m "chore(stock): regen types + repoint call-sites/tests to create_b2b_order_v3 & pay_existing_order_v11 (S53 P1.4)"
```

---

### Task 6: Full verification + session closeout docs

**Files:**
- Modify: `CLAUDE.md` (Active Workplan bump: In flight → S53 done, Merged latest → P1.4)
- Create: `docs/workplan/plans/2026-07-02-session-53-INDEX.md`

**Interfaces:** none (verification + docs).

- [ ] **Step 1: [CONTROLLER] Full DB regression**

Run the whole unification suite + all anchors once more, plus `supabase/tests/inventory.test.sql` (steady-state), via `execute_sql`.
Expected: all green.

- [ ] **Step 2: Build + typecheck**

```bash
pnpm build && pnpm typecheck
```
Expected: success (no type errors from the RPC rename).

- [ ] **Step 3: [CONTROLLER] Confirm zero raw sale inserts remain**

Grep `supabase/migrations/20260710000074_*.sql`, `…075_*.sql`, `…076_*.sql` for `INSERT INTO stock_movements`.
Expected: 0 hits across all three.

- [ ] **Step 4: Write the session INDEX**

Create `docs/workplan/plans/2026-07-02-session-53-INDEX.md` summarizing: helper `_record_sale_stock_v1`, migrations `…073..076`, v3/v11 bumps, B2B display fix, pay_existing flag fix, the reference_type-asymmetry decision, and the pgTAP suite `sale_stock_unification`. Follow the layout of `docs/workplan/plans/2026-06-29-session-52-INDEX.md`.

- [ ] **Step 5: Bump CLAUDE.md Active Workplan**

Move P1.4 from "In flight" to "Merged (latest)" with the migration range and the RPC version bumps; note the money-path RPC is now `complete_order_with_payment_v15` (unchanged version) deducting via `_record_sale_stock_v1`, `create_b2b_order_v3`, `pay_existing_order_v11`. Update the "Order writes go through RPCs" critical-patterns line with the new versions.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/workplan/plans/2026-07-02-session-53-INDEX.md
git commit -m "docs(stock): S53 INDEX + CLAUDE.md bump — sale-stock unification (P1.4)"
```

---

## Self-Review

**Spec coverage:**
- Helper §4 → Task 1. ✅
- v15 refactor §5 → Task 2. ✅
- create_b2b_order_v3 display-aware §3/§5 → Task 3. ✅
- pay_existing_order_v11 flag-aware §3/§5 → Task 4. ✅
- Call-site + test repoint §6 → Task 5. ✅
- pgTAP suite + anchors §7 → Tasks 1-6. ✅
- Migration sequencing §8 → Tasks 1-4 (`…073..076`). ✅
- Risks §9 (v15 GRANT, reference_type asymmetry, upfront validation) → Global Constraints + Task 2 Step 3. ✅
- Acceptance §10 → Task 6. ✅

**Deviations from spec (documented):**
1. Spec §5 said "remove upfront validation loops"; the plan **keeps** them in `v15`/`create_b2b_v3` (redundant with the helper) to guarantee byte-identical error behavior on the money-path, and only removes the inline unconditional checks in `pay_existing_v11` (required for the flag change). Lower risk, same end state (zero raw inserts).
2. Helper hardcodes `display_movements.reference_type = 'order'` (not from `p_reference_type`) to preserve the stock/display asymmetry the BO UI depends on — discovered during planning.

**Placeholder scan:** the pgTAP assertions use `:p_id`/`'…'` placeholders for seeded UUIDs — the implementer fills these from the seeding block (the existing anchor suites show the exact fixtures). All SQL/TS transformation fragments are concrete.

**Type consistency:** helper signature (9 args) is identical in Task 1 definition, the REVOKE lines, and the `has_function` assertion. `create_b2b_order_v3` (5 args) and `pay_existing_order_v11` (12 args) match their DROP/REVOKE/GRANT signatures and the type-regen expectations.
