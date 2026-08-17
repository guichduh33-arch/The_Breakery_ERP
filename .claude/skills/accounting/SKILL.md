---
name: accounting
description: >-
  Senior master accountant — mécanique ET conseil du module accounting. Côté mécanique :
  COA, journal entries, PB1/PBJT (NON-PKP, ADR-005), périodes fiscales & clôture annuelle,
  grand livre, balance, P&L, bilan, cash flow, coffres. Côté conseil : concevoir/faire
  évoluer le plan comptable (benchmark F&B même taille), auditer la couverture des
  automatisations POS/BO→JE (zéro double saisie), revoir la qualité/lisibilité des pages,
  générer et vérifier les rapports comptables, optimisation fiscale LÉGALE (cadre
  NON-PKP/PBJT). Use this skill whenever the task mentions journal entry / écriture
  comptable / JE, COA / plan comptable / chart of accounts, PB1, PPN, TVA, NON-PKP, PBJT,
  fiscal period / période fiscale, clôture annuelle / year close, general ledger / grand
  livre, trial balance / balance, bilan / balance sheet, P&L / compte de résultat,
  cash flow / flux de trésorerie, cash wallet / coffre / petty cash, COGS, retained
  earnings, mapping account, double saisie / double input, optimisation fiscale / impôts /
  PPh / UMKM, rapport comptable, audit comptable, compta / comptabilité — or touches
  apps/backoffice accounting features/pages, or supabase migrations/tests around
  journal/fiscal/ledger/pb1/cash_flow. Invoke it BEFORE editing any JE-emitting RPC or
  accounting report, even for a one-line fix.
pathPatterns:
  - 'apps/backoffice/src/features/accounting/**'
  - 'apps/backoffice/src/pages/accounting/**'
  - 'supabase/migrations/*journal*.sql'
  - 'supabase/migrations/*fiscal*.sql'
  - 'supabase/migrations/*ledger*.sql'
  - 'supabase/migrations/*pb1*.sql'
  - 'supabase/migrations/*cash_flow*.sql'
  - 'supabase/migrations/*cash_wallet*.sql'
  - 'supabase/migrations/*account*.sql'
  - 'supabase/tests/*accounting*.test.sql'
  - 'supabase/tests/*fiscal*.test.sql'
  - 'supabase/tests/*pb1*.test.sql'
  - 'supabase/tests/*cash*.test.sql'
promptSignals:
  phrases:
    - 'journal entry'
    - 'COA'
    - 'chart of accounts'
    - 'plan comptable'
    - 'PB1'
    - 'PPN'
    - 'NON-PKP'
    - 'fiscal period'
    - 'year close'
    - 'general ledger'
    - 'trial balance'
    - 'cash flow'
    - 'cash wallet'
    - 'COGS'
    - 'retained earnings'
    - 'mapping account'
    - 'double saisie'
    - 'optimisation fiscale'
    - 'rapport comptable'
---

# Accounting — senior master accountant, The Breakery ERP

Deux casquettes, un seul skill :

1. **Mécanique (garde-fou)** — triggers JE, mappings, pièges du COA, checklists avant
   d'éditer toute RPC émettrice. À invoquer avant chaque modification du module.
2. **Conseil (senior)** — concevoir le plan comptable, auditer la couverture des
   automatisations (zéro double saisie), revoir la qualité des pages, générer/vérifier les
   rapports, optimiser fiscalement dans la légalité. Voir « Missions advisory ».

**`CLAUDE.md` est la source de vérité** pour les patterns projet (RPC versioning, REVOKE
pairs, PIN header, audit_logs). Ce skill ajoute le modèle mental comptable, les faits
vérifiés et les méthodes de conseil.

> **Conventions de lecture.** Les RPC sont citées par **famille** (`get_general_ledger`,
> `close_fiscal_year`) : les versions bumpent, la version live se lit dans
> `supabase/migrations/` ou `pg_proc` **avant** tout call-site. Les chiffres datés
> (`au 2026-08-17`) sont des relevés, pas des invariants : re-vérifier contre la base.
> Tout ce qui suit a été re-vérifié contre la base dev live le 2026-08-17.

---

## Mental model NON-PKP (ADR-003 ratifié 2026-05-20, juridiction corrigée par ADR-005 le 2026-07-16)

**The Breakery est NON-PKP.** Décision irrévocable — relire
`docs/adr/005-juridiction-fiscale-lombok-pbjt.md` (supersedes ADR-003) avant tout
changement fiscal.

- **Output tax** : **taxe F&B locale 10%** — **PBJT Makanan dan Minuman** (UU HKPD
  1/2022), niveau kabupaten/kota, perçue par le **Bapenda** de la commune (The Breakery
  est à **Lombok, NTB** — pas Bali, cf. ADR-005). « PB1 » reste le label usuel dans le
  code. Pas de PPN sortant, pas d'e-Faktur, pas d'export DJP.
- **Input tax** : PPN 11% fournisseurs PKP **non-récupérable** → **folded** dans le coût
  d'acquisition (achats de stock → `INVENTORY_GENERAL` 1141) ou dans la charge (dépenses
  → compte de catégorie). Le compte `1151 VAT Input` est **désactivé** et sa réactivation
  refusée par la RPC. Ne jamais chercher à le rouvrir sans un nouvel ADR supersedant
  ADR-005.
- **PB1 est INCLUSIVE** : `business_config.tax_inclusive = true`, `tax_rate = 0.1`
  (relevé 2026-08-17). Le prix affiché est TTC ; la taxe se dé-cumule
  (`total × rate / (1 + rate)`) via le helper `_pb1_split`, seul endroit qui connaît la
  formule. Ne jamais recalculer une PB1 à la main — appeler le helper ou lire
  `orders.tax_amount` déjà splité.
- **`current_pb1_rate()`** lit `business_config.tax_rate`. Toujours l'utiliser — pas de
  hardcode `10/110`.
- **`calculate_pb1_payable`** : `pb1_payable = pb1_output` (pas de soustraction
  `vat_input`). Gatée `reports.financial.read` depuis le bump v2 du 2026-08-18
  (qui corrige aussi le résidu ADR-005 : `tax_regime` renvoie
  `NON_PKP_LOMBOK_PBJT`, plus `NON_PKP_BALI_PB1`). `get_pb1_report` est la
  variante mensuelle, même gate.

---

## Carte des automatisations — zéro double saisie

**Invariant : un événement d'argent = exactement UN émetteur automatique de JE.** La
saisie manuelle (`create_manual_je`) est l'exception documentée, jamais le rattrapage
d'un flux qui aurait dû être automatique. Toute JE passe par un trigger ou une RPC
dédiée — jamais d'INSERT direct dans `journal_entries`.

### Émetteurs par trigger (relevé pg_trigger 2026-08-17)

| Trigger | Table / événement | Fonction |
|---|---|---|
| `trg_create_sale_journal_entry_ins` | `orders` AFTER INSERT WHEN `status='paid'` | `create_sale_journal_entry()` |
| `trg_create_sale_journal_entry_upd` | `orders` AFTER UPDATE OF `status` → `paid` ou `voided` | `create_sale_journal_entry()` |
| `trg_create_je_for_refund` | `refunds` AFTER INSERT — CONSTRAINT trigger, DEFERRABLE INITIALLY DEFERRED | `fn_create_je_for_refund()` |
| `trg_create_purchase_je` | `goods_receipt_notes` AFTER INSERT | `create_purchase_journal_entry()` |
| `tr_20_je_emit` | `stock_movements` AFTER INSERT — types `waste`, `adjustment`, `adjustment_in/out`, `opname_in/out`, `production_in/out` | `tr_stock_movement_je()` |

### Émetteurs par RPC (la RPC émet elle-même sa JE ou ses lignes)

| Famille RPC | Événement métier | Mappings résolus (relevé 2026-08-17) |
|---|---|---|
| `complete_order_with_payment`, `pay_existing_order` | remise POS, points loyalty | `SALE_DISCOUNT` → 4900, `LOYALTY_LIABILITY` → 2210 |
| `_emit_expense_je` (appelée par le workflow expenses) | dépense approuvée | charge TTC (PPN foldé) ; `EXPENSE_AP` 2141 / `EXPENSE_CASH_OUT` 1111 |
| `create_b2b_order`, `cancel_b2b_order` | vente / annulation B2B | `SALE_B2B_REVENUE` → 4131, `B2B_AR` → 1132 |
| `record_b2b_payment` | règlement B2B | `B2B_PAYMENT_BANK` → 1112 |
| `adjust_b2b_balance` | write-off créance B2B | `B2B_AR_ADJUSTMENT` → 6520 |
| `close_shift` | écart de caisse à la clôture | `SHIFT_CASH_VARIANCE_EXPENSE` → 5910 / `_INCOME` → 4910 |
| `grant_store_credit`, `expire_store_credit` | avoir accordé / expiré | `STORE_CREDIT_GRANT_EXPENSE` → 6117, `STORE_CREDIT_EXPIRY_INCOME` → 4920 |
| `convert_loyalty_to_store_credit` | points → avoir | `LOYALTY_LIABILITY` → 2210 |
| `record_cash_wallet_movement` | coffres BO, owner drawing | `CASH_WALLET_*`, `OWNER_DRAWING` → 3110 |
| `record_cash_movement` | événements de caisse du shift POS | voir ci-dessous |

**Silencieux par décision** (ne JAMAIS les « corriger ») : `transfer_*` et
`cost_price_correction` / recalcul WAC (ADR-014 — l'écart GL vs valorisation se résorbe
à l'opname).

**Cash movements du shift POS** (`record_cash_movement`, gate `shift.cash_movement`,
idempotent, session `open` obligatoire) — seuls deux `reason_code` sur quatre émettent
une JE, **datée `CURRENT_DATE`** et non de la date de session :
- `apport_owner` → DR 1110 / CR 3100 Owner Capital
- `bank_transfer` → DR/CR 1110 ↔ 1112 (sens selon `direction`)
- `replenishment`/`misc`/NULL → mouvement enregistré, **pas de JE**

### JE de vente (`create_sale_journal_entry`)

- **Garde B2B (migration 20260818000006, 2026-08-18)** : `order_type='b2b'` OU une JE
  `reference_type='b2b_order'` préexistante référençant la commande → le trigger
  n'émet **rien** (ni `sale` ni `sale_void`) et ne touche pas au fiscal guard. Le
  revenu B2B vit exclusivement dans la JE `b2b_order` (DR 1132 / CR 4131) posée par
  `create_b2b_order`. Avant cette garde, une commande B2B passée `paid` par
  `record_b2b_payment` (qui n'écrit jamais de `order_payments`) tombait dans le
  fallback cash et **doublait le revenu** (4100 + 4131).
- CR `SALE_POS_REVENUE` → **4100** pour `total − tax_amount`, CR `SALE_PB1_TAX` → **2110**
  pour `tax_amount` (PB1 inclusive déjà splitée sur la commande).
- DR une ligne **par ligne de `order_payments`** (split tender), compte résolu par le
  helper `_sale_payment_mapping_key`.
- `orders.is_historical_import = true` → **aucune JE** (reprise d'historique).
- Aucune ligne `order_payments` → **fallback cash** sur la totalité + `audit_logs` action
  `je.payment_fallback_cash`. Un pic sur cette action = money-path qui n'écrit plus ses
  paiements. Sur dev, les fixtures E2E (`order_number` en `#TEST-`) polluent ce signal —
  filtrer avant de conclure.
- Le void émet **exactement une** contre-passation `sale_void` (ADR-013 D2) ; la ligne
  `refunds(is_full_void=true)` est un miroir audit et n'émet rien.

**Mapping méthode → compte** — helper `_sale_payment_mapping_key`, **partagé vente et
reversals** (ADR-013 D3). L'enum Postgres est la seule source ; `debit_card`/`credit_card`
n'existent pas dans l'enum :

| Méthode | Mapping key | Compte |
|---|---|---|
| `cash` | `SALE_PAYMENT_CASH` | 1110 Cash on Hand |
| `qris`, `gopay`, `ovo`, `dana` | `SALE_PAYMENT_QRIS` | 1115 QRIS Clearing |
| `card`, `edc` | `SALE_PAYMENT_DEBIT` (clé `SALE_PAYMENT_CREDIT_CARD` pointe aussi 1116) | 1116 Card Clearing |
| `transfer` | `SALE_PAYMENT_TRANSFER` | 1112 Bank Operating |
| `store_credit` | `SALE_PAYMENT_STORE_CREDIT` | 2220 Customer Store Credit Payable (ADR-013 D4) |
| (inconnue) | `SALE_PAYMENT_CASH` | fallback silencieux — un nouveau moyen de paiement non ajouté au helper part en caisse |

**Idempotence JE** : index `journal_entries_je_idempotency_uniq` sur
`(reference_type, reference_id, COALESCE(metadata->>'movement_type',''))` WHERE
`reference_id IS NOT NULL`. Les JE sans référence (clôture annuelle) portent leur propre
garde anti-rejeu.

**Fiscal guard, fail-closed** : chaque émetteur appelle `check_fiscal_period_open(date)`,
qui lève `P0004` dans deux cas — `period_locked` ET `period_undefined` (aucune période ne
couvre la date). Si les périodes de N+1 ne sont pas seedées, la vente s'arrête au
1ᵉʳ janvier. C'est voulu ; la clôture annuelle seede N+1 pour cette raison.

---

## COA — extrait de lecture

⚠️ **EXTRAIT** des comptes les plus rencontrés. Le plan complet comptait **53 comptes
(dont 1 inactif, 10 non-postables) au 2026-08-17**. Ne jamais conclure « ce compte
n'existe pas » depuis cet extrait — lire le COA live :

```sql
SELECT code, name, account_class, is_active, is_postable, cash_flow_section
  FROM accounts ORDER BY code;
```

| Code | Nom | Classe | Notes |
|------|-----|--------|-------|
| **1110** | Cash on Hand | 1 asset | Caisse shift ; `CASH_WALLET_UNDEPOSITED` |
| **1111** | Petty Cash | 1 asset | `CASH_WALLET_PETTY`, `EXPENSE_CASH_OUT` |
| **1112** | Bank Operating | 1 asset | `CASH_MOVEMENT_BANK`, `SALE_PAYMENT_TRANSFER`, `B2B_PAYMENT_BANK` |
| **1115** | Cash - QRIS Clearing | 1 asset | `SALE_PAYMENT_QRIS` |
| **1116** | Cash - Card Clearing | 1 asset | `SALE_PAYMENT_DEBIT` |
| **1117** | Small Money (Change Float) | 1 asset | `CASH_WALLET_SMALL_MONEY` |
| **1131** | Accounts Receivable | 1 asset | Créances hors B2B ; aucun mapping, zéro ligne au 2026-08-17 |
| **1132** | AR - B2B | 1 asset | `B2B_AR` — c'est ICI que vit l'AR réel |
| **1141** | Inventory - General | 1 asset | `INVENTORY_GENERAL` ; reçoit le PPN supplier foldé |
| **1142/1143** | Inventory Raw / Finished | 1 asset | `INVENTORY_RAW_MATERIAL` / `INVENTORY_FINISHED_GOODS` |
| **1151** | VAT Input — RESERVED | 1 asset | **DÉSACTIVÉ NON-PKP** (ADR-003/005), réactivation hard-bloquée. Les mappings `EXPENSE_VAT_INPUT`/`PURCHASE_VAT_INPUT` y pointent encore mais **aucune fonction ne les résout** |
| **2110** | PB1 (10%) Payable | 2 liability | `SALE_PB1_TAX` — sortie mensuelle Bapenda |
| **2141** | Accounts Payable | 2 liability | `PURCHASE_PAYABLE`, `EXPENSE_AP` |
| **2210** | Loyalty Liability | 2 liability | `LOYALTY_LIABILITY` — dette de points |
| **2220** | Customer Store Credit Payable | 2 liability | Avoirs client (ADR-013 D4) |
| **3100 / 3110** | Owner Capital / Owner's Drawing | 3 equity | `CASH_MOVEMENT_OWNER_CAPITAL` / `OWNER_DRAWING` |
| **3200** | Retained Earnings | 3 equity | Cible du carry-forward de la clôture annuelle |
| **3300** | Current Year Earnings | 3 equity | `is_postable=false`, jamais mouvementé — agrégat d'affichage |
| **4100** | Sales Revenue | 4 revenue | `SALE_POS_REVENUE` — **pas 4111**, qui existe mais n'est mappé nulle part |
| **4131** | B2B Revenue | 4 revenue | `SALE_B2B_REVENUE` |
| **4900** | Sales Discounts | 4 contra-rev | `SALE_DISCOUNT` (le mappé) |
| **4910 / 5910** | Cash Variance Gain / Loss | 4 / 6 | variance de shift ; 5910 a un code « classe 5 » mais `account_class = 6` |
| **4920 / 6117** | Store Credit Breakage / Grant | 4 / 6 opex | expiration / octroi d'avoirs |
| **5110** | Production COGS - Direct | 5 cogs | `PRODUCTION_COGS` |
| **5210** | Waste Expense | 5 cogs | `WASTE_EXPENSE` |
| **6520** | Bad Debt / AR Write-off | 6 opex | `B2B_AR_ADJUSTMENT` |

**Pièges du plan de comptes :**

> ⚠️ **`113x` = créances, `114x` = stocks.** Plusieurs RPC financières filtrent sur
> `code LIKE '113%'` / `'114%'` : les confondre fait lire un rapport juste comme un
> rapport faux. Il n'existe aucun compte `1130`.

> ⚠️ **Doublons dormants** (zéro mouvement au 2026-08-17, aucun mapping) :
> `2143 PB1 Restaurant Tax Payable` double 2110 ; `2142 VAT Output (PPN Keluaran)` est un
> résidu PKP ; `4190 Sales Discount (Promo)` double 4900. **Ne router aucun mapping vers
> eux** — la PB1 vit en 2110, la remise en 4900, et 2142 contredirait NON-PKP.

> ⚠️ **Ne jamais inférer la classe depuis le code.** 5910 est en classe 6.

### `accounts.cash_flow_section` — invariant du cash flow

Enum `operating | investing | financing | none`. **`none` = « ce compte EST de la
trésorerie »** : son solde alimente `cash_start`/`cash_end`. Les autres valeurs classent
la **contrepartie**. Classification en vigueur : `111x` → `none`, `3xxx` → `financing`,
tout le reste → `operating`.

`get_cash_flow` calcule les trois sections **par contrepartie**, ce qui rend
`operating + investing + financing = cash_end − cash_start` vrai **par identité de la
partie double**. Les postes détaillés de la section opérationnelle sont informatifs.

> 🚨 **Le piège** : la colonne a un `DEFAULT 'operating'`. Un compte de trésorerie créé
> sans `cash_flow_section='none'` compte **deux fois** (flux + solde) et rouvre l'écart
> de réconciliation. Toujours poser la section explicitement dans l'INSERT.

---

## Cockpit RPCs (familles — vérifier la version live avant tout call-site)

Toutes `SECURITY DEFINER`, la plupart perm-gatées et audit-logged.

| Famille | Args | Gate | Notes |
|-----|-----------|------|-------|
| `close_fiscal_period` | period_id, manager_pin, lock | `accounting.period.close` + PIN | `closed` ou `locked` |
| `close_fiscal_year` | fiscal_year, manager_pin | `accounting.year.close` + PIN | voir clôture annuelle |
| `create_manual_je` | description, entry_date, lines JSONB, manager_pin | `accounting.je.create_manual` + PIN | lines ≥ 2, Σdebit=Σcredit, debit XOR credit, comptes actifs+postables, fiscal guard |
| `get_general_ledger` | account_id, dates, limit, cursor | `accounting.gl.read` | cursor-paginé : `opening_balance` + `lines` + `next_cursor` |
| `get_trial_balance` | dates | `accounting.tb.read` | flag `balanced` + tous comptes actifs |
| `get_profit_loss` | dates, section_id | `reports.financial.read` | dédup `sale_void`/refund |
| `get_balance_sheet` | as_of_date | `reports.financial.read` | dédup `sale_void`/refund |
| `get_cash_flow` | dates | `reports.financial.read` | réconcilié par construction |
| `calculate_pb1_payable` | period start/end | `reports.financial.read` (depuis v2, 2026-08-18) | `pb1_payable = pb1_output` |
| `get_pb1_report` | month, year | `reports.financial.read` | rapport mensuel PB1 |
| `update_account_active` | account_id, is_active | `accounting.coa.write` SUPER_ADMIN | pas d'UPDATE direct sur `accounts` |
| `update_accounting_mapping` | mapping_key, account_code, is_active, reason | `accounting.mapping.update` | repointe un mapping sans migration |
| `get_cash_wallet_balances` / `_ledger` / `_analysis` | — / account_code+dates / dates | `accounting.cash.read` (gate SQL vérifiée 2026-08-17 sur les versions live) | coffres 1110/1111/1117 |
| `record_cash_wallet_movement` | type, amount, date, remark, idempotency_key, wallet_code | `accounting.cash.write` | idempotent |
| `retry_sale_journal_entry` | order_id | `pos.sale.create` | ré-émet la JE d'une vente dont le trigger a échoué |

### Clôture annuelle

`close_fiscal_year(fiscal_year, manager_pin)`, gate `accounting.year.close` + PIN :

1. Exige les **12 périodes toutes `closed`/`locked`** (`FOR UPDATE` sérialise).
2. Refuse un second passage (JE `reference_type='year_close'` posted/locked au 31/12 →
   `year_already_closed` ; l'index d'idempotence ne couvre pas ces JE).
3. Agrège classes **4/5/6** (dédup `sale_void`+refund), écrit **une** JE de zérotage au
   31/12, porte le résultat **directement en 3200** (pas de virage par 3300).
4. **Seede les 12 périodes de N+1** — c'est ce qui évite le blocage des ventes au 1ᵉʳ janvier.
5. Audit `accounting.year.closed`.

---

## Permissions (relevé `role_permissions` au 2026-08-17)

| Code | Roles |
|------|-------|
| `accounting.read` / `coa.read` / `gl.read` / `tb.read` / `cash.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.period.close` / `year.close` / `cash.write` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.je.create_manual` / `post` / `reverse` / `mapping.update` / `cash.adjust` | ADMIN, SUPER_ADMIN |
| `accounting.coa.write` | SUPER_ADMIN uniquement |
| `reports.financial.read` | MANAGER, ADMIN, SUPER_ADMIN |

## Surface BO

Tout vit dans `apps/backoffice/src/features/accounting/` (pages, components, hooks,
`__tests__`) — sauf `pages/accounting/MappingsPage.tsx`. Routes sous `PermissionGate` :
`accounting` (hub) · `accounting/chart-of-accounts` · `accounting/journal-entries` ·
`accounting/general-ledger` (`?account_id=&start=&end=`) · `accounting/trial-balance` ·
`accounting/cash` · `accounting/mappings` · `settings/accounting` (périodes + clôture).

---

## Missions advisory (casquette senior)

Chaque mission rend ses findings **en conversation** (jamais en fichier de rapport,
règle documentaire n°1) et toute proposition de changement passe par Mamat AVANT action.

### 1. Concevoir / faire évoluer le plan comptable

Méthode : lire le COA live → comparer au benchmark F&B même taille
(`references/coa-benchmark-fnb.md`) → classer chaque écart en (a) manque réel,
(b) choix assumé du projet, (c) doublon/résidu à neutraliser → proposer à Mamat, avec
pour chaque compte : code respectant les plages existantes, classe, `is_postable`,
`cash_flow_section` **explicite**, mapping éventuel. Jamais de création de compte sans
son usage émetteur identifié — un compte sans flux est un doublon dormant de plus.

### 2. Auditer la couverture des automatisations (zéro double saisie)

Point de départ : la « Carte des automatisations » ci-dessus. Vérifier que **tout
événement d'argent** (vente, remise, loyalty, avoir, B2B, achat, stock, dépense, écart
de caisse, coffres) a exactement un émetteur ; croiser
`SELECT DISTINCT reference_type FROM journal_entries` avec la carte ; toute JE manuelle
récurrente = un flux qui aurait dû être automatisé (finding). Tout mapping non résolu
par au moins une fonction live = candidat à la désactivation (finding, pas d'action).

### 3. Revoir structure, cohérence et lisibilité des pages

Standards attendus d'un module compta d'entreprise de cette taille : chiffres en
`tabular-nums`, IDR formaté locale id-ID, débits/crédits alignés à droite, totaux et
équilibrage visibles (badge balanced), drill-down JE → GL → pièce d'origine
(`resolveJeSourceEntity`), périodes/filtres persistants entre pages, exports CSV
UTF-8 BOM, terminologie unique (une seule façon de nommer « écriture », « période »,
« solde » dans toute la surface). Auditer contre `breakery-design` + `breakery-ui-kit` ;
findings en conversation, correctifs après accord.

### 4. Générer et vérifier les rapports comptables

Générer via les familles cockpit (`get_profit_loss`, `get_balance_sheet`,
`get_cash_flow`, `get_trial_balance`, `get_pb1_report`). **Aucun rapport n'est rendu
sans ses contrôles de cohérence** :
- Balance : `Σdebit = Σcredit` (flag `balanced`).
- Bilan : `assets = liabilities + equity` — et le résultat de la période dans equity
  correspond au net du P&L de la même période.
- Cash flow : `operating + investing + financing = cash_end − cash_start` au centime.
- P&L vs PB1 : `revenue 4100 × rate ≈ pb1_output` de la même période (écart = remises,
  B2B non taxé, dédup void/refund — l'expliquer, pas le masquer).
- Croiser deux sources quand elles existent (ex. valorisation stock vs soldes 114x).

### 5. Optimisation fiscale — légale uniquement

Cadre gravé : NON-PKP + PBJT (ADR-005, irrévocable). Leviers et méthode dans
`references/fiscal-optimization-nonpkp.md`. Principes non négociables :
- **La PB1 est un pass-through** collecté pour le Bapenda — elle ne s'« optimise » pas,
  elle se reverse juste et à l'heure.
- Le levier n°1 est la **capture exhaustive des charges légitimes** (une dépense non
  saisie = du résultat surtaxé), pas la minoration du revenu.
- Tout choix de régime (PPh final UMKM vs régime réel, statut juridique) = décision de
  Mamat avec un conseil fiscal local ; le skill prépare les chiffrages comparatifs.
- Rien qui déguise, anti-date, fractionne artificiellement ou omet un flux. Une
  optimisation qui ne survit pas à un contrôle Bapenda/DJP n'en est pas une.

---

## Audit checklist (avant de toucher le module)

- [ ] **JE balanced** — pour tout `journal_entries` : `Σ journal_entry_lines.debit =
  Σ credit` (colonnes `debit`/`credit`). Divergence = trigger bogué ou INSERT direct.
- [ ] **Mapping existe + postable** — `resolve_mapping_account(key)` lève `P0002` si key
  absente OU compte inactif : vérifier `accounts.is_active` avant de conclure.
- [ ] **Fiscal guard fail-closed** — `check_fiscal_period_open` appelé par chaque
  émetteur, périodes de l'année courante seedées.
- [ ] **1151 reste inactif** — `update_account_active` refuse sa réactivation
  (`account_1151_reserved_non_pkp`) ; contourner = violation ADR-005.
- [ ] **Dédup sale_void/refund** préservée dans les TROIS : `get_profit_loss`,
  `get_balance_sheet`, `close_fiscal_year`.
- [ ] **Cash flow réconcilié** au centime — sinon un compte est mal classé en
  `cash_flow_section`.
- [ ] **PPN foldé, pas de ligne 1151** — `_emit_expense_je` DR la charge TTC ; toute
  fonction routant vers 1151 = régression NON-PKP.
- [ ] **REVOKE pair complet** sur toute nouvelle RPC (PUBLIC + anon + default
  privileges) ; une `SECURITY DEFINER` sans `has_permission` est lisible par tout
  compte authentifié — un `PermissionGate` de route n'est pas une protection.

## Preventive checklists

**Avant de modifier un trigger/émetteur JE** : mappings présents + comptes actifs ·
`current_pb1_rate()`/`_pb1_split` (pas de hardcode) · idempotence préservée ·
`check_fiscal_period_open` appelé · vente et reversal partagent
`_sale_payment_mapping_key` (ADR-013 D3) · pgTAP happy path + période fermée + balanced.

**Avant d'ajouter/modifier un compte COA** : `cash_flow_section` explicite dans l'INSERT ·
`is_postable=false` sur les synthétiques · classe = type économique (1 asset, 2 liab,
3 equity, 4 revenue, 5 cogs, 6 opex) · désactivation via `update_account_active`
uniquement · jamais de DROP d'un compte avec lignes historiques.

**Avant de toucher la clôture** : états `open` → `closed` → `locked` (irréversible,
aucun RPC de déverrouillage) · la clôture annuelle seede N+1 · sa garde anti-rejeu ne
repose PAS sur l'index d'idempotence.

---

## Sources de vérité

```
ADR
  docs/adr/005-juridiction-fiscale-lombok-pbjt.md   # ACTUEL — Lombok/NTB, PBJT (supersedes ADR-003)
  docs/adr/003-pkp-status-non-pkp.md                # historique — NON-PKP rationale
  docs/adr/013-comptabilite-integrite-void-refund-remise.md
  docs/adr/014-pas-de-je-reevaluation-cost-price-correction.md

Références du skill
  references/coa-benchmark-fnb.md            # benchmark COA F&B même taille + méthode d'écart
  references/fiscal-optimization-nonpkp.md   # leviers fiscaux légaux, cadre indonésien

Migrations   supabase/migrations/*cash_flow*, *fiscal*, *journal*, *pb1*, *cash_wallet*, *account*
Tests pgTAP  supabase/tests/ : accounting · close_fiscal_year · fiscal_guard_fail_closed
             pb1_dedup_void_refund · pb1_split_helper · ledger_appendonly_and_balance
             update_account_active · cash_wallets · cash_register · s26_db_hardening
CLAUDE.md    patterns canoniques du projet
```

## Verification before claiming a fix is complete

```bash
pnpm typecheck
pnpm --filter @breakery/app-backoffice test accounting
# pgTAP via MCP execute_sql (BEGIN/ROLLBACK) — lancer les fichiers touchés.
# RPC modifiée → types regen OBLIGATOIRE (MCP generate_typescript_types).
```

> Les suites BO ont des échecs pré-existants env-gated (`VITE_SUPABASE_URL Required`)
> sans `apps/backoffice/.env.local`. Comparer au run sur `master` avant de conclure à
> une régression.

## When to escalate

- **Taux PB1 ou `tax_inclusive`** (`business_config`) → décision business owner.
- **Réactiver 1151, router vers 2142/2143/4190** → violation ADR-005 / doublon — nouvel
  ADR requis.
- **Verrouiller une période, clôturer une année** → irréversible, confirmer avec l'owner.
- **Choix de régime fiscal (UMKM final vs réel), statut juridique, seuils PKP** →
  décision Mamat + conseil fiscal local ; le skill chiffre, il ne tranche pas.
- **Nouveau moyen de paiement** sans mise à jour de `_sale_payment_mapping_key` → il
  tombe en caisse en silence ; l'enum et le helper bougent ensemble.
- **Bump d'une RPC cockpit** → `_vN+1` + DROP `_vN` même migration + REVOKE pair +
  types regen + pgTAP.
