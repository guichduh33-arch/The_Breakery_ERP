# Session 37 — Fraud Hardening & Correctness Close-out — INDEX

> **Branch** : `swarm/session-37` (base `master` @ `06b8283`, post-merge S36 PR #68)
> **Spec** : [`../specs/2026-06-11-session-37-spec.md`](../specs/2026-06-11-session-37-spec.md)
> **Plan** : [`./2026-06-11-session-37-plan.md`](./2026-06-11-session-37-plan.md)
> **Status** : ⏳ **skeleton** — to be filled at close-out (Task Z). Sections below are placeholders.

---

## 1. Summary

- **Wave A — money-flow security** : _TBD_ — SEC-01 discount authority+PIN gate (`complete_order_with_payment_v11` + `pay_existing_order_v7`), SEC-02 `unit_price` reconciliation, SEC-04 `loyalty_transactions` append-only, DB-02 `process-payment` rate-limit, BO-01 `sign_zreport_v2` PIN validation.
- **Wave B — POS correctness** : _TBD_ — POS-01 real pickup total, POS-02 post-promo display total, POS-04 real loyalty balance, POS-06 server-side post-kitchen void, POS-05 centralized `DEFAULT_TAX_RATE`.
- **Wave C — BO + PII cutover** : _TBD_ — BO-02 query-key alignment, BO-03/05/12 UX fixes, SEC-03/DB-03/DB-06 customers RPC wiring + `customers.read` gate cutover.
- **Wave D — tests + docs** : _TBD_ — TEST-02 PR-time pgTAP gate, TEST-01 Vitest `skipIf` backfill, PAT-05/06/17/18 CLAUDE.md refresh.
- **No new feature; fraud-hardening + correctness close-out only.**

---

## 2. Schema facts (recorded in Task 0)

| Fact | Value |
|---|---|
| MCP Supabase authenticated? | _TBD (BLOCKER for waves A+C5 if not)_ |
| Migration block base (max applied + 1) | _TBD (expected `20260621000010`; git max `20260620000017`)_ |
| `20260619000043` (`_043` gate) applied? | _TBD (must be NO — else hotfix)_ |
| PIN-validation helper / idiom | _TBD (from `close_fiscal_period_v1`)_ |
| `current_setting('request.headers')` usable in RPC? | _TBD (D1)_ |
| Existing discount permission? | _TBD (D4 — reuse or seed `orders.discount`)_ |
| `customer_categories` RLS-gated for authenticated? | _TBD (D6)_ |
| v10/v11 jsonb envelope keys (loyalty balance present?) | _TBD (POS-04)_ |
| POS-06 void surface (server order before checkout?) | _TBD_ |
| Decisions locked | D1 _ / D2 _ / D3 _ / D4 _ / D5 _ / D6 _ / D7 _ |

---

## 3. Migrations applied

| File timestamp | Cloud version | Object |
|---|---|---|
| `<base>_010_bump_complete_order_v11` | _TBD_ | discount gate + PIN + unit_price reconcil + audit; DROP v10 (SEC-01/02/05) |
| `<base>_011_revoke_pair_complete_order_v11` | _TBD_ | REVOKE pair S25 |
| `<base>_012_bump_pay_existing_order_v7` | _TBD_ | discount gate + jsonb return; DROP v6 (SEC-01, POS-01) |
| `<base>_013_revoke_pair_pay_existing_order_v7` | _TBD_ | REVOKE pair S25 |
| `<base>_014_revoke_loyalty_transactions_writes` | _TBD_ | append-only ledger (SEC-04) |
| `<base>_015_bump_sign_zreport_v2` | _TBD_ | PIN validation; DROP v1 (BO-01) — or EF wrapper per D3 |
| `<base>_016_seed_orders_discount_permission` | _TBD_ | (conditional D4) |
| `<base>_017_create_customers_pos_rpcs_v2` | _TBD_ | category-pricing RPCs; DROP v1 (SEC-03) |
| `<base>_018_gate_customers_read` | _TBD_ | PII gate cutover — applied LAST |

> Applied via MCP `apply_migration` (cloud V3 dev `ikcyvlovptebroadgtvd`). Types regen after every signature change.

---

## 4. New files

- **DB + tests** : _TBD_ (migrations above + `supabase/tests/{order_discount_gate,pay_existing_discount_gate,loyalty_transactions_append_only,sign_zreport_pin,customers_pii_gate}.test.sql`).
- **Domain** : _TBD_ (`packages/domain/src/.../taxRate.ts` + test).
- **POS** : _TBD_ (possible `useVoidServerOrder.ts`).
- **POS tests** : _TBD_ (`checkout-pickup-total`, `cart-broadcast-promo`, `success-modal-loyalty`, `void-post-kitchen`).
- **BO tests** : _TBD_ (`order-detail-invalidation`).
- **CI** : _TBD_ (pgTAP smoke job in `ci.yml`).

---

## 5. Files modified

- _TBD_ — `process-payment/index.ts` (rate-limit + PIN relay), `useCheckout.ts`, `useCartBroadcast.ts`, `SuccessModal.tsx`, `BottomActionBar.tsx`, 7× TAX_RATE sites, `useSignZReport.ts`, `useOrderDetail.ts`/`useEditOrderItems.ts`/`useVoidOrder.ts`, `OrdersListPage.tsx`, `ZReportsListPage.tsx`, `OrderDetailPage.tsx`, `useCustomerSearch.ts`/`useCreateCustomer.ts`/`Pos.tsx`/`useRestoreHeldOrder.ts`/`useOutstandingDebts.ts`, `packages/supabase/src/types.generated.ts`, `.github/workflows/ci.yml`, ~57 Vitest live suites, `CLAUDE.md`.

---

## 6. Tests run

| Suite | Count | Status |
|---|---|---|
| pgTAP `order_discount_gate` | 7 | _TBD_ |
| pgTAP `pay_existing_discount_gate` | 4 | _TBD_ |
| pgTAP `loyalty_transactions_append_only` | 3 | _TBD_ |
| pgTAP `sign_zreport_pin` | 3 | _TBD_ |
| pgTAP `customers_pii_gate` | 3 | _TBD_ |
| domain `taxRate` | 1 | _TBD_ |
| POS smokes (B1-B4) | _TBD_ | _TBD_ |
| BO smokes (C1-C4) | _TBD_ | _TBD_ |
| Full sweeps domain / UI / POS / BO | _TBD_ | _TBD_ |
| `pnpm typecheck` | 6/6 | _TBD_ |

---

## 7. Permissions seeded

- _TBD_ — `orders.discount` (MANAGER+/ADMIN+/SUPER_ADMIN) if D4 = new perm; `customers.read` gate flip (perm pre-existing).

---

## 8. RPCs added / bumped

| Action | RPC | Notes |
|---|---|---|
| Bumped | `complete_order_with_payment_v10 → v11` | _TBD_ — discount gate + PIN + unit_price reconcil + audit |
| Bumped | `pay_existing_order_v6 → v7` | _TBD_ — discount gate + jsonb return |
| Bumped | `sign_zreport_v1 → v2` | _TBD_ — PIN validation (or EF wrapper) |
| Bumped | `search_customers_v1 → v2` / `get_customer_v1 → v2` / `create_customer_v1 → v2` | _TBD_ — + category pricing |
| Hardened | `loyalty_transactions` (table) | _TBD_ — REVOKE writes |

---

## 9. Deferred S38+

Per spec §9: PAT-01/02 auth BO setSession refactor (dedicated session), POS-15 split-bill, POS-16 LAN cart mirror, POS-17 course timing, F-010..013/019..024, BO-04/08/09/10/15/21, SEC-06/07 PIN lockout, TEST-05/07, print-bridge deployment, staging-deploy secrets, dynamic VAT (`useTaxRate`), allergens, NPWP receipt.

---

## 10. Deviations vs spec/plan

| ID | Section | Original | What happened | Reason | Risk |
|---|---|---|---|---|---|
| _TBD_ | | | | | |

> Anticipated: `DEV-S37-A2-01` (Medium) if `pay_existing_order_v7` discount uses permission-gate-only (no PIN) on the direct-RPC pickup path (§A3.1); `DEV-S37-C5-01` (Informational) customers PII hard cutover front-first/gate-last.

---

## 11. Acceptance criteria

- [ ] SEC-01 — discount > 0 requires authorized_by with `orders.discount` + valid PIN; audit `order.discount_applied` — pgTAP PASS.
- [ ] SEC-02 — `unit_price` reconciled vs `retail_price` — pgTAP PASS.
- [ ] SEC-04 — `loyalty_transactions` append-only — pgTAP PASS.
- [ ] DB-02 — `process-payment` rate-limited — review + happy-path PASS.
- [ ] BO-01 — Z-report signing validates PIN — pgTAP PASS.
- [ ] POS-01 — real pickup total — smoke PASS.
- [ ] POS-02 — post-promo display total — smoke PASS.
- [ ] POS-04 — real loyalty balance on receipt — smoke PASS.
- [ ] POS-06 — server-side post-kitchen void — smoke PASS.
- [ ] POS-05 — centralized tax rate — grep 0; suites PASS.
- [ ] BO-02 — query keys aligned; refetch after mutation — smoke PASS.
- [ ] BO-03/05/12 — toast / per-row PDF / back URL — smoke PASS.
- [ ] SEC-03/DB-03/DB-06 — POS wired on RPCs; `customers.read` gate applied last; PII closed — pgTAP + smoke PASS.
- [ ] TEST-02 — PR-time pgTAP gate (or blocker documented).
- [ ] TEST-01 — 57 Vitest live suites `skipIf`-guarded.
- [ ] PAT-05/06/17/18 — CLAUDE.md refreshed.
- [ ] `pnpm typecheck` full sweep PASS; types regen committed.
- [ ] INDEX filled + CLAUDE.md §Active Workplan bumped.
