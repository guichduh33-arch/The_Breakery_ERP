# Session 13 — Foundation Hardening + Module-Wide Backlog Burn-Down — Implementation Plan INDEX

> **Date** : 2026-05-13
> **Statut** : INDEX multi-phases — chaque phase a son propre fichier `2026-05-13-session-13-phase-NN-<slug>.md` à créer en exécution.
> **Spec source** : [`../specs/2026-05-13-session-13-spec.md`](../../specs/archive/2026-05-13-session-13-spec.md).
> **Audit upstream** : [`../specs/2026-05-13-session-13-architecture-audit.md`](../../specs/archive/2026-05-13-session-13-architecture-audit.md).
> **Reference shape** : [`./2026-05-12-session-12-inventory-complete-INDEX.md`](./2026-05-12-session-12-inventory-complete-INDEX.md).
> **Migration block réservé** : `20260517000001..20260517999999` (séquentiel après `20260516000024`).
> **For agentic workers** : REQUIRED SUB-SKILL : `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans`. Chaque phase est isolée et peut être déléguée à un subagent dédié — parallélisable post-Phase 1.

---

## Goal global

Livrer la **fondation Session 13** (accounting V3 build-from-scratch + sécurisation PII + inventaire complet + modules tier-2 + analytics + delivery infra), en 22 phases groupées en 8 vagues (Wave 0 → Wave 7). Chaque phase délègue à 1-2 subagents nommés.

---

## Architecture en vagues

```
Wave 0 (pre-flight, décisions, pas de code SQL/TS exécutif)
   ├── Phase 0.1 V2→V3 translation table + decision pack
   ├── Phase 0.2 Staging + CI workflow infra
   └── Phase 0.3 Kiosk-mode auth design + ui-steward charter
        │
        ▼ tous les Streams Wave 1 démarrent en parallèle après Wave 0 green
Wave 1 (foundations parallélisables, 4 streams)
   ├── Phase 1.A Accounting Stream (strictly sequential) — module 10
   ├── Phase 1.B Security Stream (semi-sequential) — modules 25/01
   ├── Phase 1.C Inventory F1 + Stream — module 06
   └── Phase 1.D Design tokens — module 22
        │
        ▼ post-Wave 1 sync : reviewer + types-regen + DB reset baseline
Wave 2 (mid-layer enabling, 4 phases majoritairement parallèles)
   ├── Phase 2.A Production + Recipes — module 15
   ├── Phase 2.B Reports infra + materialised views — module 14
   ├── Phase 2.C Promotions BOGO engine — module 13
   └── Phase 2.D Inventory phases 5-7 (opname, movements, alerts, dashboard) — module 06
        │
        ▼
Wave 3 (mid-layer features, 3 phases parallèles)
   ├── Phase 3.A Purchasing PO complet — module 07
   ├── Phase 3.B Expenses — module 11
   └── Phase 3.C B2B core + stock reservations — modules 09 + 06-003 + 12 cash variance
        │
        ▼
Wave 4 (surface UX cascade, 4 phases parallèles gated par Wave 1+2)
   ├── Phase 4.A POS UX + 03 polish — modules 02/03
   ├── Phase 4.B KDS extensions — module 04
   ├── Phase 4.C Customer Display build-from-scratch — module 16
   └── Phase 4.D Tablet polish + ui-steward batch 2 — module 17/22
        │
        ▼
Wave 5 (infra transverse, 4 phases parallèles)
   ├── Phase 5.A LAN architecture port — module 21
   ├── Phase 5.B Notifications pipeline — module 08-006 + EF
   ├── Phase 5.C Settings UI + holidays/templates — module 19
   └── Phase 5.D RBAC UI + audit pairing — module 20
        │
        ▼
Wave 6 (analytics & polish, 3 phases parallèles)
   ├── Phase 6.A Reports cascade — module 14
   ├── Phase 6.B Marketing (segments, birthday, ROI) — module 08+13
   └── Phase 6.C POS/KDS polish + DR docs + Sentry + Playwright E2E — modules 02/04/24/23
        │
        ▼
Wave 7 (différé, mentionné, NON EXÉCUTÉ Session 13)
   └── Phase 7.X Multi-currency, multi-tenancy, mobile shell, B2B portal — sessions 14+
```

**Total phases exécutables Session 13 : 22** (Phases 0.1, 0.2, 0.3, 1.A, 1.B, 1.C, 1.D, 2.A, 2.B, 2.C, 2.D, 3.A, 3.B, 3.C, 4.A, 4.B, 4.C, 4.D, 5.A, 5.B, 5.C, 5.D, 6.A, 6.B, 6.C). **Wave 7 = différé.**

> Comptage corrigé : **25 phases exécutables**, vague 7 = non-exécutée.

---

## Tech Stack

PostgreSQL + Supabase RLS, React + Vite + Vitest, TanStack Query, Tailwind, react-router-dom, supabase-js, lucide-react, Recharts, Zod, Radix Dialog (22-006), Playwright (23-003), Sentry, pg_cron, pgTAP, Supabase Edge Functions (Deno), Resend or Sendgrid (notif), Xendit SDK (optionnel QRIS).

---

## Conventions

- **Migrations** : `20260517XXXXXX_*` (X = ordinal monotonique).
- **Sous-plans** : `docs/workplan/plans/2026-05-13-session-13-phase-NN-{slug}.md` (création à l'exécution).
- **Tests SQL** : `supabase/tests/{module}.test.sql` (pgTAP) — étend existant ou crée `{module}_session13.test.sql`.
- **Tests Vitest** : `supabase/tests/functions/{module}-*.test.ts` (live RPC) + `apps/{pos,backoffice}/src/features/*/__tests__/` (smoke) + `packages/domain/src/{module}/__tests__/` (pure unit).
- **Commits** : `feat(scope): session 13 — phase N.X — <topic>`. Co-author Claude.
- **Branche** : `swarm/session-13-phase-N.X` puis squash-merge sur `swarm/session-13` puis PR `master`.

---

## Comms entre subagents

```
lead (you) ←→ system-architect (Phase 0 steward)
            ←→ acct-stream / sec-stream / inv-stream / ui-steward (Phase 1)
            ←→ prod-recipes / reports-infra / promo-engine / inv-late (Phase 2)
            ←→ purchasing / expenses / b2b-core (Phase 3)
            ←→ pos-ux / kds-ext / display-build / tablet-polish (Phase 4)
            ←→ lan-port / notif-pipe / settings-ui / rbac-ui (Phase 5)
            ←→ reports-cascade / marketing-cascade / polish-ops (Phase 6)
            ←→ reviewer (gates all merges)
```

Pattern : chaque subagent SendMessage `lead` à completion ; lead route à `reviewer` (id dormant `a3ad24f9b7bf6e565`).

---

# WAVE 0 — Prerequisites (no SQL/TS code, decisions only)

## Phase 0.1 — V2→V3 path translation table + decision pack

**Goal** : Produire les deux artefacts qui débloquent toute la session (translation table + decision pack avec phantom-tables, F6, LAN, notif, QRIS, capacitor, has_permission refactor design, `accounting_mappings`/`fiscal_periods`/`resolve_mapping_account` prerequisite verify).

**Module(s) touchés** : transversal (référencé par tous).

**Files touched** :
- `docs/workplan/refs/2026-05-13-v2-v3-path-translation.md` (CREATE — ≈ 300-400 lignes mapping V2 → V3).
- `docs/workplan/refs/2026-05-13-decision-pack.md` (CREATE — D1..D20 du spec actées, sourcées audit Q1-Q13).
- `docs/workplan/refs/2026-05-13-has_permission-refactor-design.md` (CREATE — pseudocode + migration plan).

**DoD checklist** :
- [ ] Translation table couvre ≥ 80% des chemins V2 cités dans les 25 backlogs. Inclut entrée explicite pour `audit_log` (legacy singular) → `audit_logs` (canonical plural).
- [ ] Decision pack répond aux 13 open questions de l'audit §6.
- [ ] `has_permission()` refactor design validé par reviewer.
- [ ] Verify : `accounting_mappings`, `fiscal_periods`, `resolve_mapping_account()` absents en V3 → confirmer ils seront créés Phase 1.A migration `20260517000001-002`.
- [ ] Verify : `evaluate_promotions` SQL function **absente en V3** (`grep -RE "FUNCTION (public\.)?evaluate_promotions" supabase/migrations/` → 0 hit) ; documenter dans decision pack que Phase 2.C crée `evaluate_promotions_v1` from scratch.
- [ ] Verify : `view_section_stock_details` **absente en V3** (`grep -R view_section_stock_details supabase/migrations/` → 0 hit) ; documenter qu'elle sera créée Phase 2.D.
- [ ] **Audit refund JE inconditionnel** : examiner `fn_create_je_for_refund` (`supabase/migrations/20260512000005_*.sql`) + `apps/{pos,backoffice}` + `packages/domain/src/refunds/` + `supabase/functions/refund-order*` pour construction directe de JE. Documenter résultat (codes hardcodés OUI/NON, idempotency OUI/NON, fiscal guard OUI/NON) dans `docs/workplan/refs/2026-05-13-decision-pack.md` section "Refund JE" — **résultat documenté indépendamment du finding**.
- [ ] `audit_logs` vs `audit_log` arbitré (canonical = `audit_logs` plural — cohérent avec `journal_entries` et `stock_movements` ; voir Phase 1.B `000034` pour DROP du loser).
- [ ] Files committed sur `swarm/session-13`.

**Complexity** : S (docs only ; ≈ 4-6 h).

**Dependencies** : aucune. **Démarrage immédiat.**

**Suggested executor** : `system-architect` (nommé `arch-steward`).

**Parallelization tag** : **serial — Wave 0 blocker** (Phases 0.2, 0.3 peuvent démarrer parallèle, mais TOUS doivent finir avant Wave 1).

---

## Phase 0.2 — Staging environment + CI workflow

**Goal** : Confirmer `ikcyvlovptebroadgtvd` comme staging Session 13 (per MEMORY.md), activer le CI workflow GitHub Actions sur PR (pgTAP + Vitest + typecheck + types-regen-check + lint + build).

**Module(s) touchés** : 24 (DevOps), 23 (Tests).

**Files touched** :
- `.github/workflows/ci.yml` (CREATE) — workflow PR : checkout, pnpm install, supabase start (Docker action), `pnpm db:reset`, `pnpm db:types`, `git diff --exit-code packages/supabase/src/types.generated.ts` (fail si drift), `pnpm typecheck`, `pnpm lint`, `pnpm test --concurrency=1`, `bash supabase/tests/run_pgtap.sh`, `pnpm build`.
- `.github/workflows/staging-deploy.yml` (CREATE) — déploie staging sur push `swarm/session-13` (manual approval).
- `docs/workplan/refs/2026-05-13-staging-config.md` (CREATE) — env vars staging + cred references.
- `package.json` ajouts éventuels scripts (`db:diff-types`, etc.).

**DoD checklist** :
- [ ] CI workflow vert sur 1 PR test (branche jetable).
- [ ] `pnpm db:reset && pnpm db:types && git diff --exit-code` détecte volontairement 1 drift (test négatif).
- [ ] Staging accessible : `ikcyvlovptebroadgtvd.supabase.co` + JWT validé.
- [ ] `pnpm --filter @breakery/supabase test inventory` green sur staging.
- [ ] Documentation staging credentials (refs only, pas de secrets) dans `docs/workplan/refs/2026-05-13-staging-config.md`.

**Complexity** : M (≈ 6-8 h + iteration CI).

**Dependencies** : aucune. **Démarre parallèle Phase 0.1.**

**Suggested executor** : `devops-engineer` (nommé `ops-steward`).

**Parallelization tag** : **parallel with 0.1, 0.3 — Wave 0 blocker.**

---

## Phase 0.3 — Kiosk-mode auth design + ui-steward charter

**Goal** : Designer la solution kiosk-JWT pour KDS/Display/Tablet (D18), spécifier l'EF `kiosk-issue-jwt`, et formaliser le ui-steward charter (D9 — batching 22-006 plan).

**Module(s) touchés** : 25 (security), 22 (design).

**Files touched** :
- `docs/workplan/refs/2026-05-13-kiosk-auth-design.md` (CREATE) — design EF `kiosk-issue-jwt` : signing keys, rate-limit (10/min/IP), IP-allowlist staging, JWT claims (`kiosk_id`, `scope=display|kds|tablet`, expiry 24h), revocation, RLS policies adjustements.
- `docs/workplan/refs/2026-05-13-ui-steward-charter.md` (CREATE) — process : PRs `packages/ui/` review par `ui-steward` only ; batching 22-006 plan (3 fenêtres, ≈24 modals chacune).

**DoD checklist** :
- [ ] EF `kiosk-issue-jwt` design validé (signing approach, payload schema, rate-limit, allowlist).
- [ ] RLS adjustment plan : `display_view` ou JWT claim check pour KDS/Display/Tablet.
- [ ] ui-steward charter : workflow signing process + batch 1 modal list (24 POS modals identifiés).

**Complexity** : S (docs only ; ≈ 4-6 h).

**Dependencies** : aucune (parallèle 0.1 et 0.2).

**Suggested executor** : `security-architect` + `ui-steward` (`sec-design` + `ui-steward`).

**Parallelization tag** : **parallel with 0.1, 0.2 — Wave 0 blocker.**

---

# WAVE 1 — Foundations (4 streams parallèles, Wave 0 → Wave 1 sync gate)

## Phase 1.A — Accounting Stream (strictly sequential, build-from-scratch)

**Goal** : Construire la fondation accounting V3 manquante : `accounting_mappings` + `fiscal_periods` + `resolve_mapping_account()` + `check_fiscal_period_open()` + `next_journal_entry_number()` + COA SAK EMKM complet + `reference_type` CHECK étendu (17 types) + sale/purchase/refund/stock-movement JE triggers refactorés sur mapping ; bumps `complete_order_with_payment_v9`, `pay_existing_order_v6`, `refund_order_rpc_v2`.

**Module(s) touchés** : 10 (accounting) — critical path.

**Files touched** :

Migrations (Phase 1.A, sequential within stream) :
- `supabase/migrations/20260517000001_init_accounting_mappings.sql` — table `accounting_mappings(mapping_key TEXT PK, account_code TEXT FK accounts(code), description, is_active)` + seed 24 keys (SALE_PAYMENT_CASH, SALE_PAYMENT_QRIS, SALE_PAYMENT_DEBIT, SALE_PAYMENT_CREDIT_CARD, SALE_POS_REVENUE, SALE_B2B_REVENUE, SALE_PB1_TAX, SALE_DISCOUNT, PURCHASE_PAYABLE, PURCHASE_VAT_INPUT, PURCHASE_CASH_OUT, INVENTORY_GENERAL, INVENTORY_RAW_MATERIAL, INVENTORY_FINISHED_GOODS, PRODUCTION_COGS, WASTE_EXPENSE, ADJUSTMENT_INCOME, ADJUSTMENT_EXPENSE, OPNAME_INCOME, OPNAME_EXPENSE, EXPENSE_DEFAULT, B2B_AR, SHIFT_CASH_VARIANCE_INCOME, SHIFT_CASH_VARIANCE_EXPENSE) + helper `resolve_mapping_account(p_key TEXT) RETURNS UUID` + RLS.
- `supabase/migrations/20260517000002_init_fiscal_periods.sql` — table `fiscal_periods(id, period_start, period_end UNIQUE, status, closed_by, closed_at, locked_by, locked_at)` + seed 24 mois (Jan 2026 → Dec 2027) + helper `check_fiscal_period_open(p_date DATE) RETURNS VOID` (RAISE EXCEPTION 'period_locked' P0004 si closed/locked) + helper `next_journal_entry_number(p_date DATE) RETURNS TEXT` (format `JE-YYYYMMDD-XXXX` sequence).
- `supabase/migrations/20260517000003_extend_reference_type_check.sql` — ALTER `journal_entries` DROP+ADD CHECK (17 types : sale, sale_void, sale_refund, purchase, purchase_return, purchase_payment, expense, expense_payment, shift_close, adjustment, waste, opname, production, transfer, manual, pos_outstanding, pos_outstanding_payment).
- `supabase/migrations/20260517000004_add_current_year_earnings_account.sql` — INSERT account `3300 Current Year Earnings` (equity, is_postable=false) + RPC `get_balance_sheet_data` recalcule CYE.
- `supabase/migrations/20260517000005_seed_full_coa_sak_emkm.sql` — INSERT ≈ 37 comptes supplémentaires (1111 Petty Cash, 1112 Bank, 1113-1116 Cash variants, 1131 AR, 1141 Inventory General, 1142 Inventory Raw Material, 1143 Inventory Finished Goods, 1151 PPN Input, 2141 AP, 2142 PPN Output, 2143 PB1, 3100 Capital, 3300 CYE, 4111 POS Revenue, 4131 B2B Revenue, 4190 Sales Discount, 5101 Production COGS Direct (renommé 5110 Production COGS), 5210 Waste Expense, 6111 Salary, 6112 Rent, 6113 Utilities, 6114 Supplies, 6115 Marketing, 6116 Maintenance, 6190 Other Expense, etc.) + UPDATE mapping `PRODUCTION_COGS → '5110'`.
- `supabase/migrations/20260517000010_refactor_create_sale_journal_entry.sql` — DROP TRIGGER + DROP FUNCTION `create_sale_journal_entry()` ; CREATE OR REPLACE avec : `resolve_mapping_account()` pour chaque ligne (CASH, REVENUE POS, PB1, DISCOUNT) ; idempotence via `SELECT ... FROM journal_entries WHERE reference_type='sale' AND reference_id=NEW.id` ; `next_journal_entry_number()` (pas COUNT) ; guard `check_fiscal_period_open(NEW.created_at::date)` ; recreate TRIGGER `trg_create_sale_journal_entry_ins/upd`.
- `supabase/migrations/20260517000011_create_purchase_journal_entry_trigger.sql` — CREATE FUNCTION `create_purchase_journal_entry()` via mapping (PURCHASE_PAYABLE, PURCHASE_VAT_INPUT, INVENTORY_GENERAL) + CREATE TRIGGER `trg_create_purchase_je` AFTER UPDATE on `goods_receipt_notes` (table créée Phase 3.A — la création trigger ATTEND Phase 3.A, donc placeholder ici = créer fonction sans trigger ; trigger attaché Phase 3.A).
- `supabase/migrations/20260517000012_create_calculate_vat_payable_rpc.sql` — RPC `calculate_vat_payable(p_period_start DATE, p_period_end DATE)` utilisant `resolve_mapping_account('SALE_PB1_TAX')` et `('PURCHASE_VAT_INPUT')`.
- `supabase/migrations/20260517000013_refactor_refund_je.sql` — **inconditionnel** (Phase 0.1 audit documente l'état actuel ; refactor exécuté quoi qu'il arrive car le trigger V3 prédate `accounting_mappings`) : DROP+CREATE OR REPLACE `fn_create_je_for_refund` utilisant mapping (SALE_PAYMENT_*, SALE_POS_REVENUE, SALE_PB1_TAX inversés) + idempotency UNIQUE + `check_fiscal_period_open()` guard.
- `supabase/migrations/20260517000014_bump_refund_order_rpc_v2.sql` — DROP `refund_order_rpc(<v1 args>)` ; CREATE `refund_order_rpc_v2(p_order_id, p_reason, p_idempotency_key UUID)` consommant le trigger refactoré.
- `supabase/migrations/20260517000015_bump_complete_order_v9.sql` — DROP `complete_order_with_payment(<v8 args>)` ; CREATE `complete_order_with_payment_v9(p_order_id, p_items, p_payments JSONB, p_discount, p_customer_id, p_table_number, p_idempotency_key UUID, p_loyalty_redeem_pts INT)` — appel sale JE via trigger now refactorisé ; pgTAP test v9 idempotency.
- `supabase/migrations/20260517000016_bump_pay_existing_order_v6.sql` — idempotency 03-001 + retry 03-002.
- `supabase/migrations/20260517000020_extend_record_stock_movement_v1_lot_id.sql` — **B1 pattern (a) chosen — additive signature** : DROP existing `record_stock_movement_v1(<v4 args>)` ; CREATE `record_stock_movement_v1(<existing args>, p_lot_id UUID DEFAULT NULL)` ajoutant le paramètre en queue (backward compatible — anciens appelants restent valides via DEFAULT NULL). Pour `movement_type IN ('sale','sale_void','waste','transfer_out','production_out')`, si `p_lot_id IS NULL`, le RPC résout FIFO interne : `SELECT id FROM stock_lots WHERE product_id=p_product_id AND status='active' AND quantity > 0 ORDER BY expires_at ASC LIMIT 1 FOR UPDATE` puis `UPDATE stock_lots SET quantity = quantity - p_quantity, status = CASE WHEN quantity - p_quantity <= 0 THEN 'consumed' ELSE status END WHERE id = v_lot_id`. La colonne `stock_movements.lot_id` est remplie À L'INSERT — **jamais après**.
- `supabase/migrations/20260517000021_add_stock_movements_lot_id_column.sql` — **[m4 split 1/3]** ALTER `stock_movements` ADD `lot_id UUID NULL` (FK `stock_lots(id)` posée Phase 1.C migration `20260517000042` — column nullable + index `(lot_id) WHERE lot_id IS NOT NULL`).
- `supabase/migrations/20260517000022_create_tr_stock_movement_je_function.sql` — **[m4 split 2/3]** CREATE FUNCTION `tr_stock_movement_je()` (émet JE pour waste/adjustment_in/out/opname_in/out/production_in+out grouped via reference_id ; uses `resolve_mapping_account` ; respect `check_fiscal_period_open`).
- `supabase/migrations/20260517000023_attach_tr_stock_movement_je_trigger_and_idempotency.sql` — **[m4 split 3/3]** ADD UNIQUE constraint `journal_entries_je_idempotency_uniq (reference_type, reference_id, COALESCE(metadata->>'movement_type', ''))` + ATTACH trigger **`tr_20_je_emit`** AFTER INSERT on `stock_movements` (**M1 — numeric prefix `_20_` encode l'ordre de tir des AFTER INSERT triggers** ; Phase 1.C N'ATTACHE AUCUN trigger sur `stock_movements` (la FIFO logic vit DANS `record_stock_movement_v1` extended Phase 1.A `000020`, exécutée AVANT l'INSERT donc avant tout AFTER trigger) ; ce numérotage réserve `_10_*` pour de futurs hooks BEFORE INSERT optionnels, `_20_je_emit` = unique AFTER INSERT pour le JE, `_30_+` réservé pour futurs auditeurs). `COMMENT ON TABLE stock_movements IS 'Append-only ledger. The only AFTER INSERT trigger permitted is tr_20_je_emit (journal entry emission). FIFO lot resolution is handled UPFRONT inside record_stock_movement_v1, not via trigger. No UPDATE/DELETE triggers permitted on this table.'`.

Files apps/packages :
- `packages/domain/src/accounting/__tests__/` (CREATE) — tests unit pour resolve helpers (mocked DB output).
- `packages/domain/src/accounting/types.ts` (CREATE) — MappingKey enum TS-mirror du seed SQL.
- `apps/pos/src/features/payment/hooks/useCompleteOrder.ts` (UPDATE) — appel `complete_order_with_payment_v9`.
- `apps/pos/src/features/order-history/hooks/usePayExistingOrder.ts` (UPDATE) — v6.
- `apps/pos/src/features/payment/hooks/useRefundOrder.ts` (UPDATE) — `refund_order_rpc_v2`.
- `packages/supabase/src/types.generated.ts` (REGEN après migrations).

Tests :
- `supabase/tests/accounting.test.sql` (CREATE) — pgTAP T1-T35 : COA complet, mapping resolution, fiscal_period guard, sale JE balance + idempotency, purchase JE balance, refund JE inverse, reference_type CHECK refuse invalid, stock_movement_je trigger émet correctement, UNIQUE idempotency, CYE calculé.
- `supabase/tests/functions/accounting-sale-je.test.ts` (CREATE) — Vitest live : create order → 1 JE balanced ; re-trigger → no doublon ; closed fiscal_period → fail period_locked.
- `supabase/tests/functions/accounting-purchase-je.test.ts` (CREATE) — Vitest live (placeholder, complet Phase 3.A).
- `supabase/tests/functions/accounting-refund-je.test.ts` (CREATE) — Vitest live.

**DoD checklist** :
- [ ] 13 migrations Phase 1.A appliquées (`pnpm db:reset` green) — 000001..005, 000010..016, 000020..023 (after [m4] split of original `000020` into 3 + extension of `record_stock_movement_v1` lot_id arg + dedicated refund_order_rpc bump migration).
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] pgTAP accounting suite ≥ 35 tests green.
- [ ] pgTAP `T_TRIGGER_ORDER_STOCK_MOVEMENTS` test (M1) : asserts triggers on `stock_movements` follow the numeric prefix convention. Test query : `SELECT tgname FROM pg_trigger WHERE tgrelid='stock_movements'::regclass AND tgenabled='O' AND NOT tgisinternal ORDER BY tgname`. Expected: only `tr_20_je_emit` exists at Session 13 close; if any other trigger is added in future, ordering is encoded by prefix and asserted by this test (lexicographic AFTER INSERT firing order matches numeric prefix).
- [ ] pgTAP `T_F1_NO_UPDATE_INVARIANT` test (B1) : asserts no AFTER UPDATE trigger exists on `stock_movements` modifying its columns (`SELECT count(*) FROM pg_trigger WHERE tgrelid='stock_movements'::regclass AND tgtype & 16 = 16 AND tgenabled='O' = 0` — bit 16 = AFTER UPDATE).
- [ ] Vitest live `accounting-sale-je.test.ts` + `accounting-refund-je.test.ts` green.
- [ ] `complete_order_with_payment_v9` callable depuis POS ; v8 droppée.
- [ ] `pay_existing_order_v6` callable ; v5 droppée.
- [ ] `refund_order_rpc_v2` callable ; v1 droppée.
- [ ] `record_stock_movement_v1` accepte `p_lot_id UUID DEFAULT NULL` (signature additive ; appelants existants passent toujours).
- [ ] Sale JE équilibré (sum debit = sum credit) ; idempotent (replay = no doublon) ; period guard fonctionne.
- [ ] CYE visible dans `get_balance_sheet_data`.
- [ ] 0 trigger référence `1110/4100/2110` en hardcoded (audit : `grep -rE "'1110'|'4100'|'2110'" supabase/migrations/20260517*` retourne 0 hit).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm build` green.
- [ ] Smoke flow POS : créer 1 commande payée cash → JE auto créé sur staging.

**Complexity** : **L** (≈ 30-40 h + iterations sub-agents review).

**Dependencies** : Wave 0 complete (translation table + has_permission refactor design + staging up).

**Suggested executor** : `backend-dev` (nommé `acct-stream`) — **un seul subagent**, strictly sequential.

**Parallelization tag** : **serial within stream ; parallel with 1.B/1.C/1.D.**

---

## Phase 1.B — Security Stream (semi-sequential)

**Goal** : Refactor `has_permission()` en lookup pur (D10) ; helper rate-limit EF partagé (25-002) ; RLS PII anon→authenticated (25-001) avec kiosk-JWT (D18) ; drop client PIN fallback (25-003) ; error redaction `auth-verify-pin` (25-004) ; CSP+HSTS Vercel (25-005) ; audit EF perm checks (25-006).

**Module(s) touchés** : 01 (auth), 25 (security), 24 (Vercel config).

**Files touched** :

Migrations :
- `supabase/migrations/20260517000030_refactor_has_permission.sql` — DROP+CREATE OR REPLACE `has_permission(role TEXT, perm_key TEXT) RETURNS BOOLEAN` en lookup pur sur `role_permissions + permissions` ; seed `permissions` avec nouvelles perms Session 13 (accounting.* expenses.* cash_register.* reports.* settings.* users.* — ≈ 25 nouvelles).
- `supabase/migrations/20260517000031_init_edge_function_rate_limits.sql` — table `edge_function_rate_limits(id, function_name, ip_address, request_count, window_start)` + index.
- `supabase/migrations/20260517000032_kiosk_jwt_signing_keys.sql` — table `kiosk_jwt_signing_keys(id, key_id, secret, scope, is_active, created_at)` + seed 1 key staging.
- `supabase/migrations/20260517000033_rls_pii_anon_to_authenticated.sql` — ALTER POLICY `orders/order_items/customers/customer_categories/user_roles` SELECT : `USING (is_authenticated() OR has_kiosk_jwt())` + helper `has_kiosk_jwt() RETURNS BOOLEAN` (lit JWT claim `scope`).
- `supabase/migrations/20260517000034_drop_legacy_audit_log_singular.sql` — **[m5]** canonical = `audit_logs` (plural, cohérent `journal_entries`/`stock_movements`/`user_sessions`). Étape (1) `INSERT INTO audit_logs (...) SELECT (...) FROM audit_log` (migrate rows si schéma compatible — sinon documenter pertes acceptées) ; (2) `DROP TABLE audit_log CASCADE` ; (3) UPDATE consumers via grep (apps/packages references) noted in V2→V3 translation table. DoD : `grep -RE "\\baudit_log\\b" apps/ packages/ supabase/` retourne 0 hit (la racine `audit_log` n'apparaît pas isolée — `audit_logs` plural OK).

Edge Functions :
- `supabase/functions/_shared/rate-limit.ts` (CREATE) — Token-bucket helper.
- `supabase/functions/_shared/error-redact.ts` (CREATE) — redact PII/stack from error responses.
- `supabase/functions/kiosk-issue-jwt/index.ts` (CREATE) — EF émet kiosk JWT scope=display/kds/tablet, rate-limited, IP-allowlist via env var `KIOSK_ALLOWED_IPS`.
- `supabase/functions/auth-verify-pin/index.ts` (UPDATE) — applique `rate-limit.ts` + `error-redact.ts`.

App :
- `apps/pos/src/features/auth/hooks/useAuthPin.ts` (UPDATE) — drop fallback client PIN fallback ; pure EF call.
- `apps/pos/src/features/auth/PinPad.tsx` (UPDATE) — error message "Invalid credentials" générique.
- `apps/pos/src/features/display/hooks/useKioskAuth.ts` (CREATE) — récupère kiosk JWT via EF.
- `apps/pos/src/features/kds/hooks/useKioskAuth.ts` (CREATE) idem.
- `apps/pos/src/features/tablet/hooks/useKioskAuth.ts` (CREATE) idem.
- `vercel.json` (UPDATE OR CREATE) — headers CSP `default-src 'self' https://*.supabase.co; script-src 'self' 'unsafe-inline'; ...` + HSTS `max-age=63072000; includeSubDomains; preload`.
- `packages/supabase/src/auth/setSupabaseAccessToken.ts` (UPDATE) — supports kiosk JWT path.

Tests :
- `supabase/tests/security.test.sql` (CREATE) — pgTAP T1-T20 : has_permission lookup, RLS anon refused on orders SELECT, RLS authenticated allowed, RLS kiosk-JWT allowed display.
- `supabase/tests/functions/auth-verify-pin-rate-limit.test.ts` (CREATE) — Vitest live : 4ème tentative en 15 min → 429.
- `supabase/tests/functions/kiosk-issue-jwt.test.ts` (CREATE) — Vitest live : IP-allowlisted → 200, autre IP → 403, valid JWT subscribable to display channel.

**DoD checklist** :
- [ ] 5 migrations Phase 1.B appliquées (000030..034) — `pnpm db:reset` green.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] `has_permission()` lookup-only (audit `grep "CREATE OR REPLACE FUNCTION has_permission" supabase/migrations/2026051[78]*` retourne 1 match unique).
- [ ] EF `auth-verify-pin` rate-limited (Vitest 4th attempt → 429).
- [ ] Kiosk JWT issued via EF + IP-allowlist + rate-limit.
- [ ] RLS orders SELECT anon → 0 rows ; authenticated → N rows ; kiosk-JWT scope=display → N rows.
- [ ] Vercel CSP/HSTS actifs en preview.
- [ ] 0 fallback client PIN dans le code (audit `grep "fallback_pin\|hardcoded_pin" apps/`).
- [ ] EF perm checks audit sweep : tous EFs sensibles `has_permission()` au début (`grep -L "has_permission" supabase/functions/*/index.ts` retourne 0 sensible EF).
- [ ] **[m5] `audit_log` (singular legacy) table droppée ; `audit_logs` (plural) seul canonical** ; consumers (`apps/`, `packages/`) updated ; `grep -RE "\\baudit_log\\b" apps/ packages/ supabase/functions/` returns 0 hit on singular form.
- [ ] pgTAP security + Vitest EF tests green.
- [ ] Staging deploy validated : KDS connect via kiosk JWT, can list pending orders.

**Complexity** : **L** (≈ 24-30 h).

**Dependencies** : Wave 0 complete + Phase 1.A migration `20260517000030` ne doit pas conflit avec `20260517000001` (séparée à `30` exprès) ; sinon parallèle.

**Suggested executor** : `security-architect` (nommé `sec-stream`).

**Parallelization tag** : **parallel with 1.A/1.C/1.D — semi-sequential within stream (rate-limit avant RLS).**

---

## Phase 1.C — Inventory F1 + Session-12 Phase 8 (stock_movements JE coupling done in 1.A)

**Goal** : Livrer F1 expiry tracking (06-001/002 XL P0) — pattern (a) du B1 résolu : `stock_lots` table + lot resolution UPFRONT dans `record_stock_movement_v1` (extension signée Phase 1.A `000020`) + `stock_movements.lot_id` FK ajoutée ici (column ALTER posée 1.A `000021`) + UI alerts. **AUCUN trigger AFTER INSERT/UPDATE sur `stock_movements`** — le ledger reste strictement append-only.

**Module(s) touchés** : 06 (inventory).

**Files touched** :

Migrations :
- `supabase/migrations/20260517000040_init_stock_lots.sql` — table `stock_lots(id, product_id, location_id NULL, quantity DECIMAL(10,3) NOT NULL CHECK > 0, expires_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ, batch_number TEXT NULL, status TEXT CHECK IN ('active', 'expired', 'consumed'), created_at)` + index `(product_id, expires_at, status)` partiel `WHERE status='active'` + RLS authenticated SELECT, RPC-only writes. `stock_lots` n'est PAS append-only — `record_stock_movement_v1` UPDATE `quantity`/`status` de ce table (et c'est licite).
- `supabase/migrations/20260517000041_add_products_default_shelf_life.sql` — ALTER `products` ADD `default_shelf_life_hours INT NULL CHECK >= 0`.
- `supabase/migrations/20260517000042_add_stock_movements_lot_id_fk.sql` — ALTER `stock_movements` ADD FOREIGN KEY `lot_id REFERENCES stock_lots(id)` (column déjà créée Phase 1.A `000021`). NOTE : la FK est ON DELETE SET NULL — un lot droppé (rare) ne casse pas le ledger.
- `supabase/migrations/20260517000043_create_lot_rpcs.sql` — **B1 — pas de trigger AFTER INSERT** : seulement RPCs SECURITY DEFINER : (a) `create_stock_lot_v1(p_product_id, p_quantity, p_location_id, p_expires_at, p_batch_number, p_idempotency_key)` (appelé depuis PO receive Phase 3.A + `record_production_v1` Phase 2.A — toujours UPFRONT à la création de stock) ; (b) helper interne `_resolve_fifo_lot(p_product_id, p_quantity_needed) RETURNS UUID` consulté par `record_stock_movement_v1` lui-même (déjà étendu Phase 1.A `000020` pour appeler ce helper si `p_lot_id IS NULL`). **Aucune création de trigger ici.**
- `supabase/migrations/20260517000044_create_get_expiring_lots_rpc.sql` — RPC `get_expiring_lots_v1(p_hours_ahead INT)` (default 24h).
- `supabase/migrations/20260517000045_pg_cron_mark_expired_lots.sql` — pg_cron job `mark_expired_lots_hourly()` qui UPDATE `stock_lots SET status='expired' WHERE expires_at < NOW() AND status='active'` (UPDATE sur `stock_lots` — licite) + appelle `waste_stock_v1` automatique (option config) pour émettre un `stock_movements.waste` row INSERT (jamais UPDATE).

App :
- `apps/backoffice/src/features/inventory/components/ExpiringLotsBadge.tsx` (CREATE).
- `apps/backoffice/src/features/inventory/pages/ExpiringStockPage.tsx` (CREATE).
- `apps/backoffice/src/features/inventory/hooks/useExpiringLots.ts` (CREATE).
- `apps/backoffice/src/features/inventory/hooks/useStockLots.ts` (CREATE).
- `apps/backoffice/src/routes/index.tsx` (UPDATE) — ajout route `/backoffice/inventory/expiring`.
- `apps/backoffice/src/layouts/BackofficeLayout.tsx` (UPDATE) — sidebar Inventory entrée Expiring.
- `apps/pos/src/features/products/components/ProductCard.tsx` (UPDATE) — disable product if all lots expired (consume `useStockLots` hook).
- `packages/domain/src/inventory/expiry/fifo.ts` (CREATE) — pure helper `selectLotForConsumption(lots[], quantity_needed)`.
- `packages/domain/src/inventory/expiry/__tests__/fifo.test.ts`.

Tests :
- `supabase/tests/inventory_f1_lots.test.sql` (CREATE) — pgTAP T_F1_01 → T_F1_17 : create lot OK, FIFO consume in expiry order (via `record_stock_movement_v1(p_lot_id=NULL)`), expired lots → status='expired' via cron, FK `stock_movements.lot_id` set À L'INSERT (jamais après), RLS authenticated REVOKE INSERT direct (**T_F1_LOT_INVARIANT** critique), **T_F1_NO_TRIGGER_INVARIANT** (B1) : `SELECT count(*) FROM pg_trigger WHERE tgrelid='stock_movements'::regclass AND tgenabled='O' AND tgname ~* '(fifo|consume|update)' = 0` — assert AUCUN trigger FIFO/UPDATE/consume sur la table ledger, **T_F1_NO_LOT_ID_UPDATE** : after INSERT mvt with lot_id=X, `UPDATE stock_movements SET lot_id=Y WHERE id=mvt_id` is denied (RLS revokes UPDATE).
- `supabase/tests/functions/inventory-f1-lots.test.ts` (CREATE) — Vitest live : create lot, sell product → `record_stock_movement_v1` resolves FIFO upfront, INSERT row with lot_id pre-filled, `stock_lots.quantity` decremented in same transaction.
- `apps/backoffice/src/features/inventory/__tests__/ExpiringStockPage.smoke.test.tsx` (CREATE).

**DoD checklist** :
- [ ] 6 migrations Phase 1.C appliquées (000040..045).
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] pgTAP T_F1_01..17 green incluant : **T_F1_LOT_INVARIANT** (RLS authenticated INSERT direct → denied) + **T_F1_NO_TRIGGER_INVARIANT** (aucun trigger FIFO/consume sur `stock_movements`) + **T_F1_NO_LOT_ID_UPDATE** (UPDATE lot_id post-INSERT → denied via RLS).
- [ ] Vitest live `inventory-f1-lots.test.ts` green : FIFO resolution **UPFRONT** dans `record_stock_movement_v1`, pas via trigger.
- [ ] `record_stock_movement_v1` accepte `p_lot_id UUID DEFAULT NULL` ; quand NULL, résout FIFO ; quand provided, l'utilise tel-quel (caller override).
- [ ] pg_cron job activated + tested manually (UPDATE `stock_lots` set status='expired' — UPDATE sur stock_lots est licite, pas sur stock_movements).
- [ ] Page `/backoffice/inventory/expiring` accessible + AlertsBadge live.
- [ ] POS ProductCard disables product if all active lots quantity=0 or expired.
- [ ] Smoke staging : create lot 8h shelf life via PO mock → wait → status='expired' + auto-waste row inserted via `waste_stock_v1` (new row, jamais UPDATE).

**Complexity** : **L** (≈ 20-25 h).

**Dependencies** : Wave 0 complete + Phase 1.A migrations `20260517000020` (record_stock_movement_v1 extended signature) + `20260517000021` (lot_id column). Peut démarrer en parallèle dès `000021` mergée.

**Suggested executor** : `backend-dev` (`inv-stream`).

**Parallelization tag** : **parallel with 1.A (after `000020`) / 1.B / 1.D.**

---

## Phase 1.D — Design tokens + accessibility sweep + 22-006 batch 1

**Goal** : Établir tokens `packages/ui/src/tokens/` (colors, spacing, typography, motion) + EmptyState primitive (22-002) + a11y `<button>` (22-004) + skip-to-content (22-005) + contrast fix (22-007) + 22-006 batch 1 : migrer 24 modals POS vers Radix Dialog.

**Module(s) touchés** : 22 (design system).

**Files touched** :

Packages UI :
- `packages/ui/src/tokens/colors.ts` (CREATE) — 24 color tokens + Tailwind plugin export.
- `packages/ui/src/tokens/spacing.ts` (CREATE).
- `packages/ui/src/tokens/typography.ts` (CREATE).
- `packages/ui/src/tokens/motion.ts` (CREATE).
- `packages/ui/src/tokens/index.ts` (CREATE) — barrel.
- `packages/ui/tailwind.preset.ts` (CREATE OR UPDATE) — Tailwind preset exportant tokens.
- `packages/ui/src/primitives/EmptyState.tsx` (CREATE) + `__tests__/EmptyState.test.tsx`.
- `packages/ui/src/primitives/Dialog.tsx` (CREATE) — wrapper Radix Dialog avec focus trap + Escape.
- `packages/ui/src/primitives/Button.tsx` (UPDATE) — variants align tokens, a11y `aria-*`.
- `packages/ui/src/components/SkipToContent.tsx` (CREATE).
- `packages/ui/src/index.ts` (UPDATE) — export new primitives.
- `apps/pos/tailwind.config.ts` (UPDATE) — consume preset.
- `apps/backoffice/tailwind.config.ts` (UPDATE) — idem.
- `apps/pos/src/main.tsx` (UPDATE) — render `<SkipToContent />` first.
- `apps/backoffice/src/main.tsx` (UPDATE) idem.

22-004 sweep + 22-006 batch 1 (24 modals POS — list dans `docs/workplan/refs/2026-05-13-ui-steward-charter.md`) :
- `apps/pos/src/features/cart/components/CartModal.tsx` (UPDATE) — `<div onClick>` → `<button>` + Radix Dialog wrap.
- `apps/pos/src/features/payment/components/SplitPaymentModal.tsx` (UPDATE) idem.
- `apps/pos/src/features/customers/components/CustomerSearchModal.tsx` (UPDATE).
- `apps/pos/src/features/discounts/components/DiscountModal.tsx` (UPDATE).
- `apps/pos/src/features/kds/components/RecallModal.tsx` (UPDATE).
- `apps/pos/src/features/tablet/components/SubmitOrderModal.tsx` (UPDATE).
- ... (≈ 18 autres modals POS — voir charter).

Tests :
- `packages/ui/src/primitives/__tests__/Dialog.test.tsx` (CREATE) — focus trap + Escape closes.
- `apps/pos/src/features/cart/__tests__/CartModal.smoke.test.tsx` (UPDATE existing).
- `apps/pos/src/features/payment/__tests__/SplitPaymentModal.smoke.test.tsx` (UPDATE).
- A11y CI : ajout `@axe-core/playwright` (différé Phase 6, mais audit manuel ici).

**DoD checklist** :
- [ ] 4 token files + EmptyState + Dialog + Button + SkipToContent committed.
- [ ] Tailwind preset consumed POS + BO ; `pnpm build` green.
- [ ] 22-006 batch 1 : 24 modals POS migrés Radix Dialog avec focus-trap + Escape.
- [ ] Audit `grep -RE "<div [^>]*onClick" apps/pos/src` < 5 hits (acceptables).
- [ ] SkipToContent visible Tab-first on POS + BO.
- [ ] `--text-muted` contrast ratio ≥ 4.5:1 (audit Lighthouse).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` green.
- [ ] PRs `packages/ui/` review par `ui-steward` only.

**Complexity** : **L** (≈ 24-30 h, dont 12-15 h pour batch 1 modals).

**Dependencies** : Wave 0 complete. Parallèle 1.A/1.B/1.C.

**Suggested executor** : `ui-steward` (nommé `ui-steward`).

**Parallelization tag** : **parallel with 1.A / 1.B / 1.C. Steward singleton (mutex).**

---

# WAVE 2 — Mid-layer enabling (4 phases majoritairement parallèles)

## Phase 2.A — Production + Recipes (Session 12 phase 4 reprise)

**Goal** : Livrer Recipes (flat BOM) + production records + `record_production_v1` (atomique : production_in + N production_out + JE COGS via mapping) + `revert_production_v1` + `get_production_suggestions_v1` + UI ProductionPage + RecipeEditor.

**Module(s) touchés** : 15 (production), 05 (read-only via vue), 06 (consumer stock_movements).

**Files touched** :

Migrations :
- `supabase/migrations/20260517000060_init_recipes.sql` — table `recipes(product_id, material_id, quantity DECIMAL(10,3), unit, is_active, notes, created_at, updated_at, deleted_at)` + UNIQUE PARTIAL `(product_id, material_id) WHERE is_active=true` + RLS.
- `supabase/migrations/20260517000061_init_production_records.sql` — table `production_records(id, production_number TEXT UNIQUE, product_id, quantity_produced, quantity_waste, production_date, section_id, staff_id, batch_number, notes, materials_consumed BOOLEAN, stock_updated BOOLEAN, je_posted BOOLEAN, created_at, updated_at)` + RLS.
- `supabase/migrations/20260517000062_create_recipe_rpcs.sql` — `upsert_recipe_v1(p_product_id, p_material_id, p_quantity, p_unit, p_notes)` (ADMIN+), `list_recipes_v1(p_product_id)`, `deactivate_recipe_v1`.
- `supabase/migrations/20260517000063_create_record_production_rpc.sql` — `record_production_v1(p_product_id, p_quantity_produced, p_section_id, p_batch_number, p_quantity_waste, p_idempotency_key)` — atomique : SELECT recipes ; convert units via `convert_quantity()` ; check stock dispo ; **appelle `create_stock_lot_v1` UPFRONT** pour le produit fini si `default_shelf_life_hours` set ; INSERT production_record ; appelle `record_stock_movement_v1(p_lot_id=<lot>)` pour production_in (+qty produit fini) + N production_out (-qty ingrédients, lot=NULL → FIFO résolu par RPC) ; le trigger `tr_20_je_emit` poste JE via mapping `PRODUCTION_COGS` automatiquement après INSERT.
- `supabase/migrations/20260517000064_create_revert_production_rpc.sql` — `revert_production_v1` (ADMIN+) : RAISE si `production_date < 24h` ou non.
- `supabase/migrations/20260517000065_create_production_suggestions_rpc.sql` — `get_production_suggestions_v1(p_lookback_days, p_priority_high, p_priority_medium)`.
- `supabase/migrations/20260517000066_init_view_product_recipes.sql` — vue jointe pour module 05.

App :
- `apps/backoffice/src/features/inventory-production/` (CREATE) — ≈ 8 composants + 6 hooks.
- `apps/backoffice/src/pages/inventory/ProductionPage.tsx` (CREATE).
- `apps/backoffice/src/pages/inventory/RecipeEditorPage.tsx` (CREATE).
- `apps/backoffice/src/routes/index.tsx` (UPDATE) — routes production.
- `packages/domain/src/production/` (CREATE) — `recipeExpansion.ts`, `bomResolver.ts`, `__tests__/`.

Tests :
- `supabase/tests/inventory_production.test.sql` — pgTAP T_PROD_01..15.
- `supabase/tests/functions/inventory-production.test.ts` — Vitest live full cycle.
- `apps/backoffice/src/features/inventory-production/__tests__/RecipeEditor.smoke.test.tsx`.

**DoD checklist** :
- [ ] 7 migrations appliquées.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] pgTAP production suite green (T_PROD_01..15).
- [ ] Vitest live : produire 50 baguettes → 1 production_in (+50) + 4 production_out (-12.5kg flour, -250g salt, -250g yeast, -7.5L water) + 1 JE DR `5110` (Production COGS) / CR INVENTORY_GENERAL pour somme cost_price.
- [ ] `record_production_v1` appelle `create_stock_lot_v1` UPFRONT pour le produit fini (si `default_shelf_life_hours` set) puis `record_stock_movement_v1(p_lot_id=<resolved>)` — pas de trigger AFTER INSERT pour le lot.
- [ ] Insufficient stock → erreur explicite avec liste manquants.
- [ ] Revert (ADMIN+) → réverse JE + mouvements + stock_lots (UPDATE sur `stock_lots` licite ; INSERT sur `stock_movements` pour réversion, jamais UPDATE).
- [ ] Page ProductionPage + RecipeEditor live ; sidebar Production entrée active.
- [ ] `view_product_recipes` consumable depuis module 05.

**Complexity** : **L** (≈ 24-30 h).

**Dependencies** : **bloque sur Phase 1.A (trigger `tr_20_je_emit` migration `000023`, mapping `PRODUCTION_COGS` postable, `5110` account, extended `record_stock_movement_v1` `000020`)** + Phase 1.C (`stock_lots` pour shelf-life).

**Suggested executor** : `backend-dev` (`prod-recipes`).

**Parallelization tag** : **parallel with 2.B / 2.C / 2.D (after 1.A green).**

---

## Phase 2.B — Reports infra (materialised views + 5 first reports)

**Goal** : Poser l'infra reports (materialised views + refresh policy) + livrer 5 premiers reports (sales-by-hour, sales-by-category, sales-by-staff, stock-variance, audit) + fix timezone helper (14-003) + paginations (14-002).

**Module(s) touchés** : 14 (reports).

**Files touched** :

Migrations :
- `supabase/migrations/20260517000070_init_materialised_views.sql` — `mv_sales_daily`, `mv_stock_variance`, `mv_pl_monthly` + indexes.
- `supabase/migrations/20260517000071_pg_cron_refresh_mv.sql` — refresh hourly + nightly.
- `supabase/migrations/20260517000072_create_sales_by_hour_rpc.sql`.
- `supabase/migrations/20260517000073_create_sales_by_category_rpc.sql`.
- `supabase/migrations/20260517000074_create_sales_by_staff_rpc.sql`.
- `supabase/migrations/20260517000075_create_stock_variance_rpc.sql`.
- `supabase/migrations/20260517000076_paginate_audit_log_rpc.sql` — cursor-based.

App :
- `apps/backoffice/src/features/reports/` (CREATE) — feature folder.
- `apps/backoffice/src/pages/reports/SalesByHourPage.tsx`, `SalesByCategoryPage.tsx`, `SalesByStaffPage.tsx`, `StockVariancePage.tsx`, `AuditPage.tsx`.
- `apps/backoffice/src/features/reports/hooks/useSalesByHour.ts` etc.
- `packages/domain/src/reports/` (CREATE) — `aggregations.ts` (pure helpers), `toLocalDateStr.ts` (14-003).
- `apps/backoffice/src/routes/index.tsx` (UPDATE) — 5 routes reports.
- `apps/backoffice/src/layouts/BackofficeLayout.tsx` (UPDATE) — sidebar Reports group.

Tests :
- `supabase/tests/reports.test.sql` — pgTAP.
- `supabase/tests/functions/reports-sales.test.ts` — Vitest live.
- `apps/backoffice/src/features/reports/__tests__/SalesByHourPage.smoke.test.tsx`.

**DoD checklist** :
- [ ] 7 migrations + MV refresh testé manuel.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] 5 pages reports live ; sidebar Reports group active.
- [ ] `toLocalDateStr()` exporté `packages/domain/utils/dates.ts` ; consumers BO updated.
- [ ] Audit pagination cursor-based ; pas de `LIMIT 5000` (RPC propre).
- [ ] pgTAP + Vitest live green.

**Complexity** : **M-L** (≈ 18-24 h).

**Dependencies** : Wave 1 (sale JE refactor stable pour MV `mv_pl_monthly`).

**Suggested executor** : `backend-dev` + `coder` (`reports-infra`).

**Parallelization tag** : **parallel with 2.A / 2.C / 2.D.**

---

## Phase 2.C — Promotions BOGO + threshold engine (`evaluate_promotions_v1` — build-from-scratch)

**Goal** : **B2 — reframed as build-from-scratch.** Créer le moteur promotions DB-side : BOGO multi-produit + threshold cart + bundle. **`evaluate_promotions` n'existe PAS en V3** (vérifié : `grep -RE "FUNCTION (public\\.)?evaluate_promotions" supabase/migrations/` → 0 hit ; la logique matching actuelle vit en TS dans `packages/domain/src/promotions/`). Donc on crée **`evaluate_promotions_v1`** (pas `_v2`) — pas de DROP de prédécesseur. Les consumers TS sont mis à jour pour appeler la RPC.

**Module(s) touchés** : 13 (promotions), 02 (consumer).

**Files touched** :

Migrations :
- `supabase/migrations/20260517000080_extend_promotions_schema_bogo_threshold.sql` — ALTER `promotions` ADD `bogo_buy_quantity INT NULL`, `bogo_get_quantity INT NULL`, `bogo_get_product_id UUID NULL`, `threshold_amount DECIMAL NULL`, `threshold_type TEXT NULL CHECK IN ('subtotal','quantity')`, `bundle_product_ids UUID[] NULL`.
- `supabase/migrations/20260517000081_create_evaluate_promotions_v1.sql` — **CREATE `evaluate_promotions_v1(p_cart_items JSONB, p_customer_id UUID, p_subtotal DECIMAL) RETURNS JSONB`** — applique BOGO + threshold + bundle dans l'ordre de priorité. **AUCUN DROP** (pas de prédécesseur SQL). La logique TS existante dans `packages/domain/src/promotions/` est conservée comme fallback côté domain (pure ; testable unit) ; le consumer cart hook fait appel à la RPC SQL en priorité.
- `supabase/migrations/20260517000082_seed_demo_bogo_promotion.sql` — seed 1 promo BOGO pour test.

App :
- `apps/pos/src/features/promotions/hooks/usePromotionEvaluation.ts` (UPDATE) — appel `evaluate_promotions_v1`.
- `apps/pos/src/features/cart/store/cartStore.ts` (UPDATE) — consume v1 JSON output.
- `apps/backoffice/src/features/promotions/components/BogoForm.tsx` (CREATE) + `ThresholdForm.tsx` (CREATE).
- `packages/domain/src/promotions/bogoEngine.ts` (CREATE pure) + `__tests__/` — sert de spec exécutable et de fallback offline.

Tests :
- `supabase/tests/promotions_bogo.test.sql` — pgTAP T_BOGO_01..10.
- `supabase/tests/functions/promotions-evaluate-v1.test.ts` — Vitest live : BOGO 2+1 free, threshold 100k off 10%, bundle 3-products → fixed price.

**DoD checklist** :
- [ ] 3 migrations + `evaluate_promotions_v1` callable.
- [ ] BOGO 2+1 cas test green (cart 3 baguettes → 1 free).
- [ ] Threshold 100k cas test green.
- [ ] BackofficeBogo/Threshold forms live.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**

**Complexity** : **M** (≈ 14-18 h).

**Dependencies** : Wave 1 (cart hooks stable post-v9).

**Suggested executor** : `coder` (`promo-engine`).

**Parallelization tag** : **parallel with 2.A / 2.B / 2.D.**

---

## Phase 2.D — Inventory Session-12 Phases 5/6/7 (opname + movements + alerts/dashboard)

**Goal** : Livrer les phases inventaire Session 12 jamais terminées (sauf phase 4 → 2.A et phase 8 → 1.A) : Opname (5), Movements ledger view (6), Alerts + Dashboard produit (7).

**Module(s) touchés** : 06 (inventory).

**Files touched** :

Migrations :
- `supabase/migrations/20260517000090_init_inventory_counts.sql` — tables `inventory_counts` + `inventory_count_items`.
- `supabase/migrations/20260517000091_create_opname_rpcs.sql` — `create_opname_v1`, `add_opname_item_v1`, `set_opname_count_v1`, `finalize_opname_v1` (émet adjustments + JE via `tr_20_je_emit` trigger), `validate_opname_v1`, `cancel_opname_v1`.
- `supabase/migrations/20260517000092_create_get_stock_movements_rpc.sql` — paginé + filtres.
- `supabase/migrations/20260517000093_create_movements_aggregates_rpc.sql`.
- `supabase/migrations/20260517000094_create_low_stock_rpc.sql` — `get_low_stock_v1`.
- `supabase/migrations/20260517000095_create_reorder_suggestions_rpc.sql`.
- `supabase/migrations/20260517000096_create_product_dashboard_rpc.sql` — `get_product_dashboard_v1`.
- `supabase/migrations/20260517000097_create_view_section_stock_details.sql` — **[m3]** CREATE VIEW `view_section_stock_details AS SELECT ss.section_id, s.code AS section_code, s.name AS section_name, ss.product_id, p.name AS product_name, p.unit, ss.quantity, p.cost_price, (ss.quantity * COALESCE(p.cost_price, 0)) AS stock_value FROM section_stock ss JOIN sections s ON s.id = ss.section_id JOIN products p ON p.id = ss.product_id WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL`. Remplace l'usage phantom `stock_balances` mentionné D2(b). RLS via security_invoker pattern.

App :
- `apps/backoffice/src/features/inventory-opname/` (CREATE).
- `apps/backoffice/src/features/inventory-movements/` (CREATE).
- `apps/backoffice/src/features/inventory-alerts/` (CREATE).
- `apps/backoffice/src/features/inventory-dashboard/` (CREATE).
- Pages : `OpnameListPage`, `OpnameDetailPage`, `StockMovementsPage`, `AlertsPage`, `ProductDashboardPage`.
- AlertsBadge dans topbar BO (consume low_stock + reorder + expiring).
- Sections page `/backoffice/inventory/sections` (CRUD).

Tests :
- `supabase/tests/inventory_opname.test.sql` — pgTAP T_OPN_01..13.
- `supabase/tests/inventory_movements.test.sql` — T_MOV_01..07.
- `supabase/tests/inventory_alerts.test.sql` — T_ALERT_01..07.
- `supabase/tests/functions/inventory-opname.test.ts` etc.

**DoD checklist** :
- [ ] 8 migrations appliquées (000090..097 — incluant `view_section_stock_details`).
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] Opname cycle complet (create → add items → count → finalize → JE) green.
- [ ] Movements page filtrable + drill-down.
- [ ] AlertsPage 3 onglets (Low Stock / Reorder / Production).
- [ ] ProductDashboard charts Recharts live.
- [ ] AlertsBadge topbar avec compteur.
- [ ] `view_section_stock_details` queryable + remplace tout usage de phantom `stock_balances` (grep audit).

**Complexity** : **L** (≈ 30-36 h).

**Dependencies** : Wave 1 (trigger `tr_20_je_emit` Phase 1.A `000023`) + Phase 2.A (production suggestions reuse).

**Suggested executor** : `coder` (`inv-late`).

**Parallelization tag** : **parallel with 2.A / 2.B / 2.C — large surface, single subagent recommandé.**

---

# WAVE 3 — Mid-layer features (3 phases parallèles)

## Phase 3.A — Purchasing PO workflow complet

**Goal** : Livrer PO net-new V3 : tables, RPCs, pages, JE via mapping (`PURCHASE_PAYABLE`, `PURCHASE_VAT_INPUT`, `INVENTORY_GENERAL`).

**Module(s) touchés** : 07 (purchasing), 06 (consumer purchase movement).

**Files touched** :

Migrations :
- `supabase/migrations/20260517000110_init_purchase_orders.sql` — tables `purchase_orders` + `purchase_order_items` + `goods_receipt_notes`.
- `supabase/migrations/20260517000111_create_create_po_rpc.sql` — `create_purchase_order_v1`.
- `supabase/migrations/20260517000112_create_receive_po_rpc.sql` — `receive_purchase_order_v1` (consume `record_stock_movement_v1` purchase, set `supplier_id`, émet `goods_receipt_notes` row, trigger purchase JE via `create_purchase_journal_entry`).
- `supabase/migrations/20260517000113_attach_purchase_je_trigger.sql` — ATTACH trigger `trg_create_purchase_je` AFTER INSERT ON `goods_receipt_notes` (fonction créée Phase 1.A migration `000011`).
- `supabase/migrations/20260517000114_create_cancel_po_rpc.sql`.

App :
- `apps/backoffice/src/features/purchasing/` (CREATE).
- Pages `/backoffice/purchasing/purchase-orders/{list,new,:id}`.
- Sidebar Purchasing group.

Tests :
- `supabase/tests/purchasing_po.test.sql` — pgTAP T_PO_01..15.
- `supabase/tests/functions/purchasing-po.test.ts` — Vitest live full cycle (create → receive → JE balanced + stock incremented).

**DoD checklist** :
- [ ] 5 migrations.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] Create PO → status pending → receive → JE Dr INVENTORY_GENERAL + Dr PURCHASE_VAT_INPUT + Cr PURCHASE_PAYABLE.
- [ ] Stock incremented + `goods_receipt_notes` row.
- [ ] `receive_purchase_order_v1` appelle `create_stock_lot_v1` UPFRONT par ligne d'item (avec `expires_at = NOW() + p.default_shelf_life_hours` si défini) puis `record_stock_movement_v1(p_lot_id=<resolved>)` — pas de trigger AFTER INSERT.
- [ ] Cancel PO before receive OK ; after → refused.

**Complexity** : **L** (≈ 20-26 h).

**Dependencies** : Wave 1 (`create_purchase_journal_entry` function created in 1.A, attached here).

**Suggested executor** : `backend-dev` (`purchasing`).

**Parallelization tag** : **parallel with 3.B / 3.C.**

---

## Phase 3.B — Expenses module

**Goal** : Livrer Expenses : tables, RPCs, JE auto, page CRUD, receipt upload (Storage bucket).

**Module(s) touchés** : 11 (expenses).

**Files touched** :

Migrations :
- `supabase/migrations/20260517000120_init_expenses.sql` — tables `expenses` + `expense_categories` (seed 12 catégories).
- `supabase/migrations/20260517000121_init_storage_bucket_expense_receipts.sql` — bucket + RLS.
- `supabase/migrations/20260517000122_create_expense_rpcs.sql` — `create_expense_v1`, `submit_expense_v1`, `approve_expense_v1` (émet JE Dr Expense / Cr AP-or-Cash via mapping `EXPENSE_DEFAULT`), `pay_expense_v1`, `reject_expense_v1`.

App :
- `apps/backoffice/src/features/expenses/` (CREATE).
- Pages `/backoffice/expenses/{list,new,:id}`.
- Sidebar Expenses entry.

Tests :
- `supabase/tests/expenses.test.sql` — pgTAP T_EXP_01..10.
- `supabase/tests/functions/expenses.test.ts` — Vitest live.

**DoD checklist** :
- [ ] 3 migrations + Storage bucket.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] Cycle expense create → submit → approve → JE balanced.
- [ ] Receipt upload OK ; RLS bucket : auth READ + manager+ WRITE.

**Complexity** : **M** (≈ 14-18 h).

**Dependencies** : Wave 1 (mapping `EXPENSE_DEFAULT`, reference_type `expense` accepté).

**Suggested executor** : `coder` (`expenses`).

**Parallelization tag** : **parallel with 3.A / 3.C.**

---

## Phase 3.C — B2B core + stock reservations + Cash-Register variance + 12-007 shift JE

**Goal** : (combo) Livrer B2B fields + credit-limit RPC (modules 09 core) + stock reservations net (06-003 CREATE per D2) + cash-register variance threshold/cash-in-out (12-001/004) + shift-close JE auto (12-007).

**Module(s) touchés** : 09 (B2B), 06 (stock reservations), 12 (cash register).

**Files touched** :

Migrations :
- `supabase/migrations/20260517000130_extend_customers_b2b_fields.sql` — ALTER `customers` ADD `b2b_company_name`, `b2b_tax_id`, `b2b_payment_terms_days INT`, `b2b_credit_limit DECIMAL`.
- `supabase/migrations/20260517000131_create_validate_b2b_credit_limit_rpc.sql`.
- `supabase/migrations/20260517000132_init_stock_reservations.sql` — table `stock_reservations(id, product_id, section_id, quantity, holder_id, holder_type TEXT IN ('cart','tablet','b2b_order'), expires_at, status TEXT IN ('held','released','consumed'))` + RLS + RPCs `reservation_hold_v1` / `reservation_release_v1` + integration `record_stock_movement_v1` types `reservation_hold` / `reservation_release` (déjà enum Phase 2 inv Session 12).
- `supabase/migrations/20260517000133_extend_pos_sessions_cash_in_out.sql` — ALTER `pos_sessions` ADD `cash_in_total`, `cash_out_total`, `expected_total`, `variance_total`.
- `supabase/migrations/20260517000134_create_record_cash_movement_rpc.sql`.
- `supabase/migrations/20260517000135_create_close_shift_rpc.sql` — `close_shift_v1` calcule variance, émet JE Dr/Cr via mapping `SHIFT_CASH_VARIANCE_*`, sets `pos_sessions.status='closed'`.
- `supabase/migrations/20260517000136_seed_business_config_shift_variance.sql` — config threshold.

App :
- `apps/backoffice/src/features/customers/components/B2BFieldsSection.tsx` (CREATE).
- `apps/pos/src/features/shift/components/CloseShiftModal.tsx` (CREATE).
- `apps/pos/src/features/shift/components/CashInOutModal.tsx` (CREATE).
- `apps/pos/src/features/shift/hooks/useCloseShift.ts` (CREATE).
- `packages/domain/src/inventory/reservations/` (CREATE pure).

Tests :
- pgTAP `b2b_credit.test.sql`, `cash_register.test.sql`, `stock_reservations.test.sql`.
- Vitest live `cash-register-close.test.ts`, `stock-reservations.test.ts`.

**DoD checklist** :
- [ ] 7 migrations.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] B2B field create order + `validate_b2b_credit_limit_v1` refuse over-limit.
- [ ] Stock reservation hold 10 min → expire automatic via cron pg_cron (background).
- [ ] Close shift cash variance threshold alert UI.
- [ ] Close shift → JE émis via mapping.
- [ ] Mid-shift cash-in/out recordable.

**Complexity** : **L** (≈ 24-30 h).

**Dependencies** : Wave 1 + Phase 1.A (mapping `B2B_AR`, `SHIFT_CASH_VARIANCE_*`).

**Suggested executor** : `coder` ou `backend-dev` (`b2b-core`).

**Parallelization tag** : **parallel with 3.A / 3.B.**

---

# WAVE 4 — Surface UX cascade (4 phases parallèles)

## Phase 4.A — POS UX + 03 polish

**Goal** : POS UX hardening (02-001/002/006/020) + 03 idempotency + retry (déjà bumped 1.A `pay_existing_order_v6`).

**Module(s) touchés** : 02 (POS), 03 (payments).

**Files touched** :
- `apps/pos/src/features/cart/store/cartStore.ts` (UPDATE) — networkSplit re-mount handling, offline graceful (read-only).
- `apps/pos/src/features/payment/components/PaymentModal.tsx` (UPDATE).
- `apps/pos/src/features/order-history/components/OrderRetryBanner.tsx` (CREATE).
- `apps/pos/src/features/products/components/ServiceSpeedIndicator.tsx` (CREATE) — consume reports MV.
- Tests Vitest co-localisés.

**DoD checklist** :
- [ ] POS reload sous load OK (manual smoke).
- [ ] Order retry banner si JE non créé (rare).
- [ ] Service speed indicator visible.

**Complexity** : **M** (≈ 14-18 h).

**Dependencies** : Wave 1, Wave 2 (reports infra pour speed indicator).

**Suggested executor** : `coder` (`pos-ux`).

**Parallelization tag** : **parallel with 4.B / 4.C / 4.D.**

---

## Phase 4.B — KDS extensions

**Goal** : Station routing (04-001), recall (04-003), bump (04-004), prep timer (04-006), undo (04-cascade).

**Module(s) touchés** : 04 (KDS).

**Files touched** :
- Migration : `20260517000150_add_categories_kds_station.sql`, `20260517000151_create_kds_recall_bump_rpcs.sql`.
- `apps/pos/src/features/kds/components/*` (CREATE 5 nouveaux).
- `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` (UPDATE) — handlers.

**DoD checklist** :
- [ ] 2 migrations.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] Item routed to correct station per `categories.kds_station`.
- [ ] Recall + Bump + Undo buttons functional.
- [ ] Prep timer visible per ticket.
- [ ] **[M2] D19 realtime channel uniqueness** : tous les nouveaux hooks realtime ou modifications de `useKdsRealtime.ts` suivent le pattern CLAUDE.md (`useMemo(() => \`kds-${stationId}-${Math.random().toString(36).slice(2, 9)}\`, [stationId])`). Audit : `grep -RE "supabase\\.channel\\(['\"][^\"']*['\"]\\)" apps/pos/src/features/kds/` retourne 0 channel name hardcodé littéral.

**Complexity** : **M** (≈ 14-18 h).

**Dependencies** : Wave 1 (kiosk JWT + RLS).

**Suggested executor** : `coder` (`kds-ext`).

**Parallelization tag** : **parallel with 4.A / 4.C / 4.D.**

---

## Phase 4.C — Customer Display build-from-scratch

**Goal** : App route POS `/display` ; subscribe realtime order updates ; queue ticker ; branded layout via tokens ; kiosk JWT.

**Module(s) touchés** : 16 (display).

**Files touched** :
- `apps/pos/src/features/display/` (CREATE) — `CustomerDisplayPage.tsx`, `OrderQueueTicker.tsx`, `BrandedLayout.tsx`, `hooks/useDisplayRealtime.ts` (pattern useKdsRealtime).
- `apps/pos/src/routes/index.tsx` (UPDATE) — `/display` route.
- Migration `20260517000160_init_display_screens.sql` (optional, per D2 — display config table).

**DoD checklist** :
- [ ] `/display` route fonctionnel sans staff PIN (kiosk JWT).
- [ ] **If migration `20260517000160_init_display_screens.sql` is created: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migration.**
- [ ] Realtime order updates visible.
- [ ] **[M2] D19 realtime channel uniqueness** : `useDisplayRealtime` channel name suit le pattern (`useMemo(() => \`display-${screenId}-${Math.random().toString(36).slice(2, 9)}\`, [screenId])`). Audit : `grep -RE "supabase\\.channel\\(['\"][^\"']*['\"]\\)" apps/pos/src/features/display/` retourne 0 channel name hardcodé littéral. Unit test (Vitest jsdom + StrictMode) asserts double-mount → 2 distinct channel names.
- [ ] Queue ticker affiche 5 derniers orders.
- [ ] Branded layout consume tokens.

**Complexity** : **M** (≈ 16-20 h).

**Dependencies** : Wave 1 (kiosk JWT, RLS, tokens).

**Suggested executor** : `mobile-dev` ou `coder` (`display-build`).

**Parallelization tag** : **parallel with 4.A / 4.B / 4.D.**

---

## Phase 4.D — Tablet polish + ui-steward batch 2 (24 modals BO)

**Goal** : Tablet polish (17-001/002/003/006) + ui-steward batch 2 : migrer 24 modals BO vers Radix Dialog.

**Module(s) touchés** : 17 (tablet), 22 (design).

**Files touched** :
- Tablet : `apps/pos/src/features/tablet/components/*` (UPDATE).
- BO modals (batch 2) : `apps/backoffice/src/features/{inventory,inventory-transfers,inventory-production,inventory-opname,suppliers,customers,...}` — 24 modals migrés.
- Inventory transfer modals, opname finalize, supplier create, etc.

**DoD checklist** :
- [ ] Tablet offline graceful (read cached menu).
- [ ] 24 BO modals migrés Radix Dialog.
- [ ] PRs review par `ui-steward`.

**Complexity** : **L** (≈ 24-30 h).

**Dependencies** : Wave 1 (tokens + Dialog primitive).

**Suggested executor** : `ui-steward` (réutilisé) + `coder` (`tablet-polish`).

**Parallelization tag** : **parallel with 4.A / 4.B / 4.C ; ui-steward singleton mutex (sequential reviews).**

---

# WAVE 5 — Infra transverse (4 phases parallèles)

## Phase 5.A — LAN architecture port (hybrid Realtime + BroadcastChannel)

**Goal** : Port V2 hub/client vers V3 per D4 + `print_queue` (21-004) + KDS handlers (21-002) + print result targeting (21-003).

**Module(s) touchés** : 21 (LAN), consumers 04/16/17.

**Files touched** :
- Migration `20260517000170_init_print_queue.sql` + `20260517000171_init_lan_devices.sql`.
- `packages/domain/src/lan/` (CREATE) — `messageDedup.ts` (UUID+TTL), `protocol.ts`, `__tests__/`.
- `apps/pos/src/features/lan/` (CREATE) — `lanHub.ts`, `lanClient.ts`, `lanHubMessageHandler.ts`, hooks.
- Integration KDS `useKdsRealtime` ajoute LAN broadcast.
- Print queue UI `apps/backoffice/src/features/print-queue/`.

**DoD checklist** :
- [ ] 2 migrations.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] Hub→Client message dedup OK (test : envoyer même msg 2x → consumer voit 1 fois).
- [ ] Print queue insert via KDS bump → print device target OK.
- [ ] **[M2] D19 realtime channel uniqueness** : tous les nouveaux hooks `apps/pos/src/features/lan/` (lanHub, lanClient broadcast subscribers) suivent le pattern CLAUDE.md (`useMemo(() => \`lan-${deviceId}-${Math.random().toString(36).slice(2, 9)}\`, [deviceId])`). Audit : `grep -RE "supabase\\.channel\\(['\"][^\"']*['\"]\\)" apps/pos/src/features/lan/` retourne 0 channel name hardcodé littéral. Unit test asserts StrictMode double-mount → 2 distinct channels.

**Complexity** : **L** (≈ 24-30 h).

**Dependencies** : Wave 1, Phase 4.B (KDS extensions).

**Suggested executor** : `system-architect` ou `mobile-dev` (`lan-port`).

**Parallelization tag** : **parallel with 5.B / 5.C / 5.D.**

---

## Phase 5.B — Notifications pipeline (08-006 XL, MVP email-only)

**Goal** : EF `notification-dispatch` fanout + channel layer `packages/domain/src/notifications/` + Sendgrid OR Resend integration + templates seed.

**Module(s) touchés** : 08-006, 19 (templates), consumers 11/13/17.

**Files touched** :
- `supabase/functions/notification-dispatch/index.ts` (CREATE).
- `supabase/functions/_shared/email-provider.ts` (CREATE).
- Migration `20260517000180_init_notification_templates.sql` + seed.
- `packages/domain/src/notifications/` (CREATE pure) — `composeMessage.ts`, `decideChannels.ts`, `__tests__/`.

**DoD checklist** :
- [ ] 1 migration (`20260517000180`).
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] EF live ; envoie 1 email test via Sendgrid sandbox.
- [ ] Channel layer compose message déterministe (pure test).

**Complexity** : **L** (≈ 18-24 h).

**Dependencies** : Wave 0 (provider décidé D5).

**Suggested executor** : `coder` ou `backend-dev` (`notif-pipe`).

**Parallelization tag** : **parallel with 5.A / 5.C / 5.D.**

---

## Phase 5.C — Settings UI + holidays/templates + phantom RPC

**Goal** : `get_settings_by_category` (D2) + settings page + holidays/email/receipt templates tables + audit on settings change.

**Module(s) touchés** : 19 (settings).

**Files touched** :
- Migration `20260517000190_create_get_settings_by_category_rpc.sql`, `20260517000191_init_holidays.sql`, `20260517000192_init_email_receipt_templates.sql`.
- `apps/backoffice/src/features/settings/` (CREATE).
- Pages `/backoffice/settings/{general,holidays,templates,permissions}`.

**DoD checklist** :
- [ ] 3 migrations.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] Settings page CRUD + audit log entry (sur `audit_logs` plural).
- [ ] Holidays + templates editable.

**Complexity** : **M** (≈ 14-18 h).

**Dependencies** : Wave 1 + Phase 5.B (templates feed notifications).

**Suggested executor** : `coder` (`settings-ui`).

**Parallelization tag** : **parallel with 5.A / 5.B / 5.D.**

---

## Phase 5.D — RBAC UI + audit pairing + last-admin protection

**Goal** : Users CRUD page + permission matrix (20-001) + audit on role change (20-002) + last-admin protection (20-cascade-01-007) + revoke sessions on role change (20-007).

**Module(s) touchés** : 20 (users), 01 (auth).

**Files touched** :
- Migration `20260517000200_create_user_rpcs.sql` — `create_user_v1`, `delete_user_v1` (refuse last admin), `update_user_role_v1` (audit + revoke session).
- `apps/backoffice/src/features/users/` (CREATE).
- Pages `/backoffice/users/{list,new,:id,permissions}`.

**DoD checklist** :
- [ ] 1 migration (`20260517000200`).
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] Permission matrix consume `has_permission()` lookup (Wave 1).
- [ ] Last admin protection enforce.
- [ ] Role change → `audit_logs` (plural) entry + sessions revoked.

**Complexity** : **M** (≈ 14-18 h).

**Dependencies** : Wave 1 (has_permission refactor).

**Suggested executor** : `coder` (`rbac-ui`).

**Parallelization tag** : **parallel with 5.A / 5.B / 5.C.**

---

# WAVE 6 — Analytics & polish (3 phases parallèles)

## Phase 6.A — Reports cascade (P&L + BS + Cash Flow + remaining)

**Goal** : Compléter 14-cascade : P&L, Balance Sheet UI (consume CYE), Cash Flow, custom dashboards, basket analysis, 87 reports tabs smoke.

**Module(s) touchés** : 14 (reports).

**Files touched** :
- Migrations `20260517000210_create_pnl_rpc.sql`, `..._create_cash_flow_rpc.sql`, `..._create_basket_analysis_rpc.sql`.
- `apps/backoffice/src/pages/reports/{ProfitLossPage,BalanceSheetPage,CashFlowPage,BasketAnalysisPage}.tsx`.

**DoD checklist** :
- [ ] 3 migrations.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] 4 pages reports live.
- [ ] BS balances (A = L + E + CYE).
- [ ] Basket analysis montre top-3 cross-sells.

**Complexity** : **L** (≈ 24-30 h).

**Dependencies** : Wave 1, Wave 2.

**Suggested executor** : `coder` (`reports-cascade`).

**Parallelization tag** : **parallel with 6.B / 6.C.**

---

## Phase 6.B — Marketing cascade (segments + birthday + promo ROI)

**Goal** : 08-009 cohort + 08-010 birthday cron + 13-005 segments + 13-006 promo ROI.

**Module(s) touchés** : 08, 13.

**Files touched** :
- Migrations `20260517000220_create_cohort_rpc.sql`, `..._init_birthday_cron.sql`, `..._create_promo_roi_rpc.sql`.
- `supabase/functions/birthday-notify-cron/index.ts` (CREATE).
- `apps/backoffice/src/features/marketing/` (CREATE).

**DoD checklist** :
- [ ] 3 migrations.
- [ ] **After last migration in this phase: `pnpm db:reset && pnpm db:types && pnpm typecheck` succeed ; regenerated `packages/supabase/src/types.generated.ts` is committed alongside migrations.**
- [ ] Cohort report green.
- [ ] Birthday cron triggers notification (mocked Sendgrid).
- [ ] Promo ROI page live.

**Complexity** : **M** (≈ 14-18 h).

**Dependencies** : Wave 5.B (notifications).

**Suggested executor** : `coder` (`marketing-cascade`).

**Parallelization tag** : **parallel with 6.A / 6.C.**

---

## Phase 6.C — POS/KDS polish + Sentry + Playwright E2E + DR docs

**Goal** : POS+KDS polish residuel (cascade 02-011..027, 04-011..017) + Sentry POS+BO + 3 Playwright E2E + DR runbook docs + accounting mappings admin UI (10-012).

**Module(s) touchés** : 02, 04, 24, 23, 10-012.

**Files touched** :
- `apps/pos/src/main.tsx` + `apps/backoffice/src/main.tsx` (UPDATE) — Sentry init.
- `apps/pos/sentry.client.config.ts` (CREATE) etc.
- `tests/e2e/` (CREATE) — `complete-order.spec.ts`, `opname-finalize.spec.ts`, `po-receive.spec.ts`.
- `playwright.config.ts` (CREATE) + add to CI.
- `docs/runbooks/disaster-recovery.md` (CREATE).
- `apps/backoffice/src/pages/accounting/MappingsPage.tsx` (CREATE) — CRUD `accounting_mappings`.

**DoD checklist** :
- [ ] Sentry capture 1 erreur volontaire POS + BO.
- [ ] 3 E2E green.
- [ ] DR runbook ≥ 5 scenarios.
- [ ] Mappings admin page live.

**Complexity** : **L** (≈ 20-26 h).

**Dependencies** : Wave 1-5.

**Suggested executor** : `tester` + `coder` (`polish-ops`).

**Parallelization tag** : **parallel with 6.A / 6.B.**

---

# WAVE 7 — Deferred (NON EXÉCUTÉ Session 13)

Items listés pour traçabilité ; **strictement hors-périmètre Session 13** :
- 10-019 multi-currency end-to-end (Session 14).
- 19-008 multi-tenancy infra (Session 15).
- 10-020 multi-entity consolidation (Session 15).
- 09-007..017 B2B portal (Session 17).
- 18 mobile shell Capacitor (Session 16, ou PWA-first hors-périmètre toujours).
- 10-014 e-Faktur DJP (Session 18).
- Voice ordering / advanced ML / OCR / 2FA (Session 19+).
- LAN multi-site (Session 17).

---

## File Structure (récap global Session 13)

| Action | Path | Phase |
|---|---|---|
| CREATE ≈ 40-50 migrations | `supabase/migrations/20260517XXXXXX_*.sql` | 1-6 |
| CREATE | `docs/workplan/refs/2026-05-13-v2-v3-path-translation.md` | 0.1 |
| CREATE | `docs/workplan/refs/2026-05-13-decision-pack.md` | 0.1 |
| CREATE | `docs/workplan/refs/2026-05-13-kiosk-auth-design.md` | 0.3 |
| CREATE | `docs/workplan/refs/2026-05-13-ui-steward-charter.md` | 0.3 |
| CREATE | `.github/workflows/ci.yml` + `staging-deploy.yml` | 0.2 |
| MODIFY | `packages/supabase/src/types.generated.ts` (regen 15-25 cycles) | 1+ |
| MODIFY | `packages/supabase/src/rls/permissions.ts` (+ 25-40 perms) | 1.B |
| CREATE | `packages/domain/src/accounting/` | 1.A |
| CREATE | `packages/domain/src/expenses/` | 3.B |
| CREATE | `packages/domain/src/production/` | 2.A |
| CREATE | `packages/domain/src/reports/` | 2.B / 6.A |
| CREATE | `packages/domain/src/notifications/` | 5.B |
| CREATE | `packages/domain/src/lan/` | 5.A |
| CREATE | `packages/domain/src/inventory/expiry/` | 1.C |
| CREATE | `packages/domain/src/inventory/reservations/` | 3.C |
| CREATE | `packages/domain/src/promotions/bogoEngine.ts` | 2.C |
| CREATE | `packages/ui/src/tokens/` + primitives Dialog/EmptyState/SkipToContent | 1.D |
| MODIFY | `apps/{pos,backoffice}/tailwind.config.ts` | 1.D |
| CREATE | `supabase/functions/_shared/{rate-limit,error-redact,email-provider}.ts` | 1.B / 5.B |
| CREATE | `supabase/functions/kiosk-issue-jwt/` | 1.B |
| CREATE | `supabase/functions/notification-dispatch/` | 5.B |
| CREATE | `supabase/functions/birthday-notify-cron/` | 6.B |
| CREATE | `apps/backoffice/src/features/{accounting,expenses,purchasing,reports,settings,users,inventory-{production,opname,movements,alerts,dashboard,expiring},marketing,print-queue}/` | 1-6 |
| CREATE | `apps/pos/src/features/{display,lan}/` | 4.C / 5.A |
| MODIFY | `apps/pos/src/features/{cart,payment,kds,shift,tablet,auth,products}/` | 1.B / 1.D / 3.C / 4.A / 4.B / 4.D |
| MODIFY | `apps/backoffice/src/routes/index.tsx` (≈ 25 new routes) | 1-6 (incrémental) |
| MODIFY | `apps/backoffice/src/layouts/BackofficeLayout.tsx` (groupes Inventory/Accounting/Purchasing/Reports/Expenses/Settings/Users) | 1-6 |
| CREATE | `supabase/tests/{accounting,security,inventory_f1_lots,inventory_production,inventory_opname,inventory_movements,inventory_alerts,promotions_bogo,reports,purchasing_po,expenses,b2b_credit,cash_register,stock_reservations}.test.sql` | 1-3 |
| CREATE | `supabase/tests/functions/{accounting-*,kiosk-*,inventory-f1-*,inventory-production,inventory-opname,promotions-evaluate-v1,reports-sales,purchasing-po,expenses,cash-register-close,stock-reservations,notification-dispatch}.test.ts` | 1-5 |
| CREATE | `tests/e2e/{complete-order,opname-finalize,po-receive}.spec.ts` + `playwright.config.ts` | 6.C |
| CREATE | `vercel.json` (CSP + HSTS) | 1.B |
| CREATE | `docs/runbooks/disaster-recovery.md` | 6.C |
| CREATE | `apps/{pos,backoffice}/sentry.client.config.ts` | 6.C |

---

## Verification commands (one-shot end-of-session)

```bash
# Apply migrations from scratch + regen types
pnpm db:reset && pnpm db:types

# Verify types in sync
git diff --exit-code packages/supabase/src/types.generated.ts

# Full quality gate
pnpm typecheck && pnpm lint && pnpm test --concurrency=1 && pnpm build

# pgTAP full
bash supabase/tests/run_pgtap.sh

# Targeted suites
pnpm --filter @breakery/supabase test accounting
pnpm --filter @breakery/supabase test inventory
pnpm --filter @breakery/supabase test purchasing
pnpm --filter @breakery/supabase test expenses

# Playwright
pnpm exec playwright test

# CI dry-run
gh workflow run ci.yml --ref swarm/session-13
```

Expected at the end :
- 40-60 migrations applied
- `types.generated.ts` up-to-date and committed
- 0 typecheck errors, 0 lint warnings
- ≥ 450 new tests passing, total suite ≥ 1370
- POS + BO + packages builds successful
- 3 Playwright E2E green
- All Section 7 DoD invariants of [`../specs/2026-05-13-session-13-spec.md`](../../specs/archive/2026-05-13-session-13-spec.md) ticked

---

## Parallelization map (wave-by-wave summary)

| Wave | Phases | Streams |
|---|---|---|
| **0** | 0.1, 0.2, 0.3 | 3 parallel (docs/decision only — no code) |
| **1** | 1.A, 1.B, 1.C, 1.D | 4 parallel streams ; 1.A strictly sequential within ; 1.B semi-sequential ; 1.C parallel after 1.A migration `000020` ; 1.D fully parallel |
| **2** | 2.A, 2.B, 2.C, 2.D | 4 parallel (2.A bloque sur 1.A green) |
| **3** | 3.A, 3.B, 3.C | 3 parallel |
| **4** | 4.A, 4.B, 4.C, 4.D | 4 parallel ; 4.D ui-steward singleton mutex |
| **5** | 5.A, 5.B, 5.C, 5.D | 4 parallel |
| **6** | 6.A, 6.B, 6.C | 3 parallel |
| **7** | — | DEFERRED (Session 14+) |

Total **25 phases exécutables** Session 13. Critical path :

```
Wave 0 (0.1, 0.2, 0.3 parallel ; ~1 sprint week)
   ↓
Wave 1.A (strictly seq ; ~30-40 h critical path)
   ↓
Wave 2.A (depends 1.A) ; Waves 2.B/2.C/2.D in parallel
   ↓
Waves 3-6 parallèles avec dependencies module-spécifiques
```

Total estimated calendar : **8-12 sprint weeks** (≈ 3 mois) avec 4-6 subagents simultanés. Single-subagent serial : ≈ 20-25 sprint weeks.

---

## Out of scope (déféré sessions futures)

| Feature | Session prévue |
|---|---|
| Multi-currency end-to-end | 14 |
| Multi-tenancy infra (`tenants` table + scope guard) | 15 |
| Mobile shell Capacitor + push native | 16 |
| B2B customer portal (self-service) | 17 |
| e-Faktur DJP integration | 18 |
| Voice ordering POS | 19 |
| Forecasting ML | 20 |
| Sub-recipes récursifs (F6 complet) | 14+ |
| Multi-LAN multi-site mesh | 17+ |
| Bulk imports (users, products) | 14+ |
| 2FA TOTP | 15+ |
| OCR receipts | 16+ |
| Dark mode complete | 14+ |
| Backup verification cron + multi-env staging | 14+ |

---

**Fin de l'INDEX.** Pour exécuter une phase :

```
/skill superpowers:subagent-driven-development
# Puis pointer le subagent vers le sous-plan de la phase visée :
# docs/workplan/plans/2026-05-13-session-13-phase-NN-<slug>.md
# (Sous-plans à créer en exécution avec : file structure détaillée, tasks step-by-step, SQL inline, tests, commits, acceptance locale)
```

Chaque sous-plan doit être créé en exécution avec :
- File structure détaillée
- Tasks step-by-step (`- [ ]`)
- SQL inline ou pseudo-code TS
- Tests à écrire
- Commits attendus
- Acceptance phase-locale
