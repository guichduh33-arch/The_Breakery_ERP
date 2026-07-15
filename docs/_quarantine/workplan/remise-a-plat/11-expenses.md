# Module 11 — Dépenses

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **D1.1 « Dupliquer » livré** (bouton `ExpenseDetailPage` → `NewExpensePage` pré-remplie, date du jour, sans receipt, brouillon) ; C-B1.5 n'est plus 🔴. **F-4 (P1) FIXÉ** (`_102`) : `_emit_expense_je` fold `vat_amount` dans le débit de charge et retire la ligne compte 1151 / `EXPENSE_VAT_INPUT` (ADR-003 NON-PKP) — une dépense avec PPN saisie ne crashe plus à l'approbation ; suite `expenses.test.sql` 19/19. Voir `docs/workplan/plans/archive/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 11. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** Le cœur revendiqué est conforme (saisie + photo, circuit de validation, JE à l'approbation, engagement vs décaissement) et le code fait **beaucoup plus** que la doc — la validation multi-niveaux par montant avec SOD, listée « À venir », **existe déjà**. En sens inverse, la doc surclame la duplication d'une dépense (inexistante), le comparatif mois précédent (absent) et surtout le lien caisse (« sort du tiroir ») qui a été **volontairement débranché** au profit du Petty Cash.

## A. Ce qui fonctionne réellement (code vérifié)

- **Schéma** : table `expenses` (`20260517000120` l.74-104) — statuts `draft/submitted/approved/rejected/paid`, `vendor_name TEXT` (libre, **pas de FK suppliers**), `receipt_url`, `vat_amount`, `expense_number`.
- **Pages routées + gatées** : `/expenses` (`expenses.read`), `/expenses/new` (`expenses.create`), `/expenses/:id` (`apps/backoffice/src/routes/index.tsx:428-448`). [UI câblée]
- **Saisie rapide** : `ExpenseForm` — montant, catégorie (`CategoryPicker`), TVA, mode de paiement `cash/transfer/card/credit`, fournisseur (texte libre), date (`ExpenseForm.tsx:11-29`) ; **photo du justificatif** via `ReceiptUploader` → bucket privé `expense-receipts`, chemin `expenses/{id}/receipt.<ext>`, 5 MB max, jpeg/png/webp/pdf (`ReceiptUploader.tsx:3-46`). [UI câblée]
- **Circuit de validation** : `submit_expense_v2` (idempotency key per-mount, `useExpenseActions.ts:19-47`) → `approve_expense_v3` (**PIN manager vérifié côté serveur** avec lockout `20260622000014` ; bumped `20260601181353`) ou `reject_expense_v1` (motif) → `pay_expense_v1`. [UI câblée : `ApproveDialog`/`RejectDialog`/`PayDialog` sur `ExpenseDetailPage`]
- **Écriture comptable automatique à l'approbation** (`20260517000122` l.217-249) : DR compte de charges de la catégorie (fallback `EXPENSE_DEFAULT`) + DR VAT input éventuel / CR `EXPENSE_AP` si `credit` sinon `EXPENSE_CASH_OUT` ; garde fiscale `check_fiscal_period_open` (l.197) ; `reference_type='expense'`. [RPC]
- **Engagement vs décaissement** : une dépense `credit` approuvée crédite le compte AP (dette fournisseur au bilan) ; `pay_expense_v1` émet une **2ᵉ JE « Clear AP / Cash payment »** au paiement (`_122` l.318-346) ; les modes non-crédit basculent simplement `paid` (JE cash déjà passée à l'approbation, l.347-355). Retour `was_credit` exposé. [RPC + UI]
- **Validation multi-niveaux par montant (non revendiquée !)** : table `expense_approval_thresholds` (`20260524111854`), **snapshot des étapes requises à la soumission** (`required_approval_steps_snapshot`, `20260524113023`), approbations séquencées (`step/of_total`, `ApproveResult` dans `useExpenseActions.ts:49-54`), auto-approbation sous seuil (`auto_approved` dans `SubmitResult`), **SOD : le créateur ne peut pas approuver sa propre dépense** (exception SUPER_ADMIN seule, auditée `expense.self_approved` — `20260706000023` l.85-91,161-165) + SOD 2 (pas de double approbation du même étage). UI : `ApprovalTimeline` + `ThresholdResolutionBadge` sur `ExpenseDetailPage` (l.113,142), page de réglage `ExpenseThresholdsPage` routée+gatée `expenses.thresholds.read` (`routes/index.tsx:956-960`). [UI câblée]
- **Analyse** : `OperatingExpensesPage` (routée) — donut par catégorie, tendance temporelle, filtres période/catégorie/statut, KPI Total OpEx, export CSV (`OperatingExpensesPage.tsx:4-40,123-186`). [UI câblée]
- **Changement de design assumé (2026-07-06)** : les dépenses cash créditent désormais **1111 Petty Cash** (le coffre) et **le trigger de synchro tiroir/shift a été droppé** (`20260706000019_expense_cash_out_to_petty_drop_shift_trigger.sql`) — une dépense espèces ne touche plus l'attendu du tiroir POS.

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Saisir une dépense en < 1 min (montant, catégorie, fournisseur, mode de paiement, photo du justificatif).
- B1.2 Circuit : en attente → approuvée ou rejetée avec motif → payée ; **l'approbation génère automatiquement l'écriture** dans le bon compte de charges.
- B1.3 Distinguer engagement (approuvée) et décaissement (payée) : facture approuvée non réglée = **dette fournisseur**.
- B1.4 Totaux par période et par catégorie, **comparaison avec le mois précédent**.
- B1.5 (Scénario) **Dupliquer** le loyer du mois dernier « en deux clics ».
- B1.6 (Liens) Une dépense payée en espèces **sort du tiroir et pèse sur le comptage du soir** ; fournisseurs **partagés** avec les achats ; un caissier saisit, un manager approuve.

### B2. Annoncé « À venir »
- B2.1 Validation à plusieurs niveaux selon le montant (petites auto-approuvées, grosses → patron, interdiction de s'auto-approuver).
- B2.2 Dépenses récurrentes programmées (loyer, internet).
- B2.3 Import en masse de l'historique.
- B2.4 Budgets par catégorie avec alerte de dépassement.
- B2.5 Lecture automatique (OCR) des factures photographiées.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Saisie < 1 min avec photo | `ExpenseForm` + `ReceiptUploader` (bucket privé) — complet ; nuance : « fournisseur » = champ texte libre | ✅ CONFORME |
| B1.2 | Circuit attente→approuvée/rejetée→payée + JE auto à l'approbation | Statuts `draft/submitted/approved/rejected/paid` ; JE DR charge / CR AP-ou-cash à l'approbation (`_122` l.219-249), rejet avec motif | ✅ CONFORME |
| B1.3 | Engagement vs décaissement, dette fournisseur | `credit` → CR `EXPENSE_AP` à l'approbation, 2ᵉ JE au paiement (`_122` l.318-346) ; la dette apparaît au bilan via le compte AP | ✅ CONFORME |
| B1.4 | Totaux période/catégorie + comparaison mois précédent | Totaux/donut/tendance ✅ (`OperatingExpensesPage`) ; **aucun comparatif N-1** (grep `previous|prior|delta` dans `useExpensesByCategory.ts` → 0) | 🟠 PARTIEL |
| B1.5 | Duplication d'une dépense en deux clics | **Inexistant** (grep `duplicate|clone|copy` dans features/pages expenses → 0) | 🔴 MANQUANT |
| B1.6 | Dépense espèces sort du tiroir et pèse sur le comptage du soir ; fournisseurs partagés avec les achats | **Faux depuis le 2026-07-06** : trigger `trg_expenses_sync_cash` **droppé**, `EXPENSE_CASH_OUT` remappé sur 1111 Petty Cash (`20260706000019`) — le tiroir POS n'est plus impacté. Fournisseurs : `vendor_name TEXT` libre, **aucun lien** avec la table `suppliers` des achats | 🔴 MANQUANT (doc périmée vs décision produit) |

**Bonus code (le code fait plus que la doc) :**
- 🔵 **B2.1 est déjà largement fait** : seuils par montant (`expense_approval_thresholds`), chaîne multi-étapes avec snapshot à la soumission, auto-approbation sous seuil, **SOD anti-auto-approbation** (relâchée pour SUPER_ADMIN seulement, auditée), PIN manager server-side à chaque approbation, page de réglage des seuils. Seuls restent réellement « à venir » : récurrentes, import, budgets, OCR.
- 🔵 Idempotence de la soumission (clé per-mount, `useExpenseActions.ts:23`).
- 🔵 Gestion TVA input (`vat_amount` → `EXPENSE_VAT_INPUT`).
- 🔵 Statut `draft` (brouillon avant soumission), non décrit par la doc.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
- **Bouton « Dupliquer »** (ferme B1.5) : depuis `ExpenseDetailPage`, naviguer vers `NewExpensePage` pré-remplie (montant, catégorie, fournisseur, mode ; date = aujourd'hui ; sans receipt). Fichiers : `ExpenseDetailPage.tsx`, `NewExpensePage.tsx` (état de navigation ou query params). Done = 2 clics créent le brouillon du loyer suivant.
- **Comparaison mois précédent** (ferme B1.4) : 2ᵉ appel `useExpensesByCategory` sur la période N-1 + delta % sur le KPI et la table. Fichiers : `OperatingExpensesPage.tsx`, `useExpensesByCategory.ts`. Done = colonne « vs mois précédent » visible.
- **D4** : mettre la doc à jour sur B1.6 et B2.1 (le plus gros écart est documentaire).

### D2. Chantiers moyens (1 session, plan requis)
- **Lien fournisseurs réels** : colonne `expenses.supplier_id UUID NULL` + picker (fallback texte libre conservé), pour honorer « fournisseurs partagés » et permettre l'analyse par fournisseur. Migration + `ExpenseForm` + listes.
- **Décision produit sur le tiroir** : soit rétablir un impact shift optionnel pour les dépenses cash payées à la caisse (nouveau `paid_from='till'|'petty_cash'`), soit acter le modèle Petty Cash — dans les deux cas aligner doc + module 12.

### D3. Chantiers lourds (spec dédiée avant code)
- **Dépenses récurrentes programmées** (B2.2) : templates + cron (pg_cron) + génération en `draft`, garde fiscale.
- **Budgets par catégorie + alertes** (B2.4).
- **OCR des justificatifs** (B2.5).
- **Import en masse de l'historique** (B2.3) — déjà fléché « reliquat Spec B Phase 2 » au niveau projet.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- B1.6 → réécrire : « une dépense en espèces sort du **Petty Cash** (coffre), pas du tiroir de caisse — le comptage du soir n'est pas impacté » (décision 2026-07-06) ; retirer « fournisseurs partagés » tant que D2 n'est pas fait.
- B2.1 → **retirer de À venir** et déplacer dans « Ce qu'on peut faire aujourd'hui » : seuils multi-niveaux, auto-approbation sous seuil et interdiction de s'auto-approuver sont livrés.
- Mentionner le statut brouillon et la vérification PIN à l'approbation (arguments de confiance que la doc n'exploite pas).

## E. Dépendances croisées
- **Module 10 (Comptabilité)** : JE à l'approbation et au paiement, mappings `EXPENSE_*`, garde fiscale — tout changement de circuit passe par les mappings.
- **Module 12 (Caisse physique & shifts)** : la question tiroir vs Petty Cash (D2) doit être tranchée en cohérence avec le comptage de fin de service.
- **Module 7 (Achats & fournisseurs)** : rattachement `supplier_id` (D2).
- **Module 14 (Rapports)** : `OperatingExpensesPage` et la rentabilité consomment ce module.
- **Module 20 (Employés & droits)** : gates `expenses.create/read/pay/thresholds.*` et SOD reposent sur le RBAC.
