# Travail — Expenses

> Last updated: 2026-05-03
> Référence : [docs/reference/04-modules/11-expenses.md](../../reference/04-modules/11-expenses.md)
> Sources d'audit : `docs/audit/02-accounting-business-audit.md` (P0-4 expense approval RPC), `docs/audit/00-executive-summary.md`, `docs/audit/07-product-backlog-audit.md`

## Objectifs du module

1. **Workflow d'approbation multi-niveau** robuste : auto-approbation jusqu'à seuil (ex. ≤ 100k IDR), approbation manager (≤ 1M IDR), approbation owner (> 1M IDR), avec PIN tracé.
2. **Catégorisation enrichie** des dépenses (rent, utilities, supplies, marketing…) liées aux comptes COA pour ventiler automatiquement le JE.
3. **Récurrence** : automatiser les dépenses régulières (loyer, internet, abonnements) avec génération à date prévue.
4. **OCR receipt** (P3) pour scanner les tickets via `claude-proxy` Edge Function et pré-remplir le formulaire.
5. **Allocation par département/centre de coût** (cuisine, salle, admin) pour analyse de marges fines.

## Tâches

### TASK-11-001 — Workflow approbation multi-niveau (seuils + chaîne) [P1] [TODO]
**Status note (2026-05-14)** : Partially delivered — Phase 3.B shipped a flat workflow (draft → submitted → approved → paid via `create/submit/approve/pay/reject_expense_v1` RPCs in `20260517000122`) with permission-gated approve (`expenses.approve`) + audit_logs writes + PIN-gated dialogs (`ApproveDialog.tsx`). MISSING: configurable `expense_approval_thresholds` table, multi-level chain (manager → owner), separation-of-duties block (approver ≠ creator). Still applicable, scheduled Session 14+.
**Contexte** : Aujourd'hui `approve_expense_with_journal` (Mary P0-4) corrige les casts UUID mais n'implémente PAS de chaîne d'approbation. Toute personne avec `accounting.manage` peut approuver n'importe quel montant. Risque fraude.
**Critère d'acceptation** :
- [ ] Table `expense_approval_thresholds` (level, max_amount, required_role_id) configurable en `/settings/expenses`.
- [ ] Hook `useExpenseApproval` détermine niveau requis selon `expenses.amount` et propose les approbateurs.
- [ ] UI affiche timeline d'approbation : Pending → Manager Approved → Owner Approved → Posted (JE créé).
- [ ] Bouton "Approve" déclenche modal PIN (réutiliser `useShiftAuth`).
- [ ] Audit log toute étape avec approver_id + reason si rejet.
- [ ] Si approver = créateur → bloqué (séparation des tâches).
**Fichiers concernés** : `src/services/expenses/expenseApprovalService.ts`, `src/hooks/expenses/useExpenseApproval.ts`, migration table thresholds, page settings, modal.
**Dépend de** : `TASK-10-001` (sale trigger restauré pour cohérence générale comptable).
**Estimation** : L
**Risques** : workflow trop rigide bloque opérations urgentes — prévoir override admin (avec audit).
**Notes** : pattern PIN identique TASK-09-002 (B2B credit override).

### TASK-11-002 — Catégories d'expense étendues + mapping COA [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 3.B. V3 evidence: `supabase/migrations/20260517000120_init_expenses.sql` creates `expense_categories` table with 12 seeded categories (Rent, Electricity, Water, Internet, Marketing, Cleaning, Maintenance, Transport, Insurance, Tax, Bank Fees, Office) each FK to `accounts.id` (6111-6190 OpEx codes per `D-W3-3B-02`); `approve_expense_v1` uses `category.account_id` for the DR leg. Commit `bdf21aa`.
**Contexte** : `expenses.category` est un enum limité (utilities, supplies, marketing, other). Pas de lien direct avec un compte COA précis → JE auto va sur compte générique. Comptable doit re-coder à la main.
**Critère d'acceptation** :
- [ ] Table `expense_categories` (id, code, label_en, default_account_id, is_active) seedée avec ~20 catégories courantes bakery (Rent, Electricity, Water, Internet, Marketing, Cleaning Supplies, Equipment Maintenance, etc.).
- [ ] FK `expenses.category_id` remplace l'enum (migration douce avec backfill).
- [ ] Le moteur `postExpenseJournalEntry` utilise `default_account_id` de la catégorie pour le DR (au lieu d'un compte générique).
- [ ] UI Settings `/settings/expense-categories` CRUD permission `accounting.manage`.
**Fichiers concernés** : migration enum→table, `src/services/accounting/accountingEngine.ts`, hook + page settings.
**Dépend de** : `TASK-10-006` (purchase trigger unifié) pour cohérence pattern resolve_mapping.
**Estimation** : M
**Risques** : migration backfill enum→FK touche les expenses historiques — préserver l'historique en gardant `category_legacy`.
**Notes** : valider avec comptable la liste seed.

### TASK-11-003 — Recurring expenses (loyer, abonnements) [P2] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `recurring_expenses` table or `recurring-expenses-generate` Edge Function in V3. Still applicable, scheduled Session 14+.
**Contexte** : Loyer mensuel, internet, abonnements logiciels = re-saisie manuelle chaque mois. Source d'oubli et d'écarts.
**Critère d'acceptation** :
- [ ] Table `recurring_expenses` (template_id, name, amount, category_id, frequency: monthly/quarterly/yearly, next_due_date, payment_method, is_active).
- [ ] Edge Function `recurring-expenses-generate` (CRON daily) crée les `expenses` en `pending` à la date due.
- [ ] UI Settings `/settings/recurring-expenses` CRUD + bouton "Generate now" pour manuel.
- [ ] Notification email/in-app à l'approbateur 2j avant due_date.
- [ ] Désactivation auto si 3 instances `pending` non approuvées (évite accumulation).
**Fichiers concernés** : migration, Edge Function, page settings, hook.
**Dépend de** : `TASK-11-001` (workflow approbation, sinon les recurring s'empilent en pending sans flow clair).
**Estimation** : M
**Risques** : si l'EF échoue silencieusement → dépense manquée. Monitoring Sentry obligatoire.
**Notes** : Bot peut envoyer un récap mensuel "10 recurring expenses generated for May 2026".

### TASK-11-004 — Receipt OCR via Claude Proxy [P3] [BLOCKED]
**Status note (2026-05-14)** : Explicitly deferred per INDEX Wave 7 (`docs/workplan/plans/2026-05-13-session-13-INDEX.md` line 1088 "OCR / 2FA — Session 19+") and Out-of-scope table line 1217 "OCR receipts — Session 16+". Receipt UPLOAD is delivered (`ReceiptUploader.tsx` + storage bucket `expense-receipts` in `20260517000121`) but OCR extraction itself remains deferred.
**Contexte** : Saisie manuelle d'expenses depuis ticket papier = lente et erreur. `claude-proxy` Edge Function existe (CLAUDE.md liste 16 EF) — peut servir vision API pour extraire amount, date, vendor.
**Critère d'acceptation** :
- [ ] Bouton "Scan receipt" dans `ExpenseFormPage` ouvre upload (mobile camera ready).
- [ ] Image envoyée à `claude-proxy` avec prompt "Extract amount in IDR, date, vendor name from this receipt; return JSON {amount, date, vendor, confidence}".
- [ ] Pré-remplit le formulaire ; champs surlignés en jaune si confidence < 70%.
- [ ] Image originale stockée Storage `receipts/{expense_id}.jpg` + lien dans `expenses.receipt_url`.
- [ ] Quota mensuel anti-abus (ex. 200 OCR/mois).
**Fichiers concernés** : `src/pages/expenses/ExpenseFormPage.tsx`, `supabase/functions/claude-proxy/index.ts` (extension prompt), composant uploader, migration `expenses.receipt_url` (si absente).
**Dépend de** : aucune
**Estimation** : M
**Risques** : coût API Claude vision non négligeable — surveiller. Confidentialité receipts (RLS Storage).
**Notes** : test avec receipts thermiques effacés pour valider robustesse.

### TASK-11-005 — Allocation par département/centre de coût [P2] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `cost_centers` table or `expenses.cost_center` column in V3. Still applicable, scheduled Session 14+.
**Contexte** : Bakery a 3 zones de coûts naturelles : Production (cuisine), Service (salle/POS), Admin. Pas de ventilation aujourd'hui → marges par zone impossibles à calculer.
**Critère d'acceptation** :
- [ ] Enum `expense_department` ou table `cost_centers` (production, service, admin, other).
- [ ] `expenses.cost_center` (FK ou enum).
- [ ] UI ExpenseFormPage : selector cost center (default selon catégorie : Rent → Admin, Cleaning → Service, etc.).
- [ ] Rapport `/reports/expenses-by-cost-center` (par mois, stacked bar).
- [ ] JE inclut dans la description le cost_center pour traçabilité.
**Fichiers concernés** : migration, formulaire, nouveau report tab + ReportsConfig.
**Dépend de** : `TASK-11-002` (categories étendues pour suggérer le cost center par défaut).
**Estimation** : M
**Risques** : sans backfill, les expenses historiques restent sans cost_center — afficher "Unallocated" et offrir bulk-edit admin.
**Notes** : pattern simple ; pas besoin d'allocation pondérée (1 dépense = 1 cost center).

### TASK-11-006 — Per diem / advances pattern [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `expense_type` enum extension (`advance | per_diem | reimbursement`) or `1140 Advances to staff` account in V3 (Phase 1.A COA seed does not include 1140). Still applicable, scheduled Session 14+.
**Contexte** : Cas réel : avance de 500k IDR au cuisinier pour course marché → puis justificatif. Aujourd'hui géré en JE manuel.
**Critère d'acceptation** :
- [ ] Type `expense_type` enum : `expense | advance | per_diem | reimbursement`.
- [ ] `advance` crée JE Dr `1140 Advances to staff` / Cr Cash sans approbation lourde.
- [ ] Workflow "Settle advance" : convertit advance + receipts en expense ; calcule différence (remboursement à l'employé ou à la caisse).
- [ ] UI dédiée `/expenses/advances` avec status (open / partially settled / settled).
**Fichiers concernés** : enum migration, account `1140` (à créer si manquant), service `advanceService.ts`, page.
**Dépend de** : `TASK-11-001`, `TASK-10-001`.
**Estimation** : L
**Risques** : si pas réclamé, advances dorment → alert > 30j ouvert.
**Notes** : compte `1140` fait partie des manques signalés par Mary (audit Phase 1 — COA cleanup).

### TASK-11-007 — Bulk expense import (CSV) pour migration historique [P3] [BLOCKED]
**Status note (2026-05-14)** : Explicitly deferred per INDEX Out-of-scope table line 1215 "Bulk imports (users, products) — Session 14+". Same deferral applies to bulk expense imports.
**Contexte** : Pour rattraper l'historique 2024-2025 ou onboarder une nouvelle entité, besoin d'import CSV. Aujourd'hui : saisie manuelle un-par-un.
**Critère d'acceptation** :
- [ ] Page `/expenses/import` accepte CSV avec colonnes : date, amount, category_code, payment_method, description, vendor.
- [ ] Validation ligne par ligne avec preview des erreurs avant commit.
- [ ] Création des expenses en statut `imported` (court-circuit workflow approbation), JE créé immédiatement (option : `auto_post=true`).
- [ ] Idempotence par hash (date+amount+vendor+description).
**Fichiers concernés** : nouvelle page, parser CSV (utiliser XLSX déjà en dépendance), service import.
**Dépend de** : `TASK-11-002` (catégories pour mapping code).
**Estimation** : M
**Risques** : doublons si re-import → idempotence stricte indispensable.
**Notes** : valider colonnes attendues avec comptable.

---

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/_archive/objectif-travail-v2/EXPENSES.md` §15 — vision produit du module au-delà du tech-debt existant.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13). Récurrence, workflow approval, OCR, note de frais sont déjà couverts par TASK-11-003/001/004/006. Export comptable est couvert par TASK-10-018 (cascade Accounting).

### TASK-11-008 — Budget par catégorie [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — depends on TASK-10-017 (budget vs réel global), also TODO. Still applicable, scheduled Session 14+.
**Contexte** : aucun mécanisme de budget aujourd'hui. Le gérant ne sait pas s'il dépasse son budget mensuel marketing, maintenance, etc.
**Bénéfice attendu** : saisir un budget mensuel par catégorie + alerte au dépassement (déclencheur à 80%, 100%, 120%).
**Critère d'acceptation** :
- [ ] Table `expense_budgets` (year, month, category_id, amount).
- [ ] Page `/expenses/budget` : grille de saisie par catégorie × mois.
- [ ] Widget Dashboard : top 3 catégories en dépassement budget.
- [ ] Notification push manager quand une catégorie atteint 80% / 100% / 120% du budget.
- [ ] Couplage avec TASK-10-017 (budget Accounting) — partager la table OU mapper.
**Dépend de** : `TASK-10-017` (budget vs réel global) pour cohérence.
**Estimation** : M
**Risques** : double saisie si non couplé avec budget Accounting — choisir UN seul système.
**Notes** : V1 par catégorie expense ; V2 sous-budgets par projet / événement.

### TASK-11-009 — Multi-devise sur expenses [P3] [BLOCKED]
**Status note (2026-05-14)** : Explicitly deferred per INDEX Wave 7 (`docs/workplan/plans/2026-05-13-session-13-INDEX.md` line 1082 "10-019 multi-currency end-to-end (Session 14)") and Out-of-scope table line 1206. Hard-coupled to TASK-10-019.
**Contexte** : aujourd'hui tout en IDR. Pour les achats équipement français, abonnements SaaS USD, etc., conversion manuelle perdue.
**Bénéfice attendu** : saisir une dépense en EUR / USD, le système enregistre montant devise + taux + équivalent IDR avec traçabilité.
**Critère d'acceptation** :
- [ ] Colonnes `currency_code`, `exchange_rate`, `amount_local` sur `expenses`.
- [ ] UI form : champ "Devise" + récupération auto du taux du jour (BI ou source officielle).
- [ ] Écriture compta libellée en IDR au taux du jour.
- [ ] Écart de change post-paiement si taux différent — JE auto.
**Dépend de** : `TASK-10-019` (multi-devise Accounting global).
**Estimation** : M
**Risques** : taux divergents entre sources — référence officielle Bank Indonesia.
**Notes** : extension du module Accounting multi-devise.

### TASK-11-010 — Lien commande fournisseur ↔ dépense [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `purchase_orders.po_type` flag or `create_expense_from_po` RPC in V3; `expenses` has no `source_po_id` FK. Still applicable, scheduled Session 14+.
**Contexte** : aujourd'hui Purchasing gère les achats de marchandises (PO produits) et Expenses gère les dépenses opérationnelles, mais pas de pont quand un PO est de SERVICE (ex: maintenance, conseil) — saisie double.
**Bénéfice attendu** : quand un PO de service est réceptionné, créer automatiquement une expense pré-remplie.
**Critère d'acceptation** :
- [ ] Flag `purchase_orders.po_type` = `goods | service`.
- [ ] Pour `service` PO : à la réception, RPC `create_expense_from_po(po_id)` crée une `expenses` en draft avec catégorie mappée.
- [ ] Lien `expenses.source_po_id` (FK).
- [ ] UI : depuis PO service, bouton "Convertir en dépense".
**Dépend de** : aucune.
**Estimation** : M
**Risques** : confusion entre PO goods et service — bien valider à la création du PO.
**Notes** : utile pour le conseil comptable, juridique, maintenance four.

### TASK-11-011 — Catégorisation auto par IA [P3] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13 — no `expenseCategorySuggestion` service in V3. Aligned with INDEX Wave 7 "advanced ML" deferral. Couplable to TASK-10-021 (also TODO). Still applicable, scheduled Session 14+ once expense history accumulates.
**Contexte** : pour une dépense ambiguë ("Facture Tokopedia 350k"), le saisisseur choisit manuellement la catégorie. Coût cognitif.
**Bénéfice attendu** : suggestion automatique de la catégorie sur la base de l'historique (description fournisseur + montant + saison).
**Critère d'acceptation** :
- [ ] Service `expenseCategorySuggestion(p_description, p_amount, p_supplier)` scanne l'historique et retourne top 3 catégories + confidence.
- [ ] UI `ExpenseForm` propose les suggestions ; saisisseur confirme en 1 clic.
- [ ] Feedback loop : chaque correction manuelle alimente le modèle.
**Dépend de** : volume historique 6 mois minimum.
**Estimation** : M
**Risques** : modèle simple suffit V1 (regex + similarité fournisseur) — pas besoin de LLM.
**Notes** : couplable avec TASK-10-021 (IA classification compta) — utiliser le même service.

## Vue transversale

### Dépendances inter-tâches

```
TASK-10-001 (sale trigger restauré) ← prérequis comptable général
    ↓
TASK-11-001 (workflow approbation) → TASK-11-003 (recurring) → TASK-11-006 (advances)
TASK-11-002 (categories étendues) → TASK-11-005 (cost center)
                                  ↘ TASK-11-007 (CSV import utilise les codes catégories)
TASK-11-004 (OCR) ← indépendant
```

### Métriques de succès

| Métrique | Baseline 2026-04 | Cible Q3 2026 |
|---|---|---|
| Délai moyen approbation expense | non tracé | < 24h (TASK-11-001) |
| Couverture catégorie COA | générique | 100% des nouvelles expenses (TASK-11-002) |
| Erreurs d'oubli expenses récurrentes | quelques/mois | 0 (TASK-11-003 auto) |
| Dépenses par cost center analysées | impossible | reports mensuels (TASK-11-005) |

### Pitfalls connus impactant ces tâches

- `expenses.payment_method='cash'` doit déclencher la mise à jour du `pos_session.expected_cash` côté shift (cf. [12 — Cash Register](./12-cash-register-shift.md) TASK-12-004).
- `approve_expense_with_journal` historiquement cassé (Mary P0-4 — `::TEXT` UUID + mauvais comptes) — vérifier que la version après hotfix Phase 1 est utilisée.
- Toute expense sur période fiscale lockée (TASK-10-011) doit être bloquée explicitement.

### Risques transversaux

- **Workflow trop lourd** : TASK-11-001 doit garder une "fast lane" pour les petites dépenses < 100k IDR auto-approuvées.
- **Coût Claude API** : TASK-11-004 OCR à monitorer ; quotas mensuels obligatoires.
- **Migration enum→FK catégories** (TASK-11-002) : couper en 2 PRs (1. créer table parallèle ; 2. backfill ; 3. supprimer enum) pour éviter downtime.

### Couverture audits

| Tâche | Source audit | Section |
|---|---|---|
| TASK-11-001 | 02-accounting-business-audit.md | P0-4 expense approval RPC + sécurité fraude |
| TASK-11-002 | 02-accounting-business-audit.md | Phase 2 mappings + COA cleanup |
| TASK-11-003 | 07-product-backlog-audit.md | gap "production efficiency" indirect |
| TASK-11-004 | CLAUDE.md (claude-proxy) | nouvelle capacité |
| TASK-11-005 | 07-product-backlog-audit.md | F5 yield + cost analysis |
| TASK-11-006 | comptable demande métier | — |
| TASK-11-007 | onboarding nouvelles entités | — |
