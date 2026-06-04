# Roadmap globale — The Breakery ERP (V3 monorepo)

> Last updated: 2026-05-20 (audit complet V3 vs vision V2 — 16 fiches métier croisées)
> **Cadre** : V2 (AppGrav monolithe) **n'a jamais été déployée en production** — elle reste le cahier des charges métier théorique. V3 = code vivant (monorepo pnpm+turbo), construit from scratch, mission = parité fonctionnelle V2 + améliorations + split persona POS/BackOffice.
> Glossaire V2↔V3 : [`../../V2_V3_GLOSSARY.md`](../../V2_V3_GLOSSARY.md) (mappings RPC, hooks, pages, tables, paths)
> Plan S24-S30 : [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/archive/2026-05-19-S24-to-S30-plan.md)

---

## Synthèse audit V3 (2026-05-20)

| Statut | Modules | Détail |
|---|---|---|
| 🟢 **DONE (parité atteinte ou dépassée)** | 14 | 01 Auth, 02 POS, 03 Payments, 04 KDS, 05 Products (S27), 06 Inventory, 07 Purchasing, 08 Customers, 12 Cash, 13 Promotions, 15 Production (sub-recipes ✅, baker % ✅), 17 Tablet, 20 Users, 21 LAN |
| 🟡 **PARTIEL (gap modéré)** | 4 | 09 B2B (S24 Foundation, reste devis/abonnements), 10 Accounting (UI 4/11 → S26 Comptable Cockpit), 11 Expenses (UI 2/4 → S28 Expense Governance), 19 Settings (6/23 pages), 16 Customer Display (à vérifier) |
| 🟡 **PARTIEL (gap modéré, Vagues A+B livrées)** | 1 | 14 Reports (TASK-14-005 compare DONE S29 + gap 14-3 CSV/PDF DONE S29 + 5 bakery reports DONE S30 ; reste Vague C drill-down + 6 Soon cards restantes S31+) |
| 🔴 **MAJEUR (gros gap)** | 1 | 18 Mobile Shell (0 — P3 backlog, décision business) |

**~70 % parité V2 atteinte ; ~15 améliorations V3 nettes au-delà de V2** (idempotency cross-EF, GRANT hardening, sub-recipes, WAC, RLS helpers, rate limiting durable, etc. — voir glossaire §6).

---

---

## Vue d'ensemble

### Contexte initial (2026-04-09)

AppGrav V2 (vision monolithe Vite + React + Supabase) **n'a jamais été déployée en production**. L'audit global 2026-04-09 (8 agents BMAD + 7 skills) a produit un état des lieux théorique de cette vision : **architecture 8/10**, **sécurité 7.5/10**, **complétude produit 88 %**, **53 rapports actifs** — chiffres aspirationnels, à interpréter comme cible métier et non comme un constat de production. La passe « Global Audit & Fixes » du 2026-04-09 a aligné le design business (triggers comptables, expense approval RPC, VAT RPC, CSP/HSTS, error leakage, Sonner, French strings, .limit() reports).

### Construction V3 — avancement S13-S20

Entre Session 13 (2026-05-13) et Session 20 (2026-05-17), The Breakery a construit le monorepo V3 (pnpm + turbo, apps/pos + apps/backoffice + packages/{domain,supabase,ui,utils}) en s'appuyant sur la vision V2 comme référence métier, et résolu la majorité des gaps fonctionnels bakery historiquement identifiés. La Session 19 (Hardening polish) a clôturé les 3 derniers items P1/P2 du module 01-auth-permissions (rate limiting durable, session timeout per role, PIN strength warn). La Session 20 (GRANT hardening) a clôturé le gap de sécurité anon GRANT au niveau tables, vues et fonctions — defense-in-depth complémentaire au RLS S13.

### Ce qui reste (état 2026-05-17)

1. **Compliance fiscale Indonésie** — I1 Faktur Pajak, I2 e-Faktur, I3 DJP. **Bloqué tant que le statut PKP n'est pas confirmé** par le propriétaire. **Reste l'unique gap métier majeur.**
2. **Hardening résiduel** — ~~audit RLS `anon USING(true)` sur tables PII~~ DONE S13+S20 ; ~~message dedup LAN (TTL 5s)~~ DONE S13+S21 (audit + GC tests) ; ~~Playwright E2E en CI~~ DONE S21 (3-flow smoke nightly cron) ; ~~`pg_net` birthday cron~~ DONE S21 ; ~~Cash Flow Investing/Financing sections~~ DONE S21 ; ~~staging-deploy.yml secrets~~ DONE S21.
3. **WAC polish** — landed cost shipping/douane pro-rata (TASK-07-012 partial S17), manual cost_price bypass de WAC (DEV-S17-1.B-01), opt-out sample/promo (DEV-S17-1.C-01).
4. **Backlog métier secondaire** — modules 17 (tablet ordering polish), 18 (mobile shell Capacitor, gros chantier), 22 (design-system finitions), 16 (display polish).

### Prochains jalons

- **Session 23 (en cours)** : Landed cost shipping pro-rata + skip_wac sample/promo (TASK-07-012 + DEV-S17-1.C-01). Spec : [`../specs/2026-05-19-session-23-spec.md`](../specs/archive/2026-05-19-session-23-spec.md).
- **Sessions 24-30** : 7 sessions séquencées issues de l'audit 21-modules du 2026-05-19. Voir [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/archive/2026-05-19-S24-to-S30-plan.md). Thèmes : B2B Foundation (S24), Idempotency Hardening (S25), Comptable Cockpit (S26), Product CRUD (S27), Expense Governance (S28), Reports Export + Z-Report PDF (S29), Decision Sprint + Cleanup (S30).
- **Items WONTFIX 2026-05-19** (décision mono-site permanent) : TASK-08-011 (multi-établissement loyalty), TASK-10-020 (consolidation multi-entité), TASK-19-008 (multi-tenancy foundation), TASK-21-011 (multi-LAN segmentation). 4 items BLOCKED purgés du backlog actif.
- **Cycle review** : tous les 3-5 sessions, refresh de cette roadmap + des Status notes (`docs/workplan/backlog-by-module/0N-*.md`).

---

## Top priorités cross-modules (état 2026-05-17)

Triées par impact business + risque. Le top 10 historique avait 5 items déjà résolus en S13-S15 — cette table consolide ce qui reste actionnable.

### Actifs

| # | Tâche | Module | Pri | Estim | Source / contexte |
|---|-------|--------|-----|-------|-------------------|
| 1 | Confirmer le statut PKP de The Breakery (débloque I1/I2/I3) | n/a (business) | P0 | S | `07-product-backlog-audit.md§Recommandations Immédiates` — **bloqueur business**, pas technique |
| ~~3~~ | ~~Message dedup LAN (TTL 5s) hub + client~~ → **DONE S13 (impl) + S21 (audit confirme TTL 5s + 2 GC tests)** (Module 21-lan) | 21-lan | — | — | Closed S21 |
| ~~5~~ | ~~Fix modal focus traps : migrer modales custom vers shadcn `Dialog` (Radix)~~ → **DONE S22 (lock-in via RTL+ESLint+a11y fix)** (Module 22-design-system) | 22-design-system | — | — | Closed S22 — empirical audit confirmed all 30+ modals in `apps/` route through Radix-backed primitives ; 16 RTL focus-trap regression tests in `packages/ui/src/{primitives,components}/__tests__/*.focus-trap.test.tsx` lock behavior in ; ESLint rule `no-raw-modal-overlay` shipped via inline `tools/eslint-rules/` flat-config plugin (`breakery-local` at level `error`) ; pre-existing raw overlay in `MarginWatchPage.tsx:195` discovered + migrated to `<Dialog>` in same commit |
| ~~6~~ | ~~Playwright E2E en CI (D-W6-6C-05)~~ → **DONE S21** (Module 23-tests) | 23-tests | — | — | Closed S21 |
| 7 | WAC landed cost shipping pro-rata (TASK-07-012 finir partial S17) | 07-purchasing | P3 | M | DEV-S17-1.B-01 + DEV-S17-1.C-01..02 |
| 8 | Mobile shell Capacitor + push native (TASK-15-009 + TASK-18-***) | 18-mobile | P3 | XL | Wave 7 deferred, Session 16+ scope |
| 9 | Compliance fiscale I1/I2/I3 (si PKP confirmé) | n/a (cross) | P0* | XL | `07-product-backlog-audit.md§Compliance` |

### Top 10 historique — items DONE (référence)

- ~~Standardiser timezone `toLocalDateStr()` reports~~ → **DONE S13** TASK-14-003 (Phase 2.B)
- ~~Granulariser permissions reports `.sales`/`.inventory`/`.financial`/`.audit`~~ → **DONE S13** TASK-14-004
- ~~F1 Expiry date tracking~~ → **DONE S13** TASK-06-001 + TASK-06-002 (FIFO, cron expire, ExpiringStockPage)
- ~~F6 Sub-recipes~~ → **DONE S15+S17** TASK-15-001 (anti-cycle 5-niveaux + cost cascade complète depth-5 + `recipe_versions` + `recipe_bom_full_v1`)
- ~~Phantom table `stock_reservations`~~ → **DONE S13** TASK-06-003
- ~~Rate limiting durable Postgres backstop~~ → **DONE S13+S19** TASK-01-002 (in-memory S13, Postgres-backed S19 — `record_rate_limit_v1` RPC + `pg_cron rl-purge` + 5 EFs wired)
- ~~Auditer & remplacer 16 RLS `anon USING(true)` par auth-only (reliquat historique post-S13)~~ → **DONE S13 (RLS) + S20 (GRANT defense-in-depth — tables, views, functions)** TASK-01-001 (S13 PII tables RLS ; S20 REVOKE table+view GRANTs + REVOKE EXECUTE on functions + ALTER DEFAULT PRIVILEGES future-proofed)
- ~~Vérifier phantom tables résiduelles : `system_alerts`, `customer_invoices`~~ → **DONE S14 (D2 decision pack) ; verified absent on V3 dev S20** (`information_schema.tables` query 2026-05-17 — `orders.invoice_number` + `view_b2b_invoices` is the canonical path)

---

## Diagramme de dépendances

```mermaid
graph TD
  PKP["Confirmer statut PKP (business decision)"] --> I1[I1 Faktur Pajak]
  PKP --> I2[I2 e-Faktur CSV]
  I1 --> I2
  I2 --> I3[I3 DJP integration]

  V3Monorepo["V3 monorepo (S12-S13)"] --> Hardening[Hardening résiduel]
  Hardening --> RLSAudit[Audit RLS anon USING true]
  RLSAuditDone["Rate limiting durable ✅ DONE S13+S19"] --> SessionTimeoutDone["Session timeout per role ✅ DONE S19"]
  SessionTimeoutDone --> PinStrengthDone["PIN strength warn ✅ DONE S19"]

  F1Done["F1 Expiry tracking ✅ DONE S13"] --> F2[F2 Batch/lot tracking]
  F6Done["F6 Sub-recipes ✅ DONE S15+S17"] --> F5Done["F5 Yield tracking ✅ DONE S15"]
  F5Done --> COGSReports["COGS reports refresh ✅ DONE S18"]
  F6Done --> ProductionPlanningDone["Production scheduling ✅ DONE S15"]
  F6Done --> CostHistory["Recipe Cost History ✅ DONE S18"]

  WAC["WAC products.cost_price auto-update ✅ DONE S17"] --> LandedCost[Landed cost shipping pro-rata TASK-07-012]
  WAC --> CascadeSnapshots["recipe_versions cascade ancestres ✅ DONE S17"]

  AccountingP0Done["Phase 1 accounting P0 ✅ DONE 2026-04-09"] --> CashFlowDone["F7 Cash flow ✅ DONE S13"]
  AccountingP0Done --> CurrentYearEarnings[Account 3300 Current Year Earnings]
  CashFlowDone --> CashFlowFinancing[Cash Flow Investing/Financing sections D-W6-6A-2]

  TimezoneFixDone["Standardiser toLocalDateStr ✅ DONE S13"] --> ReportsPermissionsDone["Granulariser permissions reports ✅ DONE S13"]
  ReportsPermissionsDone --> CostHistory

  LanDedup[Message dedup LAN TTL 5s] --> LanReconnect[Fix hub zombie state après max retries]
  LanDedup --> PrintQueue[Print retry queue]

  PgTAPNightly["pg_TAP nightly cron ✅ DONE S16"] --> PlaywrightCI[Playwright E2E en CI D-W6-6C-05]
```

---

## Cadence Sessions (historique + à venir)

### Sessions complétées

| Session | Date merge | Branch / commit | Thème principal |
|---|---|---|---|
| S13 | 2026-05-14 | PR #13 (commit `bdf21aa`) | Cascade docs + Phase 2.A/2.B/3.A/4.A/5.A/6.A (productions, reports, purchasing, expenses, B2B, POS UX, KDS, display, tablet, LAN, notifs, settings, RBAC, reports cascade, marketing) |
| S14 | 2026-05-14 | `d7d60d5` | UX completion (68 commits, 6 waves) |
| S15 | 2026-05-16 | `swarm/session-15` | Bakery Production : sub-recipes F6 + yield F5 + recipe pro features (IngredientPicker, DnD, Duplicate, Batch, Schedule, Margin alerts, Boulanger %, EU allergens) (53 commits, 32 migrations) |
| S16 | 2026-05-16 | PR #20 (commit `f7c83b2`) | CI revival pgTAP nightly + S15 follow-ups (`is_semi_finished` + pg_trgm + per-version cost + multi-level preview) (11 commits, 8 migrations) |
| S17 | 2026-05-17 | PR #21 (commit `5e79509`) | Full price chain : PO receipt → WAC → cascade recipe ancestres → `recipe_bom_full_v1` RPC + `IngredientAggregatePreview` rewire (6 commits, 7 migrations) |
| S18 | 2026-05-17 | `swarm/session-18` | Recipe Cost History Report : RPC dual-mode + 2 pages BO (Overview + Timeline recharts) (5 commits, 1 migration) |
| S19 | 2026-05-17 | swarm/session-19 | Hardening polish : durable rate-limit + session timeout per role + PIN strength warn (12-14 commits, 7 migrations) |
| S20 | 2026-05-17 | swarm/session-20 | Defense-in-depth GRANT hardening : refund_sequences RLS, anon table-GRANT sweep, anon function-EXECUTE sweep (+ PUBLIC inheritance corrective `_31`), 5 operational authenticated USING(true) policies tightened (5 migrations) |
| S21 | 2026-05-18 | swarm/session-21 | Polish hardening reliquat : pg_net birthday cron + cash flow 3-sections + Playwright E2E 3-flow CI + staging-deploy secrets + LAN dedup tests + idle warning toast + PIN regex fix + ChangePinModal UX (5 migrations, 1 EF, 3 e2e specs, 4 UI fixes) |
| S22 | 2026-05-18 | swarm/session-22 | Focus-trap lock-in + WAC bypass guard + Retry-After 429 (2 streams parallèles + closeout, 8 commits, 5 migrations `20260526000010..014`, 4 RTL focus-trap test files + ESLint inline rule + RPC `update_cost_price_v1` + 5 EFs wired) |
| S24 | 2026-05-19 | swarm/session-24 | B2B Foundation : backend du dashboard shippé S14. 11 migrations `20260601000005..022` (b2b_payments ledger, view_b2b_invoices, view_ar_aging, REVOKE UPDATE customers.b2b_current_balance, B2B_PAYMENT_BANK mapping, 3 RPCs `record_b2b_payment_v1` / `adjust_b2b_balance_v1` / `create_b2b_order_v1` qui câble enfin `validate_b2b_credit_limit_v1`) + UI BO (useB2bDashboard aging from view, CreateB2bOrderModal, RecordB2bPaymentModal, B2BPaymentsPage Received tab) + tests (pgTAP 15, Vitest live 5, BO smoke 3). Closes TASK-09-001 (KPI side), 09-002, 09-006 + deviations D-W6-B2B-01 + D-W6-B2BPAY-01. (12 commits, 3 waves, 11 migrations) |
| S25 | 2026-05-20 | swarm/session-25 | Hardening Idempotency Cross-EF : 2 flux mutateurs critiques sécurisés. **DB** 6 migrations `20260602000010..015` : `tablet_order_idempotency_keys` table dédiée (PK=client_uuid), `create_tablet_order_v2(p_client_uuid, ...)` avec replay + drop v1 même migration, REVOKE EXECUTE FROM anon + corrective `_013` `ALTER DEFAULT PRIVILEGES FROM PUBLIC`, corrective `_014` relax `orders.session_id` pour `created_via='tablet'` (latent S24 bug caught par pgTAP T1), corrective `_015` fix dormant S13 RECORD-not-assigned bug dans `refund_order_rpc_v2` replay branch. **EF** : `_shared/idempotency.ts` helper (1 export `getIdempotencyKey`), `refund-order` v7 deployed cloud — PIN body → header `x-manager-pin` (hard cutover) + `p_idempotency_key` propagé via header `x-idempotency-key` + log `audit_logs.action='refund.replay'`. **POS** : 6 fichiers modifiés (refund hook+modal, tablet hook+page+checkout button) avec `useRef(crypto.randomUUID())` lifecycle. **Tests** : pgTAP 8/8 PASS, Vitest live 5 scénarios authored (live run needs SUPABASE_SERVICE_ROLE_KEY), POS smoke 4/4 PASS, typecheck 6/6 PASS. **CLAUDE.md** : Critical patterns enrichi (PIN-en-header + Idempotency 2-flavors). Closes TASK-17-002 (DONE), TASK-03-001/002 (refund EF side), gaps audit S23 03-1 / 03-2 / 17-1. (18 commits, 3 waves, 6 migrations) |
| S26 | 2026-05-20 | swarm/session-26 | Comptable Cockpit Wave 1 DB hardening NON-PKP. **ADR-003** ratification NON-PKP. **DB** 17 migrations `20260603000010..026` : `current_pb1_rate()` helper, bump `create_sale_journal_entry` PB1 dynamic + split par order_payments.method, bump `create_purchase_journal_entry` fold PPN dans INVENTORY, `calculate_pb1_payable_v1` (drop `calculate_vat_payable`), `record_cash_movement_v2` (drop v1) émet JE selon reason_code, dedupe sale_void+refund dans P&L+BS, COA cleanup (seed 3200 + reclass 5910 + désactiver 1151). **4 RPCs cockpit** : `close_fiscal_period_v1`, `get_general_ledger_v1`, `get_trial_balance_v1`, `create_manual_je_v1`. **Perms** 6 : `accounting.*`. pgTAP 15/15 PASS. (10 commits, 17 migrations) |
| S26b | 2026-05-23 | swarm/session-26b | Comptable Cockpit UI core. **6 pages BO** (COA+toggle inline, JE+drilldown+OD modal, GL keyset paginate, TrialBalance+CSV, FiscalPeriod, Settings Accounting) + **1 RPC** `update_account_active_v1`. pgTAP 4/4 + BO smoke 12/12 PASS. Closes TASK-10-011 (DONE), TASK-10-016 (DONE). (5 commits, 1 migration) |
| S27/27b | 2026-05-20 | PR #30 | Product CRUD : update + create + categories. **DB** 27 migrations (18 catch-up + 9 new) : `update_product_v1`, `create_product_v1`, `create/update/reorder_categories_v1` + REVOKE pairs. **BO** : ProductDetailPage save flow, NewProductDialog, CategoriesPage DnD. pgTAP 10/10 + BO smoke 4/4 PASS. Closes TASK-05-002, 05-006, 05-007. |
| S27c | 2026-05-24 | swarm/session-27c | Product Variants (TASK-05-003). Architecture Linked-Products : 4 cols nullables + ENUM variant_axis_type + CHECK XOR + trigger anti-nesting. **6 RPCs** + REVOKE pairs. **BO** VariantsPanel 3-case + 5 components + DnD. **POS** VariantSelectModal + useProducts filter. pgTAP 20/20 + BO smoke 10/10 + POS smoke 4/4 PASS. (34 commits, 19 migrations) |
| S28 | 2026-05-24 | swarm/session-28 | Expense Governance (TASK-11-001 + gaps 11-1 à 11-4). Architecture snapshot-at-submit. **2 tables** : `expense_approval_thresholds` + `expense_approvals`. **5 RPCs** : `submit_expense_v2`, `approve_expense_v2` (SOD + multi-step), `set/delete_expense_threshold_v1`, trigger `sync_cash_expense_to_session`. **BO** 4 components + 5 hooks + `/settings/expense-thresholds`. pgTAP 18/18 + BO smoke 8/8 PASS. (31 commits, 16 migrations) |
| S29 | 2026-05-24 | swarm/session-29 | Reports Export + Z-Report PDF Vague A (TASK-14-005 + TASK-12-002 + gap 14-3). **Flow 2-temps Z-Report** : `close_shift_v2` snapshot JSONB → EF `generate-zreport-pdf` PDF async bucket `zreports/` 7 ans → `sign_zreport_v1` PIN header. **EF `generate-pdf`** 12 templates. **Domain** `buildCsv` TDD 9/9 + `previousPeriod/formatDelta` TDD 9/9. **BO** : ZReportsListPage + 5 components + 6 hooks + ExportButtons 13 pages + DateRangePickerWithCompare 5 reports. **POS** `useCloseShift` v2. pgTAP 14/14 + BO smoke 345/345 + POS smoke 327/327 + domain unit 18/18 + Vitest live 12 env-gated PASS. (30 commits, 14 migrations `20260606000010..023`) |
| S30 | 2026-05-24 | swarm/session-30 | Vague B : 5 bakery reports (Wastage, Payment by Method, VAT/PB1, Stock Movement, Perishable Turnover) — promote 5 Soon cards du hub à actives, réutilise infra S29 (15 commits, 10 migrations `20260615000010..019` + `20260524231049..124`, 0 nouvelle perm) |

### Cadence prévisionnelle

Le rythme actuel est de **~1 session tous les 1-3 jours**, taille variable (5-68 commits, 1-32 migrations). Pas de sprint formel — chaque session a son **INDEX** (`docs/workplan/plans/2026-MM-DD-session-N-INDEX.md`) qui sert de plan et de récap après merge. Les sessions sont organisées en Waves (0=spec, 1=DB+domain, 2=UI+BO, 3=review+types regen, 4=closeout).

- **Session 23+ : TBD** — triage post-S22 merge. Candidats : compliance fiscale (si PKP confirmé) | WAC landed cost shipping/douane pro-rata (TASK-07-012 finir — DEV-S17-1.B-01 closed S22) | mobile shell Capacitor | DEV-S21-1.A.1-04 (rotate cron secret to vault.secrets) | quality reviewer NICE-TO-HAVE polish (S22 INDEX §10 informational items).

---

## Indicateurs de santé (V3 monorepo)

| Indicateur | Cible | État actuel (2026-05-17) |
|------------|-------|--------------------------|
| `select('*')` dans `apps/` ou `packages/` | 0 | À auditer (audit V2 historique : 3 résiduels) |
| Phantom tables/RPCs | 0 | `stock_reservations` DONE S13 ; `system_alerts` / `customer_invoices` à vérifier |
| Fichiers > 500 lignes (CLAUDE.md rule) | 0 | À auditer périodiquement (BakerPreviewPanel.tsx extrait S15 pour rester sous 500) |
| Test coverage modules critiques | 70 % lines / 60 % branches | À mesurer (S15 a ajouté ~50+ tests Vitest + pgTAP, S19 ajoute 17 tests pgTAP + EF/cross-instance) |
| RLS `anon USING(true)` sur tables PII | 0 | PII tables traitées S13 ; 16 historiques à recompter et purger |
| Findings P0 audits 2026-04 | 0 | DONE (Global Audit & Fixes 2026-04-09 + S13 P0 cleanup) |
| Findings P1 audits 2026-04 | < 10 | 37+ historiques, plusieurs résolus en S13-S19 (à recompter) |
| Migrations cloud V3 dev appliquées | monotonic, no drift | OK (`list_migrations` MCP, dernier bloc S19 `20260523000022`) |
| pgTAP nightly cron | green | DONE S16 (`.github/workflows/pgtap-nightly.yml`) |
| TypeScript types regen post-migration | toujours | Convention CLAUDE.md, à vérifier régulièrement |
| Durable Postgres rate-limit sur EFs auth/order | enabled | DONE S19 (5 EFs wired : `auth-verify-pin`, `kiosk-issue-jwt` ×2, `refund-order`, `void-order`, `cancel-item`) |
| Session timeout per role | configurable | DONE S19 (`roles.session_timeout_minutes` + `/settings/security` BO page) |
| anon GRANTs / EXECUTE on `public.*` | 0 | DONE S20 (tables + views + functions, ALTER DEFAULT PRIVILEGES future-proofed) |
| Items hardening reliquat S13-S19 fermés | 8/8 | DONE S21 |
| Modal focus-trap audit | locked-in | DONE S22 (16 RTL tests on Dialog/Sheet/FullScreenModal/CenterModal + ESLint `no-raw-modal-overlay` rule wired at `error` in root flat config + 1 pre-existing raw overlay remediated in MarginWatchPage) |
| WAC bypass guard sur `products.cost_price` | enabled | DONE S22 (column-level REVOKE UPDATE + RPC `update_cost_price_v1` SECURITY DEFINER + audit row in `stock_movements` movement_type=`cost_price_correction`) |
| HTTP 429 `Retry-After` header sur EFs rate-limited | enabled | DONE S22 (5 EFs : `auth-verify-pin`, `kiosk-issue-jwt` ×2 buckets, `refund-order`, `void-order`, `cancel-item` via `_shared/responses.ts` helper) |
| B2B AR aging réel (sur invoice_date, pas last_visit_at) | enabled | DONE S24 (`view_ar_aging` + `view_b2b_invoices` buckets current/31-60/61-90/90+ ; useB2bDashboard reads the view) |
| B2B credit limit enforcement (RPC câblé dans le path order) | enabled | DONE S24 (`create_b2b_order_v1` calls `validate_b2b_credit_limit_v1` pre-insert + raise `credit_limit_exceeded` P0011 with payload would_exceed_by) |
| B2B paiement ledger (audit append-only) | enabled | DONE S24 (`b2b_payments` table, REVOKE INSERT/UPDATE/DELETE + `record_b2b_payment_v1` SECURITY DEFINER + JE DR Cash/Bank / CR B2B_AR) |
| refund-order idempotent | enabled | DONE S25 (`p_idempotency_key` wired via `x-idempotency-key` header → `refund_order_rpc_v2` ; POS `useRef(crypto.randomUUID())` lifecycle + replay envelope + `audit_logs.action='refund.replay'`) |
| create_tablet_order idempotent | enabled | DONE S25 (`create_tablet_order_v2` avec `p_client_uuid` + table dédiée `tablet_order_idempotency_keys` ; v1 dropped same migration ; POS `useRef` lifecycle sur `TabletOrderPage` + `TabletCheckoutButton`) |
| PIN-en-header pattern | enabled | DONE S25 (hard cutover `refund-order` PIN body → header `x-manager-pin` ; helper `_shared/idempotency.ts` ; pattern à étendre aux autres EF managériaux `void-order`, `cancel-item`, `kiosk-issue-jwt` S26+) |

---

## Pointeurs vers les fichiers backlog par module

| Module | Fichier | Items |
|--------|---------|-------|
| Auth & Permissions | [`01-auth-permissions.md`](./01-auth-permissions.md) | 10 (S19 closes TASK-01-002 follow-up, 006, 008) |
| POS / Cart / Orders | [`02-pos-cart-orders.md`](./02-pos-cart-orders.md) | 27 |
| Payments & Split | [`03-payments-split.md`](./03-payments-split.md) | 7 |
| KDS / Kitchen | [`04-kds-kitchen.md`](./04-kds-kitchen.md) | 17 |
| Products / Categories | [`05-products-categories.md`](./05-products-categories.md) | 8 |
| Inventory / Stock | [`06-inventory-stock.md`](./06-inventory-stock.md) | 11 (S17 WAC) |
| Purchasing / Suppliers | [`07-purchasing-suppliers.md`](./07-purchasing-suppliers.md) | 14 |
| Customers / Loyalty | [`08-customers-loyalty.md`](./08-customers-loyalty.md) | 12 |
| B2B / Wholesale | [`09-b2b-wholesale.md`](./09-b2b-wholesale.md) | 17 |
| Accounting (double-entry) | [`10-accounting-double-entry.md`](./10-accounting-double-entry.md) | 22 |
| Expenses | [`11-expenses.md`](./11-expenses.md) | 11 |
| Cash Register / Shift | [`12-cash-register-shift.md`](./12-cash-register-shift.md) | 12 (S29 TASK-12-002 Z-Report PDF signable DONE) |
| Promotions & Discounts | [`13-promotions-discounts.md`](./13-promotions-discounts.md) | 12 |
| Reports & Analytics | [`14-reports-analytics.md`](./14-reports-analytics.md) | 21 (S18 cost history ; S29 TASK-14-005 compare DONE + gap 14-3 CSV/PDF DONE ; reste Vague B/C S30+) |
| Production & Recipes | [`15-production-recipes.md`](./15-production-recipes.md) | 12 (9 DONE S15-S18) |
| Display Customer | [`16-display-customer.md`](./16-display-customer.md) | 13 |
| Tablet Ordering | [`17-tablet-ordering.md`](./17-tablet-ordering.md) | 14 |
| Mobile Shell | [`18-mobile-shell.md`](./18-mobile-shell.md) | 10 (bloqué Capacitor) |
| Settings & Configuration | [`19-settings-configuration.md`](./19-settings-configuration.md) | 14 (S19 `/settings/security`) |
| Users / RBAC | [`20-users-rbac.md`](./20-users-rbac.md) | 16 |
| LAN Architecture | [`21-lan-architecture.md`](./21-lan-architecture.md) | 11 |
| Design System | [`22-design-system.md`](./22-design-system.md) | 13 |
| Tests | [`23-tests.md`](./23-tests.md) | 12 (S16 pgTAP nightly, S19 +17 tests) |
| Deployment & Ops | [`24-deployment-ops.md`](./24-deployment-ops.md) | 11 |
| Security | [`25-security.md`](./25-security.md) | 17 (S19 closes rate-limit + REVOKE-anon hardening) |

**Total : 25 modules, ~344 items, ~88 DONE (S13-S19).**

---

## Conventions de mise à jour

- Statut item : `[TODO]`, `[DOING]`, `[DONE]`, `[BLOCKED]`, `[OBSOLETE]` en suffixe du titre H3 (voir [`00-README.md`](./00-README.md) pour la légende complète).
- **Append-only Status notes** : ne jamais réécrire une `**Status note (YYYY-MM-DD)**` existante. Ajouter une nouvelle ligne datée avec préfixe `S15 update:` / `S16 update:` / `S17 update:` / `S18 update:` / `S19 update:` (etc.) sous la note précédente.
- **Source de vérité par session** : `docs/workplan/plans/2026-MM-DD-session-N-INDEX.md` (deliverables + deviations §10/§13 selon session).
- **WONTFIX** : convention non-formelle (pas de statut dédié), tracée en Status note avec mention `WONTFIX YYYY-MM-DD per user decision` et lien vers memory si applicable. Exemple : DEV-S15-5.C-01 allergens receipt/display (memory `project_allergens_wontfix`).
