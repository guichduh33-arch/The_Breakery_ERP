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
| MCP Supabase authenticated? | ✅ OAuth re-auth user-side 2026-06-11 (était LE blocker — résolu en début de run DB) |
| Migration block base (max applied + 1) | NAME-block `20260621000010..018` (cloud versions clock-assignées, convention S36 ; max cloud `20260606000013`, max NAME git `20260620000017`) |
| `20260619000043` (`_043` gate) applied? | NO ✅ (confirmé via `list_migrations` — ré-authorée en `_018`, **non appliquée**, cutover front-first) |
| PIN-validation helper / idiom | `verify_user_pin(profile_id, pin)` (crypt/bf) + `has_permission(auth_uid, perm)` — idiome `close_fiscal_period_v1` ; mapping authorizer profile→auth_uid via `user_profiles.auth_user_id` |
| `current_setting('request.headers')` usable in RPC? | NON — aucun RPC du projet ne lit `request.headers` → D1 = fallback permission-only pour `pay_existing_order_v7` (DEV-S37-A2-01) |
| Existing discount permission? | **`sales.discount` existe** (seed S5) → D4 = réutilisée, pas de migration `_016` |
| `customer_categories` RLS-gated for authenticated? | SELECT = true pour authenticated ; D6 = embed `category JSONB` dans le TABLE result des v2 (1 round-trip) |
| v10/v11 jsonb envelope keys (loyalty balance present?) | v10 : non → v11 ajoute `loyalty_balance_after` (additif, POS-04) |
| POS-06 void surface (server order before checkout?) | Déjà livré pré-run (commit `e3cadee`) |
| SEC-02 prix attendu server-side | `get_customer_product_price(product_id, customer_id)` (retail/wholesale/discount_pct/custom) — PAS `retail_price` brut, sinon le pricing par catégorie client casse ; gift lines exemptées ssi `promotion_id` ∈ `p_promotions` |
| Decisions locked | D1 permission-only / D2 force-server-price+audit / D3 v2 in-arg / D4 reuse `sales.discount` / D6 embed JSONB / D7 ré-auteur `_018` (D5 tax rate = Wave B, hors de ce run) |

---

## 3. Migrations applied

| File timestamp | Cloud version | Object |
|---|---|---|
| `20260621000010_bump_complete_order_v11` | clock-assigned 2026-06-11 | ✅ APPLIED — discount gate (`sales.discount`+PIN) + unit_price reconcil via `get_customer_product_price` + gift-line/promo tie + audits `order.discount_applied`/`order.price_overridden` + `loyalty_balance_after`; DROP v10 (SEC-01/02/05) |
| `20260621000011_revoke_pair_complete_order_v11` | clock-assigned | ✅ APPLIED — REVOKE pair S25 |
| `20260621000012_bump_pay_existing_order_v7` | clock-assigned | ✅ APPLIED — discount gate permission-only (DEV-S37-A2-01) + jsonb envelope; DROP v6 (SEC-01, POS-01) |
| `20260621000013_revoke_pair_pay_existing_order_v7` | clock-assigned | ✅ APPLIED — REVOKE pair S25 |
| `20260621000014_revoke_loyalty_transactions_writes` | clock-assigned | ✅ APPLIED — append-only ledger (SEC-04) |
| `20260621000015_bump_sign_zreport_v2_pin` | clock-assigned | ✅ APPLIED — PIN in-arg validé (D3) + REVOKE pair inline; DROP v1 (BO-01) |
| ~~`_016_seed_orders_discount_permission`~~ | — | **SKIPPED** — D4 : `sales.discount` pré-existante réutilisée |
| `20260621000017_create_customers_pos_rpcs_v2` | clock-assigned | ✅ APPLIED — search/get/create_customer_v2 + `category JSONB` embed; DROP v1 (SEC-03/DB-03) |
| `20260621000018_gate_customers_read` | — | ⏸️ **AUTHORED, NOT APPLIED** — hard cutover PII : front C5 d'abord (4+1 sites POS), gate en dernier |

> Applied via MCP `apply_migration` (cloud V3 dev `ikcyvlovptebroadgtvd`). Types regen ✅ committed (v11/v7/sign_v2/customers v2). EF `process-payment` v6 deployed (calls v11, forwards discounts, relays `x-manager-pin`; DB-02 rate-limit now live).

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
| pgTAP `order_discount_gate` | 10 | ✅ 10/10 PASS (cloud MCP, 2026-06-11) |
| pgTAP `pay_existing_discount_gate` | 5 | ✅ 5/5 PASS |
| pgTAP `loyalty_transactions_append_only` | 5 | ✅ 5/5 PASS (incl. sanity earn-row via v11) |
| pgTAP `sign_zreport_pin` | 6 | ✅ 6/6 PASS |
| pgTAP `customers_pii_gate` | 6 | ✅ 5/5 + T6 gate expected-FAIL tant que `_018` non appliquée |
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
| DEV-S37-A2-01 | A2 | Discount PIN gate sur les 2 RPCs payment | `pay_existing_order_v7` gate **permission-only** (pas de PIN) sur le chemin direct-RPC pickup | Aucun RPC du projet ne lit `request.headers` ; le chemin principal EF→v11 garde le gate PIN complet ; pickup-with-discount rare | Medium (anticipée par le plan §A3.1) |
| DEV-S37-A1-01 | A1 | T7 "audited override respected" | Exemption gift resserrée : une ligne `is_promo_gift` doit référencer un `promotion_id` présent dans `p_promotions`, sinon `check_violation` | Sans ce lien, un client pouvait taguer n'importe quelle ligne en cadeau à prix 0 (contournement de la réconciliation SEC-02) | Informational (durcissement) |
| DEV-S37-A1-02 | A1 | Réconciliation vs `products.retail_price` | Prix attendu = `get_customer_product_price(product_id, customer_id)` | Le POS applique légitimement le pricing par catégorie client (wholesale/discount_pct/custom) ; forcer retail brut aurait cassé ce flux | Informational |
| DEV-S37-D4-01 | Task 0 | Seed `orders.discount` (`_016`) | Permission `sales.discount` pré-existante (S5) réutilisée ; `_016` skipped | D4 le prévoyait ("reuse if found") | Informational |
| DEV-S37-C5-01 | C5 | — | `_018` gate authored mais NON appliquée ; pgTAP T6 expected-FAIL documenté | Cutover front-first/gate-last (anticipée) | Informational |
| DEV-S37-A1-03 | A1 | Spec: PIN "collected by the discount modal" | Le POS ne retenait pas le PIN après vérif → nouveau `managerPinHolder` module-scoped (jamais persisté, hors cart broadcast), set par `useVerifyManagerPin`, lu/cleared par `useCheckout` | v11 revalide le PIN au checkout ; il faut le transporter de l'autorisation au paiement | Informational |

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
