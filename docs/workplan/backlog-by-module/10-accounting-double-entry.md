# Travail — Accounting (Double-Entry)

> Last updated: 2026-05-03
> Référence : `docs/reference/04-modules/10-accounting-double-entry.md` (à créer — module non encore documenté en référence)
> Sources d'audit : `docs/audit/02-accounting-business-audit.md` (Mary, B-/72%, 5 P0), `docs/audit/00-executive-summary.md`, `docs/audit/IMPLEMENTATION_PLAN.md` Phase 1
> Contexte : module avec le plus gros backlog de l'audit global (5 P0 + 6 P1 + 5 P2 + 5 P3).

## Objectifs du module

1. **Restaurer l'intégrité des écritures comptables** post-régressions migrations 2026-04 (P0 Mary 1-5) — chaque vente doit créer un JE équilibré vers les BONS comptes du COA seedé (pas de hardcoded `1110/4100/2110` inexistants).
2. **Couvrir 100% des 16 types de transactions** par un JE auto, avec contrainte `reference_type` CHECK alignée sur les types réellement émis par le moteur TS.
3. **Aligner SAK EMKM 100%** : 3 états financiers (BS, IS, CALK) cohérents, équation comptable A=L+E qui balance vraiment, calcul VAT mensuel correct.
4. **Outiller la conciliation bancaire** semi-automatique pour traiter ≤ 30 minutes/mois les rapprochements (au lieu de manuel).
5. **Verrouiller les périodes fiscales** (`fiscal_periods.is_locked`) pour empêcher toute modification rétroactive après clôture mensuelle.
6. **Fournir une UI Admin pour les mappings** (`accounting_mappings`) afin que le comptable puisse maintenir les correspondances `mapping_key → account_code` sans migration SQL.

## Tâches

### TASK-10-001 — Restaurer le sale trigger unifié avec mapping resolution + fiscal guard [P0] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 1.A. V3 evidence: `supabase/migrations/20260517000010_refactor_create_sale_journal_entry.sql` rebuilds `create_sale_journal_entry()` with `resolve_mapping_account()` + `check_fiscal_period_open()` + `next_journal_entry_number()` + idempotency SELECT on existing JE. Commit `bdf21aa` (squashed PR #13).
**Contexte** : Mary P0-1 — migration `20260402120000_add_fiscal_period_guard_to_journal_triggers.sql` écrase `create_sale_journal_entry()` (version mapping de `20260330600100`) avec une version hardcodée référençant `1110/1130/1131/1132/4100/2110/4190` qui n'existent PAS dans le COA seedé (codes réels : `1113/1114/1115/1116/4111/2143/4131`). Impact : chaque vente POS crée des JE silencieusement faux ou échoue.
**Critère d'acceptation** :
- [ ] Nouvelle migration `YYYYMMDD_restore_unified_sale_trigger.sql` qui DROP+CREATE OR REPLACE `create_sale_journal_entry()` avec : appel `resolve_mapping_account()` pour chaque ligne ; idempotence via SELECT prélable sur `journal_entries(reference_type, reference_id)` ; usage `next_journal_entry_number()` (pas COUNT) ; guard `is_fiscal_period_closed(p_date)` au début ; nesting du discount (pas DR séparé).
- [ ] Test SQL : insérer `orders(status='completed')` → vérifier 1 JE créé, lignes équilibrées, comptes correspondent à `SALE_PAYMENT_*` + `SALE_POS_REVENUE` + `SALE_PB1_TAX` + `SALE_DISCOUNT`.
- [ ] Test re-exécution même order : 0 nouveau JE (idempotence).
- [ ] Test order période fiscale fermée → exception explicite.
**Fichiers concernés** : `supabase/migrations/YYYYMMDD_restore_unified_sale_trigger.sql`, `src/services/accounting/__tests__/saleTrigger.smoke.test.ts` (nouveau).
**Dépend de** : aucune (hotfix immédiat)
**Estimation** : M
**Risques** : casser un comportement encore utilisé en production — rollback prêt (revert migration). Vérifier que les JE déjà créés en prod restent valides (pas de retro-fix).
**Notes** : suivre `IMPLEMENTATION_PLAN.md` Phase 1.1. Pitfall trigger SQL (CLAUDE.md) : "trigger functions can only be called as triggers" → smoke test via `pg_proc`.

### TASK-10-002 — Corriger ou supprimer le stock_movement trigger mort [P0] [OBSOLETE]
**Status note (2026-05-14)** : V2 broken trigger never existed in V3 — superseded by built-from-scratch `tr_stock_movement_je()` (Phase 1.A migrations `20260517000022` + `20260517000023`) which uses `resolve_mapping_account()` + `check_fiscal_period_open()` + idempotency UNIQUE on `(reference_type, reference_id, metadata->>'movement_type')`. No V2-style "dead trigger" to drop. Commit `bdf21aa` (squashed PR #13).
**Contexte** : Mary P0-2 — `create_stock_movement_journal_entry()` (migration `20260402110000`) référence colonnes `mapping_code` + `mapping_type` qui N'EXISTENT PAS dans `accounting_mappings`. Le trigger échoue silencieusement à chaque mouvement de stock. Risque : si un dev "fixe" le schéma sans virer le trigger, doublons JE avec le moteur TS (`postStockWasteJournalEntry` etc).
**Critère d'acceptation** :
- [ ] Décision documentée dans `docs/reference/04-modules/10-accounting-double-entry.md` : « la SOURCE est le moteur TS, pas le trigger DB ».
- [ ] Migration `YYYYMMDD_drop_stock_movement_trigger.sql` qui DROP TRIGGER + DROP FUNCTION.
- [ ] Test régression : insert stock_movement → vérifier qu'AUCUN JE n'est créé par le DB ; le moteur TS reste responsable.
**Fichiers concernés** : `supabase/migrations/YYYYMMDD_drop_stock_movement_trigger.sql`, `docs/reference/04-modules/10-accounting-double-entry.md` (à créer).
**Dépend de** : aucune
**Estimation** : S
**Risques** : faible — le trigger ne fait rien aujourd'hui.
**Notes** : alternative = corriger le trigger pour utiliser `resolve_mapping_account` mais alors RETIRER les wrappers TS pour éviter doublons. Choisir UN seul chemin.

### TASK-10-003 — Seeder le mapping `SALE_REVENUE` ou refactor `accountingEngine.ts` [P0] [OBSOLETE]
**Status note (2026-05-14)** : V2 `accountingEngine.ts` does not exist in V3 (D20: JE construction lives in DB triggers, no TS engine layer). V3 sale trigger (`20260517000010`) resolves via `SALE_POS_REVENUE` mapping seeded in `20260517000001` + `20260517000005`. No `SALE_REVENUE` key needed; outstanding path covered by trigger `status` branching. Commit `bdf21aa`.
**Contexte** : Mary P0-3 — `postPOSOutstandingJE()` ligne 603 utilise mapping key `SALE_REVENUE` qui n'a JAMAIS été seedé. Toutes les ventes outstanding (commandes payées en `outstanding`/`pay_later`) ont un JE silencieusement échoué (CR Revenue line non résolu).
**Critère d'acceptation** :
- [ ] Option A : migration `YYYYMMDD_seed_sale_revenue_mapping.sql` insère `('SALE_REVENUE', '4111')` dans `accounting_mappings`.
- [ ] OU Option B : `accountingEngine.ts` ligne 603 remplace `'SALE_REVENUE'` par `'SALE_POS_REVENUE'` (déjà seedé).
- [ ] Test : créer order outstanding via `postPOSOutstandingJE` → vérifier ligne CR sur compte 4111 présente.
- [ ] Smoke check : `SELECT mapping_key FROM accounting_mappings` ne contient AUCUNE clé inutilisée par le moteur (audit lexical bidirectionnel).
**Fichiers concernés** : migration OU `src/services/accounting/accountingEngine.ts:603`, `src/services/accounting/__tests__/accountingEngine.test.ts`.
**Dépend de** : aucune
**Estimation** : S
**Risques** : si choix Option A, attention à ne pas créer de DOUBLON avec `SALE_POS_REVENUE` (même compte 4111). Préférer Option B (refactor TS) pour éviter dette mapping.
**Notes** : `IMPLEMENTATION_PLAN.md` Phase 1.3. Cf. CLAUDE.md pitfall « After SQL changes, run `/gen-types` ».

### TASK-10-004 — Étendre la contrainte CHECK `reference_type` (4 types manquants) [P0] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 1.A. V3 evidence: `supabase/migrations/20260517000003_extend_reference_type_check.sql` drops and recreates the CHECK with 17 types (sale, sale_void, sale_refund, purchase, purchase_return, purchase_payment, expense, expense_payment, shift_close, adjustment, waste, opname, production, transfer, manual, pos_outstanding, pos_outstanding_payment). Commit `bdf21aa`.
**Contexte** : Mary P0-5 / P1 — `journal_entries.reference_type` CHECK liste 12 types mais le moteur en émet 16 : MANQUE `production`, `purchase_return`, `pos_outstanding`, `pos_outstanding_payment`. Tout JE de ces 4 types lève une CHECK violation Postgres → fonctionnalités prod-ready côté UI mais cassées côté DB.
**Critère d'acceptation** :
- [ ] Migration `YYYYMMDD_extend_reference_type_check.sql` : `ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_reference_type_check; ADD CONSTRAINT … CHECK (reference_type IN (16 types complets))`.
- [ ] Test : créer un JE `reference_type='production'` via `postProductionJournalEntry` → succès (200).
- [ ] Test : créer un JE `reference_type='invalid_type'` → erreur 500 (CHECK).
- [ ] `/gen-types` post-migration pour rafraîchir éventuels types TS.
**Fichiers concernés** : migration, tests d'intégration moteur.
**Dépend de** : aucune
**Estimation** : S
**Risques** : aucun — élargir une CHECK ne casse rien.
**Notes** : `IMPLEMENTATION_PLAN.md` Phase 1.5. Pitfall (CLAUDE.md) sur DDL postgres : tester en branche Supabase avant prod.

### TASK-10-005 — Corriger les codes comptes dans `calculate_vat_payable` RPC [P0] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 1.A. V3 evidence: `supabase/migrations/20260517000012_create_calculate_vat_payable_rpc.sql` builds the RPC from scratch using `resolve_mapping_account('SALE_PB1_TAX')` (account 2143) and `resolve_mapping_account('EXPENSE_VAT_INPUT')` (account 1151) — no hardcoded codes. Commit `bdf21aa`.
**Contexte** : Mary P0 / P1-1 — RPC référence `a.code = '2110'` (PPN collected) et `a.code = '1400'` (PPN deductible) MAIS les comptes seedés sont `2143` et `1151`. Conséquence : la RPC retourne TOUJOURS zéro. Affecte la page VAT Management, la section CALK Tax, et le workflow SPT mensuel.
**Critère d'acceptation** :
- [ ] Migration `YYYYMMDD_fix_vat_account_codes_in_rpc.sql` : `CREATE OR REPLACE FUNCTION calculate_vat_payable` avec `resolve_mapping_account('SALE_PB1_TAX')` et `resolve_mapping_account('PURCHASE_VAT_INPUT')` (au lieu de codes hardcodés).
- [ ] Test : créer 1 sale (PB1 collected) + 1 expense (VAT input) sur la même période → RPC retourne `(collected: X, deductible: Y, payable: X-Y)` non-nul.
- [ ] Page `/accounting/vat-management` affiche désormais les vrais montants (manuel test).
**Fichiers concernés** : migration, `src/services/accounting/vatService.ts`, `src/hooks/accounting/useVATManagement.ts`, tests.
**Dépend de** : `TASK-10-001` (le sale trigger doit être correct pour générer les CR `SALE_PB1_TAX`).
**Estimation** : M
**Risques** : si le module pre-existing comptait sur les zéros (workflows manuels), surprise lors du fix — communiquer aux utilisateurs.
**Notes** : `IMPLEMENTATION_PLAN.md` Phase 1.6. Préférer la version `resolve_mapping_account()` (P3-1 audit) à un nouveau hardcode.

### TASK-10-006 — Refactor `create_purchase_journal_entry` pour usage mapping unifié [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 1.A + Wave 4 attach. V3 evidence: `supabase/migrations/20260517000011_create_purchase_journal_entry_trigger.sql` creates the function with `resolve_mapping_account()` for PURCHASE_PAYABLE / PURCHASE_VAT_INPUT / INVENTORY_GENERAL + idempotency + fiscal guard; `20260517000113_attach_purchase_je_trigger.sql` attaches it on `goods_receipt_notes`. Commit `bdf21aa`.
**Contexte** : Mary P1-2 — trigger purchase utilise les vieux codes `1300/1110/1400/2100/5100`. Idem patho que sale trigger : codes inexistants dans le COA actuel. Doit passer par `resolve_mapping_account()` (PURCHASE_PAYABLE, PURCHASE_VAT_INPUT, PURCHASE_CASH_OUT, INVENTORY_GENERAL).
**Critère d'acceptation** :
- [ ] Migration `YYYYMMDD_unify_purchase_trigger.sql` : `CREATE OR REPLACE FUNCTION create_purchase_journal_entry()` utilisant resolve_mapping_account.
- [ ] Test : créer purchase_order status `received` → JE créé avec lignes DR INVENTORY_GENERAL + DR PURCHASE_VAT_INPUT (si VAT) + CR PURCHASE_PAYABLE.
- [ ] Idempotence + fiscal guard alignés sur la version sale (TASK-10-001).
- [ ] Audit comparatif via `/accounting-audit` : 0 trigger restant utilisant des codes hardcodés.
**Fichiers concernés** : migration, smoke tests, audit re-run.
**Dépend de** : `TASK-10-001` (cohérence d'approche).
**Estimation** : M
**Risques** : données prod déjà créées avec ce trigger sont déjà en BD ; pas de retrofix automatique.
**Notes** : `IMPLEMENTATION_PLAN.md` Phase 1.7.

### TASK-10-007 — Combler le mapping `PRODUCTION_COGS` (compte non-postable) [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 1.A. V3 evidence: `supabase/migrations/20260517000005_seed_full_coa_sak_emkm.sql` seeds account `5110 'Production COGS Direct'` (postable=true) and maps `PRODUCTION_COGS → 5110` (line 97). Group `5100` (non-postable) preserved as parent. Commit `bdf21aa`.
**Contexte** : Mary P1-1 — `PRODUCTION_COGS` mappé sur `5100` qui est `node_type='GROUP', is_postable=false`. Le cache moteur filtre `is_postable=true` → mapping résout NULL → JEs production échouent silencieusement.
**Critère d'acceptation** :
- [ ] Migration `YYYYMMDD_add_production_cogs_account.sql` : INSERT account `5101 'Production COGS - Direct'` (parent 5100, is_postable=true) + UPDATE mapping `PRODUCTION_COGS → '5101'`.
- [ ] Test : créer production_record + appeler `postProductionJournalEntry` → JE créé avec ligne DR sur 5101.
- [ ] Hierarchy validation : `5100` reste GROUP, `5101` est ACCOUNT enfant.
**Fichiers concernés** : migration, smoke tests engine.
**Dépend de** : `TASK-10-004` (CHECK constraint doit accepter `production` reference_type).
**Estimation** : S
**Risques** : si rapports financiers groupent par compte, `5100` n'aura plus de transactions directes (uniquement via 5101) — vérifier vues `view_profit_loss`.
**Notes** : option alternative = passer 5100 en `is_postable=true` mais casserait la sémantique GROUP.

### TASK-10-008 — Ajouter "Current Year Earnings" au Balance Sheet (compte 3300) [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 1.A + Phase 6.A. V3 evidence: `supabase/migrations/20260517000004_add_current_year_earnings_account.sql` seeds account `3300 'Current Year Earnings'` (equity, non-postable); `20260517000211_create_balance_sheet_rpc.sql` computes CYE and BO consumes via `BalanceSheetPage.tsx` + `useBalanceSheet.ts`. Commit `bdf21aa`.
**Contexte** : Mary P1-4 — pas de compte `3300` ni calcul inline. L'équation A=L+E ne balance JAMAIS en pratique car les revenue/expense accumulés ne sont reflétés en équité qu'au year-end close. Bloquant pour publication d'états financiers crédibles.
**Critère d'acceptation** :
- [ ] Migration `YYYYMMDD_add_current_year_earnings.sql` : INSERT account `3300 'Current Year Earnings'` (type equity, is_postable=false par convention).
- [ ] RPC `get_balance_sheet_data` ajoute une ligne calculée : `current_year_earnings = SUM(revenue.balance) - SUM(expense.balance)` sur la fiscal year courante.
- [ ] Hook `useBalanceSheet` recalcule `isBalanced = abs((assets) - (liabilities + equity + currentYearEarnings)) < 1`.
- [ ] Test : BS sur un mois où il y a eu 1 sale → `currentYearEarnings > 0` ; A = L + E + CYE.
**Fichiers concernés** : migration, RPC SQL, `src/hooks/accounting/useBalanceSheet.ts`, composant `BalanceSheetTab`.
**Dépend de** : `TASK-10-001` (sale trigger fiable pour que revenue soit correct).
**Estimation** : M
**Risques** : changements visibles UI BS — communiquer comptable.
**Notes** : alternative pure code (pas de migration) si on calcule 100% côté hook ; mais avoir le compte permet le year-end close (zero out).

### TASK-10-009 — Bank reconciliation : auto-matching + auto-JE adjustments [P2] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `bank_reconciliations` table or service in V3. Still applicable, scheduled Session 14+. Pre-req `TASK-10-001` (sale JE fiable) now satisfied so this can proceed.
**Contexte** : Mary P3-3 — `useBankReconciliation` permet de matcher manuellement mais aucun auto-matching ni JE auto pour les frais/intérêts non-matchés. Comptable fait tout à la main.
**Critère d'acceptation** :
- [ ] Service `bankReconciliationService.autoMatch(statementLines, journalEntries)` matche par (montant, date ±3j, référence ILIKE).
- [ ] Score de confiance par match (0-100%) ; UI propose acceptation > 80%, manuel < 80%.
- [ ] Bouton "Create JE for unmatched" génère un JE manuel pré-rempli (frais bancaires, intérêts) via `postManualJournalEntry`.
- [ ] Persist `bank_reconciliations(statement_period, status, matched_count, unmatched_count)`.
**Fichiers concernés** : `src/services/accounting/bankReconciliationService.ts`, `src/hooks/accounting/useBankReconciliation.ts`, page `/accounting/bank-reconciliation`, migration `bank_reconciliations`.
**Dépend de** : `TASK-10-001` (JE moteur fiable).
**Estimation** : L
**Risques** : faux positifs auto-match → comptable doit pouvoir ré-ouvrir.
**Notes** : import format CSV bancaire (BCA, Mandiri) à supporter — formats variés.

### TASK-10-010 — UI Admin pour gestion des `accounting_mappings` [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 6.C. V3 evidence: `apps/backoffice/src/pages/accounting/MappingsPage.tsx` + `apps/backoffice/src/features/accounting-mappings/components/MappingEditDialog.tsx` + RPC `supabase/migrations/20260517000230_create_update_mapping_rpc.sql` (`update_accounting_mapping_v1`) write to `audit_logs` per change. Permission gate via `accounting.mapping.update`. Commit `bdf21aa`.
**Contexte** : Aujourd'hui, ajouter ou modifier une mapping_key requiert une migration SQL. Le comptable n'a pas la main. Audit `/accounting-audit` recommande un panneau admin pour visualiser et éditer (avec garde-fou : un mapping_key utilisé en code ne peut pas être supprimé).
**Critère d'acceptation** :
- [ ] Page `/accounting/mappings` (permission `accounting.manage`) liste toutes les `accounting_mappings`, statut actif/inactif, compte cible, description.
- [ ] CRUD : créer / modifier (changer le account_code) / désactiver. Suppression bloquée si utilisé en code (registry hardcodé `USED_MAPPING_KEYS`).
- [ ] Audit log de toute modification.
- [ ] Validation : `account_code` doit exister ET être `is_postable=true`.
**Fichiers concernés** : `src/pages/accounting/MappingsPage.tsx`, `src/hooks/accounting/useAccountingMappings.ts`, `src/services/accounting/mappingsService.ts`.
**Dépend de** : aucune
**Estimation** : M
**Risques** : modifier un mapping en cours d'année change l'imputation de TOUTES les nouvelles transactions — bien afficher cet impact.
**Notes** : registry `USED_MAPPING_KEYS` peut être généré par un script `scripts/audit-mapping-keys.mjs`.

### TASK-10-011 — Verrouillage périodes fiscales : UI + workflow mensuel [P1] [TODO]
**Status note (2026-05-14)** : Partially delivered — Phase 1.A migration `20260517000002_init_fiscal_periods.sql` creates `fiscal_periods` table + `check_fiscal_period_open()` guard + seeds 24 months (Jan 2026 → Dec 2027), and triggers respect the guard (`P0004 period_locked`). MISSING in V3: BO page `/accounting/fiscal-periods`, close/lock RPCs, manager-PIN workflow. UI work still applicable, scheduled Session 14+.
**Contexte** : `is_fiscal_period_closed()` existe (utilisé par triggers post-TASK-10-001) MAIS aucune UI claire pour fermer un mois ni workflow contrôlé. Aujourd'hui, `fiscal_periods.is_locked` se modifie en SQL.
**Critère d'acceptation** :
- [ ] Page `/accounting/fiscal-periods` liste les périodes (mois en cours, passés, futurs) avec statut `open/closed/locked`.
- [ ] Action "Close period" : exécute checks préalables (toutes orders completed/voided ; toute writeoff approuvé ; pas de JE draft) ; passe en `closed`.
- [ ] Action "Lock period" (manager only + manager PIN) : empêche toute édition rétroactive.
- [ ] Toute tentative d'écriture sur période lockée → 403 explicite côté UI (pas erreur 500 obscure).
- [ ] Audit log : qui a fermé/locked + timestamp.
**Fichiers concernés** : page, hook `useFiscalPeriods` (existe), service, RPC `close_fiscal_period(p_period_id)` + `lock_fiscal_period(p_period_id)`.
**Dépend de** : `TASK-10-001` (triggers respectent déjà le guard).
**Estimation** : L
**Risques** : si le close est buggé et bloque toute écriture → procédure d'urgence (admin SQL). Documenter dans le module ref.
**Notes** : workflow comptable type — fermer J+5 mois suivant, locker J+30 après visa expert-comptable.

### TASK-10-012 — Cash Flow Statement (3e pilier financier — F7 backlog) [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 6.A (MVP). V3 evidence: `supabase/migrations/20260517000212_create_cash_flow_rpc.sql` (`get_cash_flow_v1` — indirect method) + `apps/backoffice/src/pages/reports/CashFlowPage.tsx` + `useCashFlow.ts`. Operating section fully computed; Investing/Financing return zero pending fixed-assets/loans modules (deviation `D-W6-6A-2`, follow-up Session 14+). UI renders all 3 sections so wiring is stable.
**Contexte** : `CURRENT_STATE.md` Remaining Backlog F7 + audit produit Gap 6. BS+IS implementés, mais pas de Cash Flow Statement (méthode indirecte SAK EMKM). Bloquant pour reporting bancaire/investisseur.
**Critère d'acceptation** :
- [ ] RPC `get_cash_flow_data(p_start_date, p_end_date)` retourne 3 sections : Operating (net income + non-cash + WC changes), Investing, Financing.
- [ ] Hook `useCashFlowStatement` + page `/accounting/cash-flow`.
- [ ] PDF export aligné avec template BS/IS (même header, même footer).
- [ ] CALK référence le Cash Flow dans la section "État de trésorerie" (mise à jour `calkService`).
- [ ] Test : sur une période avec sale + purchase + expense → cash flow opérationnel calculé correctement.
**Fichiers concernés** : RPC SQL, hook, page, service, calkService update.
**Dépend de** : `TASK-10-001`, `TASK-10-008`.
**Estimation** : L
**Risques** : méthode indirecte demande catégorisation des comptes (operating vs investing vs financing) — ajouter `accounts.cash_flow_category` enum.
**Notes** : SAK EMKM Bab 3.7 décrit la méthode minimum acceptable.

### TASK-10-013 — Audit trail JE modifications [P2] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `journal_entries_audit_log` table or immutability triggers in V3. JE modifications are governed by the trigger model (idempotent insertion) but no full before/after audit. Still applicable, scheduled Session 14+.
**Contexte** : Aujourd'hui, un JE en statut `draft` peut être édité ; `posted` peut être voided puis re-créé. Pas de full audit trail (qui a modifié quoi quand). Risque conformité SAK EMKM (immutabilité).
**Critère d'acceptation** :
- [ ] Trigger `audit_journal_entry_changes` insère dans `journal_entries_audit_log` à tout UPDATE (avant/après JSON, user, timestamp).
- [ ] Lignes (`journal_entry_lines`) idem.
- [ ] UI `JournalEntryDetailPage` affiche un onglet "Modifications" avec timeline.
- [ ] Aucun JE `posted/locked` ne peut être HARD updated (seulement void + re-create) — RLS UPDATE check.
**Fichiers concernés** : migration audit table + triggers, composant timeline, RLS policies.
**Dépend de** : aucune
**Estimation** : M
**Risques** : volume audit log → partition mensuelle ou rétention 7 ans (obligation Indonésie).
**Notes** : reuse pattern `audit_logs` existant.

---

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/objectif travail/ACCOUNTING.md` §18 — vision produit du module au-delà du tech-debt P0/P1.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13).

### TASK-10-014 — E-Faktur / e-Bupot integration [P2] [BLOCKED]
**Status note (2026-05-14)** : Explicitly deferred per INDEX Wave 7 (`docs/workplan/plans/2026-05-13-session-13-INDEX.md` line 1087 "e-Faktur DJP (Session 18)") and Out-of-scope table line 1210. Hard-blocked on external regulatory decision (passage au régime PPN).
**Contexte** : si The Breakery passe un jour sous régime PPN national (au-delà du seuil omzet réglementaire), l'intégration directe avec le système fiscal national (DJP : e-Faktur, e-Bupot) devient nécessaire pour générer les factures électroniques et les bulletins de retenue à la source.
**Bénéfice attendu** : conformité PPN sans ressaisie ; e-Faktur émis automatiquement sur chaque vente B2B éligible.
**Critère d'acceptation** :
- [ ] Étude de faisabilité API DJP (sandbox, prérequis NPWP, certificat numérique).
- [ ] Mapping `accounting_mappings` enrichi pour PPN_OUTPUT / PPN_INPUT (préparer mais ne pas activer).
- [ ] Toggle Settings → Financial → "Régime PPN" qui active la collecte e-Faktur sur les ventes éligibles.
- [ ] Génération e-Faktur XML conforme + workflow d'envoi / accusé.
**Dépend de** : passage effectif au régime PPN (décision externe).
**Estimation** : XL
**Risques** : changement réglementaire DJP fréquent — viser une couche d'abstraction `taxFilingProvider`.
**Notes** : impact transverse VAT Management page + CALK Tax section.

### TASK-10-015 — Amortissement automatique des immobilisations [P2] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `fixed_assets` table or amortisation cron in V3. Referenced indirectly by deviation `D-W6-6A-2` as the dependency that would enable Investing section of Cash Flow Statement. Still applicable, scheduled Session 14+.
**Contexte** : aujourd'hui aucune gestion des immobilisations — saisie manuelle d'OD mensuelle. Pour une vraie boulangerie avec four, frigos, mobilier, vitrines, c'est faux et fastidieux.
**Bénéfice attendu** : saisir un équipement, paramétrer la durée d'amortissement, le système génère l'écriture d'amortissement chaque mois.
**Critère d'acceptation** :
- [ ] Table `fixed_assets` (code, libellé, date acquisition, montant HT, durée, méthode linéaire/dégressif, compte amortissement, compte dotation).
- [ ] Job mensuel (cron Edge Function) qui calcule et poste l'écriture d'amortissement de chaque immobilisation active.
- [ ] Page `/accounting/fixed-assets` (permission `accounting.manage`) : CRUD immobilisations + visualisation des amortissements cumulés.
- [ ] Intégration au Balance Sheet : "Immobilisations nettes" = brutes − amortissements cumulés.
**Dépend de** : `TASK-10-011` (périodes fiscales) pour ne pas poster sur période fermée.
**Estimation** : L
**Risques** : changement de méthode en cours d'exercice non géré V1.
**Notes** : SAK EMKM autorise les deux méthodes (linéaire, dégressif). Par défaut linéaire.

### TASK-10-016 — Closing checklist mensuelle [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `/accounting/month-close` page or check RPCs in V3. Depends on `TASK-10-011` (fiscal periods UI). Still applicable, scheduled Session 14+.
**Contexte** : la clôture d'un mois est aujourd'hui implicite (le comptable suit son propre process Excel). Pas de garde-fou.
**Bénéfice attendu** : workflow guidé qui demande "as-tu réconcilié la banque ? validé les dépenses en attente ? déclaré la PB1 ? vérifié les opnames du mois ?" avant d'autoriser la clôture de la période.
**Critère d'acceptation** :
- [ ] Page `/accounting/month-close` qui liste les checks préalables avec leur statut (✅ / ❌ / ⚠️).
- [ ] Chaque check est une RPC : `check_bank_reconciled(p_period)`, `check_expenses_validated(p_period)`, `check_pb1_filed(p_period)`, `check_opnames_complete(p_period)`.
- [ ] Bouton "Close month" actif seulement si tous les checks bloquants sont verts.
- [ ] Trace audit : qui a fermé, à quelle date, avec quel statut de chaque check.
**Dépend de** : `TASK-10-011`.
**Estimation** : M
**Risques** : checks trop stricts → comptable bloqué → procédure d'override (manager PIN).
**Notes** : workflow inspiré des "month-end close" Xero / QuickBooks.

### TASK-10-017 — Comparatif budget vs réel [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `budgets` table or `view_budget_vs_actual` in V3. Still applicable, scheduled Session 14+.
**Contexte** : aucun module budget aujourd'hui. Le gérant ne sait pas s'il dépense plus que prévu en marketing, en achats matières premières, etc.
**Bénéfice attendu** : saisir un budget annuel par compte (ou par classe), voir en direct les écarts mensuels et cumulés.
**Critère d'acceptation** :
- [ ] Table `budgets` (year, account_id, period (year/month), amount).
- [ ] Page `/accounting/budget` : grille de saisie par compte × mois.
- [ ] Vue `view_budget_vs_actual` qui joint `budgets` + soldes mensuels des comptes.
- [ ] Widget Dashboard "Top 5 écarts budget vs réel" sur le mois courant.
**Dépend de** : aucune.
**Estimation** : L
**Risques** : import budget depuis Excel → format CSV strict.
**Notes** : V1 budget annuel par compte ; V2 sous-budgets par section / canal.

### TASK-10-018 — Export Accurate / MYOB [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `accountingExportService` or Accurate/MYOB exporter in V3. Still applicable, scheduled Session 14+.
**Contexte** : aujourd'hui export CSV générique uniquement. Les comptables externes utilisent souvent Accurate (Indonésie) ou MYOB et doivent reformater manuellement.
**Bénéfice attendu** : génération d'un fichier d'import au format attendu par les logiciels comptables locaux.
**Critère d'acceptation** :
- [ ] Service `accountingExportService.exportToAccurate(p_start, p_end)` produit le fichier XML/CSV Accurate.
- [ ] Service `accountingExportService.exportToMYOB(p_start, p_end)` idem MYOB.
- [ ] Page `/accounting/export` (permission `accounting.manage`) : sélection période + format + download.
- [ ] Test : import du fichier généré dans un sandbox Accurate / MYOB sans erreur.
**Dépend de** : aucune.
**Estimation** : M (par format).
**Risques** : formats propriétaires versionnés — figer le mapping à une version donnée.
**Notes** : commencer par Accurate (marché Indonésie dominant).

### TASK-10-019 — Multi-devise [P3] [BLOCKED]
**Status note (2026-05-14)** : Explicitly deferred per INDEX Wave 7 (`docs/workplan/plans/2026-05-13-session-13-INDEX.md` line 1082 "10-019 multi-currency end-to-end (Session 14)") and Out-of-scope table line 1206. Scope-deferred at session-13 planning.
**Contexte** : tout est en IDR aujourd'hui. Pour les fournisseurs internationaux (équipement français, ingrédients italiens, abonnements SaaS USD), une dépense doit être convertie manuellement à la saisie — perte du taux historique.
**Bénéfice attendu** : saisir une dépense en EUR / USD, le système enregistre montant devise + taux + équivalent IDR, et révise les écarts de change en fin de période.
**Critère d'acceptation** :
- [ ] Colonnes `currency_code` (ISO 4217) + `exchange_rate` + `amount_local` sur `expenses`, `purchase_orders`, `purchase_order_items`.
- [ ] Service `exchangeRateService` qui charge le taux du jour (BI / open-source feed).
- [ ] Écriture compta libellée en IDR au taux du jour de l'opération.
- [ ] Écart de change post-paiement : différence taux jour-opération vs taux jour-paiement → écriture `exchange_gain_loss`.
- [ ] Plan comptable étendu : `7301 Exchange Gain` / `6301 Exchange Loss`.
**Dépend de** : aucune.
**Estimation** : L
**Risques** : sources de taux divergentes — choisir une référence officielle (Bank Indonesia).
**Notes** : V1 lecture taux quotidienne ; V2 historique stocké.

### TASK-10-020 — Consolidation multi-entité [P3] [WONTFIX]
**Status note (2026-05-14)** : Explicitly deferred per INDEX Wave 7 (`docs/workplan/plans/2026-05-13-session-13-INDEX.md` line 1084 "10-020 multi-entity consolidation (Session 15)") and Out-of-scope table line 1207. Scope-deferred at session-13 planning.
**Status note (2026-05-19)** : **WONTFIX per user decision** — The Breakery confirme mono-site / mono-entité permanent. Aucune ouverture de seconde entité juridique prévue. La consolidation multi-entité sort du backlog indéfiniment. Voir audit S23 (`docs/workplan/plans/2026-05-19-S24-to-S30-plan.md`).
**Contexte** : un seul jeu de livres aujourd'hui. Si The Breakery ouvre une seconde adresse en tant qu'entité juridique distincte, pas de consolidation possible.
**Bénéfice attendu** : maintenir des livres séparés par entité et produire des états consolidés.
**Critère d'acceptation** :
- [ ] Concept `entity_id` propagé sur `accounts`, `journal_entries`, `fiscal_periods`.
- [ ] Settings → Multi-entity : CRUD entités + paramètres comptables propres.
- [ ] RPC `get_consolidated_balance_sheet(p_entity_ids[], p_date)` agrège les soldes après élimination des opérations intra-groupe.
- [ ] Page `/accounting/consolidation` : sélection entités + période + visualisation états consolidés.
**Dépend de** : décision juridique d'ouvrir une seconde entité.
**Estimation** : XL
**Risques** : impact transverse énorme (Inventory, Orders, B2B). À planifier comme une refonte modulaire et non un patch.
**Notes** : V1 simple addition ; V2 vraies éliminations intra-groupe SAK EMKM.

### TASK-10-021 — IA d'aide à la classification [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no classification suggestion service in V3. Aligned with INDEX Wave 7 "advanced ML" deferral (line 1088). Still applicable, scheduled Session 14+ once expense history accumulates.
**Contexte** : pour les dépenses ambiguës (ex: "Facture Tokopedia 350k"), le comptable choisit manuellement le compte d'imputation. Coût cognitif, risque d'erreur.
**Bénéfice attendu** : suggestion automatique du compte sur la base de l'historique de classifications (libellé fournisseur + montant + saison).
**Critère d'acceptation** :
- [ ] Service `expenseClassificationSuggestion(p_description, p_amount, p_supplier)` qui scanne l'historique et retourne top 3 comptes probables + confidence.
- [ ] UI `ExpenseForm` propose les suggestions, comptable confirme en 1 clic.
- [ ] Feedback loop : chaque correction manuelle alimente le modèle.
**Dépend de** : volume d'historique suffisant (~6 mois de dépenses classées).
**Estimation** : M
**Risques** : modèle simple (regex + similarité) souvent suffit en V1 — pas besoin de LLM.
**Notes** : commencer par embedding sentence-transformers léger, pas d'API externe.

### TASK-10-022 — Tax planning [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no tax-planning module in V3. Depends on TASK-10-015 (amortisation) + TASK-10-017 (budget), both still TODO. Still applicable, scheduled Session 14+.
**Contexte** : le gérant ne sait pas anticiper sa charge fiscale annuelle (impôt sur les sociétés indonésien — PPh Badan 22 % pour PME). Surprise en fin d'année.
**Bénéfice attendu** : simulation des taxes à payer selon différents scénarios de fin d'année (provisionner amortissement supplémentaire, optimiser timing des achats, etc.).
**Critère d'acceptation** :
- [ ] Page `/accounting/tax-planning` : projection résultat fiscal annuel à partir du YTD + extrapolation.
- [ ] Scénarios "what-if" : ajouter X IDR de dépenses, accélérer Y amortissement, retarder Z facturation B2B.
- [ ] Calcul PPh Badan estimé + recommandations.
- [ ] Export PDF "Prévisionnel fiscal" pour le comptable externe.
**Dépend de** : `TASK-10-015` (amortissement) + `TASK-10-017` (budget) pour précision des projections.
**Estimation** : L
**Risques** : règles fiscales indonésiennes évoluent — externaliser le moteur de calcul dans une config versionnée.
**Notes** : ne remplace pas le conseil fiscal — outil d'aide à la décision.


**S21 update (2026-05-18):** Cash Flow report gains Investing + Financing sections. Migration block `20260525000020..021`. New `cash_flow_section` ENUM (`operating/investing/financing/none`) on `accounts` (NOT NULL DEFAULT `operating`). New `cash_flow_v1(date,date) RETURNS jsonb` with 3-section totals + net_change + lines. Granted to `authenticated`, revoked from `anon` AND `PUBLIC` (S20 defense-in-depth). pgTAP 10/10. BO `CashFlowPage.tsx` updated. Closes D-W6-6A-2.
