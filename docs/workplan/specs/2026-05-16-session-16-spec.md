# Session 16 — Spec (CI revival + S15 follow-ups)

**Date:** 2026-05-16
**Branch:** `swarm/session-16` (off `7ed9781` master, post-PR #17 merge)
**INDEX:** [`../plans/2026-05-16-session-16-INDEX.md`](../plans/2026-05-16-session-16-INDEX.md)
**Migration block reserved:** `20260520000001..099`
**Approach:** Pragmatic hybrid (4 waves: solo CI revival → 3 parallel S15 follow-ups → gate → closeout).

---

## 1. Goal global

Session 16 is an **operational hygiene** session: revive the supabase-tests CI gate (red since Session 13, see `DEV-S15-CI-01` medium-severity) and knock out three Session 15 deferred follow-ups that improve recipe pro UX and per-version auditability.

In : drop the broken Docker `supabase-tests` job, replace with a nightly cloud pgTAP cron ; add `products.is_semi_finished` flag + pg_trgm indexes + wire `search_ingredients_v1` to use them ; embed cost data in `recipe_versions` snapshots + surface in history UI ; refactor `IngredientAggregatePreview` to walk the full sub-recipe cascade.

Out : allergens on receipt / customer display (DEV-S15-5.C-01), Session 13 deferred items, full-cascade cost rollup inside snapshot (depth-1 only for v1), Playwright CI, new bakery features.

---

## 2. Scope — what's included

### 2.1 Phase 1.A — CI revival (Wave 1, solo)

- Edit `.github/workflows/ci.yml` : delete the `supabase-tests` job (lines 115-143, `continue-on-error: true`, Docker-dependent).
- Create `.github/workflows/pgtap-nightly.yml` : cron `0 19 * * *` UTC (= 02:00 Asia/Jakarta), `workflow_dispatch` enabled for manual trigger.
- Workflow steps :
  1. Checkout.
  2. Install `psql` 16 via `apt-get install -y postgresql-client`.
  3. Connect to V3 dev via pooler URL using GitHub Actions secret `V3_DEV_PG_PASSWORD` (URL-encoded). Confirm secret existence ; if absent, Wave 0 opens an issue + blocks Phase 1.A on user setup.
  4. Iterate `supabase/tests/*.test.sql` ; for each file wrap in `BEGIN; \i <file>; ROLLBACK;` envelope. Capture exit codes ; aggregate into a per-file pass/fail table.
  5. On any failure : non-zero workflow exit, post a comment on the **CI tracking issue** (opened in Wave 0, label `ci/pgtap-nightly`) with the failure summary + tail of psql output.
- Open GitHub issue *Session 16 — pgTAP nightly tracking* during Wave 0 ; pin in repo description.

### 2.2 Phase 2.A — Picker polish (Wave 2, parallel)

Resolves `DEV-S15-3.A-01` (`is_semi_finished` flag) and `DEV-S15-3.A-02` (`pg_trgm` indexes).

Migrations (`20260520000010..014`) :

| # | File | Purpose |
|---|---|---|
| 10 | `20260520000010_extend_products_is_semi_finished.sql` | Add `is_semi_finished BOOLEAN NOT NULL DEFAULT FALSE`. |
| 11 | `20260520000011_backfill_is_semi_finished.sql` | `UPDATE products` flag for products with recipe-of-recipe (depth ≥ 2). |
| 12 | `20260520000012_create_tr_recompute_is_semi_finished.sql` | AFTER INSERT/UPDATE/DELETE trigger on `recipes` ; maintains the flag on the parent product. `pg_trigger_depth() < 1` guard. |
| 13 | `20260520000013_add_pg_trgm_indexes_products.sql` | `CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops)` ; same for `sku`. **NOT CONCURRENTLY** (MCP apply_migration wraps in transaction). Expected lock window < 100ms on ~10k rows. |
| 14 | `20260520000014_bump_search_ingredients_v1.sql` | Replace nested EXISTS for `semi_finished` with `p.is_semi_finished` ; add `similarity(name, q)` and `similarity(sku, q)` to the rank tier set (floor 0.3). Exact + prefix tiers stay above similarity. Maintain signature stability. |

UI : `packages/ui/src/components/IngredientPicker.tsx` — no code change ; the ranking improvement comes from the RPC alone. Smoke test confirms tab counts now reflect the explicit flag.

### 2.3 Phase 2.B — Per-version recipe cost (Wave 2, parallel)

Resolves `DEV-S15-2.B-01`.

Migrations (`20260520000020..022`) :

| # | File | Purpose |
|---|---|---|
| 20 | `20260520000020_bump_recipe_version_snapshot_with_cost.sql` | Bump `tr_snapshot_recipe_version()`. **Breaking shape change** : snapshot now stored as `{"items": [...], "product_cost_at_version": NUMERIC}` instead of bare array. Each item now includes `material_cost_price NUMERIC` (resolved from `products.cost_price` at trigger time). `product_cost_at_version = Σ(quantity × material_cost_price)` for depth-1 (full cascade deferred — see §6 limitations). |
| 21 | `20260520000021_refresh_latest_recipe_version_with_cost.sql` | For each product with a recipe, INSERT a fresh `recipe_versions` row with `change_note = 'cost_snapshot_refresh'`. Non-destructive : older versions remain in legacy shape ; UI tolerates both. |
| 22 | `20260520000022_extend_recipe_versions_payload_check.sql` | Optional CHECK constraint ensuring new versions match `{items, product_cost_at_version}` shape ; legacy rows exempted via `created_at < refresh_timestamp` predicate. |

UI :
- `apps/backoffice/src/features/inventory-production/hooks/useRecipeVersions.ts` : update `RecipeVersionSnapshotRow[]` shape ; tolerate both old (`Array.isArray(snapshot)`) and new (`{items, ...}`) payloads. Expose `productCostAtVersion: number | null` on `RecipeVersionRow`.
- `apps/backoffice/src/features/inventory-production/components/RecipeVersionHistory.tsx` : surface `product_cost_at_version` next to the version number header. Add a **third column** to the diff list showing per-material `cost_price × quantity = subtotal`. Old-shape versions show "—" with `<title>cost data added 2026-05-XX</title>` tooltip.

### 2.4 Phase 2.C — Multi-level aggregate preview (Wave 2, parallel)

Resolves `DEV-S15-4.A-02`.

Files :
- `packages/domain/src/production/expandRecipeCascade.ts` (CREATE) : new pure-TS helper. Signature : `expandRecipeCascade(graph: RecipeGraph, productId: string, multiplier: number, opts?: { maxDepth?: number }): Map<materialId, { qty, name, unit }>`. Walks DFS, accumulates only **leaf** materials (skips sub-recipe rows), uses the same cycle/depth-cap logic as `recipeCostCalculator`. Throws `RecipeCycleError` / `RecipeDepthExceededError`.
- `packages/domain/src/production/__tests__/expandRecipeCascade.test.ts` (CREATE) : flat, 2-level, 5-level, cycle, depth exceeded.
- `packages/domain/src/production/index.ts` (UPDATE) : export `expandRecipeCascade`.
- `apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx` (UPDATE) :
  - Replace `useRecipesPerProduct(productIds)` with a **recursive graph builder** : seed with `productIds`, fetch `list_recipes_v1` for each ; for every material that has `has_recipe = true` (look up via products query), enqueue and fetch its recipe ; iterate until queue empty or depth 5. Cache by `productId`.
  - Replace `expandRecipe(recipe, multiplier)` call with `expandRecipeCascade(graph, productId, multiplier)`.
  - Update header comment : remove the "depth-1 only" caveat.
  - Update smoke test : add a 2-level recipe fixture, verify leaves correctly aggregated, verify a non-leaf sub-recipe is NOT in the preview output.

### 2.5 Phase 3.A — Wave 2 gate (Wave 3)

Reviewer pass. Types regen merge. Conflict resolution on shared files (none expected ; verification step).

### 2.6 Phase 4.A — Closeout (Wave 4)

- MCP `generate_typescript_types project_id=ikcyvlovptebroadgtvd` → write `packages/supabase/src/types.generated.ts`.
- `pnpm typecheck` green.
- `pnpm exec turbo run test --concurrency=1` green.
- `pnpm build` green.
- CLAUDE.md "Active Workplan" : pointer Session 17 (next).
- PR draft "Session 16 — CI revival + S15 follow-ups" → master.
- Update INDEX §10 deviation packs for Session 17.

---

## 3. Decisions (numbered for reference)

| # | Decision | Rationale |
|---|---|---|
| D1 | Drop the Docker `supabase-tests` job entirely (no fallback). Replace with cloud-only nightly pgTAP. | Docker retired 2026-05-14 (CLAUDE.md). Per-PR Docker job was `continue-on-error: true` since Session 13 anyway. |
| D2 | Nightly cron at `0 19 * * *` UTC (= 02:00 Asia/Jakarta). | Off-hours for prod traffic ; V3 dev is the target so prod is unaffected regardless. |
| D3 | No PR-gating pgTAP. Manual MCP run remains the canonical PR-time check (documented in CLAUDE.md). | Concurrent-PR collision risk on shared V3 dev. Small team (≤ 2 devs). |
| D4 | `is_semi_finished` is a maintained denormalized flag, not a generated column. | Avoids GENERATED EXPRESSION limitations with cross-table EXISTS. Trigger keeps it consistent. |
| D5 | `pg_trgm` indexes via plain `CREATE INDEX` (not CONCURRENTLY). | MCP `apply_migration` wraps the body in a transaction ; CONCURRENTLY forbidden. Lock window < 100ms on current row count. |
| D6 | Similarity ranking added **after** exact + prefix tiers, not replacing them. | Preserves the picker UX guarantee that exact SKU/name match comes first. |
| D7 | Snapshot JSONB shape **changes** from `[...]` to `{items: [...], product_cost_at_version: NUMERIC}`. | Adding a top-level number alongside an array forces a shape change. UI handles both ; CHECK constraint enforces forward shape only. |
| D8 | `product_cost_at_version` is **depth-1 only** for Session 16 ; full cascade is Session 17+ work. | Full cascade requires either (a) running `calculate_recipe_cost_v1` inside the trigger — risk of recursion ; or (b) post-trigger refresh job. Either adds complexity ; v1 keeps it simple. Documented limitation. |
| D9 | One-time refresh INSERTs new versions (`change_note = 'cost_snapshot_refresh'`) instead of mutating old ones. | `recipe_versions` is append-only by design (RLS revokes UPDATE/DELETE). Refresh as new versions preserves audit. |
| D10 | `expandRecipeCascade` returns **leaves only** (skips sub-recipe rows). | Aggregate preview is for stock-deduction validation ; sub-recipes don't deduct stock directly. Mirrors `record_batch_production_v1` server behavior. |
| D11 | Graph builder in `IngredientAggregatePreview` uses iterative BFS with `useQueries` ; NOT a new RPC. | Reuses cached `list_recipes_v1` results ; no DB API surface to bless ; cheap on small graphs. A future `recipe_bom_full_v1` RPC could replace it (S17+). |
| D12 | Phase 2.A trigger watches INSERT/UPDATE/DELETE on `recipes`, NOT `recipes.is_active` toggles alone. | Existing snapshot trigger already covers the same surface ; we mirror its pattern for consistency. |
| D13 | No PR-blocking type-regen check. Manual regen + commit at Phase 4.A. | Same as Session 15 — type drift caught by `pnpm typecheck` in main CI. |

---

## 4. Test plan

### 4.1 pgTAP (DB)

- `supabase/tests/picker_polish.test.sql` (CREATE) — covers :
  - `is_semi_finished` defaults to FALSE for new product.
  - Trigger sets TRUE when a product's recipe references another recipe-product.
  - Trigger sets FALSE when the last sub-recipe row is removed.
  - `search_ingredients_v1` returns the new flag value (not the legacy EXISTS).
  - Similarity ranking : `search_ingredients_v1('croisant')` matches `croissant` via trigram (score ≥ 0.3) and ranks below exact / prefix.
- `supabase/tests/recipe_version_cost.test.sql` (CREATE) — covers :
  - New shape contains `items` array + `product_cost_at_version`.
  - `product_cost_at_version = Σ(qty × material_cost_price)` for a known fixture.
  - Refresh migration creates exactly one new version per product with a recipe ; idempotent on re-run.
  - Legacy version rows untouched.
  - CHECK constraint rejects bare-array INSERTs from new snapshots ; accepts legacy rows.
- `supabase/tests/ci_smoke.test.sql` (CREATE) — `SELECT 1 AS ok` ; validates the nightly workflow runner before relying on it for full pgTAP.

### 4.2 Vitest live RPC

- `supabase/tests/functions/search-ingredients-polish.test.ts` — verifies `is_semi_finished` and trigram similarity from app side.

### 4.3 Domain unit

- `packages/domain/src/production/__tests__/expandRecipeCascade.test.ts` (CREATE) — flat, 2-level, 5-level, cycle, depth exceeded, mixed leaves+subs at same depth.

### 4.4 Backoffice smoke

- `RecipeVersionHistory.cost.smoke.test.tsx` (CREATE) — renders cost in new-shape version ; renders "—" in legacy-shape version ; no NaN on missing cost.
- `IngredientAggregatePreview.cascade.smoke.test.tsx` (UPDATE) — 2-level recipe fixture ; leaves aggregated ; sub-recipe NOT in output.

### 4.5 CI smoke

- Manual `workflow_dispatch` trigger of `pgtap-nightly.yml` once Wave 0 secret check is done.

---

## 5. File map (informative)

```
.github/workflows/
  ci.yml                                                 (UPDATE — delete supabase-tests job)
  pgtap-nightly.yml                                      (CREATE — Wave 1)

supabase/migrations/
  20260520000010_extend_products_is_semi_finished.sql    (CREATE — Wave 2.A)
  20260520000011_backfill_is_semi_finished.sql           (CREATE — Wave 2.A)
  20260520000012_create_tr_recompute_is_semi_finished.sql (CREATE — Wave 2.A)
  20260520000013_add_pg_trgm_indexes_products.sql        (CREATE — Wave 2.A)
  20260520000014_bump_search_ingredients_v1.sql          (CREATE — Wave 2.A)
  20260520000020_bump_recipe_version_snapshot_with_cost.sql (CREATE — Wave 2.B)
  20260520000021_refresh_latest_recipe_version_with_cost.sql (CREATE — Wave 2.B)
  20260520000022_extend_recipe_versions_payload_check.sql (CREATE — Wave 2.B)

supabase/tests/
  picker_polish.test.sql                                 (CREATE — Wave 2.A)
  recipe_version_cost.test.sql                           (CREATE — Wave 2.B)
  ci_smoke.test.sql                                      (CREATE — Wave 1)
  functions/search-ingredients-polish.test.ts            (CREATE — Wave 2.A)

packages/domain/src/production/
  expandRecipeCascade.ts                                 (CREATE — Wave 2.C)
  __tests__/expandRecipeCascade.test.ts                  (CREATE — Wave 2.C)
  index.ts                                               (UPDATE — Wave 2.C)

packages/supabase/src/
  types.generated.ts                                     (UPDATE — Wave 4)

apps/backoffice/src/features/inventory-production/
  hooks/useRecipeVersions.ts                             (UPDATE — Wave 2.B)
  components/RecipeVersionHistory.tsx                    (UPDATE — Wave 2.B)
  components/IngredientAggregatePreview.tsx              (UPDATE — Wave 2.C)
  __tests__/RecipeVersionHistory.cost.smoke.test.tsx     (CREATE — Wave 2.B)
  __tests__/IngredientAggregatePreview.smoke.test.tsx    (UPDATE — Wave 2.C)

CLAUDE.md                                                (UPDATE — Wave 4)
docs/workplan/plans/2026-05-16-session-16-INDEX.md       (CREATE — Wave 0)
docs/workplan/specs/2026-05-16-session-16-spec.md        (CREATE — Wave 0 — this doc)
```

---

## 6. Limitations & known follow-ups (Session 17+)

| ID | Description |
|---|---|
| `DEV-S16-2.B-01` | `product_cost_at_version` is **depth-1 only**. Sub-recipe material costs are read as their `products.cost_price` at trigger time (a depth-0 lookup) ; if a sub-recipe is later edited, the historical `product_cost_at_version` won't reflect the recomputed cascade. Full-cascade snapshot deferred to Session 17. |
| `DEV-S16-2.B-02` | Legacy `recipe_versions` rows (pre-Wave 2.B) stay in bare-array shape with no cost data. UI shows "—". A bulk-rewrite migration would be lossy (no historical `products.cost_price` available) ; we accept the gap. |
| `DEV-S16-2.C-01` | `IngredientAggregatePreview` graph builder uses iterative `useQueries` BFS. A future `recipe_bom_full_v1` RPC could compute the full leaf-only BoM in one call and shrink the network footprint. |
| `DEV-S16-1.A-01` | Nightly pgTAP is the only automated check. PR-time gating via Supabase branches (paid feature) or manual MCP run is not enforced by tooling. |

---

## 7. Out of scope (deferred Session 17+)

- Allergens on receipt + customer display (DEV-S15-5.C-01) — touches print queue / template renderer.
- Session 13 deferred items : Playwright CI job (D-W6-6C-05), `pg_net` birthday cron (D-W6-6B-02), Cash Flow Investing/Financing sections (D-W6-6A-2), `mv_pl_monthly` branched reuse (D-W6-6A-1), staging-deploy.yml secrets (D-W6-CICD-01).
- Per-version cost full cascade (see DEV-S16-2.B-01).
- New bakery feature module (B2B wholesale, expenses, reports, customers/loyalty enhancements).
- Compliance & hardening (RLS anon audit, rate limiting auth-verify-pin, granular reports permissions).
- New RPCs (`recipe_bom_full_v1`, etc.).

---

## 8. Success criteria (gate to merge)

- [ ] `pnpm typecheck` green.
- [ ] `pnpm exec turbo run test --concurrency=1` green.
- [ ] `pnpm build` green.
- [ ] pgTAP suite green via cloud MCP `execute_sql` (BEGIN/ROLLBACK envelope).
- [ ] `pgtap-nightly.yml` workflow_dispatch run returns exit 0 on V3 dev.
- [ ] `ci.yml` no longer references Docker `supabase` commands.
- [ ] `packages/supabase/src/types.generated.ts` regenerated and committed.
- [ ] CLAUDE.md "Active Workplan" pointer updated to Session 17.
- [ ] PR open to master with body listing 8 migrations + workflow changes.
- [ ] No new "DEV-S16-…" deviation packs beyond those documented in §6.

---

*Spec écrit 2026-05-16 sur `swarm/session-16` par lead session 16 (autonomous mode).*
