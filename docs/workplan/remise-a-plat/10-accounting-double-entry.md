# Module 10 — Comptabilité en partie double

> ⚠️ **Corps figé au `5b0fa92` (2026-07-04) — partiellement périmé.** Le tableau §C ligne **B1.2** (encore noté 🟠 PARTIEL « Source en texte mort, aucun lien de navigation vers l'opération d'origine ») est dépassé : le **drill-down JE → origine** a été livré en **S59** (`resolveJeSourceEntity`, 26 `reference_type` couverts) — caveat : `reference_id` de `sale_refund`/`refund` pointe une ligne `refunds.id`, pas un `orders.id` (fallback texte volontaire). Le corps/tableau figé ci-dessous n'est PAS réécrit (append-only) ; se fier au présent bandeau, à la MAJ S59 ci-dessous et à CLAUDE.md pour l'état courant.

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **D1.1 drill-down JE → origine livré** (`resolveJeSourceEntity`, 26 `reference_type` couverts) ; C-B1.2 n'est plus 🟠 texte-mort. **À documenter (leçon S59)** : la sémantique de `journal_entries.reference_id` **varie selon `reference_type`** — pour `sale_refund`/`refund`, `reference_id` pointe une ligne `refunds.id`, PAS un `orders.id` (ces deux types sont volontairement en fallback texte, pas de lien order). Une table de correspondance `reference_type` → entité + colonne cible reste à ajouter à cette fiche. Voir `docs/workplan/plans/archive/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 10. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** Le cœur (JE auto partout, écriture manuelle équilibrée+PIN, TB/P&L/BS, périodes fail-closed, clôture annuelle câblée) est réel et conforme. La doc surclame en revanche le **rapprochement bancaire** (inexistant — seul un comptage cash-vs-GL existe), les **notes annexes SAK EMKM** (aucune trace) et la « **déclaration PB1 en un clic** » (c'est un rapport exportable, pas un workflow déclaratif) ; le drill-down GL s'arrête au type de source sans lien vers l'opération d'origine.

## A. Ce qui fonctionne réellement (code vérifié)

- **Plan comptable** : page routée+gatée `accounting.coa.read` (`apps/backoffice/src/routes/index.tsx:532-537`), hooks `useChartOfAccounts` / `useUpdateAccountActive` (activation/désactivation). [UI câblée]
- **Journal des écritures** : `JournalEntriesPage` + `JournalEntryDetailDrawer` (lignes débit/crédit + totaux). Les écritures sont générées automatiquement par tous les flux : vente (`complete_order_with_payment_v17`), B2B (`_075`), dépenses (`20260517000122` l.219-249), paiement dépense (l.325-338), shift, stock, cash movements — l'ordre de grandeur « 95 % auto » est crédible. [UI câblée]
- **Écriture manuelle équilibrée obligatoire** : `create_manual_je_v1` (`20260603000025`) rejette `je_unbalanced` si |ΣD−ΣC| ≥ 0,01 (l.107-108), PIN manager avec lockout (`20260622000013`). [UI câblée : `CreateManualJEModal` + `useCreateManualJournalEntry.ts:26`]
- **Grand livre** : `get_general_ledger_v2` (curseur, running balance) + `GeneralLedgerPage` (« Drilldown by account », l.102). Les lignes exposent `reference_type`/`reference_id` (`useGeneralLedger.ts:15-16`). [UI câblée]
- **Balance** : `get_trial_balance_v3` (solde cumulé as-of + opening, fix leak `_078`) + `TrialBalancePage` + export CSV (`exportTrialBalanceCsv.ts`). [UI câblée]
- **P&L / Bilan** : `get_profit_loss_v2` / `get_balance_sheet_v2` (gatés `has_permission` depuis S50) + pages + **templates PDF** `pnl.ts` / `bs.ts` dans `supabase/functions/_shared/pdf-templates/`. [UI câblée + EF]
- **Marge brute par produit** : `get_gross_margin_by_product_v1` (`20260710000093`, gate `reports.financial.read`, POS+B2B, fuseau local, **coût = WAC courant avec caveat documenté**) + `GrossMarginPage` routée+gatée (`routes/index.tsx:708-714`). [UI câblée]
- **PB1 10 % (NON-PKP)** : `get_pb1_report_v1` + `Pb1ReportPage` (sélecteur mois/année, CSV + PDF `pb1.ts`, drill-down GL compte 2110 — `Pb1ReportPage.tsx:4-8,40`). [UI câblée]
- **Périodes fiscales fail-closed** : `check_fiscal_period_open` lève `period_locked` (P0004) sur période close/lockée et `period_undefined` (P0004) si **aucune période ne couvre la date** (`20260710000077` l.27-33) — 34 call-sites protégés. Gestion des périodes : `SettingsAccountingPage` + `FiscalPeriodModal` (close/lock), route gatée `accounting.period.close` (`routes/index.tsx:948-952`). [UI câblée]
- **Clôture annuelle** : `close_fiscal_year_v1` (`20260710000080` : préconditions 12 périodes closed/locked, JE `year_close` zérotant classes 4/5/6 → contrepartie 3200, **seed des 12 périodes N+1**, PIN avec lockout) + permission `accounting.year.close` (`_079`) + **`AnnualCloseModal` câblée** (`SettingsAccountingPage.tsx:10,133`) + hook `useCloseFiscalYear` (classification 8 codes d'erreur). Exclusion `year_close` des rapports (`_081` : P&L v2 WHERE ; TB v3 colonnes de période). [UI câblée]
- **Trésorerie cash** : `CashTreasuryPage` (wallets 1110/1111/1117), ledger, `RecordCashMovementModal` (JE équilibrée), `CashReconciliationPanel` — comptage physique vs solde GL avec ajustement `adjustment_gain/loss` en un clic (`CashReconciliationPanel.tsx:2-33`). [UI câblée]
- **Mappings comptables** : `MappingsPage` routée (`routes/index.tsx:572-576`), `resolve_mapping_account` utilisé par tous les writers. [UI câblée]
- **Créances par ancienneté** : `view_ar_aging` (voir module 9). [UI câblée]

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Plan comptable pré-configuré + journal ; 95 % d'écritures auto ; saisie manuelle possible, écriture déséquilibrée refusée à la source.
- B1.2 Auditer un compte via le grand livre **avec remontée jusqu'à l'opération d'origine** (la vente, la commande, le paiement).
- B1.3 Balance, bilan, compte de résultat à n'importe quelle date, **prêts à imprimer** ; marge brute par produit.
- B1.4 PB1 10 % avec **déclaration mensuelle en un clic**.
- B1.5 Créances clients par ancienneté.
- B1.6 **Rapprocher les relevés bancaires des livres, au centime**.
- B1.7 Produire les **notes annexes exigées par la norme** (SAK EMKM).
- B1.8 Périodes verrouillées : mois clôturé refuse toute écriture ; opération datée d'une période inexistante **bloquée net**.
- B1.9 Clôture annuelle : bénéfice → réserves, exercice suivant préparé, PIN manager, bouton dédié.

### B2. Annoncé « À venir »
- B2.1 Figer le coût des ingrédients au moment de la vente (snapshot COGS).
- B2.2 Import en masse des ventes/dépenses historiques.
- B2.3 Amortissement automatique des équipements.
- B2.4 Check-list guidée de clôture mensuelle.
- B2.5 Budget prévu / réalisé.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | COA + journal, 95 % auto, déséquilibre refusé | `create_manual_je_v1` → `je_unbalanced` (`_025` l.107) ; JE auto sur tous les flux | ✅ CONFORME |
| B1.2 | GL avec remontée jusqu'à l'opération d'origine | Le drawer affiche `Source : <reference_type>` en **texte mort** (`JournalEntryDetailDrawer.tsx:39`) ; `reference_id` est retourné mais **aucun lien de navigation** vers la commande/dépense/paiement d'origine (l'infra `buildDrilldownUrl` existe côté rapports mais n'est pas branchée ici) | 🟠 PARTIEL |
| B1.3 | TB/BS/P&L à toute date, prêts à imprimer ; marge brute | Pages + RPCs ✅ ; PDF pour P&L/BS ✅, **TB = CSV seulement** (pas de template `tb`) ; marge brute ✅ (coût WAC courant — la doc l'assume via B2.1) | 🟠 PARTIEL |
| B1.4 | Déclaration PB1 mensuelle **en un clic** (scénario : « marque déclarée — la période se fige ») | `Pb1ReportPage` = **rapport consultable + exports CSV/PDF**. Aucun workflow « déclarer / marquer déclarée » (grep `declar` → 0 hit métier), aucun lien automatique avec le gel de période (action séparée dans Settings) | 🟠 PARTIEL |
| B1.5 | Créances par ancienneté | `view_ar_aging` + dashboard B2B | ✅ CONFORME |
| B1.6 | Rapprochement bancaire au centime | **Inexistant** : aucun import/matching de relevés bancaires. Le seul « rapprochement » est `CashReconciliationPanel` (comptage physique cash wallets vs GL + ajustement) — ce n'est pas un rapprochement bancaire | 🔴 MANQUANT |
| B1.7 | Notes annexes SAK EMKM | **Aucune trace** (grep `SAK|EMKM|notes annexes` dans `apps/backoffice/src` → 0) | 🔴 MANQUANT |
| B1.8 | Périodes verrouillées + blocage période inexistante | `check_fiscal_period_open` fail-closed `period_locked`/`period_undefined` P0004 (`_077`) | ✅ CONFORME |
| B1.9 | Clôture annuelle protégée, bouton dédié | `close_fiscal_year_v1` (`_080`) + `AnnualCloseModal` câblée + seed N+1 | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Module Cash & Treasury complet (wallets, ledger, mouvements avec JE, reconciliation cash) — la doc ne le mentionne pas dans ce module.
- 🔵 Page Accounting Mappings (édition des comptes de mapping) non décrite.
- 🔵 Exclusion `year_close` des rapports (P&L/TB) — subtilité de correction absente de la doc.
- 🔵 Dédup void/refund dans TB v3 (fix `_078`).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
- **Drill-down JE → origine** (ferme B1.2) : dans `JournalEntryDetailDrawer` et `GeneralLedgerPage`, transformer `reference_type`/`reference_id` en lien (`sale|void|refund` → OrderDetailDrawer / `orders?focus=`, `expense|expense_payment` → `/expenses/:id`, `b2b_*` → onglet Invoices, `cash_movement` → treasury). Fichiers : `JournalEntryDetailDrawer.tsx`, `GeneralLedgerPage.tsx`. Done = clic « Source » ouvre l'opération.
- **Template PDF Trial Balance** (aligne B1.3) : ajouter `tb.ts` au registre `_shared/pdf-templates/` + `ExportButtons` sur `TrialBalancePage`. Done = bouton PDF opérationnel.

### D2. Chantiers moyens (1 session, plan requis)
- **Workflow PB1 « déclarée »** (ferme B1.4) : table `pb1_declarations` (mois, montant, déclaré par/le, statut), action gatée sur `Pb1ReportPage`, lien optionnel avec la clôture de période. Plan requis (interaction avec periods + audit).
- **Check-list de clôture mensuelle** (B2.4) — s'appuie sur l'existant (périodes, PB1, Z-reports).

### D3. Chantiers lourds (spec dédiée avant code)
- **Rapprochement bancaire** (B1.6) : import de relevés (CSV bancaire), moteur de matching JE↔ligne de relevé, écran de lettrage, écarts. Spec dédiée obligatoire.
- **Notes annexes SAK EMKM** (B1.7) : définir le contenu normatif exact (politique comptable, immobilisations, dettes), génération PDF. Spec avec le comptable.
- **Snapshot COGS à la vente** (B2.1) — déjà fléché P3 dans l'audit ; conditionne la fiabilité historique de la marge brute.
- **Amortissements** (B2.3) : registre d'immobilisations + JE périodiques (cron).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- B1.6 et B1.7 → déplacer intégralement en « À venir » (rien n'existe).
- B1.4 → reformuler : « rapport PB1 mensuel exportable en un clic (CSV/PDF) ; le marquage “déclarée” et le gel automatique restent manuels ».
- B1.2 → soit corriger le code (D1), soit préciser « la source de chaque écriture est identifiée (type + référence) ».
- Ajouter la trésorerie cash (wallets/petty cash) au périmètre décrit.

## E. Dépendances croisées
- **Tous les modules opérationnels** écrivent des JE (caisse 3, B2B 9, achats 7, stock 6, dépenses 11, shifts 12) — tout changement de mapping les traverse.
- **Module 14 (Rapports)** : P&L/BS/TB/PB1/marge brute vivent à cheval entre les deux modules ; le drill-down D1 réutilise `buildDrilldownUrl`.
- **Module 9 (B2B)** : l'aging (B1.5) est porté par les vues B2B ; le fait générateur de la JE AR dépend du futur cycle de livraison B2B.
- **Module 6 (Stock)** : snapshot COGS (D3) — découplé du chantier lots (abandonné le 2026-07-04) ; à baser sur le WAC au moment de la vente.
- **Module 12 (Shifts)** : écritures d'écart de caisse et Z-reports alimentent le journal.
