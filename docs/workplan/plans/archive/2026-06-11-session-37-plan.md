# Session 37 — Fraud Hardening & Correctness Close-out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One subagent per Task. Wave A tasks are mutually independent; Wave B task B1 (POS-01) **depends on A1/A3** (the RPC return-shape bump); Wave C cutover (C5) is **strictly sequenced** (front-first, gate-last). Recommended order: **Task 0 → Wave A → Wave B → Wave C → Wave D**.

**Goal:** Close the money-flow security and POS-correctness queue surfaced by the post-S36 6-agent audit. Server-side discount validation + price reconciliation (SEC-01/02), append-only loyalty ledger (SEC-04), rate-limit the payment EF (DB-02), make Z-report signing actually validate the PIN (BO-01); fix the hardcoded `total: 0` pickup bug, pre-promo customer display, fake loyalty balance, client-only post-kitchen void, and the 7× hardcoded tax rate (POS-01/02/04/05/06); align BO order-detail query keys + small BO UX fixes (BO-02/03/05/12); and finally wire the dead-code customers PII RPCs and flip the read gate (SEC-03/DB-03/DB-06). Plus CI/test/docs hygiene (Wave D). **Zero new feature.**

**Architecture:** Wave A is DB + EF: two RPC bumps on the payment path (`complete_order_with_payment_v10 → v11`, `pay_existing_order_v6 → v7`) adding discount-authority + PIN validation + `unit_price` reconciliation + a `order.discount_applied` audit row; a REVOKE corrective on `loyalty_transactions`; a rate-limit import on `process-payment`; and Z-report PIN validation (bump `sign_zreport_v2`). Wave B is mostly front (POS), consuming the A bumps for the real `total`. Wave C is BO front fixes + the customers-PII HARD CUTOVER (extend RPCs to carry category pricing, wire 4+1 POS sites, then apply the `customers.read` gate LAST). Wave D adds a PR-time pgTAP gate, backfills 57 Vitest `skipIf` guards, and refreshes CLAUDE.md.

**Tech Stack:** React 18 + TypeScript (strict), Zustand, TanStack Query v5, Supabase JS (PIN-JWT fetch wrapper), Postgres (RPC versioning, REVOKE pairs S25, pgTAP), Deno Edge Functions (PIN-in-header, durable rate-limit), Vitest + `@testing-library/react`, Tailwind semantic tokens (`@breakery/ui`). DB target: **cloud V3 dev `ikcyvlovptebroadgtvd` via MCP** (Docker retired). pnpm + turbo monorepo.

---

## Decisions to ratify in Task 0 (then locked for the run)

| # | Decision | Default recommendation |
|---|---|---|
| D1 | PIN transport for `pay_existing_order` discount validation | `complete_order_with_payment` (via EF `process-payment`) reads `x-manager-pin` → RPC arg. For `pay_existing_order` (direct `supabase.rpc`): prefer **gate-permission-only fallback** (§A3.1) unless `current_setting('request.headers')` is confirmed reliable |
| D2 | `unit_price` reconciliation behaviour | **Force the server `retail_price`** when no audited override on the line; log `order.price_overridden` on mismatch. (Exception-raising is the stricter alternative) |
| D3 | BO-01 Z-report PIN | **Bump `sign_zreport_v2(p_zreport_id, p_manager_pin)`** validating the PIN in-arg (no new EF) — appel BO interne |
| D4 | `orders.discount` permission | New permission unless an existing discount perm is found in the `permissions` table |
| D5 | POS-05 tax rate | **Domain constant `DEFAULT_TAX_RATE` only** (V1); `useTaxRate` reading `business_config` deferred S38 |
| D6 | customers v2 shape | **Extend the RPC TABLE result** with category pricing columns (`search_customers_v2`/`get_customer_v2`/`create_customer_v2`) — 1 round-trip |
| D7 | `_043` gate file | Confirm NOT applied; re-author in the S37 block (`20260621…`) for monotonic numbering, OR apply the existing file via MCP — Task 0 decides |

---

## ⚠️ Verified facts (read first)

1. **Max migration in git is `20260620000017`** → S37 block base `20260621000010` (verify via MCP `list_migrations` in Task 0).
2. **`pay_existing_order_v6`** returns `UUID` (`20260517000016_bump_pay_existing_order_v6.sql:33`), gates only `payments.process` (line 79), writes `p_discount_*` verbatim (281-285), uses already-persisted `order_items.line_total` (138).
3. **`complete_order_with_payment_v10`** returns `jsonb` (`20260530190828:35`), gates only `pos.sale.create` (101), takes `unit_price` from client (`v_unit_price := (v_item->>'unit_price')` 194/359), writes `p_discount_authorized_by` verbatim (332), returns an envelope (517).
4. **`useCheckout.ts:95-102`** hardcodes `total: 0, tax_amount: 0` on the pickup branch.
5. **`process-payment` EF has no rate-limit** (no `checkRateLimitDurable` import); `refund-order` has it (`:25,49`).
6. **7× `TAX_RATE` in POS**: `ActiveOrderPanel.tsx:35`, `BottomActionBar.tsx:51`, `usePrintBill.ts:14`, `useApplyCartDiscount.ts:8`, `useCartBroadcast.ts:5`, `usePaymentFlowLogic.ts:26`, `SuccessModal.tsx:12`. Server reads `business_config.tax_rate`.
7. **BO query-key mismatch**: `useOrderDetail.ts:62` = `['order-detail', id]`; `useEditOrderItems.ts:74` invalidates `['orders','detail',orderId]`; `useVoidOrder.ts:57` invalidates `['orders','detail']`.
8. **`useCartBroadcast.ts:21`** uses `calculateTotals(cart, TAX_RATE)` — no promotion deduction.
9. **`SuccessModal.tsx:67`** hardcodes `balance_after: 0`.
10. **customers RPCs are dead code**: `search_customers_v1`/`get_customer_v1`/`create_customer_v1` (`20260619000040`) + `get_pos_b2b_debts_v1` (`_042`) created, NONE wired. Gate `_043` committed but DEFERRED. The v1 RPCs return a **flat projection (no `customer_categories` embed)** — insufficient for POS pricing (`useCheckout.ts:54` needs `category.points_multiplier`; `CUSTOMER_SELECT` embeds the full category).
11. **`loyalty_transactions`** has RLS only — no role-level REVOKE on INSERT/UPDATE/DELETE.

---

## Task 0: Environment + design verification (do once up front)

**Files:** none (MCP queries + reads only). Record answers in the session INDEX under "Schema facts" and lock D1-D7.

- [ ] **Step 1: MCP auth + migration base.** Run MCP `mcp__plugin_supabase_supabase__list_migrations` (project `ikcyvlovptebroadgtvd`). **If the MCP is not authenticated / returns an error, STOP and report it as a BLOCKER for all DB waves (A + C)** — front-only tasks (B partial, BO quick-fixes C1-C4, D docs) can still proceed. Read the max `version`; expected git max `20260620000017` → base `20260621000010`. Record.

- [ ] **Step 2: Confirm `_043` is NOT applied.** In the `list_migrations` output (and via `execute_sql` checking `supabase_migrations.schema_migrations`), confirm `20260619000043` is absent. **If present → the customers SELECT is already gated while the POS still reads `customers` directly → PII reads broken for POS roles → HOTFIX**: either fast-track the C5 front wiring or roll back the policy. Record state.

- [ ] **Step 3: Inspect the money RPCs + PIN helper pattern.** Via MCP `execute_sql`:
  - `SELECT pg_get_functiondef('public.complete_order_with_payment_v10'::regprocedure);`
  - `SELECT pg_get_functiondef('public.pay_existing_order_v6'::regprocedure);`
  - `SELECT pg_get_functiondef('public.sign_zreport_v1'::regprocedure);`
  - `SELECT pg_get_functiondef('public.close_fiscal_period_v1'::regprocedure);` (to copy the PIN-validation idiom — how it reads/validates `p_manager_pin`).
  - Check whether `current_setting('request.headers', true)` is used anywhere: `SELECT proname FROM pg_proc WHERE prosrc ILIKE '%request.headers%';`
  Record the PIN helper name (e.g. `verify_manager_pin` or inline `crypt`) and lock **D1**.

- [ ] **Step 4: Permission inventory.** `SELECT code FROM permissions WHERE code ILIKE '%discount%' OR code ILIKE '%void%' OR code ILIKE '%refund%';` — if a discount permission exists, reuse it (lock **D4**); else plan to seed `orders.discount`.

- [ ] **Step 5: customers RPC return shapes + category gate.** Read `20260619000040` (done) + check whether `customer_categories` is itself RLS-gated: `SELECT polname, polcmd FROM pg_policies WHERE tablename='customer_categories';` and `SELECT has_table_privilege('authenticated','public.customer_categories','SELECT');`. Decide **D6** (extend RPC TABLE result vs separate category fetch). Record the exact pricing/loyalty columns the POS needs (`price_modifier_type`, `discount_percentage`, `loyalty_enabled`, `points_multiplier`, `is_default`, …) from `CUSTOMER_SELECT` in `useCustomerSearch.ts:14`.

- [ ] **Step 6: POS-06 void surface map.** Read `apps/pos/src/features/cart/BottomActionBar.tsx` (void handler, lines ~121/287), `apps/pos/src/stores/cartStore.ts` (`voidOrder`, `printedItemIds`, locked-item tracking), `apps/pos/src/features/cart/hooks/useSendToKitchen.ts` (whether an order row exists server-side after send), and `supabase/functions/void-order/index.ts` (PIN-header contract). Record: does a counter cart hold a server order id before checkout, and how are locked items identified. Lock the void-routing condition.

- [ ] **Step 7: RPC return for POS-01/POS-04.** Confirm `complete_order_with_payment_v10`'s jsonb envelope keys (does it expose a post-sale loyalty balance? — needed for POS-04). If not, plan to add it additively in v11. Lock whether `pay_existing_order_v7` returns jsonb (POS-01).

---

# Wave A — Money-flow security (DB + EF) — ~M/L

**Approach:** Two payment-RPC bumps (discount gate + PIN + unit_price reconcil + audit), a loyalty REVOKE corrective, a rate-limit import on `process-payment`, and Z-report PIN validation. Tasks A1-A5 are independent; each is TDD-first (pgTAP red → migration → pgTAP green). Recommended agents: `db-engineer` (A1/A2/A3/A5), `edge-functions-engineer` (A4 + the `process-payment` PIN relay for A1), `test-engineer` (all pgTAP).

### Task A1: bump `complete_order_with_payment_v10 → v11` — discount gate + PIN + unit_price reconcil + audit (SEC-01/SEC-02/SEC-05)

**Files:**
- Create migration: `supabase/migrations/<base>_010_bump_complete_order_v11.sql`
- Create migration: `supabase/migrations/<base>_011_revoke_pair_complete_order_v11.sql`
- (Conditional) `supabase/migrations/<base>_016_seed_orders_discount_permission.sql` (per D4)
- Modify EF: `supabase/functions/process-payment/index.ts` (read `x-manager-pin` → RPC arg `p_manager_pin`)
- Modify domain/payload: `packages/domain` `buildOrderPayload` (thread manager pin if needed) + `apps/pos/src/features/payment/hooks/useCheckout.ts`
- Create test: `supabase/tests/order_discount_gate.test.sql`

- [ ] **Step 1: Write the pgTAP (failing baseline)** covering SEC-01 + SEC-02 in `order_discount_gate.test.sql`:
  - T1: order-level `p_discount_amount > 0` with `p_discount_authorized_by = NULL` → exception.
  - T2: discount > 0 with `authorized_by` lacking `orders.discount` → exception (P0003).
  - T3: discount > 0 with valid authorizer + correct PIN → success + one `audit_logs` row `action='order.discount_applied'`.
  - T4: discount > 0 with wrong PIN → exception.
  - T5: order with no discount → no PIN required → success.
  - T6 (SEC-02): a line with `unit_price` < `products.retail_price` and no override → server forces `retail_price` (assert persisted `order_items.unit_price` == `retail_price`) per D2 (or expects exception if D2=exception).
  - T7 (SEC-02): a line with an audited override → client `unit_price` respected.
  Wrap `BEGIN; SELECT plan(7); … SELECT * FROM finish(); ROLLBACK;`. Run via MCP `execute_sql` → expect failures (no gate yet).

- [ ] **Step 2: Write the v11 migration.** `CREATE OR REPLACE FUNCTION complete_order_with_payment_v11(...)` adding `p_manager_pin TEXT DEFAULT NULL`; preserve the v10 body and add, near the discount handling:
  - If any discount (order-level OR any line `discount_amount > 0`): require `p_discount_authorized_by` IS NOT NULL; `has_permission(p_discount_authorized_by, 'orders.discount')` (or the reused perm per D4); validate PIN via the Task-0 helper (`verify_manager_pin(p_discount_authorized_by, p_manager_pin)` idiom).
  - For each line: load `products.retail_price`; if no audited override on the line, set `v_unit_price := products.retail_price` (D2) and log `order.price_overridden` on mismatch; else respect the client value.
  - Append an `audit_logs` row `action='order.discount_applied'` (canonical cols `actor_id, action, entity_type, entity_id, metadata`).
  `DROP FUNCTION complete_order_with_payment_v10(<old sig>)` in the same migration. Apply via MCP `apply_migration`.

- [ ] **Step 3: REVOKE pair migration** (`_011`) — canonical S25 triple on `complete_order_with_payment_v11`: `REVOKE EXECUTE … FROM PUBLIC; REVOKE EXECUTE … FROM anon; GRANT EXECUTE … TO authenticated; ALTER DEFAULT PRIVILEGES FOR ROLE postgres … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`. (Note: `complete_order_with_payment` is called by the `process-payment` EF in service-role; keep `authenticated` GRANT if the POS ever calls it directly — verify the caller is the EF only and adjust.) Apply.

- [ ] **Step 4: (Conditional) seed `orders.discount`** (`_016`, per D4) for MANAGER/ADMIN/SUPER_ADMIN. Apply.

- [ ] **Step 5: Wire the EF + POS.** In `process-payment/index.ts`: read the PIN via the shared header helper (`x-manager-pin`), pass it as `p_manager_pin` to the RPC. In `useCheckout.ts` (non-pickup branch) + `buildOrderPayload`: forward the manager PIN header (collected by the discount-authorization modal — verify the POS already captures a manager PIN for discounts; if not, this is the discount-authorize UI path). Update the RPC call to `complete_order_with_payment_v11`.

- [ ] **Step 6: Regen types** (signature changed) — MCP `generate_typescript_types` → write `packages/supabase/src/types.generated.ts` → commit.

- [ ] **Step 7: Re-run pgTAP** → 7/7 PASS. Run POS golden-path smoke (`pnpm --filter @breakery/app-pos test golden-path`) → no regression. `pnpm typecheck`.

- [ ] **Step 8: Commit** — `feat(db): complete_order_with_payment v11 — discount authority+PIN gate, unit_price reconciliation, discount audit (SEC-01/02/05)`.

### Task A2: bump `pay_existing_order_v6 → v7` — discount gate + jsonb return (SEC-01 + POS-01 enabler)

**Files:**
- Create migration: `supabase/migrations/<base>_012_bump_pay_existing_order_v7.sql`
- Create migration: `supabase/migrations/<base>_013_revoke_pair_pay_existing_order_v7.sql`
- Create test: `supabase/tests/pay_existing_discount_gate.test.sql`
- (Downstream, Wave B) `useCheckout.ts` reads the new jsonb return.

- [ ] **Step 1: pgTAP (failing)** — T1: discount > 0 without authorized_by → exception; T2: authorized_by lacking `orders.discount` → exception; T3: valid authorizer (+ PIN per D1) → success + audit row; T4: return value is jsonb with `{ order_id, order_number, total, tax_amount, change_given }` (POS-01). Run → fail.

- [ ] **Step 2: v7 migration.** `CREATE OR REPLACE FUNCTION pay_existing_order_v7(...)` — same v6 body, change `RETURNS UUID` → `RETURNS jsonb` returning the envelope; add discount-authority gate (per D1: PIN via header-in-RPC if reliable, else permission-gate-only fallback §A3.1 — **document the chosen path as a deviation**); append `order.discount_applied` audit row when a discount is present. `DROP FUNCTION pay_existing_order_v6(<old sig>)` same migration. Apply.

#### A3.1 fallback (if D1 = permission-only for direct RPC)
If reading `x-manager-pin` inside the direct-RPC `pay_existing_order_v7` is unreliable, gate the discount on `has_permission(p_discount_authorized_by, 'orders.discount')` alone (no PIN) for the pickup path and **record `DEV-S37-A2-01` (Medium)**: pickup-tablet discounts are permission-gated but not PIN-gated; the main checkout path (`complete_order_with_payment_v11`) keeps the full PIN gate. Acceptable because pickup-with-discount is rare; revisit if abused.

- [ ] **Step 3: REVOKE pair** (`_013`) — canonical S25 triple on `pay_existing_order_v7`, GRANT `authenticated` (the POS calls it directly). Apply.

- [ ] **Step 4: Regen types** → commit.

- [ ] **Step 5: Re-run pgTAP** → PASS. (POS wiring of the jsonb return happens in Wave B Task B1.)

- [ ] **Step 6: Commit** — `feat(db): pay_existing_order v7 — discount gate + jsonb return for the real total (SEC-01, POS-01 enabler)`.

### Task A3: `loyalty_transactions` append-only REVOKE (SEC-04)

**Files:**
- Create migration: `supabase/migrations/<base>_014_revoke_loyalty_transactions_writes.sql`
- Create test: `supabase/tests/loyalty_transactions_append_only.test.sql`

- [ ] **Step 1: pgTAP (failing)** — T1: `has_table_privilege('authenticated','public.loyalty_transactions','INSERT')` = false; T2: UPDATE = false; T3: DELETE = false. Run → fail (currently true).

- [ ] **Step 2: Migration** — `REVOKE INSERT, UPDATE, DELETE ON public.loyalty_transactions FROM authenticated, anon, PUBLIC;` (SECURITY DEFINER RPCs owned by postgres keep writing). Apply.

- [ ] **Step 3: Re-run pgTAP** → 3/3 PASS. Sanity: a sale via RPC still inserts an earn row (run a definer RPC in a `BEGIN; … ROLLBACK;` and assert the row).

- [ ] **Step 4: Commit** — `fix(db): make loyalty_transactions append-only (REVOKE writes from authenticated/anon/PUBLIC) (SEC-04)`.

### Task A4: rate-limit `process-payment` EF (DB-02)

**Files:**
- Modify EF: `supabase/functions/process-payment/index.ts`

- [ ] **Step 1: Read the reference** — `supabase/functions/refund-order/index.ts:25,49` for the `checkRateLimitDurable` + `getClientIp` import and call shape, and the `_shared/rate-limit.ts` signature.

- [ ] **Step 2: Add the rate-limit** at the top of the handler: import `{ checkRateLimitDurable, getClientIp }`, call with a `process-payment` bucket + window/limit aligned to `refund-order`, return 429 on limit. Fail-open on DB error (S19 trade-off). Keep the existing auth/JWT flow intact.

- [ ] **Step 3: Deploy** the EF to V3 dev via MCP (or the project's EF deploy path). Smoke: a normal checkout still succeeds (golden-path); rapid N+1 requests → 429 (env-gated Vitest live if `SUPABASE_SERVICE_ROLE_KEY` present).

- [ ] **Step 4: Commit** — `fix(edge): rate-limit process-payment with checkRateLimitDurable (DB-02)`.

### Task A5: Z-report PIN validation (BO-01)

**Files:** (per D3 — default = bump v2)
- Create migration: `supabase/migrations/<base>_015_bump_sign_zreport_v2.sql`
- Modify hook: `apps/backoffice/src/features/zreports/hooks/useSignZReport.ts` (send PIN as RPC arg, not header)
- Create test: `supabase/tests/sign_zreport_pin.test.sql`

- [ ] **Step 1: pgTAP (failing)** — T1: `sign_zreport_v2(p_zreport_id, NULL)` or wrong PIN → exception (status stays `draft`); T2: correct PIN + `zreports.sign` perm → `z_reports.status='signed'` + audit_log `zreport.signed`; T3: idempotent replay returns same result. Run → fail (v1 ignores PIN).

- [ ] **Step 2: Migration** — `CREATE OR REPLACE FUNCTION sign_zreport_v2(p_zreport_id UUID, p_manager_pin TEXT)` validating the PIN (Task-0 idiom, e.g. like `close_fiscal_period_v1`) + the existing `zreports.sign` gate + audit + idempotent replay; `DROP FUNCTION sign_zreport_v1(<old sig>)` same migration; REVOKE pair. Apply.
  > If D3 = EF wrapper instead: create `supabase/functions/sign-zreport/index.ts` reading `x-manager-pin` (S25) + rate-limit + idempotency, calling `sign_zreport_v1` service-role after PIN check; deploy via MCP; hook POSTs the EF. Record the chosen path.

- [ ] **Step 3: Wire the hook** — `useSignZReport.ts` passes the PIN as the `p_manager_pin` RPC arg (drop the ignored `x-manager-pin` header) and calls `sign_zreport_v2`. Regen types.

- [ ] **Step 4: Re-run pgTAP** → PASS. BO smoke (`pnpm --filter @breakery/app-backoffice test zreport`) → sign requires PIN.

- [ ] **Step 5: Commit** — `fix(db): sign_zreport_v2 validates the manager PIN — signing was unauthenticated (BO-01)`.

---

# Wave B — POS correctness (front + RPC return) — ~S/M

**Approach:** Front-only except POS-01 which consumes A2's jsonb return. B1 depends on A2; B2-B5 are independent. Agent: `pos-specialist` + `test-engineer`.

### Task B1: real total on pickup-tablet checkout (POS-01) — depends on A2

**Files:**
- Modify: `apps/pos/src/features/payment/hooks/useCheckout.ts` (lines 93-102)
- Test: `apps/pos/src/features/payment/__tests__/checkout-pickup-total.smoke.test.tsx`

- [ ] **Step 1: Failing smoke** — mock `supabase.rpc('pay_existing_order_v7')` to resolve the new jsonb envelope `{ order_id, order_number, total: 50000, tax_amount, change_given }`; assert the hook returns `total === 50000` (not 0).
- [ ] **Step 2: Run → fail** (current code hardcodes 0).
- [ ] **Step 3: Implement** — switch the pickup branch to `pay_existing_order_v7`, read `data.total`/`data.tax_amount`/`data.change_given`/`data.order_number` from the jsonb response (typed via regen). Remove the `total: 0, tax_amount: 0` hardcodes.
- [ ] **Step 4: Run → PASS**; `pnpm --filter @breakery/app-pos typecheck`; re-run any tablet/pickup smokes.
- [ ] **Step 5: Commit** — `fix(pos): return the real total on pickup-tablet checkout (POS-01)`.

### Task B2: customer display post-promo total (POS-02)

**Files:**
- Modify: `apps/pos/src/features/display/hooks/useCartBroadcast.ts`
- Test: `apps/pos/src/features/display/__tests__/cart-broadcast-promo.smoke.test.tsx`

- [ ] **Step 1: Failing smoke** — set a cart + an applied promotion in the store; assert the broadcast message `total` = items − promo − discount (not the raw `calculateTotals`).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — read `appliedPromotions` + `cartDiscount` from the store; deduct from the total before `postMessage` (mirror `usePaymentFlowLogic`'s amount-due computation — the source of truth). Keep the unique-channel pattern intact.
- [ ] **Step 4: Run → PASS**; re-run display suite; typecheck.
- [ ] **Step 5: Commit** — `fix(pos): customer display shows post-promotion total (POS-02)`.

### Task B3: real loyalty balance on receipt (POS-04)

**Files:**
- Modify: `apps/pos/src/features/payment/SuccessModal.tsx:67` (+ prop)
- Modify: the caller that renders `SuccessModal` (thread `loyaltyBalanceAfter` from the checkout response)
- Test: `apps/pos/src/features/payment/__tests__/success-modal-loyalty.smoke.test.tsx`

- [ ] **Step 1: Failing smoke** — render `SuccessModal` with `loyaltyBalanceAfter={1234}`; assert the receipt payload `loyalty.balance_after === 1234` (not 0).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — add an optional `loyaltyBalanceAfter?: number` prop; use it for `balance_after`; if the RPC envelope doesn't expose it (Task 0 Step 7), add it additively to the v11 jsonb return and thread it through the checkout response → caller → modal; if unavailable, **omit** the loyalty `balance_after` field rather than render 0.
- [ ] **Step 4: Run → PASS**; typecheck.
- [ ] **Step 5: Commit** — `fix(pos): receipt shows the real loyalty balance after the sale (POS-04)`.

### Task B4: server-side void for post-kitchen orders (POS-06)

**Files:**
- Modify: `apps/pos/src/features/cart/BottomActionBar.tsx` (void handler ~121/287)
- Possibly: a new `apps/pos/src/features/cart/hooks/useVoidServerOrder.ts` (wraps the `void-order` EF with PIN)
- Test: `apps/pos/src/features/cart/__tests__/void-post-kitchen.smoke.test.tsx`

- [ ] **Step 1: Apply Task 0 Step 6 findings** — the void-routing condition (locked items / server order present).
- [ ] **Step 2: Failing smoke** — two cases: (a) cart with locked items → asserts the server void path (EF `void-order`, PIN) is invoked before the local reset; (b) cart with no locked items → asserts only the local `cartStore.voidOrder()` runs (no server call).
- [ ] **Step 3: Run → fail** (current code always client-only).
- [ ] **Step 4: Implement** — in the void handler: if locked items exist, call the server void (EF `void-order` with `x-manager-pin`, S34 contract) and only reset locally on success; else keep the pure-client void. Surface a PIN prompt for the server path.
- [ ] **Step 5: Run → PASS**; re-run cart suites; typecheck.
- [ ] **Step 6: Commit** — `fix(pos): route post-kitchen cart void through the server (EF void-order) before local reset (POS-06)`.

### Task B5: centralize `TAX_RATE` (POS-05)

**Files:**
- Create: `packages/domain/src/<money|orders>/taxRate.ts` (export `DEFAULT_TAX_RATE = 0.10`) + barrel export
- Modify the 7 POS sites (fact #6) to import `DEFAULT_TAX_RATE`
- Test: `packages/domain/src/<…>/__tests__/taxRate.test.ts` (trivial constant assertion)

- [ ] **Step 1: Add the constant** to `@breakery/domain` (IO-free) + export from the barrel; tiny unit test asserts `DEFAULT_TAX_RATE === 0.10`.
- [ ] **Step 2: Replace the 7 local declarations** with `import { DEFAULT_TAX_RATE } from '@breakery/domain'` (rename usages from `TAX_RATE` to `DEFAULT_TAX_RATE` or alias). Per D5, **do not** add the `business_config` read (deferred S38).
- [ ] **Step 3: Verify** — `git grep "TAX_RATE = 0.1" apps/pos/src` → 0 matches; `pnpm --filter @breakery/app-pos typecheck` PASS; re-run POS cart/payment suites (the value is unchanged so no behavioural regression).
- [ ] **Step 4: Commit** — `refactor(pos): centralize tax rate into @breakery/domain DEFAULT_TAX_RATE (POS-05)`.

---

# Wave C — BO quick fixes + customers PII cutover — ~S + M

**Approach:** C1-C4 are tiny independent BO front fixes. C5 is the HARD CUTOVER (sequenced). Agents: `backoffice-specialist` (C1-C4), `pos-specialist` + `db-engineer` (C5).

### Task C1: align order-detail query keys (BO-02)

**Files:** `apps/backoffice/src/features/orders/hooks/useOrderDetail.ts`, `useEditOrderItems.ts`, `useVoidOrder.ts`; test `apps/backoffice/src/features/orders/__tests__/order-detail-invalidation.smoke.test.tsx`.

- [ ] **Step 1: Failing smoke** — after a void/edit mutation, assert `invalidateQueries` targets the key `useOrderDetail` actually uses (`['order-detail', id]`).
- [ ] **Step 2: Run → fail** (current invalidations use `['orders','detail',…]`).
- [ ] **Step 3: Implement** — change both invalidations to `['order-detail', orderId]` (match `useOrderDetail.ts:62`). Grep for any other consumer of the ghost key.
- [ ] **Step 4: Run → PASS**; typecheck.
- [ ] **Step 5: Commit** — `fix(backoffice): align order-detail query keys so void/edit invalidations refetch (BO-02)`.

### Task C2: surface OrdersListPage fetch error (BO-03)

**Files:** `apps/backoffice/src/features/orders/OrdersListPage.tsx:117`.

- [ ] **Step 1: Implement** — add a `toast.error(...)` on the swallowed error (+ optional inline error state). **Step 2: Smoke** asserts the toast fires on error. **Step 3: Commit** — `fix(backoffice): surface OrdersListPage fetch errors via toast (BO-03)`.

### Task C3: per-row PDF pending state (BO-05)

**Files:** `apps/backoffice/src/features/zreports/ZReportsListPage.tsx:43`.

- [ ] **Step 1: Implement** — track the active `zreport_id` (or compare `mutation.variables`) so only that row's button is disabled. **Step 2: Smoke** asserts other rows' buttons stay enabled. **Step 3: Commit** — `fix(backoffice): per-row Z-report PDF pending state (BO-05)`.

### Task C4: OrderDetailPage back URL (BO-12)

**Files:** `apps/backoffice/src/features/orders/OrderDetailPage.tsx`.

- [ ] **Step 1: Implement** — change the back navigation target from `/backoffice` to `/backoffice/orders`. **Step 2: Smoke/visual** confirms. **Step 3: Commit** — `fix(backoffice): OrderDetailPage back goes to the orders list (BO-12)`.

### Task C5: customers PII cutover (SEC-03 / DB-03 / DB-06) — STRICTLY SEQUENCED

**Files:**
- Migration: `supabase/migrations/<base>_017_create_customers_pos_rpcs_v2.sql` (extend RPCs with category pricing, per D6)
- Migration (LAST): `supabase/migrations/<base>_018_gate_customers_read.sql` (the `_043` equivalent)
- Modify POS: `useCustomerSearch.ts`, `useCreateCustomer.ts`, `Pos.tsx`, `useRestoreHeldOrder.ts`, `useOutstandingDebts.ts`
- Test: `supabase/tests/customers_pii_gate.test.sql`

- [ ] **Step 0 (precondition):** confirm Task 0 Step 2 — `_043` NOT applied. If applied, hotfix first.

- [ ] **Step 1: Extend the RPCs (D6).** `CREATE OR REPLACE search_customers_v2 / get_customer_v2 / create_customer_v2` returning the flat customer columns **plus** the category pricing/loyalty columns the POS needs (Task 0 Step 5 list) — either as extra TABLE columns or a nested jsonb `category`. `DROP` the v1 RPCs in the same migration. REVOKE pair on each (canonical S25). Apply via MCP. Regen types.

- [ ] **Step 2: pgTAP (RPC shape + gate)** — T1: `search_customers_v2` returns category pricing for a customer with a category; T2: definer RPCs callable by `authenticated`, not `anon`; T3 (after Step 5): `customers` SELECT requires `customers.read` (a CASHIER session gets 0 rows from a direct select). Author now, run T1/T2 immediately (T3 after the gate).

- [ ] **Step 3: Wire the 4+1 POS sites (front, gate NOT yet applied).**
  - `useCustomerSearch.ts` → `supabase.rpc('search_customers_v2', { p_query, p_limit })`, map the result to `CustomerWithCategory` (category from the RPC shape).
  - `useCreateCustomer.ts` → `supabase.rpc('create_customer_v2', …)`.
  - `Pos.tsx` inline search/create → the RPCs.
  - `useRestoreHeldOrder.ts` → `get_customer_v2` for the badge re-fetch (replace the direct `CUSTOMER_SELECT`).
  - `useOutstandingDebts.ts` → `get_pos_b2b_debts_v1` (DB-06).
  Run POS smokes: search/attach/checkout pricing + B2B debts panel work via RPCs. `git grep "from('customers')" apps/pos/src` → 0.

- [ ] **Step 4: Build the POS** (`pnpm --filter @breakery/app-pos build`) — the wired front must be deployable before the gate.

- [ ] **Step 5: Apply the gate LAST (`_018`)** — only after Step 3/4 are green and committed: `ALTER POLICY auth_read ON public.customers USING (has_permission(auth.uid(),'customers.read') AND deleted_at IS NULL);` + seed `customers.read` for MANAGER/ADMIN/SUPER_ADMIN (idempotent UPSERT). Apply via MCP. Run pgTAP T3 → PASS. **Record `DEV-S37-C5-01`**: hard cutover, front wired before gate (S25 pattern).

- [ ] **Step 6: Verify BO unaffected** — BO `useOrderDetail` embed `customers(name)` runs under a MANAGER+ session holding `customers.read` → still valid (smoke BO order detail).

- [ ] **Step 7: Commit** (two commits, in order) — `feat(db): customers POS RPCs v2 with category pricing + wire 4+1 POS sites off direct customers reads (SEC-03/DB-03/DB-06)` then `feat(db): gate customers.read SELECT — close the PII read channel (cutover) (SEC-03)`.

---

# Wave D — Tests + docs — ~M

**Approach:** CI gate + Vitest guard backfill + CLAUDE.md refresh. Agent: `test-engineer` + docs.

### Task D1: PR-time pgTAP gate (TEST-02)

**Files:** `.github/workflows/ci.yml` (+ maybe a `supabase/tests/smoke/` subset list).

- [ ] **Step 1: Decide the subset** — the REVOKE-pair + money-flow pgTAP files (this session's `order_discount_gate`, `loyalty_transactions_append_only`, `sign_zreport_pin`, `send_items_anon_revoke`, plus a couple of canonical guards). **Step 2: Add a CI job** running them against V3 dev via `execute_sql`-equivalent (psql pooler connection string from secrets). If the cloud secrets are not configured in CI, ship the job `continue-on-error: true` and **record a blocker** in the INDEX (gap S13 staging secrets). **Step 3: Verify** the job runs on a PR. **Step 4: Commit** — `ci: add a PR-time pgTAP smoke gate (TEST-02)`.

### Task D2: backfill Vitest `skipIf` guards (TEST-01)

**Files:** the 57 `supabase/tests/functions/*.test.ts` (and any other live suites) lacking the guard.

- [ ] **Step 1: Enumerate** — `git grep -L "skipIf" supabase/tests/functions/*.test.ts` (and other live dirs) to list the unguarded files. **Step 2: Wrap** each top-level `describe` with `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)` (or a shared `liveDescribe` helper). **Step 3: Verify** — `pnpm test` without the secret → those suites skip (no env-gated failures); with the secret they still run. **Step 4: Commit** — `test: guard 57 live Vitest suites with skipIf(!SUPABASE_SERVICE_ROLE_KEY) (TEST-01)`.

### Task D3: refresh CLAUDE.md (PAT-05/06/17/18)

**Files:** `CLAUDE.md` §Active Workplan (done in Close-out Task Z alongside the S37 bump).

- [ ] Correct the 4 stale points: S36 PR #68 **merged** (not "PR pending"); PR #66 **merged** (not "open"); PIN-header sweep `void-order`/`cancel-item`/`kiosk-issue-jwt` marked **DONE** (S34 / S36 verified / S25 refund); S25 block **merged** (not "ready to merge"). Folded into the §Active Workplan bump.

---

# Close-out

### Task Z: Final verification + INDEX + CLAUDE.md bump

- [ ] **Step 1: Full typecheck** — `pnpm typecheck` → PASS (baseline env-gated preserved: ~3 POS + ~24 BO `VITE_SUPABASE_URL Required`, NOT regressions — DEV-S25-2.A-02). Diff against `master` if in doubt.
- [ ] **Step 2: Targeted suites** — domain (`taxRate`), POS (`checkout-pickup-total`, `cart-broadcast-promo`, `success-modal-loyalty`, `void-post-kitchen`, golden-path), BO (`order-detail-invalidation`, zreport), pgTAP (`order_discount_gate`, `pay_existing_discount_gate`, `loyalty_transactions_append_only`, `sign_zreport_pin`, `customers_pii_gate`) all PASS via MCP.
- [ ] **Step 3: Sweep guards** — `git grep "TAX_RATE = 0.1" apps/pos/src` → 0; `git grep "from('customers')" apps/pos/src` → 0; `useCheckout` pickup branch no longer hardcodes `total: 0`.
- [ ] **Step 4: Write the INDEX** — fill `docs/workplan/plans/2026-06-11-session-37-INDEX.md` (scope delivered, migrations applied with cloud versions, RPCs bumped, permissions seeded, tests, deviations incl. DEV-S37-A2-01/C5-01, schema facts from Task 0, out-of-scope).
- [ ] **Step 5: Bump CLAUDE.md §Active Workplan** — Current session → S37; S36 → Previous session reference; correct the 4 stale points (D3); bump "Migration sequence active" with the S37 block (`20260621000010..`); list new permissions (`orders.discount` if seeded) + `customers.read` gate flip.
- [ ] **Step 6: Finalize the branch** — squash-merge `swarm/session-37` per phase (conventional commits per task). Do not force-push `master`. Pre-merge `pattern-guardian` read-only diff review of the REVOKE pairs + RPC bumps + cutover.

---

## Notes for executors

- **DB target is cloud V3 dev `ikcyvlovptebroadgtvd` via MCP** — never `pnpm db:reset` / `supabase start` (Docker retired). pgTAP runs via `execute_sql` `BEGIN; … ROLLBACK;`. **If MCP is unauthenticated (Task 0 Step 1), DB waves A + C5 are blocked — report it.**
- **Critical patterns to respect** (CLAUDE.md): RPC versioning monotone (bump + DROP old sig same migration — A1/A2/A5/C5); REVOKE pair S25 triple (`FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES … FROM PUBLIC`) on every new/bumped RPC; PIN in HTTP header never body (A1 EF relay); idempotency semantics preserved; `packages/domain` IO-free (B5 constant — no fetch/Supabase/React); regen types + commit after every schema change.
- **Sequencing**: B1 waits A2 (jsonb return); C5 is front-first / gate-last (do NOT apply `_018` before the wired front is committed); the discount-audit pgTAP (A1) must be red before the migration.
- **Recommended agent routing**: Wave A → `db-engineer` (A1/A2/A3/A5) + `edge-functions-engineer` (A4 + process-payment PIN relay) + `test-engineer` (pgTAP); Wave B → `pos-specialist` + `test-engineer`; Wave C → `backoffice-specialist` (C1-C4) + `pos-specialist`/`db-engineer` (C5); Wave D → `test-engineer` + docs; pre-merge → `pattern-guardian`.
