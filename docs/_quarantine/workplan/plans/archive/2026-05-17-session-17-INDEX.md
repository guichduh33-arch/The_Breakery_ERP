# Session 17 — INDEX (Full Price Chain : PO → Cost → Recipe Cascade → Snapshot History)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-05-17
**Branch:** `swarm/session-17` (off `f7c83b2` master, post-PR #20 merge)
**Spec:** [`../specs/2026-05-17-session-17-spec.md`](../../specs/archive/2026-05-17-session-17-spec.md)
**Migration block reserved:** `20260521000001..099`

---

## 1. Goal global

Close the price-tracking loop on production recipes : PO receipt → WAC `cost_price` update → cascade snapshot in `recipe_versions` for every transitive ancestor. Resolves DEV-S16-2.B-01, 2.B-03/04/05, 2.C-01, 2.C-02 + new « PO→cost » requirement.

**Total phases exécutables : 7** (Wave 0..4, with Wave 1 internally sequenced).
**Effort estimé : ~18h parallel, ~25h solo.**

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec + INDEX + branch creation
        │
        ▼
Wave 1 (DB chain — internally sequenced)
  ├── Phase 1.A : helper + recipes trigger refactor (PREREQUISITE)
  │        │  blocks 1.B (depends on helper)
  │        ▼
  ├── Phase 1.B : products.cost_price snapshot trigger
  ├── Phase 1.C : WAC trigger on stock_movements (parallel)
  └── Phase 1.D : recipe_bom_full_v1 RPC + refresh (parallel)
        │
        ▼ Wave 1 sync gate (cloud pgTAP smoke)
Wave 2 — Phase 2.A : UI rewire (IngredientAggregatePreview)
        │
        ▼ Wave 2 sync gate
Wave 3 — Phase 3.A : reviewer pass + types regen merge
        │
        ▼
Wave 4 — Phase 4.A : tests + build + CLAUDE.md + PR draft
```

**Cascade chain (end-to-end after merge) :**

```
PO received
   │ INSERT stock_movements (movement_type='purchase', unit_cost=X, quantity=Q)
   │
   ├─► tr_update_product_cost_on_purchase (NEW, Phase 1.C)
   │     WAC : new_cost = round((S_old × C_old + Q × X) / (S_old + Q), 2)
   │     UPDATE products.cost_price IF DISTINCT
   │
   └─► tr_snapshot_on_product_cost_change (NEW, Phase 1.B)
         WITH RECURSIVE ancestor walk of products.cost_price.NEW.id
         For each ancestor with recipe : _snapshot_recipe_version(...)
              │
              └─► INSERT recipe_versions (append-only)

Independent paths to same _snapshot_recipe_version helper :
  • recipes INSERT/UPDATE/DELETE → tr_snapshot_recipe_version (REFACTOR, Phase 1.A)
  • UI preview reads via recipe_bom_full_v1 RPC (NEW, Phase 1.D)
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch (DOING — ce doc + spec sœur)

**Files :**
- `docs/workplan/specs/2026-05-17-session-17-spec.md` ✓
- `docs/workplan/plans/2026-05-17-session-17-INDEX.md` ✓ (this doc)

**Steps :**
- [x] Spec dated, 15 decisions D1-D15, 4 waves + waves 1.A..1.D listed
- [x] INDEX dated, 4 waves (1.A prereq), parallelization map, comms map
- [ ] Branch `swarm/session-17` created off `f7c83b2` (lead, before Wave 1 start)
- [ ] CLAUDE.md "Active Workplan" pointer updated to Session 17 (closeout)

**Complexity** : **S** (~2h, done before kickoff).
**Suggested executor** : lead.

---

## 4. Wave 1 — DB chain

### Phase 1.A — Snapshot helper + recipes trigger refactor (PREREQ, solo)

Resolves `DEV-S16-2.B-01` (full cascade), `DEV-S16-2.B-03` (remove WHEN OTHERS), `DEV-S16-2.B-04` (COALESCE NULL cost), `DEV-S16-2.B-05` (descriptive change_note).

**Module(s)** : 15 (Production).

**Files :**
- `supabase/migrations/20260521000010_create_snapshot_recipe_version_helper.sql` (CREATE)
- `supabase/migrations/20260521000011_bump_tr_snapshot_recipe_version_cascade.sql` (CREATE)
- `supabase/tests/recipe_cascade_snapshot.test.sql` (CREATE — partial : recipes-mutation tests only ; cost_price tests added in 1.B)

- [ ] **Step 1 — Create helper migration `20260521000010`**

Apply via MCP `apply_migration` with `project_id='ikcyvlovptebroadgtvd'`, `name='create_snapshot_recipe_version_helper'`. SQL body :

```sql
-- 20260521000010_create_snapshot_recipe_version_helper.sql
-- Session 17 / Phase 1.A — Factorise recipe_versions INSERT.
--
-- Internal helper called by tr_snapshot_recipe_version (recipes events) AND
-- tr_snapshot_on_product_cost_change (products.cost_price events). Reuses
-- _calculate_recipe_cost_walk for full-cascade product_cost_at_version.
--
-- NOT permission-gated — callers (triggers) own the security context.

CREATE OR REPLACE FUNCTION _snapshot_recipe_version(
  p_product_id  UUID,
  p_change_note TEXT,
  p_profile     UUID
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_next_version INT;
  v_items        JSONB;
  v_cost         NUMERIC(14,2);
  v_walk         JSONB;
  v_version_id   UUID;
BEGIN
  -- Build items array snapshot from current recipes state.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'recipe_id',           r.id,
        'material_id',         r.material_id,
        'material_name',       m.name,
        'quantity',            r.quantity,
        'unit',                r.unit,
        'notes',               r.notes,
        'material_cost_price', m.cost_price
      ) ORDER BY m.name
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM recipes r
  JOIN products m ON m.id = r.material_id
  WHERE r.product_id = p_product_id
    AND r.is_active  = TRUE
    AND r.deleted_at IS NULL;

  -- Full-cascade cost (D1) — bypasses permission gate via internal helper.
  v_walk := _calculate_recipe_cost_walk(p_product_id, 5, 1, ARRAY[]::UUID[]);
  v_cost := COALESCE((v_walk->>'cost_per_unit')::NUMERIC(14,2), 0);

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM recipe_versions
   WHERE product_id = p_product_id;

  INSERT INTO recipe_versions (product_id, version_number, snapshot, created_by, change_note)
  VALUES (
    p_product_id,
    v_next_version,
    jsonb_build_object(
      'items',                   v_items,
      'product_cost_at_version', v_cost
    ),
    p_profile,
    p_change_note
  )
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END $$;

COMMENT ON FUNCTION _snapshot_recipe_version(UUID, TEXT, UUID) IS
  'Session 17 — Phase 1.A. Factorised helper for recipe_versions INSERT. '
  'Used by tr_snapshot_recipe_version + tr_snapshot_on_product_cost_change. '
  'Computes product_cost_at_version via _calculate_recipe_cost_walk (full cascade, '
  'depth=5). NOT permission-gated.';
```

- [ ] **Step 2 — Apply migration via MCP and verify**

```
mcp__plugin_supabase_supabase__apply_migration
  project_id: ikcyvlovptebroadgtvd
  name: create_snapshot_recipe_version_helper
  query: <SQL from step 1>
```

Expected : `{success: true}`.

- [ ] **Step 3 — Create trigger refactor migration `20260521000011`**

```sql
-- 20260521000011_bump_tr_snapshot_recipe_version_cascade.sql
-- Session 17 / Phase 1.A — Refactor recipes trigger : full-cascade cost +
-- ancestor cascade snapshots + cleanups (DEV-S16-2.B-03/04/05).

CREATE OR REPLACE FUNCTION tr_snapshot_recipe_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_id   UUID;
  v_action       TEXT;
  v_profile      UUID;
  v_product_name TEXT;
  v_ancestor     RECORD;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
    v_action     := 'delete';
  ELSE
    v_product_id := NEW.product_id;
    v_action     := lower(TG_OP);
  END IF;

  -- DEV-S16-2.B-03 : SELECT INTO leaves v_profile NULL on no-row, no exception
  -- block needed. Removed `WHEN OTHERS` dead-code.
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;

  -- 1) Snapshot the directly-edited product.
  PERFORM _snapshot_recipe_version(v_product_id, v_action, v_profile);

  -- 2) Cascade : snapshot each ancestor that consumes v_product_id transitively.
  SELECT name INTO v_product_name FROM products WHERE id = v_product_id;

  FOR v_ancestor IN
    WITH RECURSIVE ancestors AS (
      SELECT DISTINCT r.product_id
        FROM recipes r
       WHERE r.material_id = v_product_id
         AND r.is_active = TRUE
         AND r.deleted_at IS NULL
      UNION
      SELECT DISTINCT r.product_id
        FROM recipes r
        JOIN ancestors a ON r.material_id = a.product_id
       WHERE r.is_active = TRUE
         AND r.deleted_at IS NULL
    )
    SELECT product_id FROM ancestors
  LOOP
    PERFORM _snapshot_recipe_version(
      v_ancestor.product_id,
      'cascade: ' || COALESCE(v_product_name, v_product_id::TEXT) || ' changed',
      v_profile
    );
  END LOOP;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION tr_snapshot_recipe_version() IS
  'Session 17 / Phase 1.A (bumped from S16 / Phase 2.B). AFTER INSERT/UPDATE/DELETE '
  'on `recipes`. Snapshots the directly-edited product AND every transitive ancestor '
  '(WITH RECURSIVE walk on recipes.material_id). product_cost_at_version is now '
  'full-cascade depth-5 via _calculate_recipe_cost_walk. WHEN OTHERS removed (D11).';
```

- [ ] **Step 4 — Apply via MCP**

```
mcp__plugin_supabase_supabase__apply_migration
  project_id: ikcyvlovptebroadgtvd
  name: bump_tr_snapshot_recipe_version_cascade
  query: <SQL from step 3>
```

- [ ] **Step 5 — Write recipes-mutation portion of pgTAP test**

Create `supabase/tests/recipe_cascade_snapshot.test.sql` with the recipes-mutation tests (cost_price tests added in Phase 1.B/1.C steps). Structure :

```sql
BEGIN;
SELECT plan(20);

-- Fixture : seed two products, one with a sub-recipe.
-- (Use existing seed UUIDs from supabase/migrations/20260518000001_seed_breakery_demo.sql)
-- DECLARE :
--   v_flour    UUID := 'a36c1234-...'  -- leaf raw material
--   v_dough    UUID := 'b78d5678-...'  -- sub-recipe (uses flour)
--   v_pain     UUID := 'c91e9abc-...'  -- recipe (uses dough)

-- Test 1 : Edit recipes for v_dough → 2 snapshots (dough + pain).
SELECT lives_ok(
  $$ INSERT INTO recipes(product_id, material_id, quantity, unit, is_active)
     VALUES ('<v_dough>', '<v_flour>', 0.500, 'kg', TRUE) $$,
  'insert into recipes for sub-recipe'
);
SELECT is(
  (SELECT count(*) FROM recipe_versions
    WHERE product_id IN ('<v_dough>', '<v_pain>') AND change_note IN ('insert', 'cascade: croissant_dough changed')),
  2::bigint,
  'cascade: 2 snapshots created (dough self + pain ancestor)'
);

-- Test 2 : Verify product_cost_at_version is full-cascade (not depth-1).
SELECT is(
  (SELECT (snapshot->>'product_cost_at_version')::NUMERIC FROM recipe_versions
    WHERE product_id = '<v_pain>' ORDER BY version_number DESC LIMIT 1),
  (SELECT (_calculate_recipe_cost_walk('<v_pain>', 5, 1, ARRAY[]::UUID[])->>'cost_per_unit')::NUMERIC),
  'full-cascade cost matches walker output'
);

-- ... (≈15 more tests for: depth-3, cycle stub, change_note format, etc.)

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 6 — Run pgTAP via MCP**

```
mcp__plugin_supabase_supabase__execute_sql
  project_id: ikcyvlovptebroadgtvd
  query: <BEGIN; \i recipe_cascade_snapshot.test.sql ; ROLLBACK contents>
```

Expected : `ok 1 ... ok N` ; no FAIL lines.

- [ ] **Step 7 — Commit**

```bash
git add supabase/migrations/20260521000010_create_snapshot_recipe_version_helper.sql \
        supabase/migrations/20260521000011_bump_tr_snapshot_recipe_version_cascade.sql \
        supabase/tests/recipe_cascade_snapshot.test.sql
git commit -m "feat(production): session 17 — phase 1.A — full-cascade snapshot + ancestor walk"
```

**DoD :**
- [ ] `_snapshot_recipe_version(UUID, TEXT, UUID)` exists, returns UUID.
- [ ] `tr_snapshot_recipe_version` no longer contains `WHEN OTHERS`.
- [ ] WITH RECURSIVE ancestor walk verified : edit on depth-2 sub-recipe creates 3+ snapshots.
- [ ] `product_cost_at_version` exactly matches `_calculate_recipe_cost_walk(p, 5, ...)`.
- [ ] Existing recipes pgTAP suite (S15/S16) still green.

**Complexity** : **L** (~5h, includes anti-cycle fixture).
**Dependencies** : Wave 0.
**Suggested executor** : `recipes-trigger-arch` (backend-dev + DB SQL).
**Parallelization tag** : PREREQUISITE solo — blocks Phase 1.B.

---

### Phase 1.B — products.cost_price snapshot trigger (depends on 1.A)

**Module(s)** : 15 (Production), 05 (Products peripheral).

**Files :**
- `supabase/migrations/20260521000012_create_tr_snapshot_on_product_cost_change.sql` (CREATE)
- `supabase/tests/recipe_cascade_snapshot.test.sql` (UPDATE — append cost_price tests)

- [ ] **Step 1 — Create migration `20260521000012`**

```sql
-- 20260521000012_create_tr_snapshot_on_product_cost_change.sql
-- Session 17 / Phase 1.B — When products.cost_price changes, snapshot every
-- ancestor recipe that depends on this product. Closes the chronological
-- tracking loop for raw material price changes.

CREATE OR REPLACE FUNCTION tr_snapshot_on_product_cost_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_profile     UUID;
  v_change_note TEXT;
  v_ancestor    RECORD;
BEGIN
  -- Guard : noop if cost_price didn't actually change.
  IF OLD.cost_price IS NOT DISTINCT FROM NEW.cost_price THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;

  v_change_note := format(
    'material price update: %s %s→%s',
    NEW.name,
    COALESCE(OLD.cost_price::TEXT, 'NULL'),
    COALESCE(NEW.cost_price::TEXT, 'NULL')
  );

  -- D11 : skip ancestors without recipe (filtered implicitly by WITH RECURSIVE).
  FOR v_ancestor IN
    WITH RECURSIVE ancestors AS (
      SELECT DISTINCT r.product_id
        FROM recipes r
       WHERE r.material_id = NEW.id
         AND r.is_active = TRUE
         AND r.deleted_at IS NULL
      UNION
      SELECT DISTINCT r.product_id
        FROM recipes r
        JOIN ancestors a ON r.material_id = a.product_id
       WHERE r.is_active = TRUE
         AND r.deleted_at IS NULL
    )
    SELECT product_id FROM ancestors
  LOOP
    PERFORM _snapshot_recipe_version(v_ancestor.product_id, v_change_note, v_profile);
  END LOOP;

  RETURN NULL;
END $$;

CREATE TRIGGER tr_snapshot_on_product_cost_change
AFTER UPDATE OF cost_price ON products
FOR EACH ROW
WHEN (OLD.cost_price IS DISTINCT FROM NEW.cost_price)
EXECUTE FUNCTION tr_snapshot_on_product_cost_change();

COMMENT ON FUNCTION tr_snapshot_on_product_cost_change() IS
  'Session 17 / Phase 1.B. On products.cost_price UPDATE, snapshots every '
  'ancestor recipe that consumes this product (WITH RECURSIVE walk on '
  'recipes.material_id). Skips ancestors without recipe.';
```

- [ ] **Step 2 — Apply via MCP**

```
mcp__plugin_supabase_supabase__apply_migration
  project_id: ikcyvlovptebroadgtvd
  name: create_tr_snapshot_on_product_cost_change
  query: <SQL from step 1>
```

- [ ] **Step 3 — Append cost_price tests to `recipe_cascade_snapshot.test.sql`**

Add tests inside the same `BEGIN; ... ROLLBACK` envelope :

```sql
-- Test N : Update raw material cost_price → cascade snapshots only.
UPDATE products SET cost_price = 15000 WHERE id = '<v_flour>';

SELECT is(
  (SELECT count(*) FROM recipe_versions
    WHERE product_id IN ('<v_dough>', '<v_pain>')
      AND change_note LIKE 'material price update: flour%'),
  2::bigint,
  'flour cost change : 2 ancestor snapshots (dough + pain)'
);

SELECT is(
  (SELECT count(*) FROM recipe_versions
    WHERE product_id = '<v_flour>'
      AND change_note LIKE 'material price update:%'),
  0::bigint,
  'flour itself : no snapshot (no recipe of its own)'
);

-- Test N+1 : Update cost_price to same value → noop guard.
UPDATE products SET cost_price = 15000 WHERE id = '<v_flour>';
SELECT is(
  (SELECT count(*) FROM recipe_versions
    WHERE change_note LIKE 'material price update: flour 15000→15000'),
  0::bigint,
  'noop update : no snapshot'
);

-- Test N+2 : change_note format.
SELECT matches(
  (SELECT change_note FROM recipe_versions
    WHERE product_id = '<v_dough>'
      AND change_note LIKE 'material price update: flour%'
    ORDER BY version_number DESC LIMIT 1),
  '^material price update: flour \d+→\d+$',
  'change_note matches format'
);
```

- [ ] **Step 4 — Run pgTAP via MCP**

Expected all NEW tests pass + previous (1.A) tests still pass.

- [ ] **Step 5 — Commit**

```bash
git add supabase/migrations/20260521000012_create_tr_snapshot_on_product_cost_change.sql \
        supabase/tests/recipe_cascade_snapshot.test.sql
git commit -m "feat(production): session 17 — phase 1.B — cascade snapshot on products.cost_price change"
```

**DoD :**
- [ ] `tr_snapshot_on_product_cost_change` exists with WHEN clause.
- [ ] UPDATE on leaf material `cost_price` → snapshots created for ancestors only (not the leaf itself).
- [ ] Noop UPDATE (same value) → no snapshot.
- [ ] `change_note` format `'material price update: <name> <old>→<new>'`.

**Complexity** : **M** (~3h).
**Dependencies** : Phase 1.A (uses `_snapshot_recipe_version` helper).
**Suggested executor** : `cost-cascade-arch` (backend-dev + DB SQL).
**Parallelization tag** : parallel with 1.C, 1.D after 1.A.

---

### Phase 1.C — WAC trigger on stock_movements (parallel)

**Module(s)** : 06 (Inventory), 07 (Purchasing peripheral).

**Files :**
- `supabase/migrations/20260521000013_create_tr_update_product_cost_on_purchase.sql` (CREATE)
- `supabase/tests/recipe_cascade_snapshot.test.sql` (UPDATE — append WAC tests)

- [ ] **Step 1 — Create migration `20260521000013`**

```sql
-- 20260521000013_create_tr_update_product_cost_on_purchase.sql
-- Session 17 / Phase 1.C — Auto-update products.cost_price via WAC on PO
-- receipt. Fires on stock_movements where movement_type='purchase'.
-- Reads products.current_stock + cost_price BEFORE record_stock_movement_v1's
-- downstream UPDATE products SET current_stock = v_new (D5).

CREATE OR REPLACE FUNCTION tr_update_product_cost_on_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old_stock NUMERIC;
  v_old_cost  NUMERIC;
  v_new_cost  NUMERIC(14,2);
BEGIN
  -- Guards (D7).
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RETURN NULL;
  END IF;
  IF NEW.unit_cost IS NULL OR NEW.unit_cost <= 0 THEN
    RETURN NULL;
  END IF;

  -- Pre-movement state (current_stock not yet updated by RPC).
  SELECT current_stock, cost_price INTO v_old_stock, v_old_cost
    FROM products WHERE id = NEW.product_id;

  IF v_old_stock IS NULL OR v_old_stock <= 0 OR v_old_cost IS NULL OR v_old_cost <= 0 THEN
    -- First receipt or stock-empty state : seed cost from PO line.
    v_new_cost := round(NEW.unit_cost::NUMERIC, 2);
  ELSE
    v_new_cost := round(
      ((v_old_stock * v_old_cost) + (NEW.quantity * NEW.unit_cost))
        / (v_old_stock + NEW.quantity),
      2
    );
  END IF;

  UPDATE products
    SET cost_price = v_new_cost, updated_at = now()
   WHERE id = NEW.product_id
     AND cost_price IS DISTINCT FROM v_new_cost;

  RETURN NULL;
END $$;

CREATE TRIGGER tr_update_product_cost_on_purchase
AFTER INSERT ON stock_movements
FOR EACH ROW
WHEN (NEW.movement_type = 'purchase')
EXECUTE FUNCTION tr_update_product_cost_on_purchase();

COMMENT ON FUNCTION tr_update_product_cost_on_purchase() IS
  'Session 17 / Phase 1.C. WAC auto-update of products.cost_price on purchase '
  'stock_movements. new_cost = round((old_stock × old_cost + qty × unit_cost) '
  '/ (old_stock + qty), 2). Skips qty≤0, unit_cost≤0, empty stock seeds from '
  'unit_cost.';
```

- [ ] **Step 2 — Apply via MCP**

```
mcp__plugin_supabase_supabase__apply_migration
  project_id: ikcyvlovptebroadgtvd
  name: create_tr_update_product_cost_on_purchase
  query: <SQL from step 1>
```

- [ ] **Step 3 — Append WAC tests to `recipe_cascade_snapshot.test.sql`**

```sql
-- Test M : First-receipt seed.
UPDATE products SET cost_price = NULL, current_stock = 0 WHERE id = '<v_flour>';
-- Insert purchase stock_movement directly via record_stock_movement_v1 RPC
-- (NOT raw INSERT — see CLAUDE.md "stock_movements is append-only ledger").
SELECT record_stock_movement_v1(
  p_product_id      := '<v_flour>',
  p_movement_type   := 'purchase',
  p_quantity        := 10,
  p_unit_cost       := 12000,
  p_unit            := 'kg',
  p_reason          := 'wac-test-seed',
  p_to_section_id   := '<v_section>'
);
SELECT is(
  (SELECT cost_price FROM products WHERE id = '<v_flour>'),
  12000::NUMERIC(14,2),
  'first-receipt seeds cost_price = unit_cost'
);

-- Test M+1 : WAC blend.
-- old_stock=10, old_cost=12000, qty=5, unit_cost=15000 → (10*12000 + 5*15000)/15 = 13000.
SELECT record_stock_movement_v1(
  p_product_id      := '<v_flour>',
  p_movement_type   := 'purchase',
  p_quantity        := 5,
  p_unit_cost       := 15000,
  p_unit            := 'kg',
  p_reason          := 'wac-test-blend',
  p_to_section_id   := '<v_section>'
);
SELECT is(
  (SELECT cost_price FROM products WHERE id = '<v_flour>'),
  13000.00::NUMERIC(14,2),
  'WAC blend : (10×12000 + 5×15000)/15 = 13000'
);

-- Test M+2 : cascade fired (via 1.B trigger) on cost change.
SELECT is(
  (SELECT count(*) FROM recipe_versions
    WHERE product_id IN ('<v_dough>', '<v_pain>')
      AND change_note LIKE 'material price update: flour%'),
  4::bigint, -- 2 from seed + 2 from blend
  'WAC change cascades to ancestor snapshots'
);

-- Test M+3 : qty<=0 guard.
-- (Cannot easily test via record_stock_movement_v1 — would need a movement_type
-- supporting negative qty. Test on a non-purchase type → guard via WHEN clause.)
SELECT record_stock_movement_v1(
  p_product_id      := '<v_flour>',
  p_movement_type   := 'sale',
  p_quantity        := 5,
  p_unit_cost       := 99999,
  p_unit            := 'kg',
  p_reason          := 'wac-test-nontype',
  p_from_section_id := '<v_section>'
);
SELECT is(
  (SELECT cost_price FROM products WHERE id = '<v_flour>'),
  13000.00::NUMERIC(14,2),
  'non-purchase movement does not change cost_price'
);

-- Test M+4 : unit_cost=0 guard.
SELECT record_stock_movement_v1(
  p_product_id      := '<v_flour>',
  p_movement_type   := 'purchase',
  p_quantity        := 5,
  p_unit_cost       := 0,
  p_unit            := 'kg',
  p_reason          := 'wac-test-zero-cost',
  p_to_section_id   := '<v_section>'
);
SELECT is(
  (SELECT cost_price FROM products WHERE id = '<v_flour>'),
  13000.00::NUMERIC(14,2),
  'unit_cost=0 (free goods) does not change cost_price'
);
```

- [ ] **Step 4 — Run pgTAP via MCP**

- [ ] **Step 5 — Commit**

```bash
git add supabase/migrations/20260521000013_create_tr_update_product_cost_on_purchase.sql \
        supabase/tests/recipe_cascade_snapshot.test.sql
git commit -m "feat(inventory): session 17 — phase 1.C — WAC auto-update of products.cost_price on PO"
```

**DoD :**
- [ ] First-receipt (stock=0, cost=NULL) seeds `cost_price = unit_cost`.
- [ ] WAC formula verified : `(10×12000 + 5×15000) / 15 = 13000.00`.
- [ ] Non-purchase movement types do NOT fire the trigger (WHEN clause).
- [ ] `unit_cost = 0` skipped (guard).
- [ ] Idempotent re-receipt with same unit_cost = old_cost → no UPDATE (IS DISTINCT FROM).
- [ ] End-to-end : PO receipt cascades all the way to `recipe_versions` rows.

**Complexity** : **M** (~3h).
**Dependencies** : Phase 1.B (cascade trigger) for end-to-end test (Phase 1.C can deploy first ; cost_price will just update without cascade until 1.B lands).
**Suggested executor** : `wac-trigger-arch` (backend-dev + DB SQL).
**Parallelization tag** : parallel with 1.B, 1.D after 1.A.

---

### Phase 1.D — recipe_bom_full_v1 RPC + refresh (parallel)

Resolves `DEV-S16-2.C-02` (BFS depth) + `DEV-S16-2.C-01` (1 RPC vs N round-trips).

**Module(s)** : 15 (Production), 06 (Inventory peripheral).

**Files :**
- `supabase/migrations/20260521000020_create_recipe_bom_full_v1_rpc.sql` (CREATE)
- `supabase/migrations/20260521000030_refresh_latest_recipe_version_full_cascade.sql` (CREATE)
- `supabase/tests/recipe_bom_full_v1.test.sql` (CREATE)
- `supabase/tests/functions/recipe-bom-full.test.ts` (CREATE)

- [ ] **Step 1 — Create RPC migration `20260521000020`**

```sql
-- 20260521000020_create_recipe_bom_full_v1_rpc.sql
-- Session 17 / Phase 1.D — Server-side leaves-only BoM for production preview.

CREATE OR REPLACE FUNCTION recipe_bom_full_v1(
  p_product_id UUID,
  p_max_depth  INT DEFAULT 5
) RETURNS TABLE(
  material_id    UUID,
  material_name  TEXT,
  material_unit  TEXT,
  qty_per_unit   NUMERIC,
  current_stock  NUMERIC,
  cost_price     NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_depth IS NULL OR p_max_depth < 1 OR p_max_depth > 20 THEN
    RAISE EXCEPTION 'invalid_max_depth' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH RECURSIVE walk AS (
    -- Root rows
    SELECT r.product_id    AS root_id,
           r.material_id,
           r.quantity      AS qty,
           1               AS depth,
           ARRAY[r.product_id, r.material_id]::UUID[] AS path
      FROM recipes r
     WHERE r.product_id = p_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    -- Recursive expansion when material is itself a recipe.
    SELECT w.root_id,
           r.material_id,
           w.qty * r.quantity,
           w.depth + 1,
           w.path || r.material_id
      FROM walk w
      JOIN recipes r
        ON r.product_id = w.material_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
     WHERE w.depth < p_max_depth
       AND NOT (r.material_id = ANY(w.path))  -- cycle guard
  ),
  -- Keep only leaves (materials that are NOT themselves recipe products).
  leaves AS (
    SELECT w.material_id, SUM(w.qty) AS qty_agg
      FROM walk w
     WHERE NOT EXISTS (
       SELECT 1 FROM recipes c
        WHERE c.product_id = w.material_id
          AND c.is_active = TRUE
          AND c.deleted_at IS NULL
     )
     GROUP BY w.material_id
  )
  SELECT l.material_id,
         p.name,
         p.unit,
         l.qty_agg,
         p.current_stock,
         p.cost_price
    FROM leaves l
    JOIN products p ON p.id = l.material_id
   ORDER BY p.name;
END $$;

GRANT EXECUTE ON FUNCTION recipe_bom_full_v1(UUID, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION recipe_bom_full_v1(UUID, INT) FROM anon;

COMMENT ON FUNCTION recipe_bom_full_v1(UUID, INT) IS
  'Session 17 / Phase 1.D. Server-side leaves-only BoM for IngredientAggregatePreview. '
  'WITH RECURSIVE cascade depth=p_max_depth (default 5). Cycle guard via path[]. '
  'Aggregates by material_id (sum qty). Gated by inventory.read.';
```

- [ ] **Step 2 — Apply RPC migration via MCP**

- [ ] **Step 3 — Create refresh migration `20260521000030`**

```sql
-- 20260521000030_refresh_latest_recipe_version_full_cascade.sql
-- Session 17 / Phase 1.D — One-shot UPDATE of LATEST modern snapshot per
-- product, replacing S16's depth-1 product_cost_at_version with the new
-- full-cascade value. Append-only invariant temporarily relaxed for this
-- controlled migration (D13).
--
-- Idempotent : second run finds cost_price already equal → IS DISTINCT FROM
-- guard yields zero rows.

WITH latest AS (
  SELECT product_id, MAX(version_number) AS v
    FROM recipe_versions
   WHERE snapshot ? 'items'  -- modern shape only (DEV-S16-2.B-02 legacy skip)
   GROUP BY product_id
),
updated AS (
  UPDATE recipe_versions rv
     SET snapshot = jsonb_set(
           rv.snapshot,
           '{product_cost_at_version}',
           to_jsonb(
             (_calculate_recipe_cost_walk(rv.product_id, 5, 1, ARRAY[]::UUID[])->>'cost_per_unit')::NUMERIC(14,2)
           )
         ),
         change_note = 'system refresh: full-cascade cost data 2026-05-17'
   FROM latest l
  WHERE rv.product_id = l.product_id
    AND rv.version_number = l.v
    AND (rv.snapshot->>'product_cost_at_version')::NUMERIC(14,2)
        IS DISTINCT FROM
        (_calculate_recipe_cost_walk(rv.product_id, 5, 1, ARRAY[]::UUID[])->>'cost_per_unit')::NUMERIC(14,2)
  RETURNING rv.id
)
SELECT count(*) AS rows_refreshed FROM updated;
```

- [ ] **Step 4 — Apply refresh migration via MCP**

Expected output : `rows_refreshed: <N>` where N = number of products whose latest depth-1 cost differed from full-cascade.

- [ ] **Step 5 — Write pgTAP for the new RPC**

Create `supabase/tests/recipe_bom_full_v1.test.sql` :

```sql
BEGIN;
SELECT plan(10);

-- Test 1 : Single-level recipe returns direct materials with qty unchanged.
SELECT bag_eq(
  $$ SELECT material_id, qty_per_unit FROM recipe_bom_full_v1('<v_simple_product>', 5) $$,
  $$ VALUES ('<v_mat_1>'::UUID, 0.5::NUMERIC), ('<v_mat_2>'::UUID, 0.3::NUMERIC) $$,
  'single-level recipe : direct materials'
);

-- Test 2 : 2-level cascade aggregates sub-recipe leaves.
-- dough = 0.5 flour ; croissant = 0.1 dough → croissant leaf flour = 0.05.
SELECT is(
  (SELECT qty_per_unit FROM recipe_bom_full_v1('<v_croissant>', 5)
    WHERE material_id = '<v_flour>'),
  0.05::NUMERIC,
  '2-level cascade : 0.1 × 0.5 = 0.05'
);

-- Test 3 : Sub-recipe NOT in output.
SELECT is(
  (SELECT count(*) FROM recipe_bom_full_v1('<v_croissant>', 5)
    WHERE material_id = '<v_dough>'),
  0::bigint,
  'sub-recipe excluded from leaves'
);

-- Test 4 : Same material from two paths aggregates.
-- Setup : two sub-recipes both contain flour, parent uses both.
SELECT is(
  (SELECT count(*) FROM recipe_bom_full_v1('<v_multi_path>', 5)
    WHERE material_id = '<v_flour>'),
  1::bigint,
  'duplicate-path material aggregated into single row'
);

-- Test 5 : Cycle (synthetic fixture).
-- ... raise expected on cycle path.

-- Test 6 : p_max_depth too low → sub-recipes appear as leaves.
SELECT is(
  (SELECT count(*) FROM recipe_bom_full_v1('<v_croissant>', 1)
    WHERE material_id = '<v_dough>'),
  1::bigint,
  'p_max_depth=1 stops before recursion : dough appears as leaf'
);

-- Test 7 : Permission gate.
-- SET ROLE anon ; expect P0003.

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 6 — Run pgTAP for RPC**

- [ ] **Step 7 — Create Vitest live RPC smoke**

Create `supabase/tests/functions/recipe-bom-full.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { createPinClient } from './_helpers/pin-client.js';

describe('recipe_bom_full_v1', () => {
  it('returns leaf materials for seeded multi-level recipe', async () => {
    const supabase = await createPinClient('1234'); // any seeded PIN
    const { data, error } = await supabase.rpc('recipe_bom_full_v1', {
      p_product_id: SEED_PAIN_AU_CHOCOLAT_ID,
      p_max_depth: 5,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBeGreaterThan(0);

    // All rows are leaves (no `is_semi_finished = true` rows).
    for (const row of data!) {
      expect(row).toMatchObject({
        material_id: expect.any(String),
        material_name: expect.any(String),
        material_unit: expect.any(String),
        qty_per_unit: expect.any(Number),
        current_stock: expect.any(Number),
        cost_price: expect.any(Number),
      });
    }

    // Sub-recipe products absent.
    const dough = data!.find(r => r.material_id === SEED_CROISSANT_DOUGH_ID);
    expect(dough).toBeUndefined();
  });
});
```

- [ ] **Step 8 — Run Vitest live**

```bash
pnpm --filter @breakery/supabase test recipe-bom-full
```

Expected : all tests pass against V3 dev.

- [ ] **Step 9 — Commit**

```bash
git add supabase/migrations/20260521000020_create_recipe_bom_full_v1_rpc.sql \
        supabase/migrations/20260521000030_refresh_latest_recipe_version_full_cascade.sql \
        supabase/tests/recipe_bom_full_v1.test.sql \
        supabase/tests/functions/recipe-bom-full.test.ts
git commit -m "feat(production): session 17 — phase 1.D — recipe_bom_full_v1 RPC + refresh"
```

**DoD :**
- [ ] `recipe_bom_full_v1` exists with the documented signature.
- [ ] Leaves-only contract verified : sub-recipe rows absent.
- [ ] Multi-path aggregation verified : duplicate materials summed.
- [ ] `inventory.read` permission gate verified.
- [ ] Refresh migration : second run yields 0 rows.
- [ ] Vitest live RPC smoke green.

**Complexity** : **M** (~4h).
**Dependencies** : Phase 1.A (helper used by refresh's `_calculate_recipe_cost_walk`).
**Suggested executor** : `bom-rpc-arch` (backend-dev + DB SQL).
**Parallelization tag** : parallel with 1.B, 1.C after 1.A.

---

## 5. Wave 2 — UI rewire

### Phase 2.A — IngredientAggregatePreview rewired

Resolves `DEV-S16-2.C-02` end-to-end on the consumer side.

**Module(s)** : 15 (Production), 06 (Inventory).

**Files :**
- `apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx` (UPDATE — drop `useGraphBuilder`, use new RPC)
- `apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx` (UPDATE — 3-level fixture, mock new RPC)

- [ ] **Step 1 — Regen types so the new RPC is in `packages/supabase/src/types.generated.ts`**

```
mcp__plugin_supabase_supabase__generate_typescript_types
  project_id: ikcyvlovptebroadgtvd
```

Write the returned `types` string to `packages/supabase/src/types.generated.ts` and verify `recipe_bom_full_v1` appears.

- [ ] **Step 2 — Rewrite `IngredientAggregatePreview.tsx`**

Replace the entire file. Key shape :

```tsx
// apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx
//
// Session 17 — Phase 2.A — Server-side cascade via recipe_bom_full_v1.
// Previously did 2 static useQueries rounds capped at depth-2 ; now does
// one round (one RPC call per root) with full depth-5 cascade server-side.

import { useMemo, type JSX } from 'react';
import { useQueries } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { BatchItem } from './BatchSelector.js';

export interface IngredientAggregatePreviewProps { items: BatchItem[]; }

interface BomLeafRow {
  material_id:   string;
  material_name: string;
  material_unit: string;
  qty_per_unit:  number;
  current_stock: number;
  cost_price:    number;
}

interface AggregatedRow {
  materialId: string; materialName: string; materialUnit: string;
  totalQty: number; available: number; sufficient: boolean; shortfall: number;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function IngredientAggregatePreview({ items }: IngredientAggregatePreviewProps): JSX.Element {
  const validRows = useMemo(
    () => items.filter((it) => {
      if (it.productId === null) return false;
      const q = Number.parseFloat(it.quantityProduced);
      return Number.isFinite(q) && q > 0;
    }),
    [items],
  );

  // One RPC per root product. React Query dedupes identical productIds.
  const bomQueries = useQueries({
    queries: validRows.map((row) => ({
      queryKey: ['inv-prod', 'bom-full', row.productId] as const,
      enabled:  row.productId !== null,
      staleTime: 30_000,
      queryFn: async (): Promise<BomLeafRow[]> => {
        const { data, error } = await supabase.rpc('recipe_bom_full_v1', {
          p_product_id: row.productId as string,
          p_max_depth:  5,
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as BomLeafRow[];
      },
    })),
  });

  const loading = bomQueries.some((q) => q.isLoading);
  const errorMsg = bomQueries.find((q) => q.error)?.error?.message ?? null;

  const rows: AggregatedRow[] = useMemo(() => {
    const acc = new Map<string, AggregatedRow>();
    validRows.forEach((row, i) => {
      const bom = bomQueries[i].data;
      if (!bom) return;
      const qty = Number.parseFloat(row.quantityProduced) || 0;
      const waste = Number.parseFloat(row.quantityWaste) || 0;
      const mult = qty + waste;
      if (mult <= 0) return;
      for (const leaf of bom) {
        const need = leaf.qty_per_unit * mult;
        const existing = acc.get(leaf.material_id);
        if (existing) {
          existing.totalQty += need;
        } else {
          const shortfall = Math.max(0, need - leaf.current_stock);
          acc.set(leaf.material_id, {
            materialId: leaf.material_id, materialName: leaf.material_name,
            materialUnit: leaf.material_unit, totalQty: need,
            available: leaf.current_stock, sufficient: shortfall === 0, shortfall,
          });
        }
      }
    });
    // Recompute sufficient/shortfall after aggregation.
    return Array.from(acc.values()).map((r) => {
      const shortfall = Math.max(0, r.totalQty - r.available);
      return { ...r, sufficient: shortfall === 0, shortfall };
    }).sort((a, b) => {
      if (a.sufficient !== b.sufficient) return a.sufficient ? 1 : -1;
      return a.materialName.localeCompare(b.materialName);
    });
  }, [validRows, bomQueries.map((q) => q.dataUpdatedAt).join(',')]);

  const anyShortage = rows.some((r) => !r.sufficient);

  return (
    <div data-testid="ingredient-aggregate-preview"
         className="rounded-md border border-border-subtle bg-bg-elevated p-4 space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-lg">Aggregate ingredient preview</h3>
        {validRows.length > 0 && (
          <span className="text-xs text-text-secondary">
            {validRows.length} item{validRows.length === 1 ? '' : 's'} ·
            {rows.length} ingredient{rows.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {errorMsg !== null && <p role="alert" className="text-xs text-red">{errorMsg}</p>}

      {validRows.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Pick a recipe and enter a quantity to see the aggregate ingredient totals.
        </p>
      ) : loading ? (
        <p className="text-sm text-text-secondary">Computing requirements…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary">No recipes resolved yet.</p>
      ) : (
        <>
          {anyShortage && (
            <p role="alert" className="text-xs text-red">
              One or more ingredients are short. The server will reject submission.
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th className="py-1">Material</th>
                <th className="py-1 text-right">Required</th>
                <th className="py-1 text-right">Available</th>
                <th className="py-1 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.materialId} className="border-t border-border-subtle">
                  <td className="py-1.5">{r.materialName}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmt(r.totalQty)} {r.materialUnit}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmt(r.available)} {r.materialUnit}
                  </td>
                  <td className="py-1.5 text-right">
                    {r.sufficient ? (
                      <span className="text-success" data-testid="status-ok">OK</span>
                    ) : (
                      <span className="text-red" data-testid="status-short">
                        short {fmt(r.shortfall)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3 — Update smoke test fixture**

Rewrite `apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx` to mock `recipe_bom_full_v1` (NOT `list_recipes_v1`). The fixture should cover the 3-level scenario described in spec §4.3.

Key assertions :
1. `supabase.rpc('recipe_bom_full_v1', { p_product_id: <root>, p_max_depth: 5 })` called exactly once per root.
2. Aggregated row for shared leaf (flour) shows sum across paths.
3. Sub-recipe products NOT in the rendered `<tbody>`.
4. Stock-short rendering when `current_stock < totalQty` for any row.

- [ ] **Step 4 — Run smoke test**

```bash
pnpm --filter @breakery/backoffice test IngredientAggregatePreview.smoke
```

Expected : all assertions pass.

- [ ] **Step 5 — Run typecheck**

```bash
pnpm typecheck
```

Expected : clean (no unused imports from removed `useGraphBuilder` / `expandRecipeCascade`).

- [ ] **Step 6 — Commit**

```bash
git add apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx \
        apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx \
        packages/supabase/src/types.generated.ts
git commit -m "feat(backoffice): session 17 — phase 2.A — IngredientAggregatePreview uses recipe_bom_full_v1"
```

**DoD :**
- [ ] `useGraphBuilder` deleted from component.
- [ ] Smoke test on 3-level fixture asserts leaf aggregation across paths.
- [ ] `expandRecipeCascade` still exported (consumed by RecipeEditor — verify by grep).
- [ ] No console error / no warning in test output.
- [ ] `pnpm typecheck` green.

**Complexity** : **M** (~3h).
**Dependencies** : Phase 1.D (RPC exists in cloud + types regenerated).
**Suggested executor** : `preview-ui-coder` (frontend).

---

## 6. Wave 3 — Gate

### Phase 3.A — Reviewer pass + types regen merge

**Steps :**
- [ ] MCP `generate_typescript_types` once more (covers all S17 migrations) → write to `packages/supabase/src/types.generated.ts`.
- [ ] `pnpm typecheck` green.
- [ ] Run full pgTAP suite via MCP `execute_sql` (BEGIN/ROLLBACK envelope) :
  - `supabase/tests/recipe_cascade_snapshot.test.sql`
  - `supabase/tests/recipe_bom_full_v1.test.sql`
  - All pre-S17 tests still green (`recipe_version_cost.test.sql`, `picker_polish.test.sql`, etc.).
- [ ] Cross-phase touchpoint inspection :
  - `tr_snapshot_recipe_version` body : verify the only callers of `_snapshot_recipe_version` are the two triggers from 1.A and 1.B.
  - `recipe_bom_full_v1` : grep to confirm no other component depends on the removed `useGraphBuilder` path.
  - `record_stock_movement_v1` : verify Phase 1.C trigger does not break any existing pgTAP/Vitest tests (the WHEN clause means it only fires on `movement_type='purchase'`, so non-purchase tests are unaffected).
- [ ] If conflicts found : coordinate fixes ; otherwise proceed to closeout.

**Complexity** : **S** (~1.5h).
**Dependencies** : Wave 1 + Wave 2 completed.
**Suggested executor** : `reviewer` (reviewer agent).

---

## 7. Wave 4 — Closeout

### Phase 4.A — Tests + build + CLAUDE.md + PR

**Steps :**
- [ ] `pnpm typecheck` green.
- [ ] `pnpm exec turbo run test --concurrency=1` green.
- [ ] `pnpm build` green.
- [ ] Bundle size delta < +5KB vs Session 16 baseline (the component shrunk ; expect a small reduction).
- [ ] Update CLAUDE.md "Active Workplan" :
  - Bump "Current session" pointer to Session 18.
  - Move Session 17 to "Previous session" with merge commit + INDEX link.
  - Add Session 17 follow-ups list (DEV-S17-1.A-01..2.A-01 from §10).
- [ ] PR draft "Session 17 — Full price chain (PO → cost → recipe → snapshot)" → master with body :
  - List of 6 migrations applied.
  - Cascade matrix (events × snapshots).
  - WAC formula + edge case table.
  - Pre/post comparison of `IngredientAggregatePreview` (file size, network calls).
  - DEV-S17-* deviation packs.

**Complexity** : **S** (~2h).
**Suggested executor** : lead.

---

## 8. Parallelization map

| Wave | Phases | Parallel streams | Estim h |
|---|---|---|---|
| 0 | 0.1 | sequential | 2 |
| 1 | 1.A → (1.B \|\| 1.C \|\| 1.D) | 1.A solo prereq, then 3 parallel | 5 + max(3, 3, 4) = 9 |
| 2 | 2.A | sequential | 3 |
| 3 | 3.A | gate | 1.5 |
| 4 | 4.A | sequential | 2 |
| **TOTAL** | **7** | **4 waves** | **~17.5h** (full parallel-optimized) |

Realistic with ~20 % serialization overhead + reviewer gate per wave : **~18h parallel, ~25h solo**.

---

## 9. Comms entre subagents

```
lead (Claude) ←→ recipes-trigger-arch (Phase 1.A — PREREQUISITE)
              ←→ cost-cascade-arch (Phase 1.B, after 1.A done)
              ←→ wac-trigger-arch  (Phase 1.C, parallel with 1.B/1.D)
              ←→ bom-rpc-arch      (Phase 1.D, parallel with 1.B/1.C)
              ←→ preview-ui-coder  (Phase 2.A, after Wave 1 + types regen)
              ←→ reviewer          (Phase 3.A gate)
```

**Pattern** : 1.A runs solo, SendMessage `lead` on completion. Lead then fans 1.B / 1.C / 1.D in one shot ; each SendMessage `lead` on completion. Lead waits for all three returns, then dispatches preview-ui-coder. Reviewer gate runs solo. Closeout : lead direct.

---

## 10. Deviation packs (Session 17 → Session 18+)

*Filled during execution. Anticipated buckets :*

| ID (anticipated) | Phase | Severity | Surface |
|---|---|---|---|
| `DEV-S17-1.A-01` | 1.A | informational | Cascade fires N snapshots in one transaction for high-fanout recipe graphs ; mitigation deferred. |
| `DEV-S17-1.B-01` | 1.B | informational | Manual `products.cost_price` UPDATE bypasses WAC and doesn't emit a `stock_movements` row ; audit-only gap. |
| `DEV-S17-1.C-01` | 1.C | low | WAC applied uniformly to all purchase movements ; no opt-out for sample stock / promo. |
| `DEV-S17-1.C-02` | 1.C | informational | WAC garbage-in if `current_stock` is stale (no reconciliation pass). |
| `DEV-S17-2.A-01` | 2.A | informational | `IngredientAggregatePreview` uses RPC ; `RecipeEditor` live preview still client-side. Intentional split. |

---

## 11. Out of scope (déféré Session 18+)

- DEV-S16-2.A-01 trigram predicate fix.
- DEV-S16-1.A-01 PR-time pgTAP gate.
- DEV-S15-5.C-01 allergens on receipt + customer display.
- Session 13 deferred items.
- Per-lot cost / FIFO refactor.
- Cost-adjustment audit movement type.
- New bakery feature module (B2B, expenses, reports, customers/loyalty).
- Compliance & hardening.

---

*INDEX écrit 2026-05-16 sur `master` (pre-`swarm/session-17`) par lead. Spec sœur : [`../specs/2026-05-17-session-17-spec.md`](../../specs/archive/2026-05-17-session-17-spec.md).*
