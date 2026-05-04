# Travail — Accounting (Double-Entry)

> Last updated: 2026-05-03
> Référence : `docs/v2-reference/04-modules/10-accounting-double-entry.md` (à créer — module non encore documenté en référence)
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

### TASK-10-001 — Restaurer le sale trigger unifié avec mapping resolution + fiscal guard [P0] [TODO]
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

### TASK-10-002 — Corriger ou supprimer le stock_movement trigger mort [P0] [TODO]
**Contexte** : Mary P0-2 — `create_stock_movement_journal_entry()` (migration `20260402110000`) référence colonnes `mapping_code` + `mapping_type` qui N'EXISTENT PAS dans `accounting_mappings`. Le trigger échoue silencieusement à chaque mouvement de stock. Risque : si un dev "fixe" le schéma sans virer le trigger, doublons JE avec le moteur TS (`postStockWasteJournalEntry` etc).
**Critère d'acceptation** :
- [ ] Décision documentée dans `docs/v2-reference/04-modules/10-accounting-double-entry.md` : « la SOURCE est le moteur TS, pas le trigger DB ».
- [ ] Migration `YYYYMMDD_drop_stock_movement_trigger.sql` qui DROP TRIGGER + DROP FUNCTION.
- [ ] Test régression : insert stock_movement → vérifier qu'AUCUN JE n'est créé par le DB ; le moteur TS reste responsable.
**Fichiers concernés** : `supabase/migrations/YYYYMMDD_drop_stock_movement_trigger.sql`, `docs/v2-reference/04-modules/10-accounting-double-entry.md` (à créer).
**Dépend de** : aucune
**Estimation** : S
**Risques** : faible — le trigger ne fait rien aujourd'hui.
**Notes** : alternative = corriger le trigger pour utiliser `resolve_mapping_account` mais alors RETIRER les wrappers TS pour éviter doublons. Choisir UN seul chemin.

### TASK-10-003 — Seeder le mapping `SALE_REVENUE` ou refactor `accountingEngine.ts` [P0] [TODO]
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

### TASK-10-004 — Étendre la contrainte CHECK `reference_type` (4 types manquants) [P0] [TODO]
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

### TASK-10-005 — Corriger les codes comptes dans `calculate_vat_payable` RPC [P0] [TODO]
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

### TASK-10-006 — Refactor `create_purchase_journal_entry` pour usage mapping unifié [P1] [TODO]
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

### TASK-10-007 — Combler le mapping `PRODUCTION_COGS` (compte non-postable) [P1] [TODO]
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

### TASK-10-008 — Ajouter "Current Year Earnings" au Balance Sheet (compte 3300) [P1] [TODO]
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

### TASK-10-010 — UI Admin pour gestion des `accounting_mappings` [P2] [TODO]
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

### TASK-10-012 — Cash Flow Statement (3e pilier financier — F7 backlog) [P2] [TODO]
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
