# Session 13 — Architecture Audit (V3 monorepo vs. 25 module backlogs)

> **Date** : 2026-05-13
> **Auteur** : architect-auditor (Claude, supervised by guichduh33@gmail.com)
> **Statut** : Audit complet, prêt pour décomposition par `planner`
> **Source upstream** : researcher findings (25 modules, 5688 task lines, +108 cascade tasks, V2→V3 translation needed)
> **Référence shape** : [`./2026-05-12-session-12-inventory-complete-spec.md`](./2026-05-12-session-12-inventory-complete-spec.md)
> **Reference inventaires backlogs** : `docs/workplan/backlog-by-module/01-…25-…md`
> **Migrations existantes** : 25 modules, dernier timestamp `20260516000024`. Prochain segment **`20260517xxxxxx_*`** réservé pour session 13.
> **Scope** : audit-only — pas de plan d'exécution, pas de migrations, pas de code. Le `planner` consomme ce document.

---

## 1. Executive summary

1. **V2→V3 path translation is the #1 blocker before any task starts.** Tous les backlogs (25 fichiers, ~280 tâches) citent des chemins V2 (`src/services/...`, `src/components/...`, `src/pages/...`) qui **n'existent pas** dans le monorepo. Phase 0 doit produire une **table de correspondance officielle** V2 → V3 (`apps/{pos,backoffice}/src/features/...`, `packages/{domain,supabase,ui,utils}/src/...`, `supabase/functions/...`, `supabase/migrations/...`). Sans cela, chaque sous-agent ré-inventera son mapping et la cohérence inter-modules sera perdue.
2. **Accounting (module 10) est la fondation de toute la session.** 5 tâches P0 cassent silencieusement la chaîne JE (sale trigger codes `1110/4100/2110` hardcodés inexistants au COA seedé, `reference_type` CHECK trop court, mapping `SALE_REVENUE` non-seedé, `PRODUCTION_COGS` mappé sur compte non-postable, `calculate_vat_payable` sur codes obsolètes). **Aucune autre fonctionnalité comptable ne peut être considérée fiable tant que 10-001 → 10-007 ne sont pas livrés.** Production (15), Expenses (11), Shift-close JE (12-007), Purchase JE (07) en dépendent.
3. **`reference_type` CHECK constraint sur `journal_entries` est un goulot critique** (tâche 10-004). Elle gate **au moins 4 RPCs** (production, purchase_return, pos_outstanding, pos_outstanding_payment) qui sont conditions de Phase 2 et 3. Doit être livrée **dans la première migration de Phase 1**.
4. **RPC versioning : aucun `_vN` existant à incrémenter en Session 13 strictement**. `complete_order_with_payment` est en `v8`, `pay_existing_order` en `v5`, `record_stock_movement_v1` est en `v4` interne (4 surcharges dans `20260516000019/23/24` mais signature stable). Cependant **les futures tâches 10-001 + 12-007 vont devoir publier `complete_order_with_payment_v9`** (sale JE refactor) et **07-001 vont devoir publier `record_purchase_journal_entry_v2`** (mapping unifié). Le sequencing doit éviter qu'une phase édite `vN` au lieu de publier `vN+1`.
5. **Inventory F1 (expiry tracking, 06-001/06-002) est un XL refactor** qui touche `stock_movements` (table append-only RLS-protégée, RPC-only writes, `unit` NOT NULL). Toute écriture doit **passer par `record_stock_movement_v1`** (déjà en v4, signature stable). F1 introduit `stock_lots` + trigger FIFO + lien `stock_movements.lot_id` — risque réel de violer l'invariant ledger si le trigger FIFO écrit directement.
6. **`stock_movements` movement_type enum est déjà étendu** (`20260516000014`) avec `transfer_in/out`, `production_in/out`, `adjustment_in/out`, `opname_in/out`, `incoming`, `purchase_return`, `reservation_hold/release`. **Aucun nouvel ajout requis pour Phase 1**. F1 (expiry) peut réutiliser `waste` (pour expiration). Production (15) réutilise `production_in/out`.
7. **Notifications pipeline (08-006) est un XL qui gate 6+ tâches** (segments 13, opt-in clients 02-024, push 13-009, tablet notifications 17-010, expense alerts 11-007, B2B 09-010). **Décision provider doit être faite en Phase 0** (Twilio vs. Sendgrid vs. on-prem SMTP vs. Supabase Functions HTTP). Sans cela, plus de 8 modules sont bloqués en aval.
8. **RLS anon→authenticated migration (25-001) menace KDS, Display, Tablet.** KDS, Customer Display et Tablet sont actuellement anon-readable. La tâche restreint `orders/order_items/customers/customer_categories/user_roles` à `authenticated`. **Doit être livrée APRÈS staging (24-008)** sinon production POS plante.
9. **`packages/ui` est un point de contention multi-modules** (17 tablet, 22 design system, 04 KDS, 02 POS, 16 display). 22-006 migre 72+ modals — superposition garantie avec 17-008/009/010 et 16-001/002. **Single owner mandatoire** : un steward `packages/ui` qui sérialise les PRs.
10. **LAN (21) est la décision archi structurelle la plus importante.** Pas de code V3 (le V2 monolith utilisait BroadcastChannel + Supabase Realtime hybride). Trois options : (a) port complet V2 ; (b) Supabase Realtime only ; (c) WebRTC mesh. Cette décision impacte 04 (KDS), 16 (Display), 17 (Tablet), 18 (Mobile). **À trancher en Phase 0** avec note explicite : la consolidation Realtime only impose une refonte du dedup (21-001) et des handlers (21-002/003) déjà spécifiés pour V2.
11. **Realtime channel naming convention** est déjà documentée dans CLAUDE.md ("must be unique per mount due to StrictMode double-mount"). Cible exemplaire : `apps/pos/src/features/kds/hooks/useKdsRealtime.ts`. **Toute feature avec realtime (cart sync 02, KDS 04, transfers 06, display 16, tablet 17) doit reproduire ce pattern**. Risque haut sur 04-009 (realtime sync KDS) et 16-001 (display sync).
12. **Types regen burden ≈ 10-15 cycles** sur Session 13 si on planifie 7 phases. Chaque migration en Phase 1 (10-001/002/004/005/006/007 + 06-001 + 25-001/003) déclenche un `pnpm db:reset && pnpm db:types` obligatoire. **CI doit échouer si `types.generated.ts` est out-of-sync** (cible 23-001 ou 23-008).

**Sequencing verdict**: 7 phases, Phase 0 strictly decisions/foundations, Phase 1 strictly sequential on the accounting hotfix stream + parallelizable Inventory F1 + Security P1 + Design P1. Phases 2-6 progressively parallelizable. Phase 7 (multi-store/multi-currency/B2B portal) deferred to Q3+.

---

## 2. Per-module audit (25 modules)

> Convention : **Existing V3** = real code path. **Missing** = backlog target with no V3 equivalent. **Phantom V2** = backlog references a V2 file that does not map to anything in V3.

### Module 01 — Auth & Permissions

- **Scope**: PIN-based auth (HS256 JWT via `auth-verify-pin` EF), permissions via `has_permission()` SQL helper.
- **V3 state**: 4 EFs in `supabase/functions/auth-*`, custom fetch wrapper `setSupabaseAccessToken` in `packages/supabase/src/auth/`, SQL helpers in `supabase/migrations/20260503000006_init_helpers.sql` (recreated and extended in 20260507000001, 20260508000002, 20260511000006, 20260512000007, 20260513000004, 20260514000003, 20260516000004, 20260516000018).
- **Gap vs backlog (10 tasks)**: 2FA (TOTP), rate limiting (overlap with 25-002), granular per-route permissions, session telemetry, refresh token rotation, PIN expiry policy. All net-new.
- **Risks**:
  - Rate-limit overlap with `25-002` → **must be a single shared `_shared/rate-limit.ts` helper**, not duplicated.
  - `has_permission()` has been re-CREATE-OR-REPLACE'd 9 times across migrations (each module re-publishes it). **Pattern is fragile** : adding new perms in Session 13 requires the same dance. Consider Phase 0 decision : extract `has_permission` to a stand-alone migration with idempotent re-seed of perms, rather than re-publishing the function each time.
- **Hard deps**: 25 (security), 24 (staging needed for live PIN tests), 23 (CI).

### Module 02 — POS / Cart / Orders

- **Scope**: cart store, order submission, complete_order pipeline.
- **V3 state**: `apps/pos/src/features/cart/`, `apps/pos/src/features/order-history/`, `apps/pos/src/features/payment/`. `complete_order_with_payment` is at v8 (`20260512000006`).
- **Gap (27 tasks + 17 cascade)**: cartStore offline mode, pre-auth, table reservation, voice ordering, multi-currency, table-view, item-level discount UI, kitchen routing UX, partial cancellation. Many UX-driven.
- **Risks**:
  - `complete_order_with_payment` v9 publication required for sale JE refactor (driven by 10-001). **Cart layer must not have outstanding v8-dependent code paths** when v9 lands. Plan : 10-001 publishes v9, 02 tasks consume v9.
  - Pre-auth (02-005) impacts `stock_movements` via reservation_hold/release (enum already extended). RPC `reservation_hold_v1` net-new.
  - Multi-currency cascade — 7 dependent tasks; defer to Phase 7.
- **Hard deps**: 10 (sale JE), 13 (promotions), 08 (customer / loyalty hook), 06 (stock reservation), 21 (LAN sync if offline).

### Module 03 — Payments (Split)

- **Scope**: split payments, QRIS, gateway integration, idempotency.
- **V3 state**: `apps/pos/src/features/payment/`, EF `supabase/functions/process-payment/`. `pay_existing_order` is at v5 (`20260513000003`).
- **Gap (7 tasks)**: QRIS provider integration, gateway adapter pattern, idempotency keys on order payments table, refund flow consolidation.
- **Risks**:
  - QRIS provider is a Phase 0 decision (no provider chosen).
  - Refund flow already has `refund_order_rpc` (`20260512000010`) and `fn_create_je_for_refund` (`20260512000005`). Backlog 03-005 (refund) overlaps with module's refunds feature (`apps/pos/src/features/payment/` + refunds tables). Reconcile.
- **Hard deps**: 10 (refund JE already wired but trigger should be audited post 10-001).

### Module 04 — KDS / Kitchen

- **Scope**: KDS station ordering, item lifecycle, realtime sync.
- **V3 state**: `apps/pos/src/features/kds/`, RPC `send_items_to_kitchen` (`20260505000004`), `mark_item_served` (`20260506000004`).
- **Gap (17 tasks)**: station routing, recall, bumping, prep timer, undo, expediter view, voice alerts. Hub orchestration (depends on 21).
- **Risks**:
  - Realtime channel uniqueness already in place (`useKdsRealtime.ts`). Any new realtime hook must follow same pattern.
  - 04-009 (realtime sync) + 21-002 (KDS_ITEM_READY handler) are coupled. Plan 21 decision (LAN architecture) before 04-009.
  - RLS anon→authenticated (25-001) breaks current KDS if KDS station has no session. Phase 0 must validate KDS auth model (does staff PIN extend to KDS station, or is there a kiosk PIN ?).
- **Hard deps**: 21 (LAN), 25 (RLS), 22 (design).

### Module 05 — Products & Categories

- **Scope**: products, categories, modifiers, combos.
- **V3 state**: `apps/backoffice/src/features/products/`, modifiers tables (`20260505000001`), combos (`20260509000005`), customer-category prices (`20260509000003`).
- **Gap (8 tasks)**: variants UI, image upload, bulk import/export, recipes UI (F6 sub-recipes XL — dual-claim with 15-001).
- **Risks**:
  - **F6 sub-recipes dual-claim with 15-001** : 05 mentions recipes; 15 (Production) defines `recipes(product_id, material_id, quantity, unit, is_active)` per Session 12 spec C12. **Must reconcile to ONE canonical table in Phase 0**. Recommend treating "recipes" as a production-module table referenced by products module (read-only).
- **Hard deps**: 15 (recipes), 06 (stock raw materials), 22 (UI).

### Module 06 — Inventory & Stock

- **Scope**: stock movements, transfers, opname, production stock.
- **V3 state**: **SESSION 12 PHASES 1-3 SHIPPED.** `stock_movements` append-only ledger (RLS, RPC-only), `record_stock_movement_v1` (4 versions converged to current `20260516000024`), `adjust/receive/waste/incoming_v1`, `internal_transfers` + `transfer_items` (`20260516000022`), `record_internal_transfer_v1 / receive_internal_transfer_v1 / cancel_internal_transfer_v1` (`20260516000023`), section_stock (`20260516000017`), unit conversions (`20260516000013`), movement_type enum extended (`20260516000014`).
- **Gap (10 remaining tasks)**:
  - 06-001 **F1 expiry tracking (XL)** — net-new `stock_lots` table + FIFO trigger.
  - 06-002 expiry alerts (L) — depends 06-001.
  - 06-003 phantom `stock_reservations` decision (existing V2 service references but no V3 use; decision pending).
  - 06-004 phantom `stock_balances` decision.
  - 06-005 ghost stock report.
  - 06-006 opname workflow tightening (Phases 5-8 of session 12 are about opname/production — partially landed in phase 3).
- **Risks**:
  - F1 must not bypass `record_stock_movement_v1`. The FIFO trigger should call the RPC, not insert directly. Direct insert violates the ledger invariant in CLAUDE.md ("Never `INSERT INTO stock_movements` directly").
  - `stock_movements.unit` NOT NULL (per `20260516000019`) — F1 lots will reuse `products.unit`.
  - Phantom-tables decisions (06-003, 06-004) must be made before any consumer (B2B 09-004 reservation, reports 14-007 stock variance) touches them.
- **Hard deps**: 10 (waste JE, production JE — already C10 of session 12 spec but enforcement remains).

### Module 07 — Purchasing / Suppliers / PO

- **Scope**: purchase orders, supplier management, PO receive → inventory increment.
- **V3 state**: `apps/backoffice/src/features/suppliers/` (skeleton), `suppliers` table (`20260513000001`), `stock_movements.supplier_id` link (`20260516000002`).
- **Gap (14 tasks)**: **Entire PO workflow net-new V3**. Tables `purchase_orders`, `purchase_order_items`, `goods_receipt_notes`, RPCs `create_purchase_order_v1`, `receive_purchase_order_v1`. Invoice template + generate-invoice EF (shared with 09).
- **Risks**:
  - `create_purchase_journal_entry` trigger is currently broken (uses obsolete codes per 10-006). **07-001 must wait for 10-006** (purchase JE unified through `resolve_mapping_account`).
  - Shared invoice template / EF with 09 (B2B). Single source of truth.
  - `record_stock_movement_v1` consumes `purchase` movement_type; receiver RPC must pass `unit` correctly (NOT NULL).
- **Hard deps**: 10-006 (purchase trigger), 06 (stock_movements), 25 (RLS for supplier PII).

### Module 08 — Customers / Loyalty

- **Scope**: customer CRUD, loyalty points, tiers, notifications.
- **V3 state**: `apps/pos/src/features/customers/`, `customers` table (`20260505010001`), `loyalty_transactions` (`20260505010002`), `customer_categories` (`20260509000001`), `adjust_loyalty_points` RPC (`20260514000002`, hardened `20260515000004`), `soft_delete_customer` RPC (`20260514000004`, hardened `20260515000003`).
- **Gap (12 tasks)**: customer segments, notifications pipeline (08-006 XL), birthday triggers, B2B fields, customer invoices (phantom).
- **Risks**:
  - **Notifications pipeline (08-006) is the most-blocking XL of the session**. Gates 13-segments, 02-024 opt-in, 13-009 push, 17-010 tablet notifications, 11-007, 14-???, 18-???. Provider decision Phase 0.
  - Phantom `customer_invoices` table referenced in backlog — decision required.
  - Soft-delete + audit (25 P1) overlap — single audit_log table (`20260515000002`).
- **Hard deps**: 09 (B2B fields), 13 (segments), 25 (RLS on customers).

### Module 09 — B2B / Wholesale

- **Scope**: B2B portal, wholesale pricing, credit terms, invoice generation.
- **V3 state**: **None.** No code, no migration.
- **Gap (17 tasks)**: B2B customer fields (overlap with 08), B2B price tiers (overlap with `customer_categories` + `product_category_prices`), credit limits, payment terms (Net 30), B2B portal (XL), B2B order workflow.
- **Risks**:
  - Reuses `customer_categories` and `product_category_prices` (already in V3 since `20260509000001/003`). **Confirm no schema rework needed** — only seed new tier and policies.
  - B2B portal is XL — defer to Phase 7 alongside 19-008 multi-tenancy.
  - Stock reservation (09-004) depends on 06-003 phantom-decision.
- **Hard deps**: 06-003 (reservations), 08 (customers), 07 (invoice template), 10 (B2B JE via mapping).

### Module 10 — Accounting (Double-Entry)

- **Scope**: COA, journal entries, fiscal periods, VAT, balance sheet.
- **V3 state**: `accounts`, `journal_entries`, `journal_entry_lines` tables (`20260503000009`), `create_sale_journal_entry` trigger (`20260503000010`), `fn_create_je_for_refund` (`20260512000005`).
- **Gap (22 tasks)**: **5 P0 (sale trigger codes, dead stock trigger, SALE_REVENUE mapping, reference_type CHECK, vat_payable codes)** + 6 P1 + 5 P2 + 5 P3. Multi-currency (P3) cascades 7 tasks.
- **Risks**:
  - **P0 stream is the critical path of Session 13.** 10-001 → 10-007 strictly sequential (each tracks `resolve_mapping_account()` pattern, `next_journal_entry_number()`, fiscal_period guard, idempotency).
  - Trigger refactor of `create_sale_journal_entry` is invasive — touches every order. Must run under staging (24-008) before any prod release.
  - `accounting_mappings` table referenced extensively in backlog but **must verify it exists in V3**. If not, Phase 1 must initialise it before P0 tasks.
  - Backlog mentions `IMPLEMENTATION_PLAN.md` Phase 1 — that doc is V2-era; treat as guidance only.
- **Hard deps**: none upstream (this IS the upstream). Downstream : 06, 07, 11, 12, 15 all depend.

### Module 11 — Expenses

- **Scope**: expense recording, approval workflow, JE auto.
- **V3 state**: **None.** No tables, no RPCs, no UI.
- **Gap (11 tasks)**: `expenses` table, expense categories, approval workflow, JE auto on approval, supplier link, receipt upload, expense alerts.
- **Risks**:
  - 11-001 depends 10-004 (`reference_type` CHECK must accept `expense`) and 10-006 (mapping pattern). Strictly downstream of 10.
  - Receipt upload requires Supabase Storage bucket setup (no existing bucket for receipts).
- **Hard deps**: 10, 25 (RLS).

### Module 12 — Cash Register / Shift

- **Scope**: shift open/close, cash count, variance, JE on close.
- **V3 state**: `apps/pos/src/features/shift/`. `pos_sessions` table (`20260503000003`).
- **Gap (12 tasks)**: shift close UI hardening, cash count modal, variance escalation, JE auto on close (12-007), multi-drawer.
- **Risks**:
  - 12-007 depends 10-004 (`reference_type` accepts `shift_close`).
  - Existing `pos_sessions` schema may need columns for cash_in/cash_out/expected_total; verify before planning.
- **Hard deps**: 10-004 (CHECK), 25 (audit_log on close).

### Module 13 — Promotions / Discounts

- **Scope**: single-product promo, BOGO, threshold, bundle, scheduling.
- **V3 state**: `apps/pos/src/features/promotions/`, `apps/backoffice/src/features/promotions/`, `promotions` table (`20260511000001`), `promotion_applications` (`20260511000002`), `discount_templates` (`20260513000002`), `evaluate_promotions` RPC.
- **Gap (12 tasks)**: BOGO/threshold/bundle engine extension, segments (depends 08-006), scheduling UI, abandoned-cart promo.
- **Risks**:
  - `evaluate_promotions` is the engine; must extend cleanly without breaking single-product path. Likely RPC `evaluate_promotions_v2`.
  - Segments depend 08-006 notifications + segmentation infra.
- **Hard deps**: 08 (segments), 02 (cart integration).

### Module 14 — Reports & Analytics

- **Scope**: sales reports, stock reports, financial reports, custom dashboards.
- **V3 state**: **None.** No report tables, no materialised views, no UI.
- **Gap (20 tasks)**: P&L, BS, cash flow, sales by hour/category/staff, stock variance, customer cohort, promotion ROI. Heavy dependency.
- **Risks**:
  - Materialised views vs. live RPC trade-off — Phase 0 decision required.
  - Heavy upstream dependencies : 04-009 (KDS data), 09-010 (B2B orders), 08-009 (customer cohort), 13-006 (promo ROI), 06-001 (stock with expiry).
  - 22 (design) gates dashboard layout.
- **Hard deps**: nearly everything upstream.

### Module 15 — Production / Recipes

- **Scope**: BOM, production records, deduct ingredients, COGS production.
- **V3 state**: **None.** Recipes tables not yet created (planned in Session 12 Phase 6 but not landed).
- **Gap (12 tasks)**: `recipes`, `production_records`, `record_production_v1` RPC, sub-recipes (F6 dual-claim 05-001), production suggestions.
- **Risks**:
  - **F6 sub-recipes dual-claim 05 vs 15** — reconcile in Phase 0. Recommend: canonical table owned by 15 ; products module reads.
  - `production_in`/`production_out` movement types already in enum (since `20260516000014`).
  - `PRODUCTION_COGS` mapping must point to postable account (gated by 10-007).
  - Recursion semi-finished out-of-scope (Session 12 C12 doc).
- **Hard deps**: 10-007 (mapping), 06 (stock_movements), 05 (products integration).

### Module 16 — Customer Display

- **Scope**: customer-facing display screen (order status, totals).
- **V3 state**: **None.** No code, no route.
- **Gap (13 tasks)**: display app/route, realtime order updates, queue ticker, branded layout, dual-screen support.
- **Risks**:
  - RLS anon→authenticated (25-001) breaks display if no session. Solution : kiosk-mode service account JWT, or keep anon SELECT on a narrow `display_view`.
  - Depends 21 (LAN sync) for queue ticker.
  - Realtime channel naming must follow `useKdsRealtime.ts` pattern.
- **Hard deps**: 21, 25, 22.

### Module 17 — Tablet Ordering

- **Scope**: customer-facing tablet (table-side ordering), offline mode.
- **V3 state**: `apps/pos/src/features/tablet/`, RPCs `create_tablet_order` (`20260507000003`), `pickup_tablet_order` (`20260507000004`), `cancel_tablet_order` (`20260507000006`).
- **Gap (14 tasks)**: offline mode (XL), menu sync, payment-on-tablet flow, kitchen routing on submit, push notifications.
- **Risks**:
  - **`packages/ui` factoring contention** : 17-008/009/010 vs. 22-006 (72+ modals migration) vs. 22-002 reshape. Single steward mandatory.
  - Offline mode (XL) — IndexedDB sync, conflict resolution. Defer to Phase 5+.
- **Hard deps**: 22 (design system), 21 (LAN for sync), 02 (cart).

### Module 18 — Mobile Shell

- **Scope**: mobile-friendly POS or admin shell.
- **V3 state**: **None.** No `apps/mobile`.
- **Gap (10 tasks)**: native-feel routes, push notifications, capacitor wrapper or PWA, mobile-only admin pages.
- **Risks**:
  - Capacitor vs. PWA — Phase 0 decision (or defer to Phase 7).
  - Notifications (08-006) gate push.
- **Hard deps**: 22, 08-006, 21.

### Module 19 — Settings / Configuration

- **Scope**: settings CRUD, multi-tenancy, holidays, email templates, receipts.
- **V3 state**: `business_config` table (`20260503000005`), `order_sequences` (`20260503000005`), `audit_logs` (legacy `20260503000005`) / new `audit_log` (`20260515000002`).
- **Gap (14 tasks)**: settings UI, holidays table, email/receipt template tables, multi-tenancy infra (19-008), V2 phantom `get_settings_by_category` RPC.
- **Risks**:
  - **19-008 multi-tenancy blocks 21-011, 10-020, 08-011.** Strictly Phase 7.
  - `audit_logs` (legacy) vs `audit_log` (new singular) — table naming duplication; choose canonical.
- **Hard deps**: 22 (UI), 25 (audit).

### Module 20 — Users / RBAC

- **Scope**: users CRUD, role management, permission UI.
- **V3 state**: `roles`, `permissions`, `user_profiles`, `user_sessions` (`20260503000001`).
- **Gap (16 tasks)**: roles CRUD UI, permission matrix, role templates, 2FA pairing (with 01), audit on role change (20-007 with 25-001).
- **Risks**:
  - `has_permission()` recreation pattern (see Module 01) — same fragility.
  - 20-007 audit-on-role-change pairs with 25-001 (RLS PII) — single audit_log.
- **Hard deps**: 01, 25.

### Module 21 — LAN Architecture

- **Scope**: hub/client model, message bus, discovery, print queue.
- **V3 state**: **None.** V2 monolith had `src/services/lan/*` (lanHub, lanClient, lanHubMessageHandler) — not yet ported.
- **Gap (11 tasks)**: dual-channel dedup (21-001), KDS handlers (21-002), print result targeting (21-003), print queue (21-004), hub failover (21-005), discovery UX, browser-probe detection.
- **Risks**:
  - **MAJOR ARCH DECISION**: port V2 BroadcastChannel+Realtime hybrid vs. consolidate Supabase Realtime only vs. WebRTC mesh. **Phase 0 decision.**
  - All LAN tasks downstream of decision. If Realtime-only, dedup (21-001) and dual-channel handlers become moot; tasks rewrite.
  - Print queue (21-004) needs new `print_queue` table + RLS.
- **Hard deps**: none upstream (foundation). Downstream: 04, 16, 17, 18.

### Module 22 — Design System

- **Scope**: design tokens, primitives, component library.
- **V3 state**: `packages/ui/src/components/`, `primitives/`, `tokens/`, `lib/`. No formal token system yet.
- **Gap (13 tasks)**: token JSON (colors, spacing, typography), theme provider, dark mode, motion tokens, 72+ modals migration (22-006).
- **Risks**:
  - **Single steward for `packages/ui` mandatory** (contention with 17, 04, 02, 16).
  - 22-006 migration is large; batch into Phase 1, 2, 3 windows.
  - Tokens must align with `tailwind.config` or whatever utility framework is in use; verify Phase 0.
- **Hard deps**: none. Foundation.

### Module 23 — Tests

- **Scope**: pgTAP, Vitest live RPC, domain unit, BO smoke, E2E (missing).
- **V3 state**: pgTAP suite (`supabase/tests/inventory*.test.sql`), Vitest functions tests, domain unit (`packages/domain/src/inventory/__tests__/`). **No E2E (Playwright), no CI workflow.**
- **Gap (11 tasks)**: Playwright E2E, CI workflow on PR, test coverage thresholds, perf benchmarks, regression suite.
- **Risks**:
  - CI workflow setup (23-001/23-008) gates safe parallel work in Phase 1+. **Phase 0 enabler.**
  - Test pyramid per phase: pgTAP DB → Vitest RPC → domain unit → BO smoke. After every migration: `pnpm db:reset && pnpm db:types && pnpm typecheck`.
- **Hard deps**: 24 (CI infra).

### Module 24 — Deployment / Ops

- **Scope**: CI/CD, staging, DR, monitoring, Sentry, observability.
- **V3 state**: **None.** No `.github/workflows/`, no staging Supabase project (besides `ikcyvlovptebroadgtvd` per MEMORY.md).
- **Gap (11 tasks)**: staging env (24-008 critical), CI workflow, deploy script, DR runbook, Sentry, cold-start optimisation EF.
- **Risks**:
  - **24-008 staging is a P1 enabler.** Required for 25-001 RLS migration to be tested safely, for 10-001 sale trigger refactor, and for 03-001 payment idempotency tests.
  - Sentry + EF cold-start (24-006) double-change risk; sequence carefully.
- **Hard deps**: none. Foundation.

### Module 25 — Security

- **Scope**: RLS, rate limiting, audit, dependency audit, CSP/HSTS, secrets.
- **V3 state**: RLS partially applied (inventory tables fully locked since `20260516000003`), audit_log new (`20260515000002`), `harden_*` migrations on customers, soft_delete, adjust_loyalty.
- **Gap (17 tasks)**: anon→authenticated PII (25-001), rate limit (25-002, overlap 01), no client fallback PIN (25-003), error leakage redaction (25-004), CSP, SRI, dep audit, secrets rotation policy.
- **Risks**:
  - 25-001 staging-first (24-008) requirement.
  - 25-002 share helper with 01.
  - 25-003 risk: if Edge Function down = POS down; must couple with 24-006 cold-start opt + uptime monitoring.
- **Hard deps**: 24 (staging), 01 (auth pairing).

---

## 3. Cross-cutting concerns

### 3.1 Auth / RLS impact across modules

- **`has_permission()` recreation pattern**: 9 migrations have re-CREATE-OR-REPLACE-d this function. Every Session 13 module that adds a permission (10, 11, 12, 13, 14, 15, 19, 20, 25) will need to do the same dance. **Recommendation**: in Phase 0, refactor `has_permission()` to read permissions from a lookup, then never touch the function again — add perms via INSERTs only.
- **RLS PII tables** (25-001): orders, order_items, customers, customer_categories, user_roles. Affects KDS, Display, Tablet. **Staging-first.**
- **Permission seeds for Session 13**: estimate 25-40 new perms across 10, 11, 12, 14, 15, 19, 20.

### 3.2 RPC versioning collisions

Current published versions:

| RPC | Current version | Migration timestamp | Session 13 expected bump |
|-----|----------------|--------------------|--------------------------|
| `complete_order_with_payment` | v8 | `20260512000006` | v9 (after 10-001 sale JE refactor) |
| `pay_existing_order` | v5 | `20260513000003` | v6 (if any payment refactor in 03 stream) |
| `record_stock_movement_v1` | v4 (internal, signature stable) | `20260516000024` | none — stays v1 (extend behaviour only) |
| `adjust_stock_v1` | v1 | `20260516000011` | none |
| `receive_stock_v1` | v1 | `20260516000008` | none unless 07 changes signature |
| `waste_stock_v1` | v1 | `20260516000009` | none |
| `record_incoming_stock_v1` | v1 | `20260516000021` | none |
| `get_stock_levels_v1` | v1 | `20260516000010` | possibly v2 (F1 expiry adds lot info) |
| `create_internal_transfer_v1` | v1 | `20260516000023` | none |
| `receive_internal_transfer_v1` | v1 | `20260516000023` | none |
| `cancel_internal_transfer_v1` | v1 | `20260516000023` | none |
| `adjust_loyalty_points` | unversioned, hardened | `20260515000004` | none |
| `soft_delete_customer` | unversioned, hardened | `20260515000003` | none |
| `cancel_order_item_rpc` | unversioned | `20260512000008` | none |
| `void_order_rpc` | unversioned | `20260512000009` | none |
| `refund_order_rpc` | unversioned | `20260512000010` | possibly bump for new refund JE pattern |
| `evaluate_promotions` | unversioned (assumed) | — | v2 (BOGO/threshold engine) |
| `next_journal_entry_number` | unversioned | — | none |
| `resolve_mapping_account` | unversioned (referenced) | unverified | **VERIFY EXISTS in V3** in Phase 0 |
| `create_sale_journal_entry` (trigger fn) | drop+create per migration | `20260503000010` (last) | drop+recreate via 10-001 |
| `create_purchase_journal_entry` (trigger fn) | drop+create | unknown V3 status | drop+recreate via 10-006 |
| `create_stock_movement_journal_entry` (trigger fn) | broken (Mary P0-2) | unknown V3 status | drop entirely via 10-002 |

**Verdict**: only `complete_order_with_payment` and `pay_existing_order` need a true monotonic version bump. Triggers can be DROP+CREATE OR REPLACE per migration (acceptable pattern since they have no application-side callers).

**Hard rule** (per CLAUDE.md): "never edit a published `_vN` signature. Create `_vN+1` and `DROP FUNCTION ... vN(<old args>)` in the same migration if replacing." Apply this to RPC functions only; triggers are exempt because they have no exposed signature.

### 3.3 Schema additions (new tables)

Estimated new tables Session 13 (not exhaustive — driven by P0/P1 tasks):

| Module | Table | Source task | Priority |
|--------|-------|-------------|----------|
| 06 | `stock_lots` | 06-001 | P0 |
| 06 | `stock_reservations` (if decision = create) | 06-003 | TBD |
| 07 | `purchase_orders`, `purchase_order_items`, `goods_receipt_notes` | 07-001/002/003 | P1 |
| 10 | `accounting_mappings` (verify) | 10-001 dep | P0 |
| 10 | `fiscal_periods` (verify) | 10-001 dep | P0 |
| 11 | `expenses`, `expense_categories` | 11-001/002 | P1 |
| 13 | `promotion_segments` | 13 cascade | P2 |
| 14 | materialised views (`mv_sales_daily`, `mv_stock_variance`, `mv_pl_monthly`) | 14 cascade | P2 |
| 15 | `recipes` (or `recipes_v3`), `production_records`, `recipe_ingredients` (if denormalised) | 15-001/002 | P1 |
| 16 | `display_screens` (optional) | 16 | P2 |
| 19 | `holidays`, `email_templates`, `receipt_templates`, `notification_templates` | 19 cascade | P2 |
| 19 | `tenants` (multi-tenancy infra) | 19-008 | P7 |
| 21 | `print_queue` | 21-004 | P2 |
| 21 | `lan_devices` (if not exists) | 21 cascade | P2 |
| 25 | `edge_function_rate_limits` | 25-002 | P1 |

**Migration count estimate**: ~40-60 net-new migrations across the session if all 25 modules touched. Phase 1 alone: ~12-15 migrations.

### 3.4 `stock_movements` ledger pressure

- **Movement types**: all needed types already in enum (`20260516000014`). No new ALTER TYPE needed for Session 13.
- **New consumers**:
  - F1 expiry (06-001) → uses `waste` for expired lots.
  - Expenses (11) → no stock_movements impact.
  - Production (15) → uses `production_in`/`production_out` (already in enum).
  - PO receive (07) → uses `purchase` and `purchase_return` (already in enum).
- **Section constraint** (`20260516000020`): movement-type-aware. F1 lots inherit section_id from underlying movement; no schema change needed.
- **Risk**: F1 FIFO trigger MUST call `record_stock_movement_v1` (not insert directly). Direct insert breaks `unit` NOT NULL guarantee and bypasses idempotency.
- **Lot tracking column**: if 06-001 lands, `stock_movements` likely needs `lot_id UUID NULL` (nullable for non-perishable). One ALTER TABLE.

### 3.5 Types regen burden

`pnpm db:reset && pnpm db:types` is required after **every** migration. Session 13 estimate:

- Phase 1: 10-15 migrations → 10-15 regen cycles (or 1 batched at end of phase, if no inter-migration dependencies in the same phase).
- Phases 2-6: similar density.
- Total session: **15-25 regen cycles**.

**Recommendation**: CI must fail on out-of-sync `types.generated.ts` (already noted in CLAUDE.md as the #1 broken-CI cause). Add this check to 23-001 or 23-008.

### 3.6 Realtime channel name uniqueness

CLAUDE.md mandate: "Realtime channel names must be unique per mount". Reference implementation: `apps/pos/src/features/kds/hooks/useKdsRealtime.ts`. Modules adding realtime:

- **02 (cart sync)** — pattern : `cart-${session.id}-${random}` or similar.
- **04 (KDS — already done)** — reference pattern.
- **06 (transfers realtime)** — currently not in V3; if added, `transfer-${id}-${mountId}`.
- **16 (display)** — `display-${screenId}-${mountId}`.
- **17 (tablet)** — `tablet-${tableId}-${mountId}`.
- **21 (LAN messages)** — `lan-${deviceId}-${mountId}`.

**Risk**: 4-5 new realtime channel families. Each must follow the pattern. Audit per phase.

### 3.7 `packages/domain` (IO-free) — pure logic additions

`packages/domain/src/` currently has: cart, combos, customerCategories, customers, discounts, heldOrders, inventory, kitchen, loyalty, modifiers, orders, payment, promotions, refunds, tables, tablet, types. Additions expected:

- `packages/domain/src/accounting/` — JE composition logic (pure compose, no IO).
- `packages/domain/src/expenses/` — expense validation.
- `packages/domain/src/production/` — recipe expansion, BOM resolution.
- `packages/domain/src/reports/` — aggregations on data structures (passed by caller).
- `packages/domain/src/notifications/` — message template composition.
- `packages/domain/src/lan/` — message dedup, protocol parsing.
- `packages/domain/src/inventory/expiry/` — FIFO selection, expiry classification.

All must be IO-free (no `fetch`, no Supabase, no React).

---

## 4. Risk matrix (top 10)

| ID | Description | Impact | Likelihood | Mitigation |
|----|-------------|--------|------------|------------|
| R1 | V2→V3 path translation across 25 backlogs is unspecified; each subagent may invent its own mapping | L | L | Phase 0 produces canonical translation table; reference in every plan |
| R2 | Accounting P0 stream (10-001..007) blocks Phase 2/3/4/5; any slip ripples everywhere | L | M | Strictly sequential, single subagent, staging-validated, no parallelism within stream |
| R3 | `reference_type` CHECK (10-004) breaks 4 RPCs (production/purchase_return/pos_outstanding × 2); production migrations may have already-broken JEs | L | M | 10-004 first migration of Phase 1; document existing-data retrofix plan separately |
| R4 | RLS anon→authenticated (25-001) breaks KDS/Display/Tablet in prod | L | H | Mandatory staging (24-008) deploy first; design kiosk-mode auth pattern in Phase 0 |
| R5 | F1 expiry FIFO trigger may violate `stock_movements` append-only RPC-only invariant | L | M | Mandate trigger calls `record_stock_movement_v1` (not direct insert); pgTAP test |
| R6 | F6 sub-recipes dual-claim (05-001 vs 15-001) with different schemas | M | H | Phase 0 reconciliation; canonical table in 15; 05 reads only |
| R7 | `types.generated.ts` regen burden produces silent CI failures (per CLAUDE.md #1 cause) | M | H | CI check in 23-001/23-008 fails build on diff; doc the rule in each plan |
| R8 | Phantom-table decisions (06-003, 06-004, 08 customer_invoices, 19 get_settings_by_category etc.) block 4+ tasks | M | M | Single Phase 0 "decision pack" doc resolves all; communicate to subagents |
| R9 | Notifications pipeline (08-006 XL) gates 6+ tasks across 8 modules | L | M | Phase 0 provider decision; isolate channel layer into `packages/domain/notifications/`; mocked in tests until provider live |
| R10 | `packages/ui` contention (17/22/04/02/16) — concurrent PRs break design system | M | H | Single steward role; serialise PRs; 22-006 batched per phase window |

Honorable mentions:

- **R11**: LAN V2→V3 architecture decision (port hybrid vs. Realtime-only vs. WebRTC). Cascades to 4 modules. Phase 0.
- **R12**: Multi-currency cascade (10-019 → 7 dependent tasks). Defer Phase 7.
- **R13**: Sentry + EF cold-start (24-006) double-change risk — separate PRs.
- **R14**: `has_permission()` re-publish fragility — refactor to lookup-only in Phase 0.

---

## 5. Recommendations

### 5.1 Phase 0 — Prerequisites (no code, ~1 sprint week)

Must-land items before any other phase starts:

1. **V2→V3 path translation table** — document mapping `src/services/X → packages/{domain,supabase}/...`, `src/components/Y → apps/{pos,backoffice}/src/features/.../components/`, `src/pages/Z → apps/{pos,backoffice}/src/features/.../pages/`, `src/hooks/W → apps/{pos,backoffice}/src/features/.../hooks/`, etc. Single shared doc.
2. **Decision pack** — phantom tables (06-003, 06-004, 08 customer_invoices, 19 get_settings_by_category, email/receipt/holiday/notification phantoms), F6 canonical ownership (05 vs 15), LAN architecture (hybrid/Realtime/WebRTC), notification provider (Twilio/Sendgrid/SES/on-prem), QRIS provider, capacitor-vs-PWA for 18, materialised-views-vs-RPC for 14.
3. **`has_permission()` refactor** — extract to a single migration; idempotent perm seeding via INSERTs only.
4. **`resolve_mapping_account()` verification** — confirm function and `accounting_mappings` table exist in V3 ; if missing, port from V2 immediately.
5. **Staging environment (24-008)** — Supabase project `ikcyvlovptebroadgtvd` confirmed staging-ready (per MEMORY.md), or provision separate staging.
6. **CI workflow on PR (23-001 + 23-008)** — pgTAP + Vitest + domain unit + typecheck + types-regen-check.
7. **Kiosk-mode auth pattern** — design solution for KDS/Display/Tablet to hold a session JWT (impacts 25-001).
8. **`packages/ui` steward** — designate single owner ; document 22-006 batching plan.
9. **Migration timestamp reservation** — reserve contiguous block `20260517000001..050` for Phase 1.

### 5.2 Phase 1 — Foundations (parallelizable, 1 sprint)

Four parallel streams once Phase 0 lands:

- **Stream A — Accounting P0 (strictly sequential, single subagent)**: 10-001 → 10-002 → 10-003 → 10-004 → 10-005 → 10-006 → 10-007. Includes publishing `complete_order_with_payment_v9` and refactoring `create_purchase_journal_entry`.
- **Stream B — Security P1 (semi-sequential)**: 25-002 (rate-limit shared helper) → 25-001 (RLS PII, after staging green) → 25-003 (drop client fallback) → 25-004 (error redaction) → 25-005/006.
- **Stream C — Inventory F1 (sequential)**: 06-001 (stock_lots + FIFO trigger via `record_stock_movement_v1`) → 06-002 (alerts UI).
- **Stream D — Design tokens (parallel-safe)**: 22-001 → 22-002 → 22-004 → 22-005 → 22-006 batch 1 → 22-007. Single steward.

### 5.3 Phase 2 — Mid-layer enabling (1.5 sprints)

- 14-001..006 (reports infra : materialised views, P&L, BS, sales-by-X).
- 15-001..002 (recipes canonical + production records).
- 13-001 + 13-008 (BOGO engine `evaluate_promotions_v2`).
- 06-005 + 06-006 (ghost stock, opname tightening).

### 5.4 Phase 3 — Mid-layer features (1.5 sprints, parallel)

- **A**: 07-001..010 purchasing PO workflow.
- **B**: 09-001..006 B2B core (sans portal).
- **C**: 11-001..005 expenses.

### 5.5 Phase 4 — Surface UX cascade (1 sprint, 4 streams)

- 02 POS UX (02-001/002/006/020).
- 04 KDS (04-001/003/004/006/009/010 — gated by 21).
- 16 Display (after 21 ready).
- 17 Tablet (17-001/002/003/006 — after 22 token batch done).

### 5.6 Phase 5 — Infra & integrations (1 sprint)

- 21 LAN (21-001..009 — implementation per Phase 0 decision).
- 08-006 notifications pipeline (XL, split into : provider integration + channel layer + opt-in compliance).
- 19-001..005 settings UI + holidays/templates.
- 20-001..002/007 RBAC UI + audit pairing.

### 5.7 Phase 6 — Analytics & polish (parallel)

- 14 cascade (custom dashboards).
- 08-009/010 cohort + birthday.
- 13-005/006 segments + ROI.
- 02-011..027 POS polish cascade.
- 04-011..017 KDS polish.

### 5.8 Phase 7 — Late-stage / multi-store / advanced (Q3+, deferred)

- 10-014 e-Faktur.
- 10-019/020 multi-currency + multi-entity.
- 19-008 multi-tenancy.
- 08-011 multi-site customers.
- 21-011 multi-LAN.
- 09-007..017 B2B portal.
- 18 mobile shell (kiosk / iOS).
- 14 advanced ML reports.

### 5.9 Parallelizable modules

| Phase | Streams |
|-------|---------|
| 1 | Accounting P0 (strict seq) ⨯ Security P1 (semi-seq) ⨯ Inventory F1 (seq) ⨯ Design tokens (parallel) |
| 2 | Reports infra (seq within) ⨯ Production (seq within) ⨯ Promotions engine (parallel) ⨯ Inventory ghost-stock (parallel) |
| 3 | PO ⨯ B2B ⨯ Expenses (all parallel) |
| 4 | POS ⨯ KDS ⨯ Display ⨯ Tablet (all parallel, gated by 21+22) |
| 5 | LAN ⨯ Notifications ⨯ Settings ⨯ RBAC (notifications split; mostly parallel) |
| 6 | Reports ⨯ Marketing ⨯ POS polish ⨯ KDS polish (all parallel) |

### 5.10 Late-stage modules (need everything else first)

- 14 advanced custom dashboards (need 04, 09, 13, 08, 06).
- 16 customer display (needs 21, 25).
- 18 mobile shell (needs 22, 08-006).
- 19-008 multi-tenancy (needs everything).
- 09 B2B portal (needs 08, 07, 10).
- 10-019/020 multi-currency cascade (needs all FX-aware modules).

---

## 6. Open questions for the user

1. **V2→V3 translation owner**: should architect produce the translation table as part of Phase 0, or do you (`guichduh33`) want to author it directly to encode business intent (e.g., which V2 service maps to `domain` vs. `feature`) ?
2. **Phantom tables decisions**: are `stock_reservations`, `stock_balances`, `customer_invoices`, `get_settings_by_category` features you want to keep or drop ? Each affects ≥ 1 dependent task.
3. **F6 sub-recipes ownership**: do you want recipes owned by Products module (05) for catalogue affordances, or by Production module (15) as the source of truth for BOM ? Recommendation: 15 owns the table, 05 has read-only UI affordances.
4. **LAN architecture**: port V2 BroadcastChannel+Realtime hybrid as-is, or consolidate to Supabase Realtime only ? The former is faster to ship; the latter is simpler long-term.
5. **Notification provider**: Twilio (SMS+WhatsApp), Sendgrid (email-first), AWS SES, on-prem SMTP, or Supabase Functions HTTP fanout ? Cost vs. control trade-off.
6. **QRIS provider**: Midtrans, Xendit, DOKU, or direct BI integration ? Indonesia-specific.
7. **Multi-tenancy timing**: 19-008 was tagged Phase 7. Confirm OK to defer past Session 13 ? If sooner, it gates 21-011, 10-020, 08-011.
8. **Capacitor vs. PWA for 18 mobile shell**: any preference ? Native push notification matters for 08-006 integration.
9. **Staging Supabase project**: confirm `ikcyvlovptebroadgtvd` is the staging target for Session 13, or provision separate ?
10. **`packages/ui` steward**: designate one human (or designate "single subagent per session") for 22-006 batches ?
11. **Accounting prior-art `accounting_mappings` table**: was this ported from V2 to V3 ? Need to verify in Phase 0 ; if no, it's a hidden prereq blocking 10-001..007.
12. **Production trigger philosophy** (Mary P0-2): the decision was "TS engine is source of truth, drop the stock_movement_journal_entry trigger". Do you want to revisit (DB trigger is more atomic, but doubles risk if TS engine also writes) ?
13. **Refund JE pattern**: existing `fn_create_je_for_refund` (`20260512000005`) — does it use mapping pattern, or hardcoded codes ? Verify in Phase 0; if hardcoded, add to 10 P0 stream.

---

*End of audit. Document is read-only history once committed. Subsequent change-of-mind = new dated spec.*
