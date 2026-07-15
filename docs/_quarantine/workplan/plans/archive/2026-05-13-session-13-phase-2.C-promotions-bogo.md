# Phase 2.C — Promotions BOGO + threshold engine (sub-plan)

> Session 13 / Wave 2 / Phase 2.C. Build-from-scratch `evaluate_promotions_v1`
> SQL function (no predecessor) + extend `promotions` schema with new
> "buy N get M of product P", threshold, and bundle shapes. Update POS hook to
> prefer the SQL RPC and keep the existing TS engine as offline fallback.
>
> Date: 2026-05-14. Branch: `swarm/session-13`. Subagent: `promo-engine`.
> Migration block: `20260517000080..000082`. INDEX line 541.

---

## 0. Pre-flight findings (read first)

| Topic | Finding |
|---|---|
| `evaluate_promotions` SQL function | **Does NOT exist** in V3 (`pg_proc` query empty ; grep of migrations empty). Confirms INDEX assumption. CREATE only, no DROP. |
| `promotions` table | Already exists (`20260511000001_init_promotions.sql`) with rich V2 shape — `type` enum is `('percentage','fixed_amount','bogo','free_product')`, BOGO uses arrays `bogo_trigger_product_ids` + `bogo_reward_product_ids` + `bogo_trigger_qty/reward_qty/reward_discount_pct`. |
| New shape ask | Phase 2.C adds *additional* simpler shape: `bogo_buy_quantity`, `bogo_get_quantity`, `bogo_get_product_id` (single product), `threshold_amount` + `threshold_type`, `bundle_product_ids`. **Both shapes must coexist** — DB CHECK relaxes so either form is acceptable for `type='bogo'`. New types `threshold` + `bundle` added to enum (separate migration). |
| Existing TS engine | Lives at `packages/domain/src/promotions/` (`evaluator.ts`, `matchers.ts`, `computeAmount.ts`). Pure ; 3 test files. Will be **kept as offline fallback** + extended via `bogoEngine.ts` to support the new shape, used only if RPC fails. |
| POS hook | Real name is `useEvaluatePromotions.ts` (INDEX says `usePromotionEvaluation.ts` — typo). Pure-TS today. Will be updated to try RPC first; on failure run the TS engine. Orchestrator `usePromotionsAutoEval.ts` invokes it through debounced timer. |
| Cart store | `apps/pos/src/stores/cartStore.ts` (INDEX says `features/cart/store/cartStore.ts` — wrong path). Already consumes `AppliedPromotion[]` from the domain. We will keep the same `AppliedPromotion` shape so the cart store stays unchanged. RPC return shape will be normalized to TS `AppliedPromotion[]` inside the hook. |
| BO `PromotionFormModal` | Already routes to shared `PromotionForm` in `@breakery/ui` (3-tab layout). The two new dedicated forms (`BogoForm.tsx`, `ThresholdForm.tsx`) will be **sub-components** mounted inside the existing `PromotionForm` Type tab when `type='bogo'` or `type='threshold'`, so the create/update mutations and ref-data hooks keep working unchanged. |
| Promotion type enum | Need to extend `promotion_type` enum with `'threshold'` and `'bundle'` values (ALTER TYPE … ADD VALUE). |

**Net deviations from INDEX (recorded in `2026-05-14-session-13-wave-2-deviations.md`):**

1. Hook real path is `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts`, not `usePromotionEvaluation.ts` (file rename **not** done — keep existing name).
2. Cart store real path is `apps/pos/src/stores/cartStore.ts`, not `features/cart/store/cartStore.ts`. **No update needed** — RPC payload normalized to existing `AppliedPromotion[]` inside the hook.
3. BogoForm + ThresholdForm are mounted as sub-components of the existing `@breakery/ui/PromotionForm`, not separate modals — keeps existing list/edit flow.
4. We need to add `'threshold'` and `'bundle'` values to the `promotion_type` enum (was percentage/fixed_amount/bogo/free_product only).

---

## 1. Sequence (file-by-file)

### 1.A — Sub-plan + deviations (this commit)
- `docs/workplan/plans/2026-05-13-session-13-phase-2.C-promotions-bogo.md` (this file).
- `docs/workplan/refs/2026-05-14-session-13-wave-2-deviations.md` (append a Phase 2.C section).
- Commit `docs(workplan): session 13 — phase 2.C — sub-plan + deviations`.

### 1.B — Pure domain (TDD spec for SQL)
- `packages/domain/src/promotions/bogoEngine.ts` — exports `evaluateBogoNew`, `evaluateThreshold`, `evaluateBundle`, plus a top-level `evaluatePromotionsFallback(promotions, cart, customer, now, catalog)` that wraps the existing `evaluatePromotions` *and* handles the three new shapes. Pure TS, no I/O.
- `packages/domain/src/promotions/types.ts` — extend `Promotion` with the new optional fields (`bogo_buy_quantity`, `bogo_get_quantity`, `bogo_get_product_id`, `threshold_amount`, `threshold_type`, `bundle_product_ids`, `bundle_price`) ; extend `PromotionType` with `'threshold' | 'bundle'`.
- `packages/domain/src/promotions/__tests__/bogoEngine.test.ts` — case matrix (BOGO 2+1, threshold subtotal/quantity, bundle 3 products → fixed, expired skip, customer segment, stacking).
- `packages/domain/src/promotions/index.ts` — export new helpers.
- Run `pnpm --filter @breakery/domain test promotions` until green.
- Commit `feat(domain): session 13 — phase 2.C — pure-TS BOGO/threshold/bundle engine`.

### 1.C — DB migrations (3) via MCP
1. `20260517000080_extend_promotions_schema_bogo_threshold.sql`
   - `ALTER TYPE promotion_type ADD VALUE IF NOT EXISTS 'threshold'`
   - `ALTER TYPE promotion_type ADD VALUE IF NOT EXISTS 'bundle'`
   - `ALTER TABLE promotions ADD COLUMN bogo_buy_quantity INT NULL CHECK (bogo_buy_quantity IS NULL OR bogo_buy_quantity >= 1)`
   - `… bogo_get_quantity INT NULL CHECK (… >= 1)`
   - `… bogo_get_product_id UUID NULL REFERENCES products(id) ON DELETE SET NULL`
   - `… threshold_amount DECIMAL(14,2) NULL CHECK (… >= 0)`
   - `… threshold_type TEXT NULL CHECK (threshold_type IN ('subtotal','quantity'))`
   - `… bundle_product_ids UUID[] NULL`
   - `… bundle_price DECIMAL(14,2) NULL CHECK (… >= 0)` *(needed to express bundle fixed price)*
   - Drop and replace `chk_promotion_type_fields` to permit either legacy BOGO array shape **or** new single-product shape, plus new `threshold` and `bundle` branches.
   - Apply via `mcp__plugin_supabase_supabase__apply_migration`.
2. `20260517000081_create_evaluate_promotions_v1.sql`
   - `CREATE OR REPLACE FUNCTION public.evaluate_promotions_v1(p_cart_items JSONB, p_customer_id UUID DEFAULT NULL, p_subtotal NUMERIC DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`.
   - Input contract: `p_cart_items = [{line_id, product_id, quantity, unit_price}, …]`.
   - Algorithm (mirrors `bogoEngine.ts`):
     1. Load every `is_active=true AND deleted_at IS NULL` promotion ordered by priority desc, created_at desc.
     2. For each, run condition matchers (date range, dow, hour, min_items_total, customer category/tier when `p_customer_id` set).
     3. Branch by `type`:
        - `percentage`/`fixed_amount` → call existing pure-SQL helpers (delegate to inline CTE math).
        - `bogo` (legacy arrays) → port `computeBogo` logic.
        - `bogo` (new shape with `bogo_buy_quantity` set) → compute "every N qty of trigger → 1 free of `bogo_get_product_id`" ; emit `free_items[]`.
        - `threshold` → if `threshold_type='subtotal'`, `subtotal_before >= threshold_amount` ⇒ apply `discount_value`% or fixed; if `'quantity'`, total cart qty ≥ threshold.
        - `bundle` → if cart contains all of `bundle_product_ids` (each qty ≥ 1), discount = (Σ matched line subtotals) − `bundle_price`.
     4. Sort applied by priority desc; apply stacking matrix (first applied = anchor; subsequent require `stackable_with_promo=true` on both).
     5. Return JSON `{applied_promotions:[…], subtotal_before, subtotal_after_discount, total_discount}`.
   - Grant `EXECUTE` to `authenticated`.
   - **No DROP** (no predecessor). Apply via MCP.
3. `20260517000082_seed_demo_bogo_promotion.sql`
   - `INSERT INTO promotions (name, slug, type, bogo_buy_quantity, bogo_get_quantity, bogo_get_product_id, is_active, priority, …) SELECT 'Buy 2 baguettes get 1 free', 'demo-bogo-2-1-baguette', 'bogo', 2, 1, p.id, true, 50, … FROM products p WHERE p.name ILIKE '%baguette%' LIMIT 1 ON CONFLICT (slug) DO NOTHING`.
   - Idempotent so reruns/re-applies are safe.

After last migration: regen types via `mcp__plugin_supabase_supabase__generate_typescript_types` and write to `packages/supabase/src/types.generated.ts`.

### 1.D — pgTAP T_BOGO_01..10
- `supabase/tests/promotions_bogo.test.sql` — pgTAP suite covering:
  - T_BOGO_01: function exists and signature matches.
  - T_BOGO_02: BOGO new shape — 3 baguettes → `free_items` has 1 baguette, `total_discount = unit_price`.
  - T_BOGO_03: BOGO legacy shape (arrays) — verify backward compat still works.
  - T_BOGO_04: Threshold subtotal — cart 150k, threshold 100k @ 10% → discount 15k.
  - T_BOGO_05: Threshold quantity — cart qty 5, threshold qty 3 @ fixed 5k → discount 5k.
  - T_BOGO_06: Bundle — cart contains A+B+C, bundle_price 50k, sum 70k → discount 20k.
  - T_BOGO_07: Expired promo skipped (`end_at < now()`).
  - T_BOGO_08: Day-of-week mismatch skipped.
  - T_BOGO_09: Customer category mismatch skipped (with `p_customer_id` arg).
  - T_BOGO_10: Stacking — two stackable promos both apply ; non-stackable second skipped.
- Run via MCP `execute_sql` wrapped in `BEGIN; … ROLLBACK;`.

### 1.E — Vitest live RPC
- `supabase/tests/functions/promotions-evaluate-v1.test.ts` — 3 scenarios:
  1. BOGO 2+1: 3 baguettes → `free_items` length 1.
  2. Threshold 100k @ 10%: cart 150k → discount 15k.
  3. Bundle: cart [A, B, C] all qty 1, bundle_price 50k → discount = `subtotal − 50k`.
- Run `pnpm --filter @breakery/supabase test promotions` until green.

### 1.F — POS hook (RPC-first, TS fallback)
- `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts` — `runEvaluation` now returns a `Promise<AppliedPromotion[]>`. Inside: try `supabase.rpc('evaluate_promotions_v1', { p_cart_items, p_customer_id, p_subtotal })`; on `error` or network failure → fall back to existing in-TS `evaluatePromotions`. Normalize RPC response into `AppliedPromotion[]` shape so the cart store unchanged.
- `apps/pos/src/features/promotions/hooks/usePromotionsAutoEval.ts` — handle the promise (await inside the debounced callback).
- `apps/pos/src/features/promotions/__tests__/useEvaluatePromotions.smoke.test.ts` — mock `supabase.rpc` to return a v1-shape payload + assert hook normalizes correctly + assert fallback path runs the pure TS engine when RPC throws.
- Commit `feat(pos): session 13 — phase 2.C — RPC-first promo evaluation with TS fallback`.

### 1.G — BO BogoForm + ThresholdForm
Two strategies considered: (a) separate modals, (b) sub-components of existing `@breakery/ui/PromotionForm`. Choose **(b)** to keep existing list/save flow intact.
- `apps/backoffice/src/features/promotions/components/BogoForm.tsx` — exposes a `BogoFields` JSX block: NumberInput buy_qty, NumberInput get_qty, SingleSelect get_product_id. Plugs into existing `PromotionForm` via prop drilling OR via a new `<PromotionForm typeAddons={…}>` prop. Simpler: render this block in `PromotionFormModal.tsx` when `values.type === 'bogo' && values.bogo_buy_quantity !== null` toggle.
- `apps/backoffice/src/features/promotions/components/ThresholdForm.tsx` — Threshold amount NumberInput + radio threshold_type (subtotal/quantity) + discount value.
- `apps/backoffice/src/features/promotions/components/BogoForm.test.tsx` + `ThresholdForm.test.tsx` — RTL render + save smoke.
- Update `usePromotionReferenceData` / `useCreatePromotion` / `useUpdatePromotion` to round-trip the new columns (passing through unchanged JSON insert).

### 1.H — Types regen + final integration
- `mcp__plugin_supabase_supabase__generate_typescript_types` → write to `packages/supabase/src/types.generated.ts`.
- `pnpm typecheck` (full monorepo).
- `pnpm --filter @breakery/domain test promotions` ; `pnpm --filter @breakery/supabase test promotions` ; `pnpm --filter @breakery/pos test promotions` ; `pnpm --filter @breakery/backoffice test promotions`.
- Commit `chore(types): session 13 — phase 2.C — regen types after promo schema extension`.

### 1.I — SendMessage `lead`
Summary of files touched, migrations applied, test counts, deviations.

---

## 2. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `ALTER TYPE … ADD VALUE` can't run inside a transaction in some Postgres versions | MCP `apply_migration` already wraps in TX. If it errors, split into a stand-alone migration without other DDL ; PG14+ supports this in TX. |
| CHECK constraint replacement breaks existing rows | The Wave 0 DB is empty for promotions ; only the seed inserts. We'll guard with `WHERE type IN ('percentage','fixed_amount','bogo','free_product') NOT VALID` if needed. |
| Existing TS engine tests still green | We extend `types.ts` with **optional** fields ; existing `Promotion` factories provide `undefined` so no test impact. |
| RPC payload shape drift | Normalize RPC return → `AppliedPromotion[]` inside hook ; cart store unchanged. |
| File 500-line cap | `evaluate_promotions_v1.sql` could approach 400 lines — split into helper sub-functions if needed (`_eval_percent`, `_eval_bogo`, `_eval_threshold`, `_eval_bundle`). |
| Domain `bogoEngine.ts` cap | Split per shape if it crosses 400. |

---

## 3. DoD checklist (sub-plan ↔ INDEX)

- [ ] Sub-plan + deviations committed.
- [ ] `bogoEngine.ts` pure TS + unit tests green.
- [ ] 3 migrations applied via MCP (`apply_migration`).
- [ ] `evaluate_promotions_v1` callable from `execute_sql` smoke.
- [ ] pgTAP T_BOGO_01..10 green via `execute_sql BEGIN…ROLLBACK`.
- [ ] Vitest live RPC scenarios pass.
- [ ] POS hook RPC-first + TS fallback ; smoke test green.
- [ ] BO BogoForm + ThresholdForm render + save ; tests green.
- [ ] `mcp__plugin_supabase_supabase__generate_typescript_types` regen → `packages/supabase/src/types.generated.ts` updated + committed.
- [ ] `pnpm typecheck` green.
- [ ] Commits squash-mergeable, Claude co-author.
- [ ] SendMessage `lead` with summary.
