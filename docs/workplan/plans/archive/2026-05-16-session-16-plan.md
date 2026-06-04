# Session 16 Implementation Plan — CI revival + S15 follow-ups

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken Docker-dependent supabase-tests CI job with a nightly cloud pgTAP cron on V3 dev, and close four Session 15 follow-up items (`DEV-S15-3.A-01/02`, `DEV-S15-2.B-01`, `DEV-S15-4.A-02`).

**Architecture:** Pragmatic-hybrid wave structure — Wave 1 solo CI revival, Wave 2 three parallel S15 follow-ups (picker polish / cost snapshot / aggregate preview), Wave 3 reviewer gate, Wave 4 closeout. 8 SQL migrations in block `20260520000001..099`. New domain helper `expandRecipeCascade` in `packages/domain`. UI changes scoped to `RecipeVersionHistory.tsx`, `IngredientAggregatePreview.tsx`, `useRecipeVersions.ts`.

**Tech Stack:** pnpm 9.15 + turbo monorepo. Supabase Postgres (cloud V3 dev `ikcyvlovptebroadgtvd`). pgTAP suite via cloud MCP `execute_sql` envelope. Vitest live RPC tests under `supabase/tests/functions/`. React + TanStack Query + @testing-library/react for backoffice smoke tests. Migrations applied via `mcp__plugin_supabase_supabase__apply_migration`. Types regen via `mcp__plugin_supabase_supabase__generate_typescript_types`. GitHub Actions for nightly cron.

**Branch:** `swarm/session-16` (already created off `7ed9781` master, Wave 0 commit `8e36cd5`).

**Reference docs:**
- Spec: [`../specs/2026-05-16-session-16-spec.md`](../../specs/archive/2026-05-16-session-16-spec.md)
- INDEX: [`2026-05-16-session-16-INDEX.md`](2026-05-16-session-16-INDEX.md)

---

## Task 1: Phase 1.A — CI revival (Wave 1, solo)

**Files:**
- Create: `.github/workflows/pgtap-nightly.yml`
- Create: `supabase/tests/ci_smoke.test.sql`
- Modify: `.github/workflows/ci.yml` (delete `supabase-tests` job at lines 115-143)

### - [ ] Step 1.1: Confirm GitHub secret `V3_DEV_PG_POOLER_URL` exists

Run: `gh secret list --repo guichduh33-arch/The_Breakery_ERP | grep V3_DEV`

Expected: a row `V3_DEV_PG_POOLER_URL  Updated YYYY-MM-DD`. If absent:

```bash
# Owner must set this — value is the pooler URL from CLAUDE.md.
# DO NOT print the password in commits or PR descriptions.
gh secret set V3_DEV_PG_POOLER_URL --repo guichduh33-arch/The_Breakery_ERP \
  --body 'postgresql://postgres.ikcyvlovptebroadgtvd:<URL_ENCODED_PWD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
```

If the secret is missing AND `gh` is not authenticated to set it: **STOP, file the issue and ping the owner**. Do not proceed until the secret is set.

### - [ ] Step 1.2: Open the pgTAP tracking issue

Run:

```bash
gh issue create \
  --repo guichduh33-arch/The_Breakery_ERP \
  --title "Session 16 — pgTAP nightly tracking" \
  --label "ci/pgtap-nightly" \
  --body "$(cat <<'EOF'
Tracks the nightly pgTAP cron added in Session 16 (DEV-S15-CI-01 resolution).
Workflow `pgtap-nightly.yml` posts a comment here on every failure.
Manual `workflow_dispatch` available for ad-hoc runs.

Target: V3 dev (`ikcyvlovptebroadgtvd`). Pooler URL in repo secret `V3_DEV_PG_POOLER_URL`.
Schedule: cron `0 19 * * *` UTC = 02:00 Asia/Jakarta.
EOF
)"
```

Expected: `https://github.com/guichduh33-arch/The_Breakery_ERP/issues/<N>` printed. Note the issue number — you'll paste it into the workflow file in Step 1.4.

### - [ ] Step 1.3: Create the pgTAP smoke test

Create `supabase/tests/ci_smoke.test.sql`:

```sql
-- Session 16 / Phase 1.A — pgTAP nightly smoke probe.
-- Trivial select to validate that the workflow runner can connect to V3 dev
-- and execute SQL with the BEGIN/ROLLBACK envelope. NOT a substantive test ;
-- the substantive coverage is the rest of the supabase/tests/*.test.sql files.

BEGIN;
SELECT plan(1);

SELECT ok(1 = 1, 'pgTAP runner is alive');

SELECT * FROM finish();
ROLLBACK;
```

### - [ ] Step 1.4: Create `.github/workflows/pgtap-nightly.yml`

Substitute `<ISSUE_NUMBER>` with the number from Step 1.2 before saving.

Create `.github/workflows/pgtap-nightly.yml`:

```yaml
name: pgTAP Nightly

on:
  schedule:
    - cron: '0 19 * * *'  # 02:00 Asia/Jakarta = 19:00 UTC previous day
  workflow_dispatch:

jobs:
  pgtap:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - name: Install psql 16
        run: |
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
          sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          sudo apt-get update
          sudo apt-get install -y postgresql-client-16

      - name: Run pgTAP suite via pooler
        id: pgtap
        env:
          PGURL: ${{ secrets.V3_DEV_PG_POOLER_URL }}
        run: |
          set -uo pipefail
          if [ -z "${PGURL:-}" ]; then
            echo "::error::V3_DEV_PG_POOLER_URL secret is not set" >&2
            exit 1
          fi
          fail_count=0
          fail_list=""
          shopt -s nullglob
          for f in supabase/tests/*.test.sql; do
            echo "=== Running $f ==="
            # Wrap each file in its own BEGIN/ROLLBACK ; -v ON_ERROR_STOP=1 aborts on first SQL error.
            if ! psql "$PGURL" -v ON_ERROR_STOP=1 --single-transaction -f "$f"; then
              fail_count=$((fail_count+1))
              fail_list="${fail_list}\n - ${f}"
            fi
          done
          if [ "$fail_count" -gt 0 ]; then
            echo "::error::${fail_count} pgTAP file(s) failed:${fail_list}"
            exit 1
          fi
          echo "All pgTAP files passed."

      - name: Comment on tracking issue (failure)
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.createComment({
              issue_number: <ISSUE_NUMBER>,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `pgTAP nightly failed on \`${context.sha.slice(0,7)}\` — see [run #${context.runId}](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}).`
            });
```

**Note:** The workflow uses `--single-transaction` to make each `psql -f <file>` invocation atomic. We do NOT add explicit `BEGIN/ROLLBACK` to the `.test.sql` files — pgTAP files already include their own `BEGIN; ... ROLLBACK;` (see `ci_smoke.test.sql` above).

### - [ ] Step 1.5: Delete the `supabase-tests` job from `.github/workflows/ci.yml`

Edit `.github/workflows/ci.yml`: delete lines 115-143 inclusive (the entire `supabase-tests:` job block — starting at `  supabase-tests:` and ending after `run: supabase test db`).

After the edit, `ci.yml` should have only one job (`lint-typecheck-test-build`) and end at the `Upload build artifacts` step around line 113.

Verify:

```bash
grep -n "supabase-tests:\|supabase start\|supabase test db" .github/workflows/ci.yml
```

Expected: empty output (no matches).

### - [ ] Step 1.6: Lint the new workflow

Run:

```bash
# actionlint is available via npx ; first run downloads it.
npx actionlint .github/workflows/pgtap-nightly.yml .github/workflows/ci.yml
```

Expected: no findings. If actionlint flags the `<ISSUE_NUMBER>` literal as an unexpected integer, double-check you substituted the placeholder.

### - [ ] Step 1.7: Trigger workflow_dispatch and confirm green

After committing in Step 1.8, push and trigger:

```bash
gh workflow run pgtap-nightly.yml --ref swarm/session-16
# Wait ~30s, then:
gh run watch --exit-status
```

Expected: exit code 0, run summary shows "All pgTAP files passed." If RED, inspect the log — the most likely failure is that other `supabase/tests/*.test.sql` files (existing from Sessions 13-15) have drift against V3 dev. **Stop and triage** — do not paper over with skip patterns. The point of this gate is to surface drift.

### - [ ] Step 1.8: Commit Phase 1.A

```bash
git add .github/workflows/ci.yml .github/workflows/pgtap-nightly.yml supabase/tests/ci_smoke.test.sql
git commit -m "$(cat <<'EOF'
feat(ci): session 16 — phase 1.A — drop docker supabase-tests, add nightly cloud pgTAP cron

Resolves DEV-S15-CI-01 (medium, red since Session 13).

- Delete `.github/workflows/ci.yml` `supabase-tests` job (Docker `supabase start`
  was broken since Session 13 migration ordering vs seed.sql).
- Add `.github/workflows/pgtap-nightly.yml` : cron `0 19 * * *` UTC =
  02:00 Asia/Jakarta, `workflow_dispatch` enabled. Connects to V3 dev via
  repo secret `V3_DEV_PG_POOLER_URL`, iterates supabase/tests/*.test.sql,
  comments on tracking issue #<N> on failure.
- Add `supabase/tests/ci_smoke.test.sql` (1-assert pgTAP smoke probe).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Phase 2.A — Picker polish (Wave 2, parallel)

**Files:**
- Create: `supabase/migrations/20260520000010_extend_products_is_semi_finished.sql`
- Create: `supabase/migrations/20260520000011_backfill_is_semi_finished.sql`
- Create: `supabase/migrations/20260520000012_create_tr_recompute_is_semi_finished.sql`
- Create: `supabase/migrations/20260520000013_add_pg_trgm_indexes_products.sql`
- Create: `supabase/migrations/20260520000014_bump_search_ingredients_v1.sql`
- Create: `supabase/tests/picker_polish.test.sql`
- Create: `supabase/tests/functions/search-ingredients-polish.test.ts`

### - [ ] Step 2.1: Write migration 010 — add `is_semi_finished` column

Save as `supabase/migrations/20260520000010_extend_products_is_semi_finished.sql`:

```sql
-- 20260520000010_extend_products_is_semi_finished.sql
-- Session 16 / Phase 2.A — DEV-S15-3.A-01. Add explicit is_semi_finished
-- flag on products instead of inferring via recipe-of-recipe EXISTS in
-- search_ingredients_v1. Maintained by tr_recipes_recompute_is_semi_finished
-- (migration 012).

ALTER TABLE products
  ADD COLUMN is_semi_finished BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN products.is_semi_finished IS
  'Session 16 / Phase 2.A. TRUE iff this product has an active recipe AND '
  'at least one of its materials is itself a recipe (i.e. nesting depth ≥ 2). '
  'Maintained by tr_recipes_recompute_is_semi_finished trigger on `recipes`.';
```

Apply via MCP:

```js
mcp__plugin_supabase_supabase__apply_migration({
  project_id: 'ikcyvlovptebroadgtvd',
  name: '20260520000010_extend_products_is_semi_finished',
  query: '<paste-the-SQL-above>'
})
```

Verify with `execute_sql`:

```sql
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'products' AND column_name = 'is_semi_finished';
```

Expected: one row, `data_type = boolean`, `column_default = false`, `is_nullable = NO`.

### - [ ] Step 2.2: Write migration 011 — backfill the flag

Save as `supabase/migrations/20260520000011_backfill_is_semi_finished.sql`:

```sql
-- 20260520000011_backfill_is_semi_finished.sql
-- Session 16 / Phase 2.A — Backfill is_semi_finished for existing products.
-- Same predicate as the old EXISTS subquery in search_ingredients_v1.

UPDATE products p
   SET is_semi_finished = TRUE
 WHERE EXISTS (
   SELECT 1
     FROM recipes r1
     JOIN recipes r2 ON r2.product_id = r1.material_id
                    AND r2.is_active = TRUE
                    AND r2.deleted_at IS NULL
    WHERE r1.product_id = p.id
      AND r1.is_active = TRUE
      AND r1.deleted_at IS NULL
 );
```

Apply via MCP. Verify count is non-negative (could be 0 on V3 dev if no nested recipes exist yet):

```sql
SELECT COUNT(*) AS n FROM products WHERE is_semi_finished = TRUE;
```

### - [ ] Step 2.3: Write migration 012 — maintenance trigger

Save as `supabase/migrations/20260520000012_create_tr_recompute_is_semi_finished.sql`:

```sql
-- 20260520000012_create_tr_recompute_is_semi_finished.sql
-- Session 16 / Phase 2.A — Maintain products.is_semi_finished on recipe
-- INSERT/UPDATE/DELETE. pg_trigger_depth() < 1 guard prevents recursion
-- (same pattern as tr_snapshot_recipe_version).

CREATE OR REPLACE FUNCTION tr_recompute_is_semi_finished()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_id     UUID;
  v_parent_product UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  -- Two products may be affected by a single recipe row change:
  --   (a) the parent (recipes.product_id) — its own recipe might gain/lose a sub-recipe child
  --   (b) the material when it itself has a recipe — its is_semi_finished status doesn't change,
  --       BUT any OTHER product that uses this material as a sub-recipe needs to be revisited
  --       only if the row is being newly inserted/deleted, not on quantity edits.
  -- For (a), we recompute the parent. (b) is out of scope ; if a recipe is created/deleted on
  -- product X, every product Y that uses X as a material was already correctly flagged at the
  -- time of Y's own recipe edit (because at that time we walked Y's materials and X already
  -- had/didn't have a recipe). Edge case: X gains its FIRST recipe after Y already references X.
  -- We handle this by also recomputing every parent that has X as a material when X's recipe set
  -- changes from empty to non-empty (and vice versa).

  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
  ELSE
    v_product_id := NEW.product_id;
  END IF;

  -- (a) Recompute parent.
  UPDATE products
     SET is_semi_finished = EXISTS (
       SELECT 1
         FROM recipes r1
         JOIN recipes r2 ON r2.product_id = r1.material_id
                        AND r2.is_active = TRUE
                        AND r2.deleted_at IS NULL
        WHERE r1.product_id = v_product_id
          AND r1.is_active = TRUE
          AND r1.deleted_at IS NULL
     )
   WHERE id = v_product_id;

  -- (b) Recompute every product that uses v_product_id as a material — its
  -- is_semi_finished status depends on whether v_product_id itself has any
  -- active recipe rows. Cheap because the parent set is typically small.
  FOR v_parent_product IN
    SELECT DISTINCT r.product_id
      FROM recipes r
     WHERE r.material_id = v_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
  LOOP
    UPDATE products
       SET is_semi_finished = EXISTS (
         SELECT 1
           FROM recipes r1
           JOIN recipes r2 ON r2.product_id = r1.material_id
                          AND r2.is_active = TRUE
                          AND r2.deleted_at IS NULL
          WHERE r1.product_id = v_parent_product
            AND r1.is_active = TRUE
            AND r1.deleted_at IS NULL
       )
     WHERE id = v_parent_product;
  END LOOP;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION tr_recompute_is_semi_finished() IS
  'Session 16 / Phase 2.A. AFTER INSERT/UPDATE/DELETE trigger on `recipes`. '
  'Recomputes products.is_semi_finished for (a) the parent product whose '
  'recipe row changed, (b) every product that consumes the parent as a '
  'sub-recipe. pg_trigger_depth() < 1 guard ; idempotent ; no-op on '
  'recursive re-entry.';

DROP TRIGGER IF EXISTS tr_recipes_recompute_is_semi_finished ON recipes;

CREATE TRIGGER tr_recipes_recompute_is_semi_finished
  AFTER INSERT OR UPDATE OR DELETE ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION tr_recompute_is_semi_finished();
```

Apply via MCP.

### - [ ] Step 2.4: Write migration 013 — pg_trgm indexes

Save as `supabase/migrations/20260520000013_add_pg_trgm_indexes_products.sql`:

```sql
-- 20260520000013_add_pg_trgm_indexes_products.sql
-- Session 16 / Phase 2.A — DEV-S15-3.A-02. Trigram GIN indexes on
-- products.name and products.sku to support `similarity()` ranking inside
-- search_ingredients_v1 (migration 014).
--
-- pg_trgm extension already enabled cluster-wide (confirmed in Session 15).
--
-- NOT CONCURRENTLY : MCP apply_migration wraps the body in a transaction.
-- Lock window on V3 dev (< 5k products) is expected < 100ms.

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_sku_trgm
  ON products USING gin (sku gin_trgm_ops)
  WHERE is_active = TRUE AND deleted_at IS NULL;

COMMENT ON INDEX idx_products_name_trgm IS
  'Session 16 / Phase 2.A. Trigram GIN for similarity() ranking on product names.';
COMMENT ON INDEX idx_products_sku_trgm IS
  'Session 16 / Phase 2.A. Trigram GIN for similarity() ranking on SKUs.';
```

Apply via MCP. Verify:

```sql
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE tablename = 'products'
   AND indexname IN ('idx_products_name_trgm', 'idx_products_sku_trgm');
```

Expected: 2 rows, both `USING gin (... gin_trgm_ops)`.

### - [ ] Step 2.5: Write migration 014 — bump `search_ingredients_v1`

Save as `supabase/migrations/20260520000014_bump_search_ingredients_v1.sql`:

```sql
-- 20260520000014_bump_search_ingredients_v1.sql
-- Session 16 / Phase 2.A — Use products.is_semi_finished flag instead of
-- nested EXISTS detection ; add trigram similarity() to the rank tier set.
--
-- Signature stable (TEXT, TEXT, INT). RPC behavior changes :
--   - `semi_finished` classification now reads `p.is_semi_finished` (D4).
--   - Rank tier 2 (substring ILIKE) now also accepts trigram matches
--     `similarity(name, q) >= 0.3` OR `similarity(sku, q) >= 0.3`, ordered
--     by max(similarity_name, similarity_sku) DESC within the tier.
--
-- Exact (rank 0) and prefix (rank 1) tiers are unchanged — they always win
-- over similarity matches (D6).

CREATE OR REPLACE FUNCTION search_ingredients_v1(
  p_query TEXT DEFAULT '',
  p_kind  TEXT DEFAULT 'all',
  p_limit INT  DEFAULT 20
) RETURNS TABLE (
  product_id    UUID,
  sku           TEXT,
  name          TEXT,
  unit          TEXT,
  cost_price    NUMERIC,
  current_stock NUMERIC,
  kind          TEXT,
  has_recipe    BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_query   TEXT := COALESCE(trim(p_query), '');
  v_kind    TEXT := COALESCE(p_kind, 'all');
  v_limit   INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_like    TEXT;
  v_prefix  TEXT;
  v_lower_q TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF v_kind NOT IN ('raw', 'semi_finished', 'sub_recipe', 'all') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = 'P0001',
      DETAIL = 'p_kind must be one of: raw, semi_finished, sub_recipe, all.';
  END IF;

  v_lower_q := lower(v_query);
  v_like    := '%' || v_lower_q || '%';
  v_prefix  := v_lower_q || '%';

  RETURN QUERY
  WITH base AS (
    SELECT
      p.id              AS product_id,
      p.sku             AS sku,
      p.name            AS name,
      p.unit            AS unit,
      p.cost_price      AS cost_price,
      p.current_stock   AS current_stock,
      p.is_semi_finished AS is_semi,
      EXISTS (
        SELECT 1 FROM recipes r
         WHERE r.product_id = p.id
           AND r.is_active = TRUE
           AND r.deleted_at IS NULL
      ) AS has_recipe
    FROM products p
    WHERE p.is_active = TRUE
      AND p.deleted_at IS NULL
  ),
  classified AS (
    SELECT
      b.*,
      CASE
        WHEN b.is_semi    THEN 'semi_finished'
        WHEN b.has_recipe THEN 'sub_recipe'
        ELSE                   'raw'
      END AS kind
    FROM base b
  ),
  scored AS (
    SELECT
      c.*,
      CASE
        WHEN v_query = ''                                 THEN 0.0
        ELSE GREATEST(
          similarity(c.name, v_query),
          similarity(c.sku,  v_query)
        )
      END AS sim_score
    FROM classified c
  ),
  filtered AS (
    SELECT *
      FROM scored s
     WHERE (v_kind = 'all' OR s.kind = v_kind)
       AND (
         v_query = ''
         OR lower(s.name) LIKE v_like
         OR lower(s.sku)  LIKE v_like
         OR s.sim_score >= 0.3
       )
  ),
  ranked AS (
    SELECT
      f.*,
      CASE
        WHEN v_query = ''                       THEN 4
        WHEN lower(f.name) = v_lower_q
          OR lower(f.sku)  = v_lower_q          THEN 0
        WHEN lower(f.name) LIKE v_prefix
          OR lower(f.sku)  LIKE v_prefix        THEN 1
        WHEN lower(f.name) LIKE v_like
          OR lower(f.sku)  LIKE v_like          THEN 2
        ELSE                                         3
      END AS rank
    FROM filtered f
  )
  SELECT
    r.product_id, r.sku, r.name, r.unit, r.cost_price, r.current_stock,
    r.kind, r.has_recipe
  FROM ranked r
  ORDER BY r.rank ASC, r.sim_score DESC, r.name ASC
  LIMIT v_limit;
END $$;

GRANT EXECUTE ON FUNCTION search_ingredients_v1(TEXT, TEXT, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION search_ingredients_v1(TEXT, TEXT, INT) FROM anon, PUBLIC;

COMMENT ON FUNCTION search_ingredients_v1(TEXT, TEXT, INT) IS
  'Session 16 - Phase 2.A. Keyword + kind-filtered product search for IngredientPicker. '
  'p_kind in (raw, semi_finished, sub_recipe, all). Reads products.is_semi_finished flag '
  '(maintained by tr_recipes_recompute_is_semi_finished). Match : ILIKE substring OR '
  'pg_trgm similarity() >= 0.3. Rank tiers : exact > prefix > substring/trigram > '
  'untyped. Within each tier, similarity DESC then name ASC. STABLE SECURITY DEFINER, '
  'gated by inventory.read.';
```

Apply via MCP.

### - [ ] Step 2.6: Write pgTAP test for picker polish

Save as `supabase/tests/picker_polish.test.sql`:

```sql
-- supabase/tests/picker_polish.test.sql
-- Session 16 / Phase 2.A — covers is_semi_finished flag + trigram ranking.

BEGIN;

SELECT plan(8);

-- Setup fixture inside the rolled-back transaction.
DO $$
DECLARE
  v_pn UUID := gen_random_uuid();
  v_mt UUID := gen_random_uuid();
  v_sf UUID := gen_random_uuid();
  v_lf UUID := gen_random_uuid();
BEGIN
  -- Leaf material (flour-like).
  INSERT INTO products (id, sku, name, unit, cost_price, is_active)
  VALUES (v_lf, 'TEST-LEAF-1', 'TestLeafCroisant', 'g', 0.01, TRUE);

  -- Sub-recipe (dough-like). Has leaf as material.
  INSERT INTO products (id, sku, name, unit, cost_price, is_active)
  VALUES (v_sf, 'TEST-SUB-1', 'TestSubDough', 'kg', 0.0, TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_sf, v_lf, 500, 'g', TRUE);

  -- Semi-finished (croissant pastry uses dough).
  INSERT INTO products (id, sku, name, unit, cost_price, is_active)
  VALUES (v_mt, 'TEST-SEMI-1', 'TestPainChocoMaster', 'pcs', 0.0, TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_mt, v_sf, 0.05, 'kg', TRUE);

  -- Plain raw (no recipe).
  INSERT INTO products (id, sku, name, unit, cost_price, is_active)
  VALUES (v_pn, 'TEST-RAW-1', 'TestPureRaw', 'kg', 1.0, TRUE);

  PERFORM set_config('test.leaf', v_lf::text, false);
  PERFORM set_config('test.sub',  v_sf::text, false);
  PERFORM set_config('test.semi', v_mt::text, false);
  PERFORM set_config('test.raw',  v_pn::text, false);
END $$;

-- T1: backfill / trigger correctly classifies the semi.
SELECT ok(
  (SELECT is_semi_finished FROM products WHERE id = current_setting('test.semi')::uuid),
  'T1 — semi-finished product has is_semi_finished = TRUE'
);

-- T2: sub-recipe (depth 1) is NOT semi-finished.
SELECT ok(
  NOT (SELECT is_semi_finished FROM products WHERE id = current_setting('test.sub')::uuid),
  'T2 — depth-1 sub-recipe does NOT have is_semi_finished = TRUE'
);

-- T3: raw material is NOT semi-finished.
SELECT ok(
  NOT (SELECT is_semi_finished FROM products WHERE id = current_setting('test.raw')::uuid),
  'T3 — raw product is NOT semi-finished'
);

-- T4: removing the last sub-recipe row flips semi → FALSE.
UPDATE recipes
   SET is_active = FALSE
 WHERE product_id = current_setting('test.semi')::uuid;

SELECT ok(
  NOT (SELECT is_semi_finished FROM products WHERE id = current_setting('test.semi')::uuid),
  'T4 — deactivating sub-recipe rows flips is_semi_finished to FALSE'
);

-- T5: re-activating the row flips back.
UPDATE recipes
   SET is_active = TRUE
 WHERE product_id = current_setting('test.semi')::uuid;

SELECT ok(
  (SELECT is_semi_finished FROM products WHERE id = current_setting('test.semi')::uuid),
  'T5 — reactivating sub-recipe rows flips is_semi_finished back to TRUE'
);

-- T6: search_ingredients_v1 returns semi_finished kind via the flag.
SELECT ok(
  EXISTS (
    SELECT 1 FROM search_ingredients_v1('TestPainChocoMaster', 'semi_finished', 20)
     WHERE product_id = current_setting('test.semi')::uuid
  ),
  'T6 — search_ingredients_v1 returns semi product under kind=semi_finished'
);

-- T7: trigram tolerance — "croisant" (missing s) matches "TestLeafCroisant".
SELECT ok(
  EXISTS (
    SELECT 1 FROM search_ingredients_v1('croisant', 'all', 20)
     WHERE product_id = current_setting('test.leaf')::uuid
  ),
  'T7 — trigram similarity matches misspelled query'
);

-- T8: exact match comes first regardless of trigram score.
SELECT is(
  (SELECT product_id FROM search_ingredients_v1('TestLeafCroisant', 'all', 5) LIMIT 1),
  current_setting('test.leaf')::uuid,
  'T8 — exact name match wins rank 0'
);

SELECT * FROM finish();
ROLLBACK;
```

### - [ ] Step 2.7: Run pgTAP and verify all 8 tests pass

Run via MCP `execute_sql` with the entire file body. Or, from terminal once Phase 1.A is merged:

```bash
psql "$V3_DEV_PG_POOLER_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/tests/picker_polish.test.sql
```

Expected output ends with:

```
# All passed.
1..8
```

If any test fails, **stop and debug** — do not skip. Likely issues : missing fixtures, trigger recursion, missing similarity() permission.

### - [ ] Step 2.8: Write Vitest live RPC test

Save as `supabase/tests/functions/search-ingredients-polish.test.ts`:

```ts
// supabase/tests/functions/search-ingredients-polish.test.ts
// Session 16 / Phase 2.A — live RPC smoke for search_ingredients_v1 polish.
//
// Pattern mirrors Session 15 search-ingredients.test.ts : uses the same
// authenticated supabase client + fixture sandbox helper.

import { describe, it, expect, beforeAll } from 'vitest';
import { createTestClient, withFixtureSandbox, type Sandbox } from '../helpers/sandbox.js';

const supabase = createTestClient();

interface SearchRow {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  cost_price: number;
  current_stock: number;
  kind: 'raw' | 'sub_recipe' | 'semi_finished';
  has_recipe: boolean;
}

describe('search_ingredients_v1 polish', () => {
  let sandbox: Sandbox;
  let semiId: string;
  let leafId: string;

  beforeAll(async () => {
    sandbox = await withFixtureSandbox(supabase);
    leafId = await sandbox.createProduct({
      sku: 'POL-LEAF', name: 'PolishedLeafCroisant', unit: 'g', cost_price: 0.01,
    });
    const subId = await sandbox.createProduct({
      sku: 'POL-SUB', name: 'PolishedSubDough', unit: 'kg', cost_price: 0,
    });
    semiId = await sandbox.createProduct({
      sku: 'POL-SEMI', name: 'PolishedSemiPainChoc', unit: 'pcs', cost_price: 0,
    });
    await sandbox.createRecipe({ product_id: subId,  material_id: leafId, quantity: 500, unit: 'g'  });
    await sandbox.createRecipe({ product_id: semiId, material_id: subId,  quantity: 0.05, unit: 'kg' });
  });

  it('returns is_semi_finished via the maintained flag', async () => {
    const { data, error } = await supabase.rpc('search_ingredients_v1', {
      p_query: 'PolishedSemiPainChoc',
      p_kind:  'semi_finished',
      p_limit: 5,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as SearchRow[];
    expect(rows.some((r) => r.product_id === semiId && r.kind === 'semi_finished')).toBe(true);
  });

  it('matches misspelled query via pg_trgm similarity', async () => {
    const { data, error } = await supabase.rpc('search_ingredients_v1', {
      p_query: 'croisant',   // missing s
      p_kind:  'all',
      p_limit: 10,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as SearchRow[];
    expect(rows.some((r) => r.product_id === leafId)).toBe(true);
  });

  it('ranks exact match first even when trigram score for another row is high', async () => {
    const { data, error } = await supabase.rpc('search_ingredients_v1', {
      p_query: 'PolishedLeafCroisant',
      p_kind:  'all',
      p_limit: 5,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as SearchRow[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.product_id).toBe(leafId);
  });
});
```

**Note:** This file depends on `supabase/tests/helpers/sandbox.ts` which provides `createTestClient`, `withFixtureSandbox`, `Sandbox` etc. That helper already exists (Sessions 13-15). If `createProduct` / `createRecipe` shapes differ from above, adapt to the existing API surface — DO NOT invent new helper methods.

### - [ ] Step 2.9: Run the Vitest live RPC test

Run:

```bash
pnpm --filter @breakery/supabase test functions/search-ingredients-polish.test.ts
```

Expected: 3/3 passing. If `createProduct` / `createRecipe` helper signature is different, fix the test to match the existing helper (do not modify the helper itself).

### - [ ] Step 2.10: Commit Phase 2.A

```bash
git add supabase/migrations/2026052000001*.sql supabase/tests/picker_polish.test.sql supabase/tests/functions/search-ingredients-polish.test.ts
git commit -m "$(cat <<'EOF'
feat(db,inventory): session 16 — phase 2.A — picker polish (is_semi_finished + pg_trgm)

Resolves DEV-S15-3.A-01 + DEV-S15-3.A-02.

Migrations (5) :
- 20260520000010_extend_products_is_semi_finished : add BOOLEAN NOT NULL DEFAULT FALSE.
- 20260520000011_backfill_is_semi_finished : flag products with recipe-of-recipe (depth ≥ 2).
- 20260520000012_create_tr_recompute_is_semi_finished : trigger on `recipes` maintains flag.
- 20260520000013_add_pg_trgm_indexes_products : gin trigram indexes on name/sku
  (partial WHERE is_active AND deleted_at IS NULL).
- 20260520000014_bump_search_ingredients_v1 : read flag instead of nested EXISTS ;
  add similarity() to filter set (floor 0.3) ; rank tiers unchanged (exact > prefix
  > substring/trigram > untyped).

Tests :
- supabase/tests/picker_polish.test.sql (pgTAP, 8 assertions).
- supabase/tests/functions/search-ingredients-polish.test.ts (Vitest live RPC, 3 tests).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Phase 2.B — Per-version recipe cost (Wave 2, parallel)

**Files:**
- Create: `supabase/migrations/20260520000020_bump_recipe_version_snapshot_with_cost.sql`
- Create: `supabase/migrations/20260520000021_refresh_latest_recipe_version_with_cost.sql`
- Create: `supabase/migrations/20260520000022_extend_recipe_versions_payload_check.sql`
- Create: `supabase/tests/recipe_version_cost.test.sql`
- Modify: `apps/backoffice/src/features/inventory-production/hooks/useRecipeVersions.ts`
- Modify: `apps/backoffice/src/features/inventory-production/components/RecipeVersionHistory.tsx`
- Create: `apps/backoffice/src/features/inventory-production/__tests__/RecipeVersionHistory.cost.smoke.test.tsx`

### - [ ] Step 3.1: Write migration 020 — bump snapshot trigger

Save as `supabase/migrations/20260520000020_bump_recipe_version_snapshot_with_cost.sql`:

```sql
-- 20260520000020_bump_recipe_version_snapshot_with_cost.sql
-- Session 16 / Phase 2.B — DEV-S15-2.B-01.
--
-- Embed cost data in the snapshot. Shape changes (D7, breaking) :
--   OLD : jsonb_agg(...)  → bare array
--   NEW : {
--     "items": [{recipe_id, material_id, material_name, quantity, unit, notes, material_cost_price}, ...],
--     "product_cost_at_version": NUMERIC
--   }
--
-- product_cost_at_version is depth-1 only (D8). Sub-recipe material costs
-- resolve to products.cost_price at trigger time, not a recursive cascade.
-- Full cascade snapshot deferred to Session 17+ (DEV-S16-2.B-01).
--
-- Recursion guard pg_trigger_depth() < 1 preserved.

CREATE OR REPLACE FUNCTION tr_snapshot_recipe_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_id   UUID;
  v_next_version INT;
  v_items        JSONB;
  v_cost         NUMERIC;
  v_profile      UUID;
  v_action       TEXT;
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

  -- Build items array with material cost included.
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
  WHERE r.product_id = v_product_id
    AND r.is_active = TRUE
    AND r.deleted_at IS NULL;

  -- Depth-1 cost rollup : Σ(quantity × material_cost_price) over items.
  -- jsonb_path_query_array would be tidy but a CTE is more portable.
  SELECT COALESCE(SUM(
    (item->>'quantity')::NUMERIC * (item->>'material_cost_price')::NUMERIC
  ), 0)::NUMERIC(14,2)
  INTO v_cost
  FROM jsonb_array_elements(v_items) AS item;

  -- Next version number per product.
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM recipe_versions
   WHERE product_id = v_product_id;

  -- Best-effort actor.
  BEGIN
    SELECT id INTO v_profile FROM user_profiles
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    v_profile := NULL;
  END;

  INSERT INTO recipe_versions (product_id, version_number, snapshot, created_by, change_note)
  VALUES (
    v_product_id,
    v_next_version,
    jsonb_build_object(
      'items',                   v_items,
      'product_cost_at_version', v_cost
    ),
    v_profile,
    v_action
  );

  RETURN NULL;
END $$;

COMMENT ON FUNCTION tr_snapshot_recipe_version() IS
  'Session 16 / Phase 2.B (bumped from Session 15 / Phase 1.A). AFTER INSERT/UPDATE/DELETE '
  'on `recipes`. Snapshots {items: [...], product_cost_at_version: NUMERIC} into '
  'recipe_versions. product_cost_at_version is depth-1 only (D8) ; full cascade '
  'deferred (DEV-S16-2.B-01). Best-effort created_by from auth.uid().';
```

Apply via MCP.

### - [ ] Step 3.2: Write migration 021 — refresh latest version per product

Save as `supabase/migrations/20260520000021_refresh_latest_recipe_version_with_cost.sql`:

```sql
-- 20260520000021_refresh_latest_recipe_version_with_cost.sql
-- Session 16 / Phase 2.B — Non-destructive one-time refresh : for every
-- product with at least one active recipe row, create a fresh
-- recipe_versions row carrying the new {items, product_cost_at_version}
-- shape. Older versions stay in the legacy bare-array shape.
--
-- Idempotency : the migration is a single INSERT … SELECT inside MCP's
-- migration transaction. Re-running will create another generation of
-- refresh rows, which is harmless (recipe_versions is append-only) but
-- wasteful. The CHECK constraint added in 022 still applies to any
-- subsequent re-run.

WITH bom AS (
  SELECT
    r.product_id,
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
    ) AS items
  FROM recipes r
  JOIN products m ON m.id = r.material_id
  WHERE r.is_active = TRUE
    AND r.deleted_at IS NULL
  GROUP BY r.product_id
),
costed AS (
  SELECT
    b.product_id,
    b.items,
    COALESCE((
      SELECT SUM((it->>'quantity')::NUMERIC * (it->>'material_cost_price')::NUMERIC)
        FROM jsonb_array_elements(b.items) AS it
    ), 0)::NUMERIC(14,2) AS product_cost
  FROM bom b
),
numbered AS (
  SELECT
    c.product_id,
    c.items,
    c.product_cost,
    COALESCE((SELECT MAX(version_number) FROM recipe_versions rv WHERE rv.product_id = c.product_id), 0) + 1 AS next_version
  FROM costed c
)
INSERT INTO recipe_versions (product_id, version_number, snapshot, created_by, change_note)
SELECT
  n.product_id,
  n.next_version,
  jsonb_build_object(
    'items',                   n.items,
    'product_cost_at_version', n.product_cost
  ),
  NULL,
  'cost_snapshot_refresh'
FROM numbered n;
```

Apply via MCP. Verify:

```sql
SELECT COUNT(*) AS refreshed
  FROM recipe_versions
 WHERE change_note = 'cost_snapshot_refresh';
```

Expected: equal to count of distinct `product_id` in active recipes.

### - [ ] Step 3.3: Write migration 022 — payload CHECK constraint

Save as `supabase/migrations/20260520000022_extend_recipe_versions_payload_check.sql`:

```sql
-- 20260520000022_extend_recipe_versions_payload_check.sql
-- Session 16 / Phase 2.B — Enforce new payload shape going forward, exempt
-- legacy rows. Legacy rows are detected by snapshot being a JSONB array
-- (jsonb_typeof(snapshot) = 'array'). New rows MUST be jsonb_typeof = 'object'
-- AND contain `items` (array) + `product_cost_at_version` (number).
--
-- We do NOT use a created_at < timestamp predicate (proposed in spec §3 D7)
-- because using `jsonb_typeof` is a more robust shape check that survives
-- clock drift, partial backfills, or future refresh re-runs.

ALTER TABLE recipe_versions
  ADD CONSTRAINT recipe_versions_snapshot_shape_chk
  CHECK (
    jsonb_typeof(snapshot) = 'array'
    OR (
      jsonb_typeof(snapshot) = 'object'
      AND snapshot ? 'items'
      AND snapshot ? 'product_cost_at_version'
      AND jsonb_typeof(snapshot -> 'items') = 'array'
      AND jsonb_typeof(snapshot -> 'product_cost_at_version') = 'number'
    )
  )
  NOT VALID;

-- Validate against existing rows (legacy array shape passes the OR branch).
ALTER TABLE recipe_versions
  VALIDATE CONSTRAINT recipe_versions_snapshot_shape_chk;

COMMENT ON CONSTRAINT recipe_versions_snapshot_shape_chk ON recipe_versions IS
  'Session 16 / Phase 2.B. Accept legacy bare-array snapshots OR new '
  '{items, product_cost_at_version} object snapshots. Other shapes rejected.';
```

Apply via MCP.

### - [ ] Step 3.4: Write pgTAP test for cost snapshot

Save as `supabase/tests/recipe_version_cost.test.sql`:

```sql
-- supabase/tests/recipe_version_cost.test.sql
-- Session 16 / Phase 2.B — covers new snapshot shape + refresh idempotency
-- + CHECK constraint behavior.

BEGIN;

SELECT plan(6);

DO $$
DECLARE
  v_pr UUID := gen_random_uuid();
  v_ma UUID := gen_random_uuid();
BEGIN
  INSERT INTO products (id, sku, name, unit, cost_price, is_active)
  VALUES (v_ma, 'TEST-COST-MAT', 'TestCostMat', 'g', 0.02, TRUE);

  INSERT INTO products (id, sku, name, unit, cost_price, is_active)
  VALUES (v_pr, 'TEST-COST-PROD', 'TestCostProd', 'pcs', 0.0, TRUE);

  -- Trigger fires here, creating v1 in NEW shape.
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_pr, v_ma, 50, 'g', TRUE);

  PERFORM set_config('test.prod', v_pr::text, false);
  PERFORM set_config('test.mat',  v_ma::text, false);
END $$;

-- T1: snapshot is an object (new shape), not an array.
SELECT is(
  jsonb_typeof((SELECT snapshot FROM recipe_versions
                 WHERE product_id = current_setting('test.prod')::uuid
                 ORDER BY version_number DESC LIMIT 1)),
  'object',
  'T1 — fresh snapshot uses object shape'
);

-- T2: cost = 50 × 0.02 = 1.00.
SELECT is(
  (SELECT (snapshot->>'product_cost_at_version')::NUMERIC
     FROM recipe_versions
    WHERE product_id = current_setting('test.prod')::uuid
    ORDER BY version_number DESC LIMIT 1),
  1.00::NUMERIC,
  'T2 — product_cost_at_version = Σ(qty × material_cost_price)'
);

-- T3: items array contains material_cost_price.
SELECT ok(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      (SELECT snapshot->'items' FROM recipe_versions
        WHERE product_id = current_setting('test.prod')::uuid
        ORDER BY version_number DESC LIMIT 1)
    ) it
    WHERE (it->>'material_cost_price')::NUMERIC = 0.02
  ),
  'T3 — items rows include material_cost_price'
);

-- T4: invalid shape (bare number) is rejected by CHECK.
SELECT throws_ok(
  $$INSERT INTO recipe_versions (product_id, version_number, snapshot)
    VALUES (gen_random_uuid(), 1, '42'::jsonb)$$,
  '23514',
  NULL,
  'T4 — CHECK rejects non-object non-array snapshot'
);

-- T5: bare-array snapshot (legacy shape) still accepted by CHECK.
SELECT lives_ok(
  $$INSERT INTO recipe_versions (product_id, version_number, snapshot)
    VALUES (current_setting('test.prod')::uuid, 99999, '[{"material_id":"x"}]'::jsonb)$$,
  'T5 — CHECK accepts legacy bare-array snapshots'
);

-- T6: new object snapshot missing product_cost_at_version is rejected.
SELECT throws_ok(
  $$INSERT INTO recipe_versions (product_id, version_number, snapshot)
    VALUES (gen_random_uuid(), 1, '{"items":[]}'::jsonb)$$,
  '23514',
  NULL,
  'T6 — CHECK rejects object snapshot missing product_cost_at_version'
);

SELECT * FROM finish();
ROLLBACK;
```

### - [ ] Step 3.5: Run pgTAP, verify all 6 pass

Run via MCP `execute_sql` or psql against V3 dev (post-Phase-1.A):

```bash
psql "$V3_DEV_PG_POOLER_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/tests/recipe_version_cost.test.sql
```

Expected: `1..6` with all passing.

### - [ ] Step 3.6: Update `useRecipeVersions.ts` to tolerate both shapes

Edit `apps/backoffice/src/features/inventory-production/hooks/useRecipeVersions.ts`. Replace the entire file content with:

```ts
// apps/backoffice/src/features/inventory-production/hooks/useRecipeVersions.ts
//
// Session 16 — Phase 2.B — dual-shape tolerance.
// Legacy snapshots (pre-Session-16) are bare arrays of items, no cost data.
// New snapshots (Session 16+) are {items: [...], product_cost_at_version: number}.
// The hook normalizes both into RecipeVersionRow with optional productCostAtVersion.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

/** Single ingredient snapshot row inside `recipe_versions.snapshot` (JSONB). */
export interface RecipeVersionSnapshotRow {
  recipe_id:            string;
  material_id:          string;
  material_name:        string;
  quantity:             number;
  unit:                 string;
  notes?:               string | null;
  /** Session 16+ only ; legacy snapshots leave this undefined. */
  material_cost_price?: number;
}

export interface RecipeVersionRow {
  id:                     string;
  product_id:             string;
  version_number:         number;
  snapshot:               RecipeVersionSnapshotRow[];
  /** Session 16+ only ; undefined for legacy bare-array snapshots. */
  productCostAtVersion?:  number;
  created_at:             string;
  created_by:             string | null;
  created_by_name?:       string;
  change_note:            string | null;
}

interface RawNewShape {
  items: RecipeVersionSnapshotRow[];
  product_cost_at_version: number;
}

function parseSnapshot(raw: unknown): {
  rows: RecipeVersionSnapshotRow[];
  cost: number | undefined;
} {
  if (Array.isArray(raw)) {
    return { rows: raw as RecipeVersionSnapshotRow[], cost: undefined };
  }
  if (raw !== null && typeof raw === 'object' && 'items' in raw) {
    const obj = raw as RawNewShape;
    return {
      rows: Array.isArray(obj.items) ? obj.items : [],
      cost: typeof obj.product_cost_at_version === 'number'
        ? obj.product_cost_at_version
        : undefined,
    };
  }
  return { rows: [], cost: undefined };
}

export function useRecipeVersions(productId: string | null) {
  return useQuery<RecipeVersionRow[]>({
    queryKey: ['inventory-production', 'recipe-versions', productId ?? ''] as const,
    enabled: productId !== null && productId !== '',
    staleTime: 30_000,
    queryFn: async (): Promise<RecipeVersionRow[]> => {
      const { data, error } = await supabase
        .from('recipe_versions')
        .select('id, product_id, version_number, snapshot, created_at, created_by, change_note')
        .eq('product_id', productId!)
        .order('version_number', { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        product_id: string;
        version_number: number;
        snapshot: unknown;
        created_at: string;
        created_by: string | null;
        change_note: string | null;
      }>;

      const userIds = Array.from(new Set(
        rows.map((r) => r.created_by).filter((v): v is string => v !== null),
      ));
      const nameById: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: users, error: userErr } = await supabase
          .from('user_profiles')
          .select('id, full_name')
          .in('id', userIds);
        if (userErr) throw userErr;
        for (const u of users ?? []) {
          nameById[u.id as string] = u.full_name as string;
        }
      }

      return rows.map((r): RecipeVersionRow => {
        const parsed = parseSnapshot(r.snapshot);
        const base: RecipeVersionRow = {
          id:             r.id,
          product_id:     r.product_id,
          version_number: r.version_number,
          snapshot:       parsed.rows,
          created_at:     r.created_at,
          created_by:     r.created_by,
          change_note:    r.change_note,
        };
        if (parsed.cost !== undefined) base.productCostAtVersion = parsed.cost;
        if (r.created_by !== null) {
          const name = nameById[r.created_by];
          if (name !== undefined) base.created_by_name = name;
        }
        return base;
      });
    },
  });
}
```

### - [ ] Step 3.7: Update `RecipeVersionHistory.tsx` to surface cost

Edit `apps/backoffice/src/features/inventory-production/components/RecipeVersionHistory.tsx`. Make these two edits:

**Edit A** — in `VersionEntry`, add cost display to the header. Change the `header` block:

```tsx
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">
            Version {row.version_number}
          </h3>
          <p className="text-xs text-text-secondary">
            {createdAt}
            {row.created_by_name !== undefined && (
              <> &middot; by {row.created_by_name}</>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {row.productCostAtVersion !== undefined ? (
            <span
              className="text-xs font-mono text-text-secondary"
              data-testid={`version-cost-${row.version_number}`}
            >
              cost {row.productCostAtVersion.toLocaleString('en-US', {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })}
            </span>
          ) : (
            <span
              className="text-xs text-text-muted"
              title="Cost data added 2026-05-16"
              data-testid={`version-cost-${row.version_number}-legacy`}
            >
              cost —
            </span>
          )}
          {previous === null && (
            <span className="text-[10px] uppercase tracking-widest text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 rounded px-2 py-0.5">
              Initial
            </span>
          )}
        </div>
      </header>
```

**Edit B** — extend each diff row to show per-material subtotal when present. Change the `<li>` inside the diffs `<ul>`:

```tsx
          {diffs.map((d) => {
            const matSubtotal = (() => {
              const r = row.snapshot.find((s) => s.material_id === d.material_id);
              if (r?.material_cost_price === undefined) return null;
              return Number(r.quantity) * Number(r.material_cost_price);
            })();
            return (
              <li
                key={`${row.id}-${d.material_id}`}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${kindTone(d.kind)}`}
              >
                <span className="truncate">
                  {d.material_name}
                  {kindLabel(d.kind) !== '' && (
                    <span className="ml-2 text-[10px] uppercase tracking-widest opacity-70">
                      {kindLabel(d.kind)}
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs whitespace-nowrap flex items-center gap-2">
                  {d.kind === 'changed' && d.prev_quantity !== undefined && (
                    <span className="text-text-secondary line-through">
                      {d.prev_quantity.toLocaleString()} {d.prev_unit}
                    </span>
                  )}
                  <span>
                    {d.quantity.toLocaleString()} {d.unit}
                  </span>
                  {matSubtotal !== null && (
                    <span className="text-text-muted">
                      = {matSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
```

### - [ ] Step 3.8: Write the new-shape smoke test

Save as `apps/backoffice/src/features/inventory-production/__tests__/RecipeVersionHistory.cost.smoke.test.tsx`:

```tsx
// apps/backoffice/src/features/inventory-production/__tests__/RecipeVersionHistory.cost.smoke.test.tsx
// Session 16 / Phase 2.B — RecipeVersionHistory cost display smoke.
// Mocks two versions : v2 has new-shape cost data, v1 is legacy.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecipeVersionHistory } from '../components/RecipeVersionHistory.js';
import type { RecipeVersionRow } from '../hooks/useRecipeVersions.js';

const MOCK_ROWS: RecipeVersionRow[] = [
  {
    id: 'v2',
    product_id: 'p1',
    version_number: 2,
    snapshot: [
      { recipe_id: 'r-flour', material_id: 'm-flour', material_name: 'Flour',
        quantity: 500, unit: 'g', material_cost_price: 0.01 },
      { recipe_id: 'r-salt',  material_id: 'm-salt',  material_name: 'Salt',
        quantity: 10,  unit: 'g', material_cost_price: 0.05 },
    ],
    productCostAtVersion: 5.50, // 500*0.01 + 10*0.05
    created_at: '2026-05-16T10:00:00Z',
    created_by: 'u1',
    created_by_name: 'Alice',
    change_note: 'Updated with cost data',
  },
  {
    id: 'v1',
    product_id: 'p1',
    version_number: 1,
    snapshot: [
      { recipe_id: 'r-flour', material_id: 'm-flour', material_name: 'Flour',
        quantity: 450, unit: 'g' },
    ],
    // productCostAtVersion intentionally absent (legacy)
    created_at: '2026-05-01T10:00:00Z',
    created_by: 'u1',
    created_by_name: 'Alice',
    change_note: null,
  },
];

vi.mock('../hooks/useRecipeVersions.js', () => ({
  useRecipeVersions: () => ({ data: MOCK_ROWS, isLoading: false, error: null }),
}));

describe('RecipeVersionHistory cost smoke', () => {
  it('renders cost on the new-shape version (v2)', () => {
    render(<RecipeVersionHistory productId="p1" />);
    expect(screen.getByTestId('version-cost-2')).toHaveTextContent('cost 5.50');
  });

  it('renders the legacy placeholder on v1', () => {
    render(<RecipeVersionHistory productId="p1" />);
    expect(screen.getByTestId('version-cost-1-legacy')).toHaveTextContent('cost —');
  });

  it('renders per-material subtotals on v2 rows', () => {
    render(<RecipeVersionHistory productId="p1" />);
    // 500 × 0.01 = 5.00 and 10 × 0.05 = 0.50.
    expect(screen.getByText('= 5.00')).toBeInTheDocument();
    expect(screen.getByText('= 0.50')).toBeInTheDocument();
  });

  it('does NOT render subtotals on v1 (legacy) rows', () => {
    render(<RecipeVersionHistory productId="p1" />);
    // Should not see an "= X.XX" subtotal next to v1's Flour entry.
    const allEqMatches = screen.queryAllByText(/^= /);
    // Two matches expected total (v2 has two rows ; v1 has zero).
    expect(allEqMatches).toHaveLength(2);
  });
});
```

### - [ ] Step 3.9: Run smoke tests

Run:

```bash
pnpm --filter @breakery/backoffice test inventory-production/__tests__/RecipeVersionHistory
```

Expected: both `RecipeVersionHistory.smoke.test.tsx` (existing) and `RecipeVersionHistory.cost.smoke.test.tsx` (new) all green. **If the existing smoke breaks**, it likely means the header edit changed DOM structure under a selector — fix the existing test by adjusting its selectors (do not regress the new feature).

### - [ ] Step 3.10: Commit Phase 2.B

```bash
git add supabase/migrations/2026052000002*.sql supabase/tests/recipe_version_cost.test.sql apps/backoffice/src/features/inventory-production/hooks/useRecipeVersions.ts apps/backoffice/src/features/inventory-production/components/RecipeVersionHistory.tsx apps/backoffice/src/features/inventory-production/__tests__/RecipeVersionHistory.cost.smoke.test.tsx
git commit -m "$(cat <<'EOF'
feat(db,backoffice): session 16 — phase 2.B — per-version recipe cost in snapshot

Resolves DEV-S15-2.B-01.

Migrations (3) :
- 20260520000020_bump_recipe_version_snapshot_with_cost : breaking JSONB
  shape change to `{items, product_cost_at_version}` ; depth-1 cost rollup.
- 20260520000021_refresh_latest_recipe_version_with_cost : non-destructive
  one-time fresh snapshot per product with active recipe (change_note =
  'cost_snapshot_refresh').
- 20260520000022_extend_recipe_versions_payload_check : CHECK accepts
  legacy bare-array OR new object shape (jsonb_typeof discriminator).

UI :
- useRecipeVersions.ts : dual-shape parser, exposes optional
  productCostAtVersion.
- RecipeVersionHistory.tsx : cost in version header + per-material
  subtotal column. Legacy versions show "cost —" with tooltip.

Tests :
- supabase/tests/recipe_version_cost.test.sql (pgTAP, 6 assertions).
- RecipeVersionHistory.cost.smoke.test.tsx (4 cases).

Known limitations :
- DEV-S16-2.B-01 : product_cost_at_version is depth-1 only ; sub-recipe
  cost cascade in snapshot deferred to Session 17+.
- DEV-S16-2.B-02 : legacy rows stay in bare-array shape — no historical
  cost data is reconstructible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Phase 2.C — Multi-level aggregate preview (Wave 2, parallel)

**Files:**
- Create: `packages/domain/src/production/expandRecipeCascade.ts`
- Create: `packages/domain/src/production/__tests__/expandRecipeCascade.test.ts`
- Modify: `packages/domain/src/production/index.ts`
- Modify: `apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx`
- Modify: `apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx`

### - [ ] Step 4.1: Write the failing domain test FIRST

Save as `packages/domain/src/production/__tests__/expandRecipeCascade.test.ts`:

```ts
// packages/domain/src/production/__tests__/expandRecipeCascade.test.ts
// Session 16 / Phase 2.C — leaf-only cascade walker.

import { describe, it, expect } from 'vitest';
import {
  expandRecipeCascade,
  RecipeCycleError,
  RecipeDepthExceededError,
  type RecipeGraph,
} from '../index.js';

function product(id: string, unit = 'g', cost = 0): RecipeGraph['products'][string] {
  return { id, name: id, unit, cost_price: cost };
}

describe('expandRecipeCascade', () => {
  it('returns leaves directly for a flat recipe', () => {
    const graph: RecipeGraph = {
      products: {
        croissant: product('croissant', 'pcs'),
        flour:     product('flour', 'g', 0.01),
        butter:    product('butter', 'g', 0.05),
      },
      recipes: [
        { product_id: 'croissant', material_id: 'flour',  quantity: 50, unit: 'g' },
        { product_id: 'croissant', material_id: 'butter', quantity: 30, unit: 'g' },
      ],
    };
    const result = expandRecipeCascade(graph, 'croissant', 1);
    expect(result.size).toBe(2);
    expect(result.get('flour')?.qty).toBe(50);
    expect(result.get('butter')?.qty).toBe(30);
  });

  it('walks 2 levels and aggregates leaves (sub-recipes NOT in output)', () => {
    // pain-choco -> dough (sub-recipe) -> flour, butter ; pain-choco -> chocolate
    const graph: RecipeGraph = {
      products: {
        pain_choco: product('pain_choco', 'pcs'),
        dough:      product('dough', 'kg'),
        flour:      product('flour', 'g', 0.01),
        butter:     product('butter', 'g', 0.05),
        chocolate:  product('chocolate', 'g', 0.10),
      },
      recipes: [
        // 1 pain-choco needs 0.05 kg dough + 20g chocolate.
        { product_id: 'pain_choco', material_id: 'dough',     quantity: 0.05, unit: 'kg' },
        { product_id: 'pain_choco', material_id: 'chocolate', quantity: 20,   unit: 'g' },
        // 1 kg dough = 500g flour + 500g butter.
        { product_id: 'dough', material_id: 'flour',  quantity: 500, unit: 'g' },
        { product_id: 'dough', material_id: 'butter', quantity: 500, unit: 'g' },
      ],
    };
    const result = expandRecipeCascade(graph, 'pain_choco', 1);
    // Sub-recipe `dough` is NOT in output.
    expect(result.has('dough')).toBe(false);
    // 0.05 kg dough × 500 g/kg = 25 g flour AND 25 g butter.
    expect(result.get('flour')?.qty).toBeCloseTo(25, 5);
    expect(result.get('butter')?.qty).toBeCloseTo(25, 5);
    // 20 g chocolate.
    expect(result.get('chocolate')?.qty).toBe(20);
  });

  it('multiplies by the requested batch size', () => {
    const graph: RecipeGraph = {
      products: {
        product: product('product', 'pcs'),
        leaf:    product('leaf', 'g'),
      },
      recipes: [
        { product_id: 'product', material_id: 'leaf', quantity: 10, unit: 'g' },
      ],
    };
    const result = expandRecipeCascade(graph, 'product', 7);
    expect(result.get('leaf')?.qty).toBe(70);
  });

  it('handles a 5-level deep chain', () => {
    const products: RecipeGraph['products'] = {
      L0: product('L0'), L1: product('L1'), L2: product('L2'),
      L3: product('L3'), L4: product('L4'), leaf: product('leaf', 'g'),
    };
    const recipes: RecipeGraph['recipes'] = [
      { product_id: 'L0',   material_id: 'L1', quantity: 1, unit: 'g' },
      { product_id: 'L1',   material_id: 'L2', quantity: 1, unit: 'g' },
      { product_id: 'L2',   material_id: 'L3', quantity: 1, unit: 'g' },
      { product_id: 'L3',   material_id: 'L4', quantity: 1, unit: 'g' },
      { product_id: 'L4',   material_id: 'leaf', quantity: 1, unit: 'g' },
    ];
    const result = expandRecipeCascade({ products, recipes }, 'L0', 1);
    expect(result.size).toBe(1);
    expect(result.get('leaf')?.qty).toBe(1);
  });

  it('throws RecipeCycleError on a direct cycle', () => {
    const graph: RecipeGraph = {
      products: { A: product('A'), B: product('B') },
      recipes: [
        { product_id: 'A', material_id: 'B', quantity: 1, unit: 'g' },
        { product_id: 'B', material_id: 'A', quantity: 1, unit: 'g' },
      ],
    };
    expect(() => expandRecipeCascade(graph, 'A', 1)).toThrow(RecipeCycleError);
  });

  it('throws RecipeDepthExceededError beyond maxDepth', () => {
    // Linear chain of 7 levels with maxDepth = 3.
    const products: RecipeGraph['products'] = {};
    const recipes: RecipeGraph['recipes'] = [];
    for (let i = 0; i < 7; i++) products[`L${i}`] = product(`L${i}`);
    for (let i = 0; i < 6; i++) {
      recipes.push({ product_id: `L${i}`, material_id: `L${i + 1}`, quantity: 1, unit: 'g' });
    }
    expect(() => expandRecipeCascade({ products, recipes }, 'L0', 1, { maxDepth: 3 }))
      .toThrow(RecipeDepthExceededError);
  });

  it('aggregates same leaf reached by multiple paths', () => {
    // pain-special uses dough AND a small extra flour bag at top level.
    const graph: RecipeGraph = {
      products: {
        pain_special: product('pain_special'),
        dough:        product('dough', 'kg'),
        flour:        product('flour', 'g'),
      },
      recipes: [
        { product_id: 'pain_special', material_id: 'dough', quantity: 0.05, unit: 'kg' },
        { product_id: 'pain_special', material_id: 'flour', quantity: 10,   unit: 'g' },
        { product_id: 'dough',        material_id: 'flour', quantity: 500,  unit: 'g' },
      ],
    };
    const result = expandRecipeCascade(graph, 'pain_special', 1);
    // 25 g from dough + 10 g top-level = 35 g flour.
    expect(result.get('flour')?.qty).toBeCloseTo(35, 5);
  });
});
```

### - [ ] Step 4.2: Run the test, verify it fails

Run:

```bash
pnpm --filter @breakery/domain test expandRecipeCascade
```

Expected: ALL 7 tests fail with "expandRecipeCascade is not exported" / "Cannot find name". This confirms the test file is wired up but the implementation doesn't exist yet.

### - [ ] Step 4.3: Implement `expandRecipeCascade.ts`

Save as `packages/domain/src/production/expandRecipeCascade.ts`:

```ts
// packages/domain/src/production/expandRecipeCascade.ts
// Session 16 — Phase 2.C — leaf-only recursive cascade walker.
//
// Walks a RecipeGraph from `productId` and accumulates only LEAF materials
// (skips sub-recipe intermediates). Reuses the cycle/depth-cap semantics of
// `recipeCostCalculator` so client preview matches server-side cascade.
//
// Returns a Map keyed by material_id with aggregate {qty, name, unit}.
// `qty` is measured in the MATERIAL's stock unit (graph.products[matId].unit).
// We do NOT apply unit conversion in the client preview (mirrors D7 — identity
// conversion). If recipe-unit ≠ material-unit, the SERVER cascade is the
// source of truth ; the preview will be approximate.

import {
  RecipeCycleError,
  RecipeDepthExceededError,
  type RecipeGraph,
  type RecipeGraphRow,
} from './recipeCostCalculator.js';

export interface CascadeLeaf {
  qty:  number;
  name: string;
  unit: string;
}

export interface ExpandRecipeCascadeOptions {
  /** Hard cap on recursion depth. Defaults to 5 (matches DB cascade). */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 5;

function indexRowsByProduct(rows: readonly RecipeGraphRow[]): Map<string, RecipeGraphRow[]> {
  const map = new Map<string, RecipeGraphRow[]>();
  for (const r of rows) {
    const bucket = map.get(r.product_id);
    if (bucket) bucket.push(r);
    else map.set(r.product_id, [r]);
  }
  return map;
}

interface WalkCtx {
  graph: RecipeGraph;
  rowsByProduct: Map<string, RecipeGraphRow[]>;
  maxDepth: number;
  out: Map<string, CascadeLeaf>;
}

function walk(
  ctx: WalkCtx,
  productId: string,
  multiplier: number,
  depth: number,
  ancestors: Set<string>,
  path: string[],
): void {
  if (depth > ctx.maxDepth) {
    throw new RecipeDepthExceededError(depth);
  }
  const rows = ctx.rowsByProduct.get(productId) ?? [];
  for (const row of rows) {
    const isRecipe = ctx.rowsByProduct.has(row.material_id);
    if (isRecipe) {
      if (ancestors.has(row.material_id)) {
        throw new RecipeCycleError([...path, row.material_id]);
      }
      ancestors.add(row.material_id);
      path.push(row.material_id);
      try {
        walk(ctx, row.material_id, multiplier * row.quantity, depth + 1, ancestors, path);
      } finally {
        ancestors.delete(row.material_id);
        path.pop();
      }
    } else {
      const product = ctx.graph.products[row.material_id];
      if (!product) {
        throw new Error(
          `Material ${row.material_id} referenced by ${productId} is missing from graph.products`,
        );
      }
      const qty = multiplier * row.quantity;
      const existing = ctx.out.get(row.material_id);
      if (existing !== undefined) {
        existing.qty += qty;
      } else {
        ctx.out.set(row.material_id, { qty, name: product.name, unit: product.unit });
      }
    }
  }
}

export function expandRecipeCascade(
  graph: RecipeGraph,
  productId: string,
  multiplier: number,
  opts: ExpandRecipeCascadeOptions = {},
): Map<string, CascadeLeaf> {
  const ctx: WalkCtx = {
    graph,
    rowsByProduct: indexRowsByProduct(graph.recipes),
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    out: new Map<string, CascadeLeaf>(),
  };
  walk(ctx, productId, multiplier, 1, new Set([productId]), [productId]);
  return ctx.out;
}
```

### - [ ] Step 4.4: Update the production barrel export

Edit `packages/domain/src/production/index.ts`. Add the `expandRecipeCascade` export. Replace lines 11-23 with:

```ts
export {
  calculateRecipeCost,
  tryCalculateRecipeCost,
  RecipeCycleError,
  RecipeDepthExceededError,
  type RecipeGraph,
  type RecipeGraphProduct,
  type RecipeGraphRow,
  type RecipeCostBreakdown,
  type RecipeCostBreakdownItem,
  type CalculateRecipeCostOptions,
  type TryCalculateRecipeCostResult,
} from './recipeCostCalculator.js';
export {
  expandRecipeCascade,
  type CascadeLeaf,
  type ExpandRecipeCascadeOptions,
} from './expandRecipeCascade.js';
```

### - [ ] Step 4.5: Run the test, verify all 7 pass

Run:

```bash
pnpm --filter @breakery/domain test expandRecipeCascade
```

Expected: 7/7 green. If a single test fails, debug — most likely a `multiplier × quantity` arithmetic issue when crossing unit boundaries (e.g., kg → g in the dough example).

### - [ ] Step 4.6: Replace `IngredientAggregatePreview.tsx` with cascade-aware version

The existing component uses `expandRecipe(recipe, multiplier)` (depth-1) and `useRecipesPerProduct(productIds)` (only top-level products). Replace the entire body with a recursive graph-builder version.

Replace `apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx` with:

```tsx
// apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx
//
// Session 16 / Phase 2.C — full sub-recipe cascade preview.
//
// For each (productId, qty_produced + qty_waste) :
//   1. Build a RecipeGraph by BFS-fetching list_recipes_v1 for every reachable
//      product (cached per-id by TanStack Query).
//   2. Call expandRecipeCascade(graph, productId, multiplier) — leaves only.
//   3. Sum requirements by material_id.
//   4. Compare to a fresh products.current_stock snapshot.

import { useMemo, type JSX } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  expandRecipeCascade,
  RecipeCycleError,
  RecipeDepthExceededError,
  type RecipeGraph,
  type RecipeGraphProduct,
  type RecipeGraphRow,
} from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import type { BatchItem } from './BatchSelector.js';

export interface IngredientAggregatePreviewProps {
  items: BatchItem[];
}

interface AggregatedRow {
  materialId:   string;
  materialName: string;
  materialUnit: string;
  totalQty:     number;
  available:    number;
  sufficient:   boolean;
  shortfall:    number;
}

/** Raw shape returned by list_recipes_v1. */
interface RpcRecipeRow {
  recipe_id:     string;
  product_id:    string;
  product_name:  string;
  product_unit:  string;
  material_id:   string;
  material_name: string;
  material_unit: string;
  material_cost_price: number;
  quantity:      number;
  unit:          string;
  is_active:     boolean;
  notes:         string | null;
}

const MAX_BFS_DEPTH = 5;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/**
 * Layered BFS of recipe products. We fetch one level per `useQueries` round ;
 * the returned key set seeds the next level. Caps at MAX_BFS_DEPTH.
 */
function useGraphBuilder(rootProductIds: string[]): {
  graph: RecipeGraph | null;
  loading: boolean;
} {
  // ── Level 1: roots.
  const level1 = useQueries({
    queries: rootProductIds.map((pid) => ({
      queryKey: ['inventory-production', 'recipes', pid] as const,
      enabled:  pid !== '',
      staleTime: 30_000,
      queryFn: async (): Promise<RpcRecipeRow[]> => {
        const { data, error } = await supabase.rpc('list_recipes_v1', { p_product_id: pid });
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RpcRecipeRow[];
      },
    })),
  });

  // Reachable product ids at each depth ; we keep a flat set and a queue.
  const { discoveredIds, allRows, level1Loading } = useMemo(() => {
    const rowsAcc: RpcRecipeRow[] = [];
    const ids = new Set<string>(rootProductIds);
    let isLoading = false;
    level1.forEach((q) => {
      if (q.isLoading) isLoading = true;
      if (q.data !== undefined) {
        for (const row of q.data) {
          rowsAcc.push(row);
          ids.add(row.material_id);
        }
      }
    });
    return { discoveredIds: Array.from(ids), allRows: rowsAcc, level1Loading: isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level1.map((q) => q.dataUpdatedAt).join(','), rootProductIds.join(',')]);

  // ── Levels 2..MAX: fetch list_recipes_v1 for newly-discovered material ids
  // that don't yet have rows in allRows (they might be leaves OR deeper recipes).
  const candidates = useMemo(
    () => discoveredIds.filter((id) => !rootProductIds.includes(id)),
    [discoveredIds, rootProductIds],
  );
  const childQueries = useQueries({
    queries: candidates.map((pid) => ({
      queryKey: ['inventory-production', 'recipes', pid] as const,
      enabled:  pid !== '' && !level1Loading,
      staleTime: 30_000,
      queryFn: async (): Promise<RpcRecipeRow[]> => {
        const { data, error } = await supabase.rpc('list_recipes_v1', { p_product_id: pid });
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as RpcRecipeRow[];
      },
    })),
  });

  const { graph, loading } = useMemo<{ graph: RecipeGraph | null; loading: boolean }>(() => {
    let stillLoading = level1Loading;
    const accRows: RpcRecipeRow[] = [...allRows];
    const productMap: Record<string, RecipeGraphProduct> = {};
    childQueries.forEach((q) => {
      if (q.isLoading) stillLoading = true;
      if (q.data !== undefined) {
        for (const row of q.data) accRows.push(row);
      }
    });

    if (stillLoading) return { graph: null, loading: true };

    // Build products + recipes for the graph.
    const recipes: RecipeGraphRow[] = [];
    for (const row of accRows) {
      // Product side (the parent recipe owner).
      productMap[row.product_id] = {
        id: row.product_id, name: row.product_name, unit: row.product_unit, cost_price: 0,
      };
      // Material side (always materialized so leaves are addressable).
      productMap[row.material_id] = {
        id: row.material_id, name: row.material_name, unit: row.material_unit,
        cost_price: Number(row.material_cost_price) || 0,
      };
      recipes.push({
        product_id: row.product_id, material_id: row.material_id,
        quantity: Number(row.quantity), unit: row.unit,
      });
    }
    return { graph: { products: productMap, recipes }, loading: false };
  }, [level1Loading, allRows, childQueries.map((q) => q.dataUpdatedAt).join(',')]);

  return { graph, loading };
}

function useMaterialStockSnapshot(materialIds: string[]) {
  return useQuery({
    queryKey: ['inventory-production', 'material-stock-snapshot', [...materialIds].sort()] as const,
    enabled:  materialIds.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, current_stock')
        .in('id', materialIds);
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const r of data ?? []) out[r.id as string] = Number(r.current_stock);
      return out;
    },
  });
}

export function IngredientAggregatePreview({
  items,
}: IngredientAggregatePreviewProps): JSX.Element {
  const validRows = useMemo(
    () => items.filter((it) => {
      if (it.productId === null) return false;
      const q = Number.parseFloat(it.quantityProduced);
      return Number.isFinite(q) && q > 0;
    }),
    [items],
  );

  const rootProductIds = useMemo(
    () => Array.from(new Set(validRows.map((r) => r.productId as string))),
    [validRows],
  );

  const { graph, loading: graphLoading } = useGraphBuilder(rootProductIds);

  const { aggregated, error } = useMemo<{
    aggregated: Map<string, { name: string; unit: string; totalQty: number }>;
    error:      string | null;
  }>(() => {
    const out = new Map<string, { name: string; unit: string; totalQty: number }>();
    if (graph === null) return { aggregated: out, error: null };
    try {
      for (const row of validRows) {
        const productId = row.productId as string;
        const qty   = Number.parseFloat(row.quantityProduced);
        const waste = Number.parseFloat(row.quantityWaste) || 0;
        const multiplier = qty + waste;
        if (multiplier <= 0) continue;
        const leaves = expandRecipeCascade(graph, productId, multiplier, { maxDepth: MAX_BFS_DEPTH });
        for (const [matId, leaf] of leaves) {
          const cur = out.get(matId);
          if (cur !== undefined) cur.totalQty += leaf.qty;
          else out.set(matId, { name: leaf.name, unit: leaf.unit, totalQty: leaf.qty });
        }
      }
      return { aggregated: out, error: null };
    } catch (err) {
      if (err instanceof RecipeCycleError) {
        return { aggregated: out, error: `Recipe cycle detected (${err.path.join(' -> ')}).` };
      }
      if (err instanceof RecipeDepthExceededError) {
        return { aggregated: out, error: `Recipe nesting too deep (>${MAX_BFS_DEPTH}).` };
      }
      return { aggregated: out, error: 'Failed to compute ingredient preview.' };
    }
  }, [validRows, graph]);

  const materialIds = useMemo(() => Array.from(aggregated.keys()), [aggregated]);
  const stockQ = useMaterialStockSnapshot(materialIds);

  const rows: AggregatedRow[] = useMemo(() => {
    const stockMap = stockQ.data ?? {};
    return Array.from(aggregated.entries())
      .map(([materialId, leaf]) => {
        const available = stockMap[materialId] ?? 0;
        const shortfall = Math.max(0, leaf.totalQty - available);
        return {
          materialId, materialName: leaf.name, materialUnit: leaf.unit,
          totalQty: leaf.totalQty, available,
          sufficient: shortfall === 0, shortfall,
        };
      })
      .sort((a, b) => {
        if (a.sufficient !== b.sufficient) return a.sufficient ? 1 : -1;
        return a.materialName.localeCompare(b.materialName);
      });
  }, [aggregated, stockQ.data]);

  const anyShortage = rows.some((r) => !r.sufficient);
  const stockLoading = stockQ.isLoading;

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

      {error !== null && (
        <p role="alert" className="text-xs text-red">{error}</p>
      )}

      {validRows.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Pick a recipe and enter a quantity to see the aggregate ingredient totals.
        </p>
      ) : graphLoading || stockLoading ? (
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

### - [ ] Step 4.7: Update the smoke test to cover cascade

Edit `apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx`. **Add** a 4th test (do not delete the existing 3 — they cover depth-1 cases which still work after the refactor):

Insert at the end of the `describe(...)` block (after the existing "shows OK status when stock covers requirements" test):

```tsx
  it('cascades through a 2-level recipe and aggregates leaf materials only', async () => {
    // pain-choco (1 pcs) -> 0.05 kg dough + 20 g chocolate
    //   dough (1 kg) -> 500 g flour + 500 g butter
    // For 1 pain-choco : 25 g flour + 25 g butter + 20 g chocolate.
    // sub-recipe `dough` must NOT appear in the preview.

    mockRpc.mockImplementation((fn: string, args: { p_product_id?: string }) => {
      if (fn !== 'list_recipes_v1') return Promise.resolve({ data: [], error: null });
      if (args.p_product_id === 'prod-painchoco') {
        return Promise.resolve({ data: [
          { recipe_id: 'r1', product_id: 'prod-painchoco', product_name: 'PainChoco', product_unit: 'pcs',
            material_id: 'prod-dough', material_name: 'Dough', material_unit: 'kg',
            material_cost_price: 0, quantity: 0.05, unit: 'kg', is_active: true, notes: null },
          { recipe_id: 'r2', product_id: 'prod-painchoco', product_name: 'PainChoco', product_unit: 'pcs',
            material_id: 'mat-chocolate', material_name: 'Chocolate', material_unit: 'g',
            material_cost_price: 0.1, quantity: 20, unit: 'g', is_active: true, notes: null },
        ], error: null });
      }
      if (args.p_product_id === 'prod-dough') {
        return Promise.resolve({ data: [
          { recipe_id: 'r3', product_id: 'prod-dough', product_name: 'Dough', product_unit: 'kg',
            material_id: 'mat-flour', material_name: 'Flour', material_unit: 'g',
            material_cost_price: 0.01, quantity: 500, unit: 'g', is_active: true, notes: null },
          { recipe_id: 'r4', product_id: 'prod-dough', product_name: 'Dough', product_unit: 'kg',
            material_id: 'mat-butter', material_name: 'Butter', material_unit: 'g',
            material_cost_price: 0.05, quantity: 500, unit: 'g', is_active: true, notes: null },
        ], error: null });
      }
      // Leaves return empty list (no recipe = leaf).
      return Promise.resolve({ data: [], error: null });
    });
    mockProductsSelectIn.mockReturnValue({
      data: [
        { id: 'mat-flour',     current_stock: 1000 },
        { id: 'mat-butter',    current_stock: 1000 },
        { id: 'mat-chocolate', current_stock: 1000 },
      ],
      error: null,
    });

    renderPreview([
      row({ productId: 'prod-painchoco', productName: 'PainChoco', productUnit: 'pcs', quantityProduced: '1' }),
    ]);

    await waitFor(() => {
      expect(screen.getByText('Flour')).toBeInTheDocument();
    });
    expect(screen.getByText('Butter')).toBeInTheDocument();
    expect(screen.getByText('Chocolate')).toBeInTheDocument();
    // Sub-recipe `Dough` must NOT appear in the preview.
    expect(screen.queryByText(/^Dough$/)).not.toBeInTheDocument();
  });
```

### - [ ] Step 4.8: Run all smoke tests

Run:

```bash
pnpm --filter @breakery/backoffice test inventory-production/__tests__/IngredientAggregatePreview
```

Expected: 4/4 green (3 existing + 1 new cascade test). If the existing tests now fail, the root cause is most likely that the new graph builder needs 2 BFS rounds even for depth-1 recipes (because we conservatively fetch each material), causing the mocked `list_recipes_v1` to be called for leaves. Inspect : leaves must return `{ data: [], error: null }` to mark them as terminal. The mock `mockImplementation` in existing tests already returns empty data for unknown product_ids — should pass without change.

### - [ ] Step 4.9: Commit Phase 2.C

```bash
git add packages/domain/src/production/expandRecipeCascade.ts packages/domain/src/production/__tests__/expandRecipeCascade.test.ts packages/domain/src/production/index.ts apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx
git commit -m "$(cat <<'EOF'
feat(domain,backoffice): session 16 — phase 2.C — multi-level cascade in aggregate preview

Resolves DEV-S15-4.A-02.

Domain :
- expandRecipeCascade(graph, productId, multiplier, opts?) : leaf-only DFS,
  reuses RecipeCycleError + RecipeDepthExceededError from recipeCostCalculator.
- 7 unit tests cover flat, 2-level, 5-level, cycle, depth-exceeded,
  multi-path leaf aggregation.

UI :
- IngredientAggregatePreview rewritten to BFS-build a RecipeGraph from
  list_recipes_v1 calls and call expandRecipeCascade (was depth-1 via
  expandRecipe). Sub-recipe intermediates are excluded from output ; only
  leaf materials display.

Smoke :
- 4th test added : 2-level pain-choco -> dough -> {flour, butter} ; verifies
  Dough is absent from the preview, Flour/Butter/Chocolate are present.

Known limitation :
- DEV-S16-2.C-01 : graph builder uses iterative useQueries BFS ; one RPC
  per discovered product. Future recipe_bom_full_v1 RPC could replace.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Phase 3.A — Wave 2 gate (Wave 3)

### - [ ] Step 5.1: Regenerate TypeScript types

Run via MCP:

```js
mcp__plugin_supabase_supabase__generate_typescript_types({
  project_id: 'ikcyvlovptebroadgtvd'
})
```

Save the returned `types` string verbatim to `packages/supabase/src/types.generated.ts` (overwrite the file).

### - [ ] Step 5.2: Run typecheck

Run:

```bash
pnpm typecheck
```

Expected: green. If any drift surfaces (e.g., `products.is_semi_finished` not appearing), re-run regen and re-save.

### - [ ] Step 5.3: Cross-phase touchpoint check

Run targeted greps to confirm no incidental regressions :

```bash
# Confirm expandRecipe still exists (used elsewhere) and expandRecipeCascade is added.
grep -rn "expandRecipe\b" packages/domain/src apps/backoffice/src apps/pos/src
grep -rn "expandRecipeCascade" packages/domain/src apps/backoffice/src
```

Expected: `expandRecipe` is still referenced in `recipeExpansion.ts` and any other Session 14/15 callers. `expandRecipeCascade` is referenced in `index.ts`, `expandRecipeCascade.ts` (own file), and `IngredientAggregatePreview.tsx` only.

```bash
# Confirm search_ingredients_v1 signature unchanged at the call site.
grep -rn "search_ingredients_v1" apps/backoffice/src
```

Expected: no callers need to pass new args.

### - [ ] Step 5.4: Run all tests at the suite level

Run:

```bash
pnpm exec turbo run test --concurrency=1
```

Expected: ALL green. Any new failure should map to one of the Wave 2 phases — go fix that phase, do not skip tests.

### - [ ] Step 5.5: Commit Phase 3.A

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "$(cat <<'EOF'
chore(types): session 16 — phase 3.A — regen types after wave 2 migrations

Includes products.is_semi_finished (Phase 2.A), recipe_versions snapshot
shape unchanged at TS level (still typed as Json), search_ingredients_v1
signature unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Phase 4.A — Closeout (Wave 4)

### - [ ] Step 6.1: Run full test suite

```bash
pnpm exec turbo run test --concurrency=1
```

Expected: green. If RED, **stop and fix** — closeout doesn't proceed on red CI.

### - [ ] Step 6.2: Run full build

```bash
pnpm build
```

Expected: green. Note the bundle sizes for `apps/backoffice/dist/assets/index-*.js` and `apps/pos/dist/assets/index-*.js`. Compare to Session 15 baseline (`git checkout master -- /dev/null` first then diff). Delta target : < +10 KB on backoffice (one new domain helper + small UI extras) ; POS unchanged.

### - [ ] Step 6.3: Update CLAUDE.md "Active Workplan" pointer

Edit `CLAUDE.md`. Change the line :

```
- **Current session:** Session 16 — **CI revival + S15 follow-ups** ...
```

To :

```
- **Current session:** Session 17 — TBD (next session opens with backlog triage post-S16 merge).
- **Previous session:** Session 16 — CI revival + S15 follow-ups ✓ merged YYYY-MM-DD on `swarm/session-16` (commits: <count>, 4 waves, 8 migrations, INDEX: [`docs/workplan/plans/2026-05-16-session-16-INDEX.md`](2026-05-16-session-16-INDEX.md)). Spec: [`docs/workplan/specs/2026-05-16-session-16-spec.md`](../../specs/archive/2026-05-16-session-16-spec.md). Delivered nightly cloud pgTAP cron + `products.is_semi_finished` + pg_trgm indexes + trigram ranking in `search_ingredients_v1` + per-version cost in `recipe_versions.snapshot` + multi-level cascade in `IngredientAggregatePreview` via new `expandRecipeCascade` domain helper. Deviations tracked in INDEX §10.
```

And re-cascade the "Previous session" line into the Session 15 description (already on disk — keep its existing wording, just shift down).

### - [ ] Step 6.4: Update INDEX §10 deviation packs

Open `docs/workplan/plans/2026-05-16-session-16-INDEX.md` §10 and confirm the 4 known limitations from spec §6 are recorded :

- `DEV-S16-2.B-01` — depth-1 only cost in snapshot.
- `DEV-S16-2.B-02` — legacy rows stay in bare-array shape.
- `DEV-S16-2.C-01` — graph builder uses BFS via useQueries.
- `DEV-S16-1.A-01` — nightly pgTAP is the only automated check.

Add any NEW deviation packs surfaced during Wave 1/2 execution (rare for an op-hygiene session, but document if any).

### - [ ] Step 6.5: Open PR draft

Run:

```bash
git push -u origin swarm/session-16

gh pr create \
  --base master \
  --head swarm/session-16 \
  --draft \
  --title "Session 16 — CI revival + S15 follow-ups" \
  --body "$(cat <<'EOF'
## Summary

Operational hygiene session.

- Drop broken Docker `supabase-tests` CI job (red since Session 13) ; add `.github/workflows/pgtap-nightly.yml` cron `0 19 * * *` UTC = 02:00 Asia/Jakarta against V3 dev — resolves `DEV-S15-CI-01` (medium).
- `products.is_semi_finished` boolean flag + maintenance trigger + pg_trgm GIN indexes + trigram ranking in `search_ingredients_v1` — resolves `DEV-S15-3.A-01` / `DEV-S15-3.A-02`.
- Per-version recipe cost embedded in `recipe_versions.snapshot` (breaking shape change) + UI cost column with legacy-row tolerance — resolves `DEV-S15-2.B-01`.
- Multi-level cascade in `IngredientAggregatePreview` via new `expandRecipeCascade` domain helper — resolves `DEV-S15-4.A-02`.

## Migrations

- `20260520000010_extend_products_is_semi_finished`
- `20260520000011_backfill_is_semi_finished`
- `20260520000012_create_tr_recompute_is_semi_finished`
- `20260520000013_add_pg_trgm_indexes_products`
- `20260520000014_bump_search_ingredients_v1`
- `20260520000020_bump_recipe_version_snapshot_with_cost`
- `20260520000021_refresh_latest_recipe_version_with_cost`
- `20260520000022_extend_recipe_versions_payload_check`

## Test plan

- [ ] `pnpm typecheck`
- [ ] `pnpm exec turbo run test --concurrency=1`
- [ ] `pnpm build`
- [ ] pgTAP suite green via cloud MCP
- [ ] `pgtap-nightly.yml` workflow_dispatch returns exit 0
- [ ] Manual smoke : open RecipeEditor → "History" tab on a refreshed product → cost surfaced on the latest version, legacy versions show "cost —".
- [ ] Manual smoke : open Batch Production → select pain-choco (2-level recipe) → preview shows leaves only, no sub-recipe entries.

## Known limitations (Session 17+)

- `DEV-S16-2.B-01` — depth-1 only cost in snapshot.
- `DEV-S16-2.B-02` — legacy rows stay in bare-array shape (no historical cost reconstructible).
- `DEV-S16-2.C-01` — graph builder uses BFS via useQueries ; future `recipe_bom_full_v1` RPC could shrink network footprint.
- `DEV-S16-1.A-01` — nightly pgTAP is the only automated check ; no PR-time gate.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### - [ ] Step 6.6: Commit closeout

```bash
git add CLAUDE.md docs/workplan/plans/2026-05-16-session-16-INDEX.md
git commit -m "$(cat <<'EOF'
docs(workplan): session 16 — phase 4.A — closeout (CLAUDE.md + INDEX deviations + PR draft)

- CLAUDE.md "Active Workplan" : Session 16 → Previous, Session 17 → TBD.
- INDEX §10 : 4 deviation packs confirmed (DEV-S16-2.B-01, 02 ; DEV-S16-2.C-01 ; DEV-S16-1.A-01).
- PR draft opened against master.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-review notes (for the executor — do NOT skip)

Before considering the session complete, re-verify:

1. **Spec coverage** — every section in `2026-05-16-session-16-spec.md` §2 maps to a Task in this plan :
   - §2.1 (CI revival) → Task 1.
   - §2.2 (picker polish) → Task 2.
   - §2.3 (per-version cost) → Task 3.
   - §2.4 (multi-level preview) → Task 4.
   - §2.5 (Wave 2 gate) → Task 5.
   - §2.6 (closeout) → Task 6.
   All decisions D1-D13 are materialised in the migration bodies / file edits above.

2. **Type consistency** — `expandRecipeCascade` signature matches `index.ts` export and `IngredientAggregatePreview.tsx` consumer. `RecipeVersionRow.productCostAtVersion?` is the field name used in BOTH hook + component + test mock. `search_ingredients_v1` signature unchanged (no caller updates needed).

3. **Placeholder scan** — `<ISSUE_NUMBER>` in Step 1.4 is substituted in Step 1.2 ; `<count>` and `YYYY-MM-DD` in Step 6.3 are substituted at closeout time.

4. **Bite-sized steps** — each step is 2-5 minutes of mechanical work. Largest steps (migration writes, component rewrites) include full code, no synthesis required by the executor.

---

*Plan written 2026-05-16 on `swarm/session-16` by lead session 16 (autonomous mode).*
