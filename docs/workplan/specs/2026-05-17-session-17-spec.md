# Session 17 — Spec (Full Price Chain : PO → Cost → Recipe Cascade → Snapshot History)

**Date:** 2026-05-17
**Branch:** `swarm/session-17` (off `f7c83b2` master, post-PR #20 merge)
**INDEX:** [`../plans/2026-05-17-session-17-INDEX.md`](../plans/2026-05-17-session-17-INDEX.md) *(to be written by writing-plans next)*
**Migration block reserved:** `20260521000001..099`
**Approach:** Single-theme session, 4 waves : DB chain (4 parallel triggers/RPCs) → UI rewire → gate → closeout.

---

## 1. Goal global

Session 17 closes the **price-tracking loop** for production recipes. Today, a purchase order (PO) updates inventory quantities but leaves `products.cost_price` untouched ; recipe versions snapshot a depth-1 cost ; the aggregate preview UI is BFS-capped at depth-2. Together those gaps prevent any reliable chronological audit of « how much did this recipe cost on date X ? ».

The session installs an end-to-end chain :

```
PO received → stock_movements (purchase) → WAC update of products.cost_price
                                                 │
                                                 ▼
                          recipes mutation → tr_snapshot_recipe_version (full cascade)
                                                 │
                                                 ▼  (ancestor walk)
                                _snapshot_recipe_version → INSERT recipe_versions (append-only)
                                                 │
                                                 ▼
                                products.cost_price UPDATE → tr_snapshot_on_product_cost_change
                                                 │
                                                 ▼  (ancestor walk)
                                _snapshot_recipe_version → INSERT recipe_versions (append-only)
```

Every cost-affecting event — a PO receipt, a manual cost edit, a recipe composition change, a sub-recipe edit — produces a new immutable row in `recipe_versions` for the directly-affected product **and** every transitive ancestor. The UI consumes one new RPC (`recipe_bom_full_v1`) instead of N round-trips of BFS.

**In :**
- WAC auto-update of `products.cost_price` on `stock_movements` purchase rows.
- Cascade snapshots to ancestor recipes on (a) recipes mutation, (b) `products.cost_price` change.
- Full-cascade `product_cost_at_version` via `_calculate_recipe_cost_walk` (depth-5).
- Trigger cleanups : remove dead `WHEN OTHERS`, COALESCE NULL cost, descriptive `change_note`.
- New `recipe_bom_full_v1(p_product_id, p_max_depth)` RPC.
- `IngredientAggregatePreview` rewired to consume the new RPC.
- One-shot refresh migration of latest snapshots with full-cascade cost.

**Out :**
- DEV-S16-2.A-01 trigram predicate fix (separate session, no production-recipes coupling).
- DEV-S16-1.A-01 PR-time pgTAP gate (CI hardening, separate session).
- DEV-S15-5.C-01 allergens on receipt / customer display (separate module).
- Session 13 deferred items (Playwright CI, `pg_net` birthday cron, Cash Flow IF, `mv_pl_monthly` reuse, staging secrets).
- FIFO costing (deeper refactor, blocked by lot-level cost tracking infra).
- Legacy bare-array `recipe_versions` backfill (lossy — accepted gap, see DEV-S16-2.B-02).
- `record_incoming_stock_v1` cost-edge cases beyond the same WAC rule (out-of-scope corner inputs).

---

## 2. Scope — what's included

### 2.1 Phase 1.A — Snapshot helper + recipes trigger refactor (Wave 1, parallel)

Resolves `DEV-S16-2.B-01` (full cascade) + `DEV-S16-2.B-03/04/05` (cleanups).

Migrations :

| # | File | Purpose |
|---|---|---|
| 10 | `20260521000010_create_snapshot_recipe_version_helper.sql` | New helper `_snapshot_recipe_version(p_product_id UUID, p_change_note TEXT, p_profile UUID)` — factorises items snapshot + cost via `_calculate_recipe_cost_walk(...)` + INSERT into `recipe_versions`. Internal (no permission gate). |
| 11 | `20260521000011_bump_tr_snapshot_recipe_version_cascade.sql` | Refactor `tr_snapshot_recipe_version()` : (a) PERFORM helper for directly-edited product, (b) `WITH RECURSIVE` ancestor walk on `recipes.material_id` → PERFORM helper for each ancestor with `change_note = 'cascade: ' || edited_product_name || ' changed'`, (c) remove dead `WHEN OTHERS` block (SELECT INTO leaves `v_profile` NULL on no-row), (d) all SUM expressions use `COALESCE((cost)::NUMERIC, 0)`. Preserves `pg_trigger_depth() > 1` recursion guard. |

### 2.2 Phase 1.B — products.cost_price snapshot trigger (Wave 1, parallel)

Resolves DEV-S17-spec : chronological tracking when raw material cost changes.

Migration :

| # | File | Purpose |
|---|---|---|
| 12 | `20260521000012_create_tr_snapshot_on_product_cost_change.sql` | New trigger `tr_snapshot_on_product_cost_change()` : `AFTER UPDATE OF cost_price ON products WHEN (OLD.cost_price IS DISTINCT FROM NEW.cost_price)`. Computes `change_note = 'material price update: ' || NEW.name || ' ' || COALESCE(OLD.cost_price::TEXT,'NULL') || '→' || COALESCE(NEW.cost_price::TEXT,'NULL')`. `WITH RECURSIVE` walk : `recipes WHERE material_id = NEW.id` UNION recursive. For each distinct ancestor that has its own active recipe rows → PERFORM `_snapshot_recipe_version(ancestor, change_note, v_profile)`. Skip ancestors without recipe (a leaf product whose cost_price changed but isn't itself a recipe target produces zero snapshots — correct, nothing to recompute). |

### 2.3 Phase 1.C — PO → WAC auto-update of products.cost_price (Wave 1, parallel)

Closes the end-to-end chain : PO receipt → cost update → cascade snapshot.

Migration :

| # | File | Purpose |
|---|---|---|
| 13 | `20260521000013_create_tr_update_product_cost_on_purchase.sql` | New trigger `tr_update_product_cost_on_purchase()` : `AFTER INSERT ON stock_movements WHEN (NEW.movement_type = 'purchase')`. WAC formula : `new_cost = round((v_old_stock × v_old_cost + NEW.quantity × NEW.unit_cost) / (v_old_stock + NEW.quantity), 2)`. Reads `products.current_stock` + `cost_price` at trigger time (BEFORE the same RPC's downstream `UPDATE products SET current_stock = v_new`, see §3 D5). Guards : skip on `quantity ≤ 0`, on `unit_cost IS NULL OR unit_cost ≤ 0`, on `v_old_stock IS NULL OR v_old_stock ≤ 0` (then `new_cost := unit_cost`). UPDATE only if `cost_price IS DISTINCT FROM new_cost` (avoid no-op churn). |

### 2.4 Phase 1.D — recipe_bom_full_v1 RPC + refresh migration (Wave 1, parallel)

Resolves `DEV-S16-2.C-02` (BFS depth) + `DEV-S16-2.C-01` (single RPC vs N round-trips).

Migrations :

| # | File | Purpose |
|---|---|---|
| 20 | `20260521000020_create_recipe_bom_full_v1_rpc.sql` | New public RPC `recipe_bom_full_v1(p_product_id UUID, p_max_depth INT DEFAULT 5)` RETURNS TABLE`(material_id UUID, material_name TEXT, material_unit TEXT, qty_per_unit NUMERIC, current_stock NUMERIC, cost_price NUMERIC)`. Internal walker reuses the BFS/DFS pattern of `_calculate_recipe_cost_walk` but accumulates **leaves only** (skips sub-recipe intermediates), aggregates by `material_id` (`SUM(qty)`). Cycle guard via path array. Depth check via `p_max_depth` (range 1..20). Gated by `inventory.read`. STABLE SECURITY DEFINER. |
| 30 | `20260521000030_refresh_latest_recipe_version_full_cascade.sql` | One-shot UPDATE pass : for each product with at least one active recipe row, locate `MAX(version_number)` in `recipe_versions WHERE snapshot ? 'items'` (modern shape only, skip legacy bare-array per DEV-S16-2.B-02), recompute `product_cost_at_version` via `_calculate_recipe_cost_walk(product_id, 5, 1, ARRAY[]::UUID[])` and `jsonb_set(snapshot, '{product_cost_at_version}', ...)`. `change_note = 'system refresh: full-cascade cost data 2026-05-17'`. Migration is idempotent : second run is a no-op because `cost_price IS DISTINCT FROM` guard yields zero rows. |

### 2.5 Phase 2.A — UI rewire (Wave 2)

Drops `useGraphBuilder` (~80 LOC of static 2-round `useQueries`) and replaces with one `useQueries` round on `recipe_bom_full_v1`.

Files :

- `apps/backoffice/src/features/inventory-production/components/IngredientAggregatePreview.tsx` (UPDATE) :
  - Remove `useGraphBuilder` helper entirely.
  - Replace with `useQueries({ queries: validRows.map(row => ({ queryKey: ['inv-prod','bom-full', row.productId], queryFn: () => supabase.rpc('recipe_bom_full_v1', { p_product_id: row.productId }) })) })`.
  - Aggregate by `material_id` across roots, weight by `(qty_produced + qty_waste)`.
  - Update header comment : drop the depth-2 caveat ; reference the new RPC.
  - Keep `expandRecipeCascade` import-free here (the domain helper stays exported for `RecipeEditor` live preview, see §3 D8).
- `apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx` (UPDATE) :
  - Mock `recipe_bom_full_v1` instead of `list_recipes_v1`.
  - Fixture : 3-level recipe (croissant → croissant dough → flour + butter ; pain au choco → croissant dough + chocolate). Verify both leaves of croissant dough are aggregated through both parents.
  - Verify sub-recipe products do NOT appear in the output rows.

### 2.6 Phase 3.A — Wave 3 gate

Reviewer pass + types regen merge. Conflict resolution on shared files (only `tr_snapshot_recipe_version` body touched by Phase 1.A — no cross-phase conflicts expected).

### 2.7 Phase 4.A — Closeout (Wave 4)

- MCP `generate_typescript_types project_id=ikcyvlovptebroadgtvd` → write `packages/supabase/src/types.generated.ts`.
- `pnpm typecheck` green.
- `pnpm exec turbo run test --concurrency=1` green.
- `pnpm build` green.
- CLAUDE.md "Active Workplan" : pointer Session 18 (next).
- PR draft "Session 17 — Full price chain (PO → cost → recipe → snapshot)" → master.
- Update INDEX deviation packs for Session 18.

---

## 3. Decisions (numbered for reference)

| # | Decision | Rationale |
|---|---|---|
| D1 | Full-cascade `product_cost_at_version` reuses `_calculate_recipe_cost_walk` (the internal helper of `calculate_recipe_cost_v1`). | Avoids duplicating ~80 LOC of recursive PL/pgSQL. Helper is not permission-gated — safe to call from trigger and migration. The public RPC's `has_permission` gate stays for app-side calls. |
| D2 | Snapshot trigger cascades upward to ancestors via `WITH RECURSIVE` on `recipes.material_id`. | The user-stated requirement : « les recettes contenant une semi-process recette dont le prix est mis à jour, voient de même leur prix mis à jour ». Ancestor walk is server-only, no N+1 round-trips. |
| D3 | `pg_trigger_depth() > 1` guard preserved on `tr_snapshot_recipe_version`. | Cascade writes to `recipe_versions` (a different table), not `recipes` — so the guard never fires from the cascade path. Kept defensive against future direct edits to `recipes` from inside a trigger. |
| D4 | `products.cost_price` change cascades to ancestor recipes only, NOT to itself. | The product whose `cost_price` changed isn't necessarily a recipe — and even if it is, its own recipe rows haven't changed, so its `recipe_versions` history would receive a spurious duplicate row. Only ancestors that consume this product as material need a fresh snapshot. |
| D5 | WAC trigger reads `products.current_stock` and `cost_price` **at trigger time**, i.e. BEFORE the `UPDATE products SET current_stock = v_new` line in `record_stock_movement_v1`. | `record_stock_movement_v1` orders the statements as : `INSERT stock_movements ; UPDATE products SET current_stock`. The `AFTER INSERT` trigger fires between those two — reading `current_stock` returns the pre-movement value. Verified by reading `20260516000019_fix_record_stock_movement_v1_unit.sql`. |
| D6 | WAC formula : `new_cost = round((old_stock × old_cost + qty × unit_cost) / (old_stock + qty), 2)`. | Industry-standard weighted-average cost (moving average). Lower volatility than « last cost ». Rounded to 2 decimals to match `cost_price DECIMAL(14,2)`. |
| D7 | WAC trigger guards : skip when `quantity ≤ 0`, `unit_cost IS NULL OR ≤ 0`, or `old_stock ≤ 0` (then `new_cost := unit_cost`). | First-ever PO must seed `cost_price = unit_cost` (no prior history to average). Zero-cost goods (donations, free promo stock) must not zero-out an existing cost via WAC. Negative quantity (refund movements) are out of scope here — handled by separate refund flow. |
| D8 | `expandRecipeCascade` (domain helper) stays exported and unchanged. | No current consumer in `apps/` after `IngredientAggregatePreview` switched to `recipe_bom_full_v1`. Preserved as a `@breakery/domain` public API for future client-side cascade needs (e.g. unsaved-recipe live previews) that cannot round-trip to the server. |
| D9 | Refresh migration UPDATEs the LATEST modern snapshot in place (not a new INSERT). | The S16 refresh INSERT-style created one redundant row per product ; this time the update is a one-time correction of S16's depth-1 numbers — re-inserting would clutter the timeline. The append-only invariant still holds for runtime triggers ; the migration is a controlled exception. |
| D10 | Refresh migration's `change_note` is rewritten to `'system refresh: full-cascade cost data 2026-05-17'` (DEV-S16-2.B-05 resolution). | Operators reading the timeline see explicit intent rather than the opaque `'cost_snapshot_refresh'` token. |
| D11 | `tr_snapshot_on_product_cost_change` skips ancestors without an active recipe row. | A non-recipe product can never have a `product_cost_at_version` ; creating a snapshot for it would be inert. The skip is implicit in the `WITH RECURSIVE` join : if an ancestor never appears as `recipes.product_id`, it's filtered out. |
| D12 | WAC trigger ignores `record_stock_movement_v1`'s `unit_cost` defaulting via `COALESCE(NEW.unit_cost, (SELECT cost_price FROM products...))`. | The default is computed only when `unit_cost IS NULL` is passed by the caller. Our trigger reads `NEW.unit_cost` post-default — if the caller passed NULL, COALESCE has filled in the prior `cost_price`, so WAC degenerates to `new_cost = old_cost` (no-op via D7 guard). Effectively : explicit `unit_cost` from the PO line is the only event that moves cost. |
| D13 | RLS on `recipe_versions` (revokes UPDATE/DELETE for `authenticated`) is unchanged. | The refresh migration runs as `postgres` superuser (migration context), bypassing RLS. Runtime triggers are `SECURITY DEFINER` so they own their inserts. Append-only invariant from app side is preserved. |
| D14 | `recipe_bom_full_v1` returns aggregated leaves only (single row per `material_id`). | The aggregate preview's only consumer (`IngredientAggregatePreview`) wants totals per material. Per-occurrence rows would force client-side `SUM` over identical data. Aggregation is cheap in PL/pgSQL. |
| D15 | No PR-blocking type-regen check. Manual regen + commit at Phase 4.A. | Same as Session 16. Type drift caught by `pnpm typecheck` in main CI. |

---

## 4. Test plan

### 4.1 pgTAP (DB)

- `supabase/tests/recipe_cascade_snapshot.test.sql` (CREATE) — covers :
  - Helper `_snapshot_recipe_version` inserts one row with correct `version_number` (MAX+1), correct `change_note`, correct items shape, `product_cost_at_version` matches `_calculate_recipe_cost_walk`.
  - Edit `recipes` for a recipe with no parents → 1 snapshot row (just the edited product).
  - Edit `recipes` for a sub-recipe (croissant dough) used by 2 parents (croissant, pain au choco) → 3 snapshot rows (self + 2 ancestors).
  - Edit deeper chain (sub-sub-recipe X → Y → Z) → snapshots for X, Y, Z.
  - UPDATE `products.cost_price` for raw material (flour) used by croissant dough used by croissant → 2 snapshots (croissant dough + croissant), NOT flour itself.
  - UPDATE `products.cost_price` for a product with no recipe ancestors → zero snapshots, no error.
  - INSERT `stock_movements` (movement_type=purchase, qty=10, unit_cost=12000) for material with old_stock=0 → cost_price = 12000, cascade fires.
  - INSERT (purchase, qty=5, unit_cost=15000) for material with old_stock=10, old_cost=12000 → new_cost = round((10×12000 + 5×15000) / 15, 2) = 13000.00 ; cascade fires.
  - INSERT (purchase, qty=10, unit_cost=0) → skipped (D7 guard) ; no cost change, no cascade.
  - INSERT (purchase, qty=-5, unit_cost=12000) → skipped ; no cost change, no cascade.
  - INSERT (purchase, qty=10, unit_cost=12000) on material where current cost_price is already 12000 → cost_price unchanged (`IS DISTINCT FROM` guard), no cascade.
  - Append-only check : assert no UPDATE/DELETE issued against `recipe_versions` outside the refresh migration.

- `supabase/tests/recipe_bom_full_v1.test.sql` (CREATE) — covers :
  - Single-product recipe (1 level) returns leaves correctly with `qty_per_unit` matching `recipes.quantity`.
  - 2-level recipe : sub-recipe expanded, intermediate not in output.
  - 5-level recipe : all leaves correctly aggregated through the chain.
  - Cycle (synthetic fixture) raises `recipe_cycle` SQLSTATE.
  - Depth > p_max_depth raises `recipe_depth_exceeded`.
  - Same material referenced from two distinct paths aggregates into one row.
  - `p_max_depth=1` on a 2-level recipe : sub-recipe rows still in output (no cascade), no error.
  - `inventory.read` permission gate : caller without permission gets `forbidden` (P0003).

### 4.2 Vitest live RPC

- `supabase/tests/functions/recipe-bom-full.test.ts` (CREATE) — calls `recipe_bom_full_v1` via PIN auth, verifies row shape + leaf-only contract on a known seeded fixture (the existing seed bakery dataset already has multi-level recipes).

### 4.3 Backoffice smoke

- `apps/backoffice/src/features/inventory-production/__tests__/IngredientAggregatePreview.smoke.test.tsx` (UPDATE) — 3-level recipe fixture ; assert :
  - Network call : exactly N calls to `recipe_bom_full_v1` (one per root) — verify via mocked supabase client call count.
  - Aggregation : flour appears once with `qty = (croissant.qty × dough_per_croissant × flour_per_dough + pain_choco.qty × dough_per_pc × flour_per_dough)`.
  - Sub-recipe products absent from rendered table.
  - Stock-short rendering still works (the `current_stock` field of the RPC drives comparison directly — no second query needed).

### 4.4 Domain unit

No new tests. `expandRecipeCascade` tests stay as-is (still used by `RecipeEditor`).

### 4.5 CI smoke

Reuses S16's nightly pgTAP cron — new test files will be picked up automatically on the next nightly run after merge.

---

## 5. File map (informative)

```
supabase/migrations/
  20260521000010_create_snapshot_recipe_version_helper.sql            (CREATE — Wave 1.A)
  20260521000011_bump_tr_snapshot_recipe_version_cascade.sql          (CREATE — Wave 1.A)
  20260521000012_create_tr_snapshot_on_product_cost_change.sql        (CREATE — Wave 1.B)
  20260521000013_create_tr_update_product_cost_on_purchase.sql        (CREATE — Wave 1.C)
  20260521000020_create_recipe_bom_full_v1_rpc.sql                    (CREATE — Wave 1.D)
  20260521000030_refresh_latest_recipe_version_full_cascade.sql       (CREATE — Wave 1.D)

supabase/tests/
  recipe_cascade_snapshot.test.sql                                    (CREATE — Wave 1)
  recipe_bom_full_v1.test.sql                                         (CREATE — Wave 1.D)
  functions/recipe-bom-full.test.ts                                   (CREATE — Wave 1.D)

apps/backoffice/src/features/inventory-production/
  components/IngredientAggregatePreview.tsx                           (UPDATE — Wave 2.A)
  __tests__/IngredientAggregatePreview.smoke.test.tsx                 (UPDATE — Wave 2.A)

packages/supabase/src/
  types.generated.ts                                                  (UPDATE — Wave 3 gate)

CLAUDE.md                                                             (UPDATE — Wave 4)
docs/workplan/plans/2026-05-17-session-17-INDEX.md                    (CREATE — Wave 0, by writing-plans)
docs/workplan/specs/2026-05-17-session-17-spec.md                     (CREATE — Wave 0 — this doc)
```

---

## 6. Limitations & known follow-ups (Session 18+)

| ID | Description |
|---|---|
| `DEV-S17-1.C-01` | WAC trigger applies to all `movement_type='purchase'` rows uniformly. If a future feature distinguishes regular PO receipts vs special « cost-not-applicable » purchases (e.g. sample stock, returns categorised as purchases), the trigger will still recompute. Add a metadata flag or a movement subtype to opt out — out of scope here. |
| `DEV-S17-1.C-02` | WAC does NOT account for stock-on-hand value mismatches when `current_stock` is itself stale or wrong (e.g. inventory adjustment errors). Garbage-in garbage-out — a follow-up audit could compare WAC-derived cost against an external « known-good » purchase log. |
| `DEV-S17-1.B-01` | A direct UPDATE of `products.cost_price` via admin UI bypasses WAC and fires `tr_snapshot_on_product_cost_change` directly — this is intentional. But it does NOT generate a `stock_movements` audit row. A future enhancement could record an internal `movement_type='cost_adjustment'` row for traceability. |
| `DEV-S17-2.A-01` | `expandRecipeCascade` has no current consumer in `apps/` after Phase 2.A. Preserved as a `@breakery/domain` public API for future client-side cascade needs that cannot round-trip to the server (informational). |
| `DEV-S17-1.A-01` | Cascade in `tr_snapshot_recipe_version` writes N snapshots in a single transaction when a sub-recipe edit affects N ancestors. For pathological recipe graphs (>50 ancestors per material) this could spike write contention. The Breakery's bakery realistic depth ≤ 5 with ≤ 10 ancestors per material — well within bounds. Mitigation deferred. |

---

## 7. Out of scope (deferred Session 18+)

- DEV-S16-2.A-01 trigram predicate fix (`similarity()` → `%` operator + `set_limit`).
- DEV-S16-1.A-01 PR-time pgTAP gate.
- DEV-S15-5.C-01 allergens on receipt + customer display.
- Session 13 deferred items : Playwright CI job, `pg_net` birthday cron, Cash Flow Investing/Financing, `mv_pl_monthly` branched reuse, staging-deploy secrets.
- Per-lot cost tracking / FIFO (requires `stock_lots.unit_cost` + consumption walker).
- Cost-adjustment audit movement type (DEV-S17-1.B-01).
- Manual override of WAC method per product (e.g. force « last cost » for volatile materials).
- New bakery feature module (B2B wholesale, expenses, reports, customers/loyalty enhancements).
- Compliance & hardening (RLS anon audit, rate limiting auth-verify-pin, granular reports permissions).

---

## 8. Success criteria (gate to merge)

- [ ] `pnpm typecheck` green.
- [ ] `pnpm exec turbo run test --concurrency=1` green.
- [ ] `pnpm build` green.
- [ ] pgTAP suite green via cloud MCP `execute_sql` (BEGIN/ROLLBACK envelope) — `recipe_cascade_snapshot.test.sql` + `recipe_bom_full_v1.test.sql`.
- [ ] Nightly `pgtap-nightly.yml` workflow run on master post-merge returns exit 0.
- [ ] `packages/supabase/src/types.generated.ts` regenerated and committed.
- [ ] CLAUDE.md "Active Workplan" pointer updated to Session 18.
- [ ] PR open to master with body listing 6 migrations + 1 UI rewire + cascade matrix.
- [ ] No new « DEV-S17-… » deviation packs beyond those documented in §6.
- [ ] Smoke-test on V3 dev : (a) edit a recipe row → verify cascade snapshots created for direct product + all ancestors, (b) UPDATE `products.cost_price` directly → verify ancestor snapshots, (c) call `receive_purchase_order_v1` on a seeded PO → verify `cost_price` moved by WAC and snapshot cascade fired.

---

*Spec écrit 2026-05-16 sur `swarm/session-17` par lead session 17 (autonomous mode). Brainstorming par superpowers:brainstorming skill.*
