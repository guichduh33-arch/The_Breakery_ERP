# Session 16 — INDEX (CI revival + S15 follow-ups)

**Date:** 2026-05-16
**Branch:** `swarm/session-16` (off `7ed9781` master, post-PR #17 merge)
**Spec:** [`../specs/2026-05-16-session-16-spec.md`](../specs/2026-05-16-session-16-spec.md)
**Migration block reserved:** `20260520000001..099`

---

## 1. Goal global

Operational hygiene session : revive the supabase-tests CI gate (red since Session 13 — `DEV-S15-CI-01` medium) by dropping the Docker job and replacing it with a nightly cloud pgTAP cron. Knock out 3 Session 15 deferred follow-ups : `DEV-S15-3.A-01/02` (picker polish — `is_semi_finished` flag + pg_trgm), `DEV-S15-2.B-01` (per-version cost in history), `DEV-S15-4.A-02` (multi-level aggregate preview).

**Total phases exécutables : 6** (Wave 0..4).
**Effort estimé : ~15h parallel, ~20h solo.**

Session 15 (Bakery Production) merged 2026-05-16 on `swarm/session-15`. Session 16 = **operational hygiene + S15 cleanup only**, no new feature module.

---

## 2. Architecture en vagues

```
Wave 0 (planning, no code) — Phase 0.1
  └─► Spec + INDEX + branch + delete orphan `now())` file
        │
        ▼
Wave 1 (CI revival — solo) — Phase 1.A
  └─► ci.yml drop supabase-tests job + new pgtap-nightly.yml
        │
        ▼ Wave 1 sync gate (manual workflow_dispatch test)
Wave 2 (S15 follow-ups — 3 parallel)
  ├── Phase 2.A picker polish (DB + RPC + UI smoke)
  ├── Phase 2.B per-version cost (DB trigger + UI + tolerance)
  └── Phase 2.C multi-level preview (domain helper + UI)
        │
        ▼ Wave 2 sync gate
Wave 3 (gate) — Phase 3.A
  └─► Reviewer pass + types regen merge
        │
        ▼
Wave 4 (closeout) — Phase 4.A
  └─► Tests + build + CLAUDE.md update + PR draft
```

---

## 3. Wave 0 — Prerequisites (no code)

### Phase 0.1 — Spec + INDEX + branch + cleanup (DOING — ce doc)

**Files** :
- `docs/workplan/specs/2026-05-16-session-16-spec.md` ✓
- `docs/workplan/plans/2026-05-16-session-16-INDEX.md` ✓ (this doc)
- Delete orphan `now())` empty file (artifact from a previous shell quoting bug).
- Open GitHub **CI tracking issue** "Session 16 — pgTAP nightly tracking" with label `ci/pgtap-nightly`. Pin in repo description ; future Phase 1.A workflow comments here on failure.

**DoD** :
- [x] Branch `swarm/session-16` created off master.
- [x] Spec dated, 13 decisions D1-D13, 6 phases listed, scope in/out explicit.
- [x] INDEX dated, 4 waves + parallelization map + comms map.
- [x] Orphan file removed.
- [ ] GitHub tracking issue opened (deferred to Wave 1 start — needs gh CLI auth).
- [x] CLAUDE.md "Active Workplan" updated.

**Complexity** : **S** (~1.5h).
**Suggested executor** : lead (vous).

---

## 4. Wave 1 — CI revival

### Phase 1.A — Drop Docker job + add nightly pgTAP cron

**Goal** : Replace the broken Docker `supabase-tests` job with a nightly cloud-targeted pgTAP runner.

**Module(s)** : 24 (Deployment/Ops).

**Files** :
- `.github/workflows/ci.yml` (UPDATE) — delete lines 115-143 (`supabase-tests` job block).
- `.github/workflows/pgtap-nightly.yml` (CREATE).
- `supabase/tests/ci_smoke.test.sql` (CREATE) — `SELECT 1 AS ok`.

**Workflow shape (`pgtap-nightly.yml`)** :
```yaml
name: pgTAP Nightly
on:
  schedule: [{ cron: '0 19 * * *' }]  # 02:00 Asia/Jakarta
  workflow_dispatch:
jobs:
  pgtap:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - name: Install psql 16
        run: sudo apt-get install -y postgresql-client-16
      - name: Run pgTAP suite via pooler
        env:
          PGURL: ${{ secrets.V3_DEV_PG_POOLER_URL }}
        run: |
          set -e
          fail=0
          for f in supabase/tests/*.test.sql; do
            echo "=== $f ==="
            psql "$PGURL" -v ON_ERROR_STOP=1 -c "BEGIN;" -f "$f" -c "ROLLBACK;" || fail=$((fail+1))
          done
          test "$fail" -eq 0
      - name: Comment on tracking issue on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.createComment({
              issue_number: <TBD-from-Wave-0>,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `pgTAP nightly failed on ${context.sha.slice(0,7)} — see [run](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}).`
            });
```

**DoD** :
- [ ] `ci.yml` no longer references `supabase start` / `supabase test db`.
- [ ] `pgtap-nightly.yml` lints clean (`actionlint`).
- [ ] Manual `workflow_dispatch` run returns exit 0 with `ci_smoke.test.sql` only.
- [ ] If `V3_DEV_PG_POOLER_URL` secret absent : issue opened, phase blocked.
- [ ] Tracking issue created in repo.

**Complexity** : **M** (~3h, includes secret confirmation + first manual run).
**Dependencies** : Wave 0.
**Suggested executor** : `ci-revival-arch` (devops + backend-dev).
**Parallelization tag** : solo Wave 1 ; gates Wave 2.

---

## 5. Wave 2 — S15 follow-ups (3 parallel)

### Phase 2.A — Picker polish (DEV-S15-3.A-01 + DEV-S15-3.A-02)

**Goal** : Replace inferred `semi_finished` with a maintained flag ; add pg_trgm indexes ; surface trigram ranking in `search_ingredients_v1`.

**Module(s)** : 5 (Products), 15 (Production).

**Files** :
- `supabase/migrations/20260520000010_extend_products_is_semi_finished.sql` (CREATE).
- `supabase/migrations/20260520000011_backfill_is_semi_finished.sql` (CREATE).
- `supabase/migrations/20260520000012_create_tr_recompute_is_semi_finished.sql` (CREATE — AFTER INSERT/UPDATE/DELETE trigger on `recipes`).
- `supabase/migrations/20260520000013_add_pg_trgm_indexes_products.sql` (CREATE — gin trgm ops on `name`/`sku`).
- `supabase/migrations/20260520000014_bump_search_ingredients_v1.sql` (CREATE — use flag + similarity).
- `supabase/tests/picker_polish.test.sql` (CREATE).
- `supabase/tests/functions/search-ingredients-polish.test.ts` (CREATE).

**DoD** :
- [ ] `products.is_semi_finished BOOLEAN NOT NULL DEFAULT FALSE` exists.
- [ ] Trigger maintains the flag : creating a sub-recipe row flips parent to TRUE ; removing the last flips back to FALSE.
- [ ] `pg_trgm` gin indexes exist on `products.name` and `products.sku`.
- [ ] `search_ingredients_v1('croisant', 'all')` returns `croissant` ranked below exact/prefix matches.
- [ ] No regression on existing `IngredientPicker.test.tsx` smoke.
- [ ] pgTAP green (cloud).

**Complexity** : **M** (~4h).
**Dependencies** : Wave 1 (CI restored so failures are visible).
**Suggested executor** : `picker-polish-arch` (backend-dev + DB SQL).
**Parallelization tag** : parallel with 2.B et 2.C.

### Phase 2.B — Per-version cost snapshot (DEV-S15-2.B-01)

**Goal** : Embed cost data in `recipe_versions.snapshot` ; expose in history UI ; tolerate legacy shape.

**Module(s)** : 15 (Production), 06 (Inventory peripheral).

**Files** :
- `supabase/migrations/20260520000020_bump_recipe_version_snapshot_with_cost.sql` (CREATE — replace `tr_snapshot_recipe_version()`).
- `supabase/migrations/20260520000021_refresh_latest_recipe_version_with_cost.sql` (CREATE — one-time fresh snapshot per product).
- `supabase/migrations/20260520000022_extend_recipe_versions_payload_check.sql` (CREATE — CHECK constraint, exempts legacy by `created_at < refresh_timestamp`).
- `supabase/tests/recipe_version_cost.test.sql` (CREATE).
- `apps/backoffice/src/features/inventory-production/hooks/useRecipeVersions.ts` (UPDATE — dual-shape tolerance + `productCostAtVersion`).
- `apps/backoffice/src/features/inventory-production/components/RecipeVersionHistory.tsx` (UPDATE — cost header + per-line subtotal column).
- `apps/backoffice/src/features/inventory-production/__tests__/RecipeVersionHistory.cost.smoke.test.tsx` (CREATE).

**DoD** :
- [ ] New snapshot shape : `{items: [{material_id, material_name, quantity, unit, material_cost_price, notes}, ...], product_cost_at_version: NUMERIC}`.
- [ ] `product_cost_at_version = Σ(qty × material_cost_price)` for depth-1.
- [ ] Refresh migration creates exactly one new version per recipe-having product.
- [ ] UI renders cost on new versions ; renders "—" with tooltip on legacy.
- [ ] No NaN, no console error.
- [ ] pgTAP green (cloud).

**Complexity** : **M** (~5h).
**Dependencies** : Wave 1.
**Suggested executor** : `cost-snapshot-arch` (backend-dev + UI).
**Parallelization tag** : parallel with 2.A et 2.C.

### Phase 2.C — Multi-level aggregate preview (DEV-S15-4.A-02)

**Goal** : Refactor `IngredientAggregatePreview` to walk the full sub-recipe cascade, leaves-only.

**Module(s)** : 15 (Production), 06 (Inventory).

**Files** :
- `packages/domain/src/production/expandRecipeCascade.ts` (CREATE).
- `packages/domain/src/production/__tests__/expandRecipeCascade.test.ts` (CREATE).
- `packages/domain/src/production/index.ts` (UPDATE — export).
- `apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx` (UPDATE — recursive graph builder + cascade call).
- `apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx` (UPDATE — 2-level fixture).

**DoD** :
- [ ] `expandRecipeCascade(graph, productId, multiplier)` returns leaves only.
- [ ] Domain unit tests cover flat, 2-level, 5-level, cycle, depth exceeded, mixed leaves+subs at same depth.
- [ ] UI preview correctly aggregates leaves through a 2-level recipe fixture.
- [ ] Sub-recipe rows do NOT appear in the preview output (only their leaves).
- [ ] Header comment in `IngredientAggregatePreview.tsx` no longer mentions "depth-1 only".
- [ ] Smoke test green.

**Complexity** : **M** (~3h).
**Dependencies** : Wave 1.
**Suggested executor** : `aggregate-preview-coder` (frontend + domain).
**Parallelization tag** : parallel with 2.A et 2.B.

---

## 6. Wave 3 — Gate

### Phase 3.A — Reviewer pass + types regen merge

**Goal** : Verify the three Wave 2 phases integrate cleanly ; merge types regen.

**Steps** :
- [ ] MCP `generate_typescript_types` → write `packages/supabase/src/types.generated.ts` (after Wave 2 migrations applied).
- [ ] Run `pnpm typecheck` ; resolve any drift surface.
- [ ] Inspect cross-phase touchpoints :
  - `useRecipeVersions.ts` shape changes vs RecipeEditor consumers.
  - `expandRecipeCascade` vs existing `expandRecipe` usages elsewhere (grep to confirm no incidental regression).
  - `search_ingredients_v1` signature unchanged → no caller updates needed.
- [ ] If conflicts found : coordinate fixes ; otherwise proceed to closeout.

**Complexity** : **S** (~1h).
**Dependencies** : Wave 2 all phases completed.
**Suggested executor** : `reviewer` (reviewer agent).

---

## 7. Wave 4 — Closeout

### Phase 4.A — Tests + build + CLAUDE.md + PR

**Goal** : Finaliser session.

**Steps** :
- [ ] `pnpm typecheck` green.
- [ ] `pnpm exec turbo run test --concurrency=1` green.
- [ ] `pnpm build` green.
- [ ] Bundle size delta < +10KB vs Session 15 baseline (no UI features added of size).
- [ ] CLAUDE.md "Active Workplan" : pointer Session 17 (next).
- [ ] PR draft "Session 16 — CI revival + S15 follow-ups" → master, body avec liste 8 migrations + workflow changes + deviation packs.
- [ ] INDEX §10 deviation packs filled.

**Complexity** : **S** (~2h).
**Suggested executor** : lead.

---

## 8. Parallelization map

| Wave | Phases | Parallel streams | Estim h |
|---|---|---|---|
| 0 | 0.1 | sequential | 1.5 |
| 1 | 1.A | solo | 3 |
| 2 | 2.A, 2.B, 2.C | 3 parallel | max(4, 5, 3) = 5 |
| 3 | 3.A | gate | 1 |
| 4 | 4.A | sequential | 2 |
| **TOTAL** | **6** | **4 waves** | **~12.5h** (full parallel-optimized) |

Realistic with ~20% serialization overhead + reviewer gate per wave : ~15h parallel, ~20h solo.

---

## 9. Comms entre subagents

```
lead (Claude) ←→ ci-revival-arch (Wave 1)
              ←→ picker-polish-arch / cost-snapshot-arch / aggregate-preview-coder (Wave 2)
              ←→ reviewer (Wave 3 gate)
```

Pattern : chaque subagent SendMessage `lead` à completion ; lead route à `reviewer` puis prochaine wave. Wave 2 fans out in one shot ; lead waits on all three returns before invoking reviewer.

---

## 10. Deviation packs (Session 16 → Session 17+)

Recorded during Wave 1-3 execution. All deviations are functionally non-blocking and are filed as follow-ups for Session 17+ triage.

| ID | Phase | Description | Severity |
|---|---|---|---|
| **DEV-S16-1.A-01** | 1.A | Nightly pgTAP cron (`pgtap-nightly.yml`) is the only automated check ; no PR-time gate. Per-PR gating via Supabase branches or manual MCP run is not enforced by tooling. Documented as the canonical PR-time check in CLAUDE.md. | informational |
| **DEV-S16-2.A-01** | 2.A | `pg_trgm` GIN indexes are created on `products.name`/`sku` (migration `20260520000013`) but the `search_ingredients_v1` RPC filter uses `similarity(col, q) >= 0.3` on a CTE-projected expression, which the planner cannot match against the GIN indexes (only the `%` operator + `set_limit()` does). At <5k products the seq-scan is invisible. Future fix : rewrite predicate to use `col % v_query` operator AND `SET LOCAL pg_trgm.similarity_threshold = 0.3` inside the RPC. | low |
| **DEV-S16-2.B-01** | 2.B | `product_cost_at_version` in `recipe_versions.snapshot` is **depth-1 only**. Sub-recipe material costs resolve to `products.cost_price` at trigger time (depth-0 lookup), not a recursive cascade. If a sub-recipe is later edited, the historical `product_cost_at_version` won't reflect the recomputed cascade. Full-cascade snapshot deferred to Session 17+. | low |
| **DEV-S16-2.B-02** | 2.B | Legacy `recipe_versions` rows (pre-Session-16) stay in bare-array shape with no cost data. UI shows "cost —" placeholder. A bulk-rewrite migration would be lossy (no historical `products.cost_price` available) ; gap is accepted. | low |
| **DEV-S16-2.B-03** | 2.B | `WHEN OTHERS` exception block in `tr_snapshot_recipe_version` (Session 15 carryover ; re-touched in `20260520000020` without cleanup) swallows all error classes when resolving `auth.uid()` → `user_profiles.id`. Should be removed (SELECT INTO doesn't raise NO_DATA_FOUND in PL/pgSQL — block is unnecessary) or narrowed to `WHEN insufficient_privilege`. | low |
| **DEV-S16-2.B-04** | 2.B | NULL `material_cost_price` is silently dropped via `SUM((qty)::NUMERIC * (cost)::NUMERIC)` in the trigger body and the refresh CTE — a NUMERIC × NULL produces NULL, which SUM ignores. Result : audit log silently under-reports cost when a material has NULL `products.cost_price`. Fix : `COALESCE((cost)::NUMERIC, 0)` in both SUM expressions. Currently invisible on V3 dev (all materials have non-NULL cost_price). | low |
| **DEV-S16-2.B-05** | 2.B | Refresh migration `20260520000021` writes rows with `change_note = 'cost_snapshot_refresh'` — recognizable to maintainers but opaque to operators viewing the timeline. Could be expanded to `'system refresh: cost data added 2026-05-16'`. | informational |
| **DEV-S16-2.C-01** | 2.C | UI graph builder uses iterative `useQueries` BFS ; one RPC per discovered product. Future `recipe_bom_full_v1` RPC could compute the full leaf-only BoM in one call and shrink the network footprint. | informational |
| **DEV-S16-2.C-02** | 2.C | `useGraphBuilder` does only TWO static `useQueries` rounds (roots + their direct children). With `MAX_BFS_DEPTH = 5` configured on `expandRecipeCascade`, recipes deeper than 2 levels would be partial — the cascade walker would see sub-recipe products as leaves because they weren't fetched. For The Breakery's typical 2-level bakery recipes this is exact ; for deeper nesting the preview is approximate and `record_batch_production_v1` server cascade remains the source of truth. File header documents the limitation (commit `3fecfa8`). Future fix : iterative round-loop or server-side cascade RPC. | medium |

**Resolution targets:** each item is filed as a follow-up backlog candidate for Session 17+ triage. The medium-severity item (DEV-S16-2.C-02) is the strongest candidate for early Session 17 work since it materially affects preview accuracy as bakery recipes grow deeper.

---

## 11. Out of scope (déféré Session 17+)

- Allergens on receipt + customer display (DEV-S15-5.C-01).
- Session 13 deferred items : Playwright CI job, pg_net birthday cron, Cash Flow Investing/Financing, mv_pl_monthly branched reuse, staging-deploy secrets.
- Per-version cost full cascade (see §6 DEV-S16-2.B-01).
- New bakery feature module (B2B, expenses, reports, customers/loyalty enhancements).
- Compliance & hardening (RLS anon audit, rate limiting auth-verify-pin, granular reports perms).

Session 16 = **operational hygiene + S15 cleanup uniquement**. Tout autre item attend Session 17+.

---

*INDEX écrit 2026-05-16 sur `swarm/session-16` par lead session 16 (autonomous mode).*
