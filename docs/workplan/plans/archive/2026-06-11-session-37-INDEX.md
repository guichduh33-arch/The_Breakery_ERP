# Session 37 — Fraud Hardening & Correctness Close-out — INDEX

> **Branch** : `swarm/session-37` (base `master` @ `06b8283`, post-merge S36 PR #68)
> **Spec** : [`../specs/2026-06-11-session-37-spec.md`](../../specs/archive/2026-06-11-session-37-spec.md)
> **Plan** : [`./2026-06-11-session-37-plan.md`](./2026-06-11-session-37-plan.md)
> **Status** : ✅ **executed 2026-06-11** — all four waves delivered, hard cutover PII applied (gate `_018` live), full sweeps green.

---

## 1. Summary

- **Wave A — money-flow security** : ✅ DONE — SEC-01 discount authority+PIN gate (`complete_order_with_payment_v11` + `pay_existing_order_v7` permission-only DEV-S37-A2-01), SEC-02 `unit_price` reconciliation via `get_customer_product_price` (DEV-S37-A1-02) + gift-line/promo tie (DEV-S37-A1-01), SEC-04 `loyalty_transactions` append-only, DB-02 `process-payment` rate-limit (EF v6 deployed), BO-01 `sign_zreport_v2` PIN validated in-RPC (D3).
- **Wave B — POS correctness** : ✅ DONE — POS-01 real pickup total (v7 jsonb envelope), POS-02 post-promo display total, POS-04 real loyalty balance (`loyalty_balance_after` additif v11), POS-06 server-side post-kitchen void (livré pré-run `e3cadee`), POS-05 `DEFAULT_TAX_RATE` centralisé dans `@breakery/domain` (7 sites POS migrés, grep 0).
- **Wave C — BO + PII cutover** : ✅ DONE — BO-02 query keys alignés (`['order-detail', id]`), BO-03 toast erreur OrdersListPage, BO-05 per-row PDF pending, BO-12 back URL ; **SEC-03/DB-03/DB-06 hard cutover customers** : RPCs v2 (category JSONB embed) + corrective `_019` (default category server-side) + bump `get_pos_b2b_debts_v2` (`_020`, vraie sémantique panel) + 4+1 sites POS câblés + build OK + **gate `_018` appliqué EN DERNIER** — pgTAP 7/7 PASS post-gate.
- **Wave D — tests + docs** : ✅ DONE — TEST-02 PR-time pgTAP gate (`ci.yml`), TEST-01 Vitest live suites `skipIf`-guarded, PAT-05/06/17/18 CLAUDE.md 4 stale facts corrigés (`b0f939e`).
- **No new feature; fraud-hardening + correctness close-out only.**
- **Pre-merge review** : pattern-guardian read-only sur `master...HEAD` — **14/14 patterns PASS**, 0 violation HIGH/MEDIUM, 3 notes INFO (corrective `_019` intra-session pré-publication conforme ; ACLs préservés par CREATE OR REPLACE ; lacune PIN pickup déjà trackée DEV-S37-A2-01).

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
| `20260621000019_fix_create_customer_v2_default_category` | clock-assigned | ✅ APPLIED — corrective : la v2 assigne la catégorie par défaut server-side (parité avec l'ex-`resolveDefaultCategoryId` client) + retourne l'embed peuplé (DEV-S37-C5-02) |
| `20260621000020_bump_get_pos_b2b_debts_v2` | clock-assigned | ✅ APPLIED — bump v1→v2 : vraie sémantique CustomerDebtsPanel (tous types d'ordres dû > 0, lookback 180 j, champs crédit affichés par le panel) ; DROP v1 + REVOKE pair (DEV-S37-C5-03) |
| `20260621000018_gate_customers_read` | clock-assigned (appliquée **après** `_020`) | ✅ **APPLIED EN DERNIER** — hard cutover PII : policy `auth_read` gated `customers.read` + grant MANAGER/ADMIN/SUPER_ADMIN. Front C5 câblé/buildé/committé avant (DEV-S37-C5-01) |

> Applied via MCP `apply_migration` (cloud V3 dev `ikcyvlovptebroadgtvd`). Types regen ✅ committed ×2 (v11/v7/sign_v2/customers v2, puis debts v2). EF `process-payment` v6 deployed (calls v11, forwards discounts, relays `x-manager-pin`; DB-02 rate-limit now live). NB : `_018` est appliquée chronologiquement après `_019`/`_020` (cloud versions clock-assignées) — les trois sont order-independent au replay.

---

## 4. New files

- **DB + tests** : migrations `_010.._020` (sauf `_016` skipped) + `supabase/tests/{order_discount_gate,pay_existing_discount_gate,loyalty_transactions_append_only,sign_zreport_pin,customers_pii_gate}.test.sql` (le dernier étendu à 7 tests : T3 default-category `_019`, T7 debts v2 `_020`).
- **Domain** : `packages/domain/src/orders/taxRate.ts` (`DEFAULT_TAX_RATE = 0.10`) + `__tests__/taxRate.test.ts` + barrel export.
- **POS tests** : `checkout-pickup-total`, `cart-broadcast-promo`, `success-modal-loyalty`, `void-post-kitchen` smokes (Wave B) ; `restore-customer-refetch` réécrit sur `get_customer_v2`.
- **BO tests** : `order-detail-invalidation.smoke.test.tsx`.
- **CI** : pgTAP smoke job dans `.github/workflows/ci.yml` (TEST-02).

---

## 5. Files modified

- **EF** : `process-payment/index.ts` (rate-limit DB-02 + appel v11 + relay `x-manager-pin` + forward discounts) — v6 deployed.
- **POS** : `useCheckout.ts` (v7 pickup réel + PIN relay), `useCartBroadcast.ts` (POS-02), `SuccessModal.tsx` (POS-04), `BottomActionBar.tsx` (POS-06 + tax), 7× sites `TAX_RATE` → `DEFAULT_TAX_RATE`, `managerPinHolder` (DEV-S37-A1-03) ; **C5** : `useCustomerSearch.ts` / `useCreateCustomer.ts` / `Pos.tsx` (search+create inline) / `useRestoreHeldOrder.ts` → customer RPCs v2 ; `useOutstandingDebts.ts` → `get_pos_b2b_debts_v2` (agrégation client conservée).
- **BO** : `useSignZReport.ts` (v2 PIN in-arg), `useOrderDetail.ts`/`useEditOrderItems.ts`/`useVoidOrder.ts` (BO-02), `OrdersListPage.tsx` (BO-03), `ZReportsListPage.tsx` (BO-05), `OrderDetailPage.tsx` (BO-12).
- **Infra** : `packages/supabase/src/types.generated.ts` (regen ×2), `.github/workflows/ci.yml`, Vitest live suites `skipIf`-guarded (TEST-01), `CLAUDE.md` (PAT-05/06/17/18), `pay-existing.smoke.test.tsx` (assertion v7).

---

## 6. Tests run

| Suite | Count | Status |
|---|---|---|
| pgTAP `order_discount_gate` | 10 | ✅ 10/10 PASS (cloud MCP, 2026-06-11) |
| pgTAP `pay_existing_discount_gate` | 5 | ✅ 5/5 PASS |
| pgTAP `loyalty_transactions_append_only` | 5 | ✅ 5/5 PASS (incl. sanity earn-row via v11) |
| pgTAP `sign_zreport_pin` | 6 | ✅ 6/6 PASS |
| pgTAP `customers_pii_gate` | 7 | ✅ **7/7 PASS post-gate** (avant `_018` : 6/7, T6 expected-FAIL documenté) |
| domain full sweep (incl. `taxRate`) | 57 files | ✅ PASS |
| UI full sweep | 54 files | ✅ PASS |
| POS full sweep | 102 files / 412 tests (+1 skip) | ✅ PASS (1 fix : `pay-existing` assertion v6→v7) |
| BO full sweep | 134 files (+1 skip) | ✅ PASS |
| `pnpm typecheck` | 6/6 | ✅ PASS |

---

## 7. Permissions seeded

- Aucune nouvelle permission : D4 = `sales.discount` pré-existante (S5) réutilisée ; `customers.read` pré-existante — gate flip `_018` + grant MANAGER/ADMIN/SUPER_ADMIN (UPSERT idempotent).

---

## 8. RPCs added / bumped

| Action | RPC | Notes |
|---|---|---|
| Bumped | `complete_order_with_payment_v10 → v11` | discount gate (`sales.discount` + PIN) + unit_price reconcil (`get_customer_product_price`) + audits `order.discount_applied`/`order.price_overridden` + `loyalty_balance_after` ; DROP v10 |
| Bumped | `pay_existing_order_v6 → v7` | discount gate permission-only (DEV-S37-A2-01) + jsonb envelope `{order_id, order_number, total, tax_amount, change_given}` ; DROP v6 |
| Bumped | `sign_zreport_v1 → v2` | PIN validé in-arg (D3, idiome `close_fiscal_period_v1`) ; DROP v1 |
| Bumped | `search_customers_v1 → v2` / `get_customer_v1 → v2` / `create_customer_v1 → v2` | embed `category JSONB` (1 round-trip, D6) ; corrective `_019` : default category server-side au create ; DROP v1 ×3 |
| Bumped | `get_pos_b2b_debts_v1 → v2` | vraie sémantique panel (tous types d'ordres, lookback, champs crédit) ; DROP v1 (DEV-S37-C5-03) |
| Hardened | `loyalty_transactions` (table) | REVOKE INSERT/UPDATE/DELETE FROM authenticated/anon/PUBLIC — append-only |
| Hardened | `customers` (table) | policy `auth_read` gated `has_permission(auth.uid(), 'customers.read')` — PII fermée (`_018`) |

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
| DEV-S37-C5-02 | C5 | `create_customer_v2` (_017) telle quelle | Corrective `_019` : la v2 assigne la catégorie par défaut server-side | Le front pré-cutover résolvait `customer_categories.is_default` au create (`resolveDefaultCategoryId`) ; la v2 de `_017` ne le faisait pas → un walk-in créé via RPC aurait perdu le multiplier loyalty/pricing par défaut | Informational (parité comportementale, caught au wiring) |
| DEV-S37-C5-03 | C5 | Plan : câbler `get_pos_b2b_debts_v1` tel quel | Bump `_020` v1→v2 : tous types d'ordres dû > 0 (pas seulement `order_type='b2b'`), lookback 180 j, expose `b2b_credit_limit`/`b2b_current_balance` | La prémisse v1 « the panel never displayed them » était fausse — `CustomerDebtsPanel` affiche la barre de crédit et couvre l'ardoise retail ; câbler v1 aurait régressé le panel silencieusement. Champs crédit ≠ PII (le gate vise phones/emails/birth_dates) et déjà visibles au POS pré-cutover | Informational (anti-régression) |

> Anticipated: `DEV-S37-A2-01` (Medium) if `pay_existing_order_v7` discount uses permission-gate-only (no PIN) on the direct-RPC pickup path (§A3.1); `DEV-S37-C5-01` (Informational) customers PII hard cutover front-first/gate-last.

---

## 11. Acceptance criteria

- [x] SEC-01 — discount > 0 requires authorized_by with `sales.discount` (D4) + valid PIN; audit `order.discount_applied` — pgTAP 10/10 PASS.
- [x] SEC-02 — `unit_price` reconciled vs `get_customer_product_price` (DEV-S37-A1-02) — pgTAP PASS.
- [x] SEC-04 — `loyalty_transactions` append-only — pgTAP 5/5 PASS.
- [x] DB-02 — `process-payment` rate-limited — EF v6 deployed, golden-path PASS.
- [x] BO-01 — Z-report signing validates PIN — pgTAP 6/6 PASS.
- [x] POS-01 — real pickup total (v7 jsonb) — smoke PASS.
- [x] POS-02 — post-promo display total — smoke PASS.
- [x] POS-04 — real loyalty balance on receipt — smoke PASS.
- [x] POS-06 — server-side post-kitchen void — smoke PASS (livré pré-run `e3cadee`).
- [x] POS-05 — centralized tax rate — `git grep "TAX_RATE = 0.1" apps/pos/src` → 0; suites PASS.
- [x] BO-02 — query keys aligned; refetch after mutation — smoke PASS.
- [x] BO-03/05/12 — toast / per-row PDF / back URL — smoke PASS.
- [x] SEC-03/DB-03/DB-06 — POS wired on RPCs v2 (grep direct customers reads → 0); `customers.read` gate applied LAST; PII closed — pgTAP 7/7 + smokes 32/32 PASS, BO orders 16/16 PASS post-gate.
- [x] TEST-02 — PR-time pgTAP gate in `ci.yml`.
- [x] TEST-01 — Vitest live suites `skipIf`-guarded (`c651a13`).
- [x] PAT-05/06/17/18 — CLAUDE.md refreshed (`b0f939e`).
- [x] `pnpm typecheck` 6/6 PASS; types regen committed ×2.
- [x] INDEX filled + CLAUDE.md §Active Workplan bumped.
