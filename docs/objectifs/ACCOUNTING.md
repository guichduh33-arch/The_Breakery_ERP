# Module Accounting — Objectif métier

> **Statut V2/V3** : décrit la vision business cible (11 pages). **V2 jamais déployée**. Implémentation V3 actuelle = **partielle** — 1 page accounting (`MappingsPage`) + 3 pages financières sous `/reports` (Balance Sheet, ProfitLoss, Cash Flow). Les 7 autres pages sont **planifiées pour la Session S26 Comptable Cockpit**. DB excellente (triggers JE, mappings, fiscal periods, VAT, view_ar_aging tous présents). Voir [`../V2_V3_GLOSSARY.md`](../V2_V3_GLOSSARY.md).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module Accounting (`/accounting`) sert à faire au quotidien** pour The Breakery,

---

## 1. Raison d'être

Le module Accounting est la **comptabilité d'entreprise intégrée** de The Breakery. Il répond à une question simple mais critique pour toute PME indonésienne soumise à la fiscalité locale :

> *"Combien j'ai vraiment gagné ce mois ? Qu'est-ce que je dois au fisc en PB1 ? Combien me doivent mes clients B2B ? Combien je dois à mes fournisseurs ? Mon banque correspond-elle à mes livres ? Et est-ce que je suis en règle avec la norme SAK EMKM si un contrôleur passe demain ?"*

C'est le module qui transforme **un flux quotidien d'opérations métier** (ventes, achats, dépenses, paiements, productions, casses) en **comptabilité en partie double conforme** : plan comptable, journaux, grand livre, balance, états financiers, déclarations fiscales.

Le module est **principalement automatique** : 95 % des écritures sont générées par les triggers Postgres au fur et à mesure des opérations métier. L'utilisateur (gérant, comptable interne ou externe) consulte, vérifie, ajuste à la marge, et exporte pour la déclaration. Il **ne ressaisit jamais une vente** en compta.

Le module respecte la norme indonésienne **SAK EMKM** (Standar Akuntansi Keuangan Entitas Mikro, Kecil dan Menengah) — la norme PME — et publie en format compatible **CALK** (Catatan Atas Laporan Keuangan — notes annexes aux états financiers).

---

## 2. Les 11 pages du module

Le module est structuré en **11 pages** correspondant à 11 jobs comptables distincts :

| Page | Job-to-be-done | Permission |
|---|---|---|
| **Chart of Accounts** | Voir / gérer le plan comptable | `accounting.view` |
| **Journal Entries** | Consulter et créer des écritures journal | `accounting.journal.create` |
| **General Ledger** | Visualiser le grand livre par compte | `accounting.view` |
| **Trial Balance** | Balance des comptes à une date donnée | `accounting.view` |
| **Balance Sheet** | Bilan (actif / passif) | `accounting.view` |
| **Income Statement** | Compte de résultat (P&L) | `accounting.view` |
| **VAT Management** | Gérer la taxe PB1 (collectée, payable, déclarations) | `accounting.vat.manage` |
| **AR Aging** | Vieillissement des créances clients (Accounts Receivable) | `accounting.view` |
| **Bank Reconciliation** | Réconciliation des relevés bancaires | `accounting.manage` |
| **Reconciliation Detail** | Détail d'une réconciliation en cours | `accounting.manage` |
| **CALK** | Notes annexes aux états financiers (norme SAK EMKM) | `accounting.view` |

---

## 3. Les 6 invariants du module

Quelle que soit la page consultée, le module garantit toujours :

1. **Partie double stricte**. Chaque écriture journal a `débit total = crédit total`. Le système refuse une écriture déséquilibrée.
2. **Génération automatique**. 95 % des écritures sont créées par des triggers Postgres sur les opérations métier (vente, achat, paiement, casse, production). L'humain valide et corrige, il ne saisit pas.
3. **Conformité SAK EMKM**. Le plan comptable, la structure des états financiers et le format CALK respectent la norme indonésienne PME.
4. **Période fiscale verrouillable**. Une période clôturée n'accepte plus d'écriture — protection contre les modifications rétroactives.
5. **PB1 séparée des autres taxes**. La taxe restaurant locale 10% (PB1) a sa propre logique, ses propres comptes (2110 / 2143), et son propre rapport — distincte d'une éventuelle TVA / PPN.
6. **Toute écriture est traçable**. Source (opération métier d'origine), auteur, date, motif — jamais d'écriture orpheline.

---

## 4. Le Chart of Accounts — Le plan comptable

Page `ChartOfAccountsPage` : le **squelette** de la comptabilité. Affiche l'arbre hiérarchique du plan comptable :

### 4.1 Structure du plan

Codification à 4-5 chiffres, organisée par classe (norme SAK EMKM) :

| Classe | Comptes | Exemple |
|---|---|---|
| **1xxx** | Actif | 1110 Cash, 1120 Bank, 1300 Inventory, 1400 AR (Accounts Receivable) |
| **2xxx** | Passif | 2100 AP (Accounts Payable), 2110 PB1 Collected, 2143 PB1 Payable |
| **3xxx** | Capital / Equity | 3100 Capital social, 3200 Résultat de l'exercice |
| **4xxx** | Produits / Revenue | 4100 Sales Revenue, 4200 B2B Revenue, 4900 Exceptional income |
| **5xxx** | Charges / Expenses | 5100 COGS, 5200 Operating expenses, 5900 Exceptional charges |

### 4.2 Actions disponibles

- **Visualisation en arbre** (`AccountTree`) avec tri par code.
- **Création / édition** d'un compte via `AccountModal` (code, libellé, type, parent, accepte les écritures directes ou pas).
- **Désactivation** d'un compte sans écriture associée (soft delete).
- **AccountPicker** réutilisable dans les modales d'écriture.

Bénéfice métier : **un plan comptable lisible et adapté à la boulangerie**, qu'on n'a pas à reconstruire à chaque déclaration. Le système est livré pré-rempli pour SAK EMKM ; le comptable ajoute ses sous-comptes si besoin.

---

## 5. Les Journal Entries — Le journal des écritures

Page `JournalEntriesPage` : la liste des **écritures comptables** générées et saisies.

### 5.1 Types d'écritures

| Source | Génération | Exemple |
|---|---|---|
| **Vente POS / B2B** | Auto (trigger `create_sale_journal_entry`) | Débit 1110 Cash 110k / Crédit 4100 Sales 100k / Crédit 2110 PB1 10k |
| **Achat fournisseur** | Auto (trigger `create_purchase_journal_entry`) | Débit 1300 Inventory 500k / Crédit 2100 AP 500k |
| **Paiement fournisseur** | Auto | Débit 2100 AP 500k / Crédit 1120 Bank 500k |
| **Production** | Auto | Débit 1300 Finished Goods / Crédit 1300 Raw Materials |
| **Casse / Wastage** | Auto | Débit 5200 Wastage / Crédit 1300 Inventory |
| **Dépense** | Auto (via approve_expense_with_journal RPC) | Débit 5200 Operating Expense / Crédit 1110 Cash ou 2100 AP |
| **Écart de caisse** | Auto à la clôture session | Débit/Crédit 4900/5900 selon signe |
| **Ajustement manuel** | Manuel (`JournalEntryForm`) | Toute écriture saisie à la main par le comptable |

### 5.2 Le formulaire d'écriture manuelle

`JournalEntryForm` permet au comptable de :

- Saisir une **date** (refusée si la période est clôturée).
- Choisir un **journal** (général, ventes, achats, banque, OD — opérations diverses).
- Saisir une **description** + référence externe.
- Ajouter des **lignes** (`JournalLineTable`) : compte, débit ou crédit, libellé.
- Vérification temps réel : total débit = total crédit. Bloquant si différent.
- Validation → création de l'écriture en base, avec auteur et timestamp.

### 5.3 Validation comptable (`journalEntryValidation`)

Avant persistance, le service `journalEntryValidation` vérifie :

- Équilibre débit/crédit.
- Tous les comptes existent et sont actifs.
- Tous les comptes acceptent des écritures directes (pas des comptes "parent" agrégateurs).
- La période fiscale est ouverte.
- L'utilisateur a la permission `accounting.journal.create`.

Bénéfice métier : **impossible de saisir une écriture incohérente**. Le système refuse à la source.

---

## 6. Le General Ledger — Le grand livre

Page `GeneralLedgerPage` : pour un **compte donné**, l'historique complet des mouvements sur une période :

- Soldes d'ouverture, mouvements détaillés, solde de clôture.
- Pour chaque ligne : date, journal source, libellé, débit, crédit, solde courant.
- **Drill-down** : clic sur une ligne → ouvre l'écriture journal d'origine et, plus loin, l'opération métier source (la vente, le PO, le paiement).
- **Filtres** : période, contrepartie, fourchette de montant.
- **Export** CSV / PDF.

Bénéfice métier : **auditer un compte en 30 secondes**. Le comptable demande "pourquoi le compte 1110 Cash a bougé de 2M le 15 ?" — le grand livre montre les 4 transactions à l'origine, drill-down vers les ventes du jour.

---

## 7. La Trial Balance — La balance

Page `TrialBalancePage` : à une **date donnée**, l'état des soldes de tous les comptes :

- Une ligne par compte avec : code, libellé, total débit période, total crédit période, solde.
- Totaux en bas : total débit = total crédit (sinon erreur grave dans la base).
- **Filtre par date** (n'importe quelle date, pas que la fin de mois).
- **Filtre par classe** (1xxx actif, 2xxx passif, etc.).
- **Export** CSV / PDF.

Bénéfice métier : **vérifier la cohérence globale** avant de produire le bilan. Si la balance ne balance pas, le bilan sera faux.

---

## 8. Le Balance Sheet — Le bilan

Page `BalanceSheetPage` : le **bilan** à une date donnée, structure SAK EMKM :

- **Actif** : courant (cash, banque, AR, inventory), non courant (immobilisations, dépôts).
- **Passif** : courant (AP, PB1 payable, salaires à payer), non courant (emprunts).
- **Capitaux propres** : capital, réserves, résultat de l'exercice.
- Égalité Actif = Passif + Capitaux propres affichée en pied.
- **Format `FinancialStatementTable`** lisible avec hiérarchie pliable.
- **Export** PDF officiel pour banque / investisseur / contrôleur.

Bénéfice métier : **un bilan en 5 secondes**, prêt à imprimer, conforme à la norme indonésienne, sans avoir à attendre la clôture mensuelle du comptable externe.

---

## 9. L'Income Statement — Le compte de résultat

Page `IncomeStatementPage` : le **P&L** sur une période, structure SAK EMKM :

- **Revenus** : ventes retail, B2B, exceptionnel.
- **COGS** : coût des matières premières consommées (via production et ventes directes).
- **Marge brute** = Revenus − COGS.
- **Charges d'exploitation** : salaires, loyer, électricité, marketing, transport, casse.
- **Résultat d'exploitation**.
- **Charges et produits financiers**.
- **Résultat avant impôt**.
- **Impôt sur les sociétés** (si applicable).
- **Résultat net**.

Affichage tabulaire (`IncomeStatementTable`) avec comparaison période-vs-période optionnelle.

Bénéfice métier : **connaître son résultat à J+1**. Le gérant n'attend plus la fin de mois pour savoir s'il est rentable — il regarde son P&L tous les soirs s'il veut.

---

## 10. La VAT Management — La PB1 (taxe restaurant)

Page `VATManagementPage` : la gestion spécifique de la **PB1** (Pajak Restoran — taxe restaurant locale).

### 10.1 Spécificités PB1

- **PB1 ≠ PPN / TVA**. C'est une **taxe restaurant locale**, perçue au niveau du gouvernement régional (kabupaten / kota), pas national.
- **Taux fixe 10%**, inclus dans les prix affichés au client.
- **Formule** : `tax_amount = total × 10/110` (extraction de la part taxe du prix TTC).
- **Comptes** : 2110 PB1 Collected (côté revenu) / 2143 PB1 Payable (à reverser).
- **Pas de déduction d'amont** comme la TVA classique — pas de mécanisme de "PB1 à récupérer". La PB1 collectée est entièrement reversée.

### 10.2 Fonctionnalités

- **VATSummaryCard** : carte synthétique mois par mois (PB1 collectée, à reverser).
- **Calculer la PB1 du mois** via RPC `calculate_vat_payable(year, month)`.
- **Filings** (`useVatFilings`) : historique des déclarations passées.
- **Génération de la déclaration mensuelle** : PDF imprimable conforme au format attendu par le service fiscal local.
- **Marquage "déclaré + payé"** une fois la déclaration faite (verrouille la période).

Bénéfice métier : **conformité PB1 sans erreur ni oubli**. Le 10 de chaque mois, le comptable génère la déclaration du mois précédent en 1 clic, paie au trésor public, et marque comme déclarée — trace permanente.

---

## 11. L'AR Aging — Les créances clients

Page `ARAgingPage` : le **vieillissement des comptes à recevoir** (Accounts Receivable).

- Liste de tous les clients avec encours > 0 (essentiellement B2B + ardoises POS).
- Buckets : Courant (avant échéance) / 1-30j retard / 31-60j / 61-90j / 90j+.
- Total par bucket et total global.
- Drill-down par client → liste détaillée de ses commandes impayées.
- Filtres : par client, par type (B2B / POS outstanding), par montant.
- **Hook `useARManagement`** pour les actions de relance et imputation.

Bénéfice métier : **piloter le recouvrement** sans formule Excel parallèle. Voir au premier coup d'œil quels clients dérapent et de combien.

---

## 12. La Bank Reconciliation — La réconciliation bancaire

Pages `BankReconciliationPage` + `ReconciliationDetailPage` : le **rapprochement** entre les écritures comptables côté banque et le relevé bancaire réel.

### 12.1 Le geste

1. **Importer un relevé bancaire** (`BankStatementUpload`) au format CSV ou Excel — le service `bankStatementParser` interprète et normalise.
2. **Charger les écritures comptables** non encore rapprochées sur la période.
3. **Matcher automatiquement** sur les correspondances triviales (même date, même montant).
4. **Match manuel** (`ManualMatchModal`) pour les cas ambigus (différence de jour, montant légèrement différent à cause de frais).
5. **Ajustements** (`AdjustmentForm`) pour les écarts résiduels (frais bancaires non comptabilisés, intérêts, etc.).
6. **Validation finale** : la réconciliation est figée, marque les écritures comme rapprochées.

### 12.2 Vue détail

`ReconciliationDetailPage` montre, pour une réconciliation donnée :

- Solde de départ banque vs comptabilité.
- Lignes matchées une à une.
- Lignes orphelines (banque sans compta, ou compta sans banque) — à investiguer.
- Solde de fin attendu vs réel.

Bénéfice métier : **les livres de The Breakery collent à la banque** au centime près, semaine après semaine. Aucune dérive ne s'installe.

---

## 13. La CALK — Notes annexes aux états financiers

Page `CALKPage` : la **CALK** (*Catatan Atas Laporan Keuangan*) — les **notes annexes** aux états financiers exigées par la norme SAK EMKM.

Contenu type :

- Identification de l'entité (raison sociale, NPWP, adresse, secteur).
- Base de présentation des comptes.
- Méthodes comptables retenues (FIFO, coût moyen, amortissements).
- Détail des principaux postes du bilan.
- Détail des principaux postes du P&L.
- Engagements hors bilan.
- Événements post-clôture.

Le module fournit un **éditeur structuré** (service `calkService`) qui pré-remplit les sections standards à partir des données comptables et permet au comptable d'ajouter les commentaires narratifs.

Bénéfice métier : **un dossier d'états financiers complet** prêt à imprimer / envoyer à la banque / au comptable externe, conforme à la norme PME indonésienne, sans devoir tout reformater dans Word.

---

## 14. Les périodes fiscales

`useFiscalPeriods` + `FiscalPeriodModal` : la gestion des **périodes comptables**.

- Une période ouverte accepte les écritures.
- Une période clôturée les refuse — protection contre la modification rétroactive.
- Trois statuts : `open` / `pending_closure` / `closed`.
- Clôture nécessite permission `accounting.manage`.
- Le calendrier fiscal indonésien standard : exercice = année civile (1 janv − 31 déc), avec clôtures mensuelles intermédiaires possibles.

Bénéfice métier : **figer le passé** dès qu'il est validé. Une fois mars clôturé, le résultat de mars est définitif — personne ne peut le retoucher sans piste d'audit.

---

## 15. La génération automatique — Le cœur du module

Toute la **valeur quotidienne** du module vient de l'**automatisation**. Les triggers Postgres génèrent les écritures sans intervention humaine :

| Opération métier | Trigger | Écriture produite |
|---|---|---|
| Vente POS payée cash | `create_sale_journal_entry` | DR Cash / CR Sales / CR PB1 Payable |
| Vente POS payée card | `create_sale_journal_entry` | DR Bank (à recevoir) / CR Sales / CR PB1 Payable |
| Vente B2B livrée | `create_sale_journal_entry` (B2B variant) | DR AR / CR B2B Sales / CR PB1 Payable |
| Paiement B2B reçu | Trigger paiement | DR Cash/Bank / CR AR |
| Réception PO | `create_purchase_journal_entry` | DR Inventory / CR AP |
| Paiement fournisseur | Trigger paiement | DR AP / CR Cash/Bank |
| Casse / Wastage | Trigger | DR Wastage Expense / CR Inventory |
| Production | Trigger | DR Finished Goods / CR Raw Materials |
| Dépense approuvée | RPC `approve_expense_with_journal` | DR Operating Expense / CR Cash/Bank or AP |
| Écart de caisse session | Trigger fermeture | DR/CR Exceptional / CR/DR Cash |
| Refund | Trigger void/refund | Contre-passation de la vente d'origine |

Bénéfice métier : **le comptable n'est plus la goulot d'étranglement**. Il consulte, audite, ajuste à la marge, déclare — il ne saisit plus.

---

## 16. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **POS / Orders** | Chaque commande payée déclenche une écriture vente automatique. |
| **B2B** | Chaque livraison + chaque paiement B2B alimentent AR et le journal. |
| **Inventory** | Chaque production / casse / opname adjustment écrit en compta. |
| **Purchasing** | Chaque réception PO et chaque paiement fournisseur écrit en compta. |
| **Cash Register** | Chaque clôture session écrit un éventuel écart de caisse. |
| **Expenses** | Chaque dépense approuvée passe par `approve_expense_with_journal`. |
| **Reports** | P&L Monthly Trend, VAT Report, Receivables, Expenses by Category lisent les tables compta. |
| **Settings** | Plan comptable de référence, numérotation écritures, date de clôture exercice configurés dans Settings → Financial. |

---

## 17. Ce que le module ne fait **pas** (par design)

- Le module **ne fait pas la paie**. Pas de gestion des salaires détaillée — juste les écritures globales mensuelles. Pour la paie, un SIRH externe (BPJS, PPh21).
- Le module **ne gère pas les amortissements automatiques** des immobilisations. Saisie manuelle d'OD mensuelle.
- Le module **ne gère pas la TVA / PPN**. The Breakery est sous régime PB1 (taxe restaurant 10% locale), pas PPN national.
- Le module **ne fait pas de consolidation multi-entité**. Une seule entreprise, un seul jeu de livres.
- Le module **ne supporte pas le multi-devise**. Tout en IDR. Une dépense en USD doit être convertie manuellement.
- Le module **n'exporte pas vers Accurate / MYOB** directement. Export CSV générique, à reformater dans le logiciel externe si besoin.

---

## 18. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **E-Faktur / e-Bupot integration** | Si The Breakery passe sous régime PPN, intégration directe avec le système fiscal national. |
| 🔴 | **Amortissement automatique des immobilisations** | Saisir un équipement, paramétrer la durée, le système écrit l'amortissement mensuel. |
| 🟠 | **Closing checklist mensuelle** | Workflow guidé : "as-tu réconcilié la banque ? validé les dépenses ? déclaré la PB1 ?" avant de clôturer le mois. |
| 🟠 | **Comparatif budget vs réel** | Saisir un budget annuel et voir en direct les écarts par compte. |
| 🟠 | **Export Accurate / MYOB** | Génération d'un fichier d'import au format attendu par les logiciels comptables locaux. |
| 🟡 | **Multi-devise** | Pour les fournisseurs internationaux (équipement français, ingrédients italiens). |
| 🟡 | **Consolidation multi-entité** | Si The Breakery ouvre une seconde adresse en tant qu'entité juridique distincte. |
| 🟢 | **IA d'aide à la classification** | Suggestion automatique du compte pour les dépenses ambiguës basée sur l'historique. |
| 🟢 | **Tax planning** | Simulation des taxes à payer selon différents scénarios de fin d'année. |

---

## 19. En une phrase

Le module Accounting est **la mémoire comptable cohérente et vivante** de The Breakery : il transforme chaque vente, achat, dépense, casse, production et paiement en écriture en partie double conforme SAK EMKM via 95 % d'automatisation par triggers, sépare proprement la PB1 du reste, réconcilie la banque au centime près, produit un bilan et un P&L à jour à la seconde, et livre la déclaration PB1 mensuelle prête à imprimer — pour que le gérant connaisse son résultat à J+1 et que le comptable externe ne fasse plus que valider.
