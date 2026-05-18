# Session 24 — INDEX (B2B Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 1 stream serial Wave 1 (DB+RPC tightly coupled) → Wave 2 UI serial → Wave 3 closeout.

**Goal :** Fermer 5 gaps B2B identifiés par l'audit module 09 — backend manquant sous surface UI shippée S14. Closes TASK-09-001 (AR aging), TASK-09-002 (credit limit enforcement), TASK-09-006 (fix dashboard KPI) + deviations D-W6-B2B-01, D-W6-B2BPAY-01.

**Architecture :** Wave 0 (spec/INDEX/branch) serial → Wave 1 serial DB+RPC+tests (couplage fort) → Wave 2 serial UI BO → Wave 3 closeout serial. Cloud-only via Supabase MCP — no Docker.

**Tech Stack :** Postgres ledger append-only + REVOKE UPDATE column, SECURITY DEFINER RPCs, vues SECURITY INVOKER, JE double-entry via `accounting_mappings.AR_B2B`, pgTAP via MCP, Vitest live RPC, React Query mutations + invalidations, shadcn CenterModal.

**Date :** 2026-05-19
**Branch :** `swarm/session-24` (off `a9b7ca2` post-S23 audit/plan)
**Spec :** [`../specs/2026-05-19-session-24-spec.md`](../specs/2026-05-19-session-24-spec.md)
**Migration block réservé :** `20260601000010..099`
**Multi-session plan parent :** [`./2026-05-19-S24-to-S30-plan.md`](./2026-05-19-S24-to-S30-plan.md)

---

## 1. Goal global

| # | Item | Phase | Estim |
|---|------|-------|-------|
| 1 | 5 migrations DDL/REVOKE/seed (b2b_payments table, view_b2b_invoices, view_ar_aging, REVOKE UPDATE column, AR_B2B mapping) | 1.A | S ~45min |
| 2 | RPC `record_b2b_payment_v1` (paiement + JE Cash→AR + allocation metadata) | 1.A | M ~1.5h |
| 3 | RPC `adjust_b2b_balance_v1` (admin adjustment + audit) | 1.A | S ~30min |
| 4 | RPC `create_b2b_order_v1` (commande B2B unpaid + gate validate_b2b_credit_limit_v1 + JE AR→Sales) | 1.A | M ~1.5h |
| 5 | pgTAP `b2b_foundation.test.sql` (15 cas T1-T15) | 1.A | M ~1h |
| 6 | Vitest live `record-b2b-payment.test.ts` (5 scénarios) | 1.A | S ~45min |
| 7 | Types regen MCP + fix useB2bDashboard aging | 2.A | S ~30min |
| 8 | CreateB2bOrderModal + RecordB2bPaymentModal + hooks | 2.A | M ~2h |
| 9 | B2BPaymentsPage onglet "Reçu" + activation "+ New B2B Order" | 2.A | S ~45min |
| 10 | BO smoke tests (3 cas) | 2.A | S ~30min |
| 11 | Closeout (status notes, roadmap, INDEX §10, PR) | 3.A | M ~1h |

**Total :** ~10h serial.

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec ✓ + INDEX ✓ + branche `swarm/session-24` ✓
        │
        ▼
Wave 1 — Phase 1.A (1 stream serial — couplage DB fort)
  · Pre-flight checks (DB introspection MCP)
  · 5 migrations DDL/REVOKE/seed (010-014)
  · 3 RPCs NEW (020-022)
  · pgTAP 15 cas
  · Vitest live 5 scénarios
        │
        ▼
Wave 2 — Phase 2.A : UI BO (1 stream serial)
  · Types regen
  · Fix useB2bDashboard aging proxy → view_ar_aging
  · CreateB2bOrderModal + activation button
  · RecordB2bPaymentModal
  · B2BPaymentsPage onglet "Reçu"
  · i18n fr.json (~20 strings)
  · BO smoke tests
        │
        ▼
Wave 3 — Phase 3.A : closeout
  · Quality gates final
  · Status notes 09-b2b + roadmap §Sessions + §Indicateurs
  · INDEX §10 deviations
  · CLAUDE.md current session pointer
  · Commit + push + PR
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch

- [x] Spec dated 2026-05-19, 8 sections + 8 décisions + 9 risques.
- [x] Branche `swarm/session-24` créée off `a9b7ca2`.
- [x] INDEX dated, 3 vagues + 5 phases.
- [ ] Commit spec + INDEX.

**Complexity :** S (~30min). **Suggested executor :** lead.

---

## 4. Wave 1 — Phase 1.A : DB + RPC + tests (1 stream serial)

**Module(s) :** 09-b2b-wholesale, 10-accounting-double-entry.
**Migration sub-block :** `20260601000010..022`.
**Executor :** 1 subagent `backend-dev` sonnet, name `stream-a`.

### Sub-phase 1.A.0 — Pre-flight empirical checks (10min)

Avant d'écrire la moindre migration, le subagent DOIT exécuter via MCP `execute_sql` sur `ikcyvlovptebroadgtvd` :

```sql
-- 1) Vérifier signature actuelle validate_b2b_credit_limit_v1
SELECT pg_get_function_identity_arguments(oid) AS args, prorettype::regtype, prosecdef
  FROM pg_proc WHERE proname='validate_b2b_credit_limit_v1' AND pronamespace='public'::regnamespace;

-- 2) Vérifier état accounting_mappings (existe-t-il déjà un AR_B2B ?)
SELECT mapping_key, account_id FROM accounting_mappings WHERE mapping_key ILIKE '%AR%';

-- 3) Vérifier comptes existants pour identifier le bon compte AR ou en créer un
SELECT code, name, account_type FROM accounts WHERE code LIKE '11%' ORDER BY code;

-- 4) Check type customer_type enum
SELECT enum_range(NULL::customer_type);

-- 5) Check colonnes orders + statuts existants
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name='orders' AND column_name IN ('order_type','status','paid_at','idempotency_key');
SELECT DISTINCT status FROM orders LIMIT 20;

-- 6) Check enum payment_method (méthodes B2B = cash/bank_transfer/check ?)
SELECT enum_range(NULL::payment_method);

-- 7) Check si REVOKE UPDATE column déjà appliqué quelque part (pattern S22)
SELECT grantee, privilege_type FROM information_schema.column_privileges
 WHERE table_name='customers' AND column_name='b2b_current_balance';

-- 8) Check si una table b2b_payments existe déjà
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name='b2b_payments';

-- 9) Check resolve_mapping_account function (utilisé par les JE)
SELECT pg_get_function_identity_arguments(oid)
  FROM pg_proc WHERE proname='resolve_mapping_account' AND pronamespace='public'::regnamespace;

-- 10) Check order_sequences table (utilisé pour génération order_number)
SELECT column_name FROM information_schema.columns
 WHERE table_name='order_sequences';
```

**Decisions selon résultats :**
- Si `AR_B2B` mapping existe → réutiliser, skip migration `_014`.
- Si pas de compte 1130 dans `accounts` → créer dans migration `_014`.
- Si `b2b_payments` existe déjà (improbable) → STOP + alerter lead.
- Si `payment_method` enum manque 'bank_transfer' ou 'check' → étendre dans migration `_010` ou utiliser méthodes existantes.

Rapport synthèse à conserver dans le commit Wave 0 ou inline dans le 1er commit Wave 1.

### Sub-phase 1.A.1 — Migrations DDL (010-014)

**Fichiers :**
- `supabase/migrations/20260601000010_create_b2b_payments_table.sql` (CREATE)
- `supabase/migrations/20260601000011_create_view_b2b_invoices.sql` (CREATE)
- `supabase/migrations/20260601000012_create_view_ar_aging.sql` (CREATE)
- `supabase/migrations/20260601000013_revoke_update_b2b_current_balance.sql` (REVOKE)
- `supabase/migrations/20260601000014_seed_ar_b2b_mapping.sql` (SEED — si pre-flight a montré absence)

**Steps :**

- [ ] **Step 1** — Apply `_010` via MCP `apply_migration`. SQL : voir spec §4.1.1.
- [ ] **Step 2** — Apply `_011`. SQL : voir spec §4.1.2.
- [ ] **Step 3** — Apply `_012`. SQL : voir spec §4.1.3.
- [ ] **Step 4** — Apply `_013`. SQL : voir spec §4.1.4.
- [ ] **Step 5** — Si nécessaire d'après pre-flight, apply `_014`. SQL : voir spec §4.1.5.
- [ ] **Step 6** — Smoke check via `execute_sql` : `SELECT * FROM view_ar_aging LIMIT 5; SELECT * FROM b2b_payments LIMIT 1; SELECT mapping_key FROM accounting_mappings WHERE mapping_key='AR_B2B';` — expect succès même vides.
- [ ] **Step 7** — Commit : `feat(db): session 24 — phase 1.A.1 — b2b_payments table + AR aging views + REVOKE UPDATE`.

### Sub-phase 1.A.2 — RPCs NEW (020-022)

**Fichiers :**
- `supabase/migrations/20260601000020_create_record_b2b_payment_v1.sql` (CREATE)
- `supabase/migrations/20260601000021_create_adjust_b2b_balance_v1.sql` (CREATE)
- `supabase/migrations/20260601000022_create_b2b_order_v1.sql` (CREATE)

**Steps :**

- [ ] **Step 1** — Apply `_020` `record_b2b_payment_v1`. Body suit spec §4.1.6.
  - SECURITY DEFINER, search_path=public.
  - Idempotency check upfront (UNIQUE constraint sur `b2b_payments.idempotency_key`).
  - FOR UPDATE customers row.
  - Build allocation JSONB en SELECT subquery sur orders unpaid.
  - JE insert via `resolve_mapping_account('CASH')` / `resolve_mapping_account('AR_B2B')`.
  - Sequence `nextval('b2b_payment_seq')` → format `BP-YYYY-NNNN`.
  - REVOKE/GRANT EXECUTE auth standard.

- [ ] **Step 2** — Apply `_021` `adjust_b2b_balance_v1`. Body suit spec §4.1.7. Plus simple : pas de JE, juste UPDATE + audit_logs.

- [ ] **Step 3** — Apply `_022` `create_b2b_order_v1`. Body suit spec §4.1.8.
  - Validation total > 0.
  - Call `validate_b2b_credit_limit_v1` ; si `allowed=false`, RAISE `credit_limit_exceeded` USING DETAIL = payload jsonb.
  - INSERT orders (order_type='b2b', status='pending', paid_at=NULL).
  - Items loop : INSERT order_items + record_stock_movement_v1.
  - JE : DR AR_B2B / CR Sales (+ VAT split via tax_rate business_config).
  - UPDATE customers.b2b_current_balance += total.

- [ ] **Step 4** — Re-test smoke via `execute_sql` : `SELECT proname FROM pg_proc WHERE proname IN ('record_b2b_payment_v1','adjust_b2b_balance_v1','create_b2b_order_v1');` — expect 3 rows.

- [ ] **Step 5** — Commit : `feat(db): session 24 — phase 1.A.2 — 3 RPCs B2B foundation (payment/adjust/create_order)`.

### Sub-phase 1.A.3 — Tests pgTAP

**Fichier :** `supabase/tests/b2b_foundation.test.sql` (CREATE)

**Steps :**

- [ ] **Step 1** — Read `supabase/tests/b2b_credit.test.sql` + `supabase/tests/inventory.test.sql` pour pattern (fixtures, role switching, plan).
- [ ] **Step 2** — Author 15 cas T1-T15 selon spec §4.2.1. Bootstrap : 3 customers test (1 retail + 2 b2b avec limites différentes) + 1 product test + 1 pos_session test + user_profile test.
- [ ] **Step 3** — Run via MCP `execute_sql` wrap BEGIN/ROLLBACK.
- [ ] **Step 4** — Expect 15/15 passes. Si fail : itération.
- [ ] **Step 5** — Commit : `test(db): session 24 — phase 1.A.3 — pgTAP b2b foundation 15 cas`.

### Sub-phase 1.A.4 — Vitest live RPC

**Fichier :** `supabase/tests/functions/record-b2b-payment.test.ts` (CREATE)

**Steps :**

- [ ] **Step 1** — Read `supabase/tests/functions/inventory-*.test.ts` pour pattern (bootstrap via service-role, supabase-js client, cleanup `afterAll`).
- [ ] **Step 2** — Author 5 scénarios selon spec §4.2.2.
- [ ] **Step 3** — Run : `cd supabase/tests && npx vitest run functions/record-b2b-payment` (rappel DEV-S22-1.B-06 : pas dans pnpm workspace).
- [ ] **Step 4** — Vérifier cleanup propre (aucun customer/order/payment test résiduel).
- [ ] **Step 5** — Commit : `test(db,supabase): session 24 — phase 1.A.4 — record_b2b_payment_v1 live tests`.

**DoD Wave 1 :**

- 5 migrations DDL + 3 migrations RPC appliquées sur V3 dev cloud
- pgTAP 15/15 passes
- Vitest live 5/5 passes
- 4 commits sur `swarm/session-24`

**Complexity :** M+ (~5-6h). **Dependencies :** Phase 0.1.

---

## 5. Wave 2 — Phase 2.A : UI BO (1 stream serial)

**Module(s) :** 09-b2b-wholesale (BO).
**Executor :** 1 subagent `coder` sonnet, name `stream-ui`, **après** Wave 1.

### Sub-phase 2.A.1 — Types regen post-Wave 1

**Fichier :** `packages/supabase/src/types.generated.ts` (MODIFY via MCP)

- [ ] **Step 1** — Regen via MCP `generate_typescript_types(project_id='ikcyvlovptebroadgtvd')`.
- [ ] **Step 2** — Write result dans `packages/supabase/src/types.generated.ts`.
- [ ] **Step 3** — `pnpm typecheck` global : doit passer.
- [ ] **Step 4** — Commit : `chore(types): session 24 — phase 2.A.1 — regen post B2B foundation migrations`.

### Sub-phase 2.A.2 — Fix useB2bDashboard aging proxy

**Fichiers :**
- `apps/backoffice/src/features/btob/hooks/useB2bDashboard.ts` (MODIFY)

**Steps :**

- [ ] **Step 1** — Read full current file pour comprendre toute la fonction.
- [ ] **Step 2** — Remplacer le bloc lignes 131-156 :
  - Ajouter un appel `supabase.from('view_ar_aging').select('customer_id, bucket, invoice_count, total_outstanding, max_age_days')` après le récup orders.
  - Réagréger par bucket sur le set total (toutes customers B2B), pas par customer.
  - Mapper vers la shape `B2bAgingBucket[]` existante (Current / Overdue / Critical / Default).
  - Update commentaire "use last_visit_at as a proxy" → "uses view_ar_aging (S24)".
- [ ] **Step 3** — Run `pnpm --filter @breakery/backoffice typecheck`.
- [ ] **Step 4** — Commit : `fix(backoffice): session 24 — phase 2.A.2 — useB2bDashboard aging from view_ar_aging`.

### Sub-phase 2.A.3 — CreateB2bOrderModal + activation button

**Fichiers :**
- `apps/backoffice/src/features/btob/components/CreateB2bOrderModal.tsx` (CREATE)
- `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts` (CREATE)
- `apps/backoffice/src/pages/btob/B2BDashboardPage.tsx` (MODIFY — drop disabled, wire modal)
- `apps/backoffice/src/i18n/fr.json` (MODIFY — ~10 strings)

**Steps :**

- [ ] **Step 1** — Read pages B2B existantes + `packages/ui/src/components/CenterModal.tsx`.
- [ ] **Step 2** — Author `useCreateB2bOrder.ts` : useMutation call `create_b2b_order_v1`, invalidate `b2b-dashboard` + `customers`. Gérer erreur `credit_limit_exceeded` (extraire payload via `error.details`).
- [ ] **Step 3** — Author `CreateB2bOrderModal.tsx` :
  - CenterModal, 3 steps : Customer / Items / Review.
  - Step Customer : autocomplete `customers` filter `customer_type='b2b'` (réutilise pattern existant si possible).
  - Step Items : tableau ProductPicker + qty + unit_price ; total live.
  - Step Review : récap + Submit.
  - Sur succès : toast + close ; sur credit limit : alerte rouge + bouton "Retry with adjusted amount".
- [ ] **Step 4** — Modify `B2BDashboardPage.tsx:79-86` : drop `disabled` + `setInfo`, ajouter `useState [createOpen, setCreateOpen]`, wire `onClick`, render modal.
- [ ] **Step 5** — i18n strings sous `b2b.create.*`.
- [ ] **Step 6** — Run `pnpm --filter @breakery/backoffice dev` + manual smoke (mais auth dev cloud requise — skip si pas dispo).
- [ ] **Step 7** — Commit : `feat(backoffice): session 24 — phase 2.A.3 — CreateB2bOrderModal + activate dashboard button`.

### Sub-phase 2.A.4 — RecordB2bPaymentModal + B2BPaymentsPage onglet "Reçu"

**Fichiers :**
- `apps/backoffice/src/features/btob/components/RecordB2bPaymentModal.tsx` (CREATE)
- `apps/backoffice/src/features/btob/hooks/useRecordB2bPayment.ts` (CREATE)
- `apps/backoffice/src/features/btob/hooks/useB2bPaymentsReceived.ts` (CREATE)
- `apps/backoffice/src/pages/btob/B2BPaymentsPage.tsx` (MODIFY — onglet "Reçu" + bouton "+ Record Payment")
- `apps/backoffice/src/i18n/fr.json` (MODIFY — ~10 strings)

**Steps :**

- [ ] **Step 1** — Read `B2BPaymentsPage.tsx` pour pattern existant.
- [ ] **Step 2** — Author `useRecordB2bPayment.ts` : useMutation call `record_b2b_payment_v1`, invalidate `b2b-dashboard` + `b2b-payments-received`.
- [ ] **Step 3** — Author `useB2bPaymentsReceived.ts` : useQuery `b2b_payments` avec customer join, filtrable par période.
- [ ] **Step 4** — Author `RecordB2bPaymentModal.tsx` : form simple (customer picker, amount, method, reference, paid_at, notes), call mutation.
- [ ] **Step 5** — Modify `B2BPaymentsPage.tsx` : onglet "Reçu" consomme useB2bPaymentsReceived, header bouton "+ Record Payment" wire vers modal.
- [ ] **Step 6** — i18n strings sous `b2b.payments.*`.
- [ ] **Step 7** — Commit : `feat(backoffice): session 24 — phase 2.A.4 — RecordB2bPaymentModal + payments received tab`.

### Sub-phase 2.A.5 — BO smoke tests

**Fichier :** `apps/backoffice/src/features/btob/__tests__/b2b-foundation.smoke.test.tsx` (CREATE)

**Steps :**

- [ ] **Step 1** — Read `apps/backoffice/src/__tests__/btob-dashboard.smoke.test.tsx` pour pattern.
- [ ] **Step 2** — Author 3 cas selon spec §4.3.4.
- [ ] **Step 3** — Run : `pnpm --filter @breakery/backoffice test b2b-foundation`.
- [ ] **Step 4** — Commit : `test(backoffice): session 24 — phase 2.A.5 — b2b foundation smoke`.

**DoD Wave 2 :**

- 1 hook fix + 5 fichiers nouveaux + 3 fichiers modifiés
- BO smoke green
- types regen committed
- 4-5 commits sur `swarm/session-24`

**Complexity :** M+ (~4h). **Dependencies :** Wave 1 DONE.

---

## 6. Wave 3 — Closeout (Phase 3.A)

**Fichiers :**
- `docs/workplan/backlog-by-module/09-b2b-wholesale.md` (MODIFY)
- `docs/workplan/backlog-by-module/10-accounting-double-entry.md` (MODIFY — AR_B2B mapping ajouté)
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` (MODIFY)
- `docs/workplan/plans/2026-05-19-session-24-INDEX.md` (MODIFY — fill §10)
- `CLAUDE.md` (MODIFY — bump current session pointer)

**Steps :**

- [ ] **Step 1** — Final quality gates : `pnpm typecheck && pnpm build && pnpm exec turbo run test --concurrency=1`.
- [ ] **Step 2** — Status notes :
  - `09-b2b-wholesale.md` :
    - TASK-09-001 (AR aging) : `**Status note (2026-05-19)** : S24 update — DONE. View view_ar_aging + view_b2b_invoices créées (buckets 0-30/31-60/61-90/90+). useB2bDashboard fixé : aging KPI consomme la vraie date facture, plus de proxy last_visit_at. Closes D-W6-B2B-aging-bug.`
    - TASK-09-002 (credit limit enforcement) : `**Status note (2026-05-19)** : S24 update — DONE. RPC create_b2b_order_v1 câble validate_b2b_credit_limit_v1 (gate pre-insert). Raise credit_limit_exceeded avec payload would_exceed_by. UI alerte rouge.`
    - TASK-09-006 (fix dashboard KPI) : `**Status note (2026-05-19)** : S24 update — DONE. Mêmes fix que TASK-09-001.`
    - Ajouter section `## S24 deliverables` : 5 gaps fermés + référence INDEX.
  - `10-accounting-double-entry.md` : ajouter ligne mapping `AR_B2B` (compte 1130) à la liste des mappings.
- [ ] **Step 3** — Roadmap globale :
  - §Sessions complétées : ajouter ligne S24 (date, branch, thème, commits, migrations count).
  - §Indicateurs : ajouter 2 lignes :
    - `B2B AR aging réel | enabled | DONE S24 (view_ar_aging + view_b2b_invoices, buckets 4 tranches)`
    - `B2B credit limit enforcement | enabled | DONE S24 (gate pre-insert via validate_b2b_credit_limit_v1 dans create_b2b_order_v1)`
  - §Actifs : retirer "Module 09 B2B sans backend" si listé.
- [ ] **Step 4** — CLAUDE.md `## Active Workplan` : bump current session pointer vers S24 ; garder S23 en "Previous session" (note : S23 a livré uniquement landed cost domain helper, reste deferred).
- [ ] **Step 5** — Fill INDEX §10 deviations (post-execution).
- [ ] **Step 6** — Final commit closeout + push :
  ```bash
  git push -u origin swarm/session-24
  gh pr create --title "session 24 — B2B Foundation (backend du dashboard shippé S14)" --body "$(cat <<'EOF'
  ## Summary

  Closes **TASK-09-001** (AR aging), **TASK-09-002** (credit limit enforcement), **TASK-09-006** (fix dashboard KPI) + deviations **D-W6-B2B-01** ("+ New B2B Order" disabled), **D-W6-B2BPAY-01** (onglet Reçu vide).

  Le module 09 (B2B Wholesale) avait une surface UI shippée en S14 sans backend complet. Cette session foundryt :

  **DB :**
  - 5 DDL migrations (`20260601000010..014`) : `b2b_payments` ledger append-only + RLS + `view_b2b_invoices` + `view_ar_aging` + REVOKE UPDATE direct sur `customers.b2b_current_balance` (pattern S22 `update_cost_price_v1`) + seed AR_B2B mapping.
  - 3 RPC migrations (`20260601000020..022`) : `record_b2b_payment_v1` (paiement + JE Cash→AR + idempotency + allocation metadata), `adjust_b2b_balance_v1` (admin adjustment + audit), `create_b2b_order_v1` (commande B2B unpaid + gate `validate_b2b_credit_limit_v1` + JE AR→Sales + stock).

  **UI BO :**
  - Fix `useB2bDashboard` aging proxy → consomme `view_ar_aging` (vraies dates facture).
  - NEW `CreateB2bOrderModal` (CenterModal 3 steps) + activation "+ New B2B Order" button.
  - NEW `RecordB2bPaymentModal` + B2BPaymentsPage onglet "Reçu" qui liste `b2b_payments`.
  - i18n fr.json ~20 strings.

  **Tests :**
  - pgTAP `b2b_foundation.test.sql` 15 cas.
  - Vitest live `record-b2b-payment.test.ts` 5 scénarios.
  - BO smoke 3 cas.

  **Out of scope (déféré post-S30) :** B2BSettings backend (D-W6-B2BSET-01), listes de prix B2B négociées, fiche client B2B 360°, édition/clone/livraisons multiples, allocation FIFO précise paiement→factures (S26), invoice PDF (S29), multi-currency.

  ## Test plan
  - [ ] pgTAP `b2b_foundation.test.sql` 15/15 via cloud MCP.
  - [ ] Vitest live `cd supabase/tests && npx vitest run functions/record-b2b-payment`.
  - [ ] `pnpm --filter @breakery/backoffice test b2b-foundation` green.
  - [ ] `pnpm typecheck && pnpm build && pnpm test --concurrency=1` green.
  - [ ] Manual UI : create B2B customer with credit limit, create order via "+ New B2B Order", verify balance increase ; record payment ; verify balance decrease + aging KPI shows real dates.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

**Complexity :** M (~1h). **Dependencies :** Wave 2 DONE.

---

## 7. Parallelization map

| Wave | Phases | Parallel streams | Estim h wall-time |
|------|--------|------------------|-------------------|
| 0 | 0.1 | sequential | 0.5 |
| 1 | 1.A | sequential (couplage DB fort) | 5-6 |
| 2 | 2.A.1 → 2.A.5 | sequential (5 sub-phases) | 4 |
| 3 | 3.A | sequential | 1 |
| **TOTAL** | **5 phases** | — | **~10-11h wall-time serial** |

---

## 8. Comms entre subagents

```
lead (Claude)
  └──► stream-a (backend-dev sonnet, run_in_background)
        · Pre-flight checks
        · 5 DDL + 3 RPC migrations
        · pgTAP 15 cas
        · Vitest live 5 scénarios

After stream-a completes + commits, lead :
  └──► stream-ui (coder sonnet)
        · Types regen
        · useB2bDashboard fix
        · CreateB2bOrderModal + RecordB2bPaymentModal
        · B2BPaymentsPage tab + activate button
        · BO smoke tests

After stream-ui complete + commits, lead :
  └──► closeout serial
        · Quality gates
        · Status notes + roadmap
        · INDEX §10
        · PR
```

---

## 9. Out of scope (déféré S25+)

- B2BSettings backend (D-W6-B2BSET-01)
- Listes de prix B2B (TASK-09-???)
- Fiche client B2B 360° (`/b2b/clients/:id`)
- Édition/clone/livraisons multiples d'une commande B2B
- Allocation FIFO précise paiement→factures (S26 Comptable Cockpit)
- Invoice PDF generation (S29 scope)
- Multi-currency PO/invoice (bloqué TASK-10-019)
- Couplage `complete_order_v9` POS path B2B (cash-and-carry B2B sans gate) — documenter en deviation

---

## 10. Deviation packs (Session 24 → Session 25+)

*Finalized post-execution Phase 3.A. Format `DEV-S24-1.A-NN` / `DEV-S24-2.A-NN` / `DEV-S24-3.A-NN`. All informational unless marked otherwise.*

*(À remplir après exécution.)*
