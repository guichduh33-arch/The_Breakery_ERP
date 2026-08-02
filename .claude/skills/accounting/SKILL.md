---
name: accounting
description: >-
  Accounting cockpit expert — COA, journal entries, PB1/PBJT (NON-PKP, ADR-005), fiscal periods
  & year close, general ledger, trial balance, P&L, balance sheet, cash flow, cash wallets,
  mapping accounts. Audits JE balance/mapping/fiscal-guard AND guides accounting changes.
  Use this skill whenever the task mentions journal entry / écriture comptable / JE, COA /
  plan comptable, PB1, PPN, TVA, NON-PKP, fiscal period / période fiscale, clôture annuelle /
  year close, general ledger / grand livre, trial balance / balance, cash flow / flux de
  trésorerie, cash wallet / coffre / petty cash, COGS, retained earnings, mapping account,
  compta / comptabilité — or touches apps/backoffice accounting features/pages, or supabase
  migrations/tests around journal/fiscal/ledger/pb1/cash_flow.
  Invoke it BEFORE editing any JE-emitting RPC or accounting report, even for a one-line fix.
pathPatterns:
  - 'apps/backoffice/src/features/accounting/**'
  - 'apps/backoffice/src/pages/accounting/**'
  - 'supabase/migrations/*journal*.sql'
  - 'supabase/migrations/*fiscal*.sql'
  - 'supabase/migrations/*ledger*.sql'
  - 'supabase/migrations/*pb1*.sql'
  - 'supabase/migrations/*cash_flow*.sql'
  - 'supabase/migrations/*cash_wallet*.sql'
  - 'supabase/tests/*accounting*.test.sql'
  - 'supabase/tests/*fiscal*.test.sql'
  - 'supabase/tests/*pb1*.test.sql'
  - 'supabase/tests/*cash*.test.sql'
  - 'supabase/tests/*s26*.test.sql'
promptSignals:
  phrases:
    - 'journal entry'
    - 'COA'
    - 'chart of accounts'
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
---

# Accounting — The Breakery ERP

Expert on the accounting cockpit: chart of accounts, journal entries, PB1 fiscal reporting, general ledger, trial balance, cash flow, fiscal periods and year close.

**`CLAUDE.md` est la source de vérité** for project-wide patterns (RPC versioning, REVOKE pairs, PIN header, audit_logs). This skill adds the accounting-specific mental model, verified account codes, RPC families, and audit checklists that CLAUDE.md doesn't carry.

> **Conventions de lecture.** Les RPC sont citées par **famille** (`get_general_ledger`,
> `close_fiscal_period`) : les versions bumpent, la version live se lit dans
> `supabase/migrations/` ou `pg_proc` **avant** tout call-site. Les chiffres datés
> (`au 2026-08-02`) sont des relevés, pas des invariants : re-vérifier contre la base.

---

## Mental model NON-PKP (ADR-003 ratifié 2026-05-20, juridiction corrigée par ADR-005 le 2026-07-16)

**The Breakery est NON-PKP.** Décision irrévocable — re-read `docs/adr/005-juridiction-fiscale-lombok-pbjt.md` (supersedes ADR-003) before any fiscal change.

- **Output tax** : **taxe F&B locale 10%** — **PBJT Makanan dan Minuman** (UU HKPD 1/2022), niveau **kabupaten/kota**, perçue par le **Bapenda** de la commune (The Breakery est à **Lombok, NTB** — pas Bali, cf. ADR-005). « PB1 » reste le label usuel dans le code. Pas de PPN sortant, pas d'e-Faktur, pas d'export DJP.
- **Input tax** : PPN 11% fournisseurs PKP est **non-récupérable** → **folded** dans le coût d'acquisition (achats de stock → `INVENTORY_GENERAL` 1141) ou dans la charge (dépenses → compte de catégorie). Le compte `1151 VAT Input` est **désactivé** et sa réactivation est refusée par la RPC. Ne jamais chercher à le rouvrir sans un nouvel ADR supersedant ADR-005.
- **PB1 est INCLUSIVE** : `business_config.tax_inclusive = true` (relevé 2026-08-02). Le prix affiché est TTC ; la taxe se **dé-cumule** (`total × rate / (1 + rate)`) via le helper `_pb1_split`, seul endroit qui connaît la formule. Ne jamais recalculer une PB1 à la main dans une RPC ou un rapport — appeler le helper, ou lire `orders.tax_amount` déjà splité.
- **`current_pb1_rate()`** : helper stable lit `business_config.tax_rate`. Toujours l'utiliser — pas de hardcode `10/110`.
- **`calculate_pb1_payable`** : formule simplifiée `pb1_payable = pb1_output` (pas de soustraction `vat_input`). Remplace l'ancien `calculate_vat_payable` (droppé en migration le 2026-06-03). `get_pb1_report` est la variante mensuelle (mois/année) gatée `reports.financial.read`.

---

## JE backbone (triggers automatiques)

Toutes les JE passent par des **triggers** ou des RPC dédiées — ne jamais INSERT dans `journal_entries` directement.

| Trigger | Table / événement | Fonction |
|---|---|---|
| `trg_create_sale_journal_entry_ins` | `orders` AFTER INSERT WHEN `status='paid'` | `create_sale_journal_entry()` |
| `trg_create_sale_journal_entry_upd` | `orders` AFTER UPDATE OF `status` → `paid` ou `voided` | `create_sale_journal_entry()` |
| `trg_create_je_for_refund` | `refunds` AFTER INSERT — **CONSTRAINT trigger, DEFERRABLE INITIALLY DEFERRED** | `fn_create_je_for_refund()` |
| `trg_create_purchase_je` | `goods_receipt_notes` AFTER INSERT | `create_purchase_journal_entry()` |
| `tr_20_je_emit` | `stock_movements` AFTER INSERT — types `waste`, `adjustment`, `adjustment_in/out`, `opname_in/out`, `production_in/out` | `tr_stock_movement_je()` |

Les autres types de mouvement sont **silencieux par décision** : `transfer_*`, et `cost_price_correction` / recalcul WAC (ADR-014 — ne jamais les ajouter au CASE ; l'écart GL vs valorisation se résorbe à l'opname).

Hors triggers : `record_cash_wallet_movement` (coffres BO) et `record_cash_movement` (événements de caisse du shift POS) émettent leurs JE eux-mêmes.

**JE de vente** (`create_sale_journal_entry`) :
- CR `SALE_POS_REVENUE` → **4100** pour `total − tax_amount`, CR `SALE_PB1_TAX` → **2110** pour `tax_amount` (lu sur la commande, PB1 inclusive déjà splitée).
- DR une ligne **par ligne de `order_payments`** (split tender), compte résolu par le helper `_sale_payment_mapping_key`.
- `orders.is_historical_import = true` → **aucune JE** (reprise d'historique).
- Aucune ligne `order_payments` → **fallback cash** sur la totalité + `audit_logs` action `je.payment_fallback_cash`. Un pic sur cette action = money-path qui n'écrit plus ses paiements.
- Le void émet **exactement une** contre-passation `sale_void` (ADR-013 D2) ; la ligne `refunds(is_full_void=true)` est un miroir audit et n'émet rien.

**Mapping méthode → compte** — helper `_sale_payment_mapping_key`, **partagé par la vente et les reversals** (ADR-013 D3). L'enum Postgres est la seule source ; `debit_card`/`credit_card` **n'existent pas** :

| Méthode | Mapping key | Compte |
|---|---|---|
| `cash` | `SALE_PAYMENT_CASH` | 1110 Cash on Hand |
| `qris`, `gopay`, `ovo`, `dana` | `SALE_PAYMENT_QRIS` | 1115 QRIS Clearing |
| `card`, `edc` | `SALE_PAYMENT_DEBIT` | 1116 Card Clearing |
| `transfer` | `SALE_PAYMENT_TRANSFER` | 1112 Bank Operating |
| `store_credit` | `SALE_PAYMENT_STORE_CREDIT` | 2220 Customer Store Credit Payable (ADR-013 D4) |
| (inconnue) | `SALE_PAYMENT_CASH` | fallback silencieux — un nouveau moyen de paiement non ajouté au helper part en caisse |

**Idempotence** : index `journal_entries_je_idempotency_uniq` sur `(reference_type, reference_id, COALESCE(metadata->>'movement_type',''))` **WHERE `reference_id IS NOT NULL`**. Les JE sans référence (clôture annuelle) ne sont donc PAS couvertes : elles portent leur propre garde anti-rejeu.

**Fiscal guard, fail-closed** : chaque émetteur appelle `check_fiscal_period_open(date)`, qui lève `P0004` dans **deux** cas — `period_locked` (période `closed`/`locked`) **et `period_undefined` (aucune période ne couvre la date)**. Conséquence : si les périodes de l'année suivante ne sont pas seedées, la vente s'arrête au 1ᵉʳ janvier. C'est voulu ; la clôture annuelle seede N+1 pour cette raison.

**Cash movements du shift POS** (`record_cash_movement`, gate `shift.cash_movement`, idempotent par `p_idempotency_key`, session `open` obligatoire) — seuls deux `reason_code` sur quatre émettent une JE, **datée `CURRENT_DATE`** et non de la date de session :
- `apport_owner` → DR 1110 / CR **3100** Owner Capital
- `bank_transfer` → DR/CR 1110 ↔ **1112** Bank Operating (sens selon `direction`)
- `replenishment`/`misc`/NULL → mouvement enregistré, **pas de JE**

---

## COA — extrait de lecture

⚠️ **Ce tableau est un EXTRAIT** des comptes qu'on rencontre le plus. Le plan comptable
complet comptait **52 comptes (dont 1 inactif) au 2026-08-02**. Ne jamais conclure
« ce compte n'existe pas » depuis cet extrait — lire le COA live :

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
| **1131** | Accounts Receivable | 1 asset | Créances hors B2B ; **aucun mapping, zéro ligne** au 2026-08-02 |
| **1132** | AR - B2B | 1 asset | `B2B_AR` — c'est ICI que vit l'AR réel |
| **1141** | Inventory - General | 1 asset | `INVENTORY_GENERAL` ; reçoit le PPN supplier (folded, NON-PKP) |
| **1142** | Inventory - Raw Material | 1 asset | `INVENTORY_RAW_MATERIAL` |
| **1143** | Inventory - Finished Goods | 1 asset | `INVENTORY_FINISHED_GOODS` |
| **1151** | VAT Input — RESERVED | 1 asset | **DÉSACTIVÉ NON-PKP** (ADR-003/005), réactivation hard-bloquée ; 1 ligne historique antérieure. Les mappings `EXPENSE_VAT_INPUT`/`PURCHASE_VAT_INPUT` y pointent encore mais **aucune fonction ne les résout** |
| **2110** | PB1 (10%) Payable | 2 liability | `SALE_PB1_TAX` — sortie mensuelle Bapenda (Lombok, ADR-005) |
| **2141** | Accounts Payable | 2 liability | `PURCHASE_PAYABLE`, `EXPENSE_AP` |
| **2220** | Customer Store Credit Payable | 2 liability | Avoirs client (ADR-013 D4) |
| **3100** | Owner Capital | 3 equity | `CASH_MOVEMENT_OWNER_CAPITAL` |
| **3200** | Retained Earnings | 3 equity | Cible du carry-forward de la clôture annuelle |
| **3300** | Current Year Earnings | 3 equity | **`is_postable=false`, jamais mouvementé** — agrégat d'affichage |
| **4100** | Sales Revenue | 4 revenue | `SALE_POS_REVENUE` — **pas 4111**, qui existe mais n'est mappé nulle part |
| **5910** | Cash Variance Loss | 6 opex | Code « classe 5 » mais `account_class = 6` — renommage en 6910 différé |

**Pièges du plan de comptes :**

> ⚠️ **`113x` = créances, `114x` = stocks.** Plusieurs RPC financières filtrent sur
> `code LIKE '113%'` / `'114%'` : les confondre fait lire un rapport juste comme un
> rapport faux. Il n'existe **aucun** compte `1130`.

> ⚠️ **Doublons dormants.** `2143 PB1 Restaurant Tax Payable` fait doublon avec `2110`,
> et `2142 VAT Output (PPN Keluaran)` est un résidu PKP. Les deux sont `is_active=true`
> mais à **zéro mouvement** au 2026-08-02, et aucun mapping n'y pointe. **Ne router aucun
> mapping vers eux** : la PB1 collectée vit en 2110, et 2142 contredirait le statut NON-PKP.

> ⚠️ **Ne jamais inférer la classe depuis le code.** 5910 est en classe 6.

### `accounts.cash_flow_section` — invariant du cash flow

Enum `operating | investing | financing | none`. **`none` signifie « ce compte EST de la
trésorerie »** : son solde alimente `cash_start`/`cash_end`. Les autres valeurs classent la
**contrepartie**. Classification en vigueur : `111x` → `none`, `3xxx` → `financing`, tout le
reste → `operating` (une dette d'exploitation comme 2110 n'est PAS du financement).

`get_cash_flow` calcule les trois sections **par contrepartie**, ce qui rend
`operating + investing + financing = cash_end − cash_start` vrai **par identité de la partie
double**, sans énumérer aucun code de compte. Les postes détaillés de la section
opérationnelle (`net_profit`, `delta_ar`, `delta_ap`, `delta_inventory`,
`non_cash_adjustments`) sont **informatifs** : ils expliquent le total, ils ne le fondent pas.

> 🚨 **Le piège** : la colonne a un `DEFAULT 'operating'`. Un compte créé sans
> `cash_flow_section` explicite est donc classé opérationnel **en silence**. Créer un compte
> de trésorerie (`111x`) sans le mettre à `none` le fait compter **deux fois** — comme flux
> et comme solde — et rouvre l'écart de réconciliation que la v3 a fermé. Un compte de
> capitaux propres oublié en `operating` fausse la ventilation des trois sections.

---

## Cockpit RPCs (familles — vérifier la version live avant tout call-site)

Toutes sont `SECURITY DEFINER`, la plupart perm-gatées et audit-logged.

| Famille | Signature (args) | Gate | Notes |
|-----|-----------|------|-------|
| `close_fiscal_period` | `(p_period_id UUID, p_manager_pin TEXT, p_lock BOOLEAN DEFAULT FALSE)` | `accounting.period.close` + PIN | Status `closed` ou `locked` |
| `close_fiscal_year` | `(p_fiscal_year INT, p_manager_pin TEXT)` | `accounting.year.close` + PIN | Voir section clôture annuelle |
| `create_manual_je` | `(p_description TEXT, p_entry_date DATE, p_lines JSONB, p_manager_pin TEXT)` | `accounting.je.create_manual` + PIN | lines ≥ 2, Σdebit=Σcredit, debit XOR credit, comptes `is_active`+`is_postable`, fiscal guard |
| `get_general_ledger` | `(p_account_id UUID, p_date_start DATE, p_date_end DATE, p_limit INT, p_cursor JSONB)` | `accounting.gl.read` | Cursor-paginé : `opening_balance` + `lines` + `next_cursor` |
| `get_trial_balance` | `(p_date_start DATE, p_date_end DATE)` | `accounting.tb.read` | Flag `balanced` + tous comptes actifs |
| `get_profit_loss` | `(p_date_start DATE, p_date_end DATE, p_section_id UUID)` | `reports.financial.read` | Dédup `sale_void`/refund |
| `get_balance_sheet` | `(p_as_of_date DATE)` | `reports.financial.read` | Dédup `sale_void`/refund |
| `get_cash_flow` | `(p_date_start DATE, p_date_end DATE)` | `reports.financial.read` | Réconcilié par construction (voir `cash_flow_section`) |
| `calculate_pb1_payable` | `(p_period_start DATE, p_period_end DATE)` | — (aucune) | `pb1_payable = pb1_output` |
| `get_pb1_report` | `(p_period_month INT, p_period_year INT)` | `reports.financial.read` | Rapport mensuel PB1 |
| `update_account_active` | `(p_account_id UUID, p_is_active BOOLEAN)` | `accounting.coa.write` SUPER_ADMIN | audit_logs ; pas d'UPDATE direct sur `accounts` |
| `update_accounting_mapping` | `(p_mapping_key TEXT, p_account_code TEXT, p_is_active BOOLEAN, p_reason TEXT)` | `accounting.mapping.update` | Repointe un mapping sans migration |
| `get_cash_wallet_balances` / `get_cash_wallet_ledger` / `get_cash_wallet_analysis` | `()` / `(p_account_code, p_date_start, p_date_end)` / `(p_date_start, p_date_end)` | ⚠️ **aucune gate SQL** — seul le `PermissionGate` de la route BO protège | Coffres 1110/1111/1117 |
| `record_cash_wallet_movement` | `(p_movement_type, p_amount, p_movement_date, p_remark, p_idempotency_key, p_wallet_code)` | `accounting.cash.write` | Idempotent par `p_idempotency_key` |
| `retry_sale_journal_entry` | `(p_order_id UUID)` | `pos.sale.create` | Ré-émet la JE d'une vente dont le trigger a échoué |

**Idempotency** : `create_manual_je` génère un `entry_no` interne — pas d'arg idempotency client. Si replay nécessaire, vérifier l'existence par description+date+montant.

### Clôture annuelle — implémentée

`close_fiscal_year(p_fiscal_year, p_manager_pin)`, gate `accounting.year.close` + PIN :

1. Exige les **12 périodes de l'année toutes `closed`/`locked`** (`FOR UPDATE` sérialise) ; refuse si l'une manque ou reste ouverte.
2. Refuse un second passage : une JE `reference_type='year_close'` posted/locked au 31/12 → `year_already_closed` (l'index d'idempotence ne couvre pas ces JE, `reference_id` étant NULL).
3. Agrège les comptes de classes **4/5/6** sur l'exercice (dédup canonique `sale_void`+refund), écrit **une** JE de zérotage datée du 31/12 et porte le résultat net **directement en 3200 Retained Earnings**.
4. **Seede les 12 périodes de N+1** — c'est ce qui empêche le fail-closed `period_undefined` de bloquer les ventes au 1ᵉʳ janvier.
5. Audit `accounting.year.closed` avec `net_result`, `line_count`, `periods_seeded_next_year`.

> `3300 Current Year Earnings` est `is_postable=false` et n'a **jamais** de ligne : il n'y a pas de virage 3300→3200, le carry-forward va des comptes de résultat vers 3200.

---

## Permissions (relevé `role_permissions` au 2026-08-02)

| Code | Roles |
|------|-------|
| `accounting.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.coa.read` / `gl.read` / `tb.read` / `cash.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.period.close` / `year.close` / `cash.write` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.je.create_manual` / `post` / `reverse` / `mapping.update` / `cash.adjust` | ADMIN, SUPER_ADMIN |
| `accounting.coa.write` | SUPER_ADMIN **uniquement** |

---

## Surface BO

Tout vit dans `apps/backoffice/src/features/accounting/` (pages, hooks, components, utils, `__tests__`) — sauf `pages/accounting/MappingsPage.tsx`.

Routes (`apps/backoffice/src/routes/index.tsx`), chacune sous `PermissionGate` :
`accounting` (hub, `accounting.read`) · `accounting/chart-of-accounts` (`coa.read`) ·
`accounting/journal-entries` + `accounting/general-ledger` (`gl.read`, la page GL accepte `?account_id=&start=&end=`) ·
`accounting/trial-balance` (`tb.read`) · `accounting/cash` (`cash.read`) ·
`accounting/mappings` (`accounting.read`) · `settings/accounting` (`period.close`, périodes fiscales + clôture annuelle).

Modales/panneaux notables : `CreateManualJEModal` (stepper, PIN header), `FiscalPeriodModal`, `AnnualCloseModal`, `RecordCashMovementModal`, `JournalEntryDetailDrawer`, `CashReconciliationPanel`, `CashAnalysisPanel`, `WalletCard`/`WalletLedgerTable`.
Helpers domaine : `exportTrialBalanceCsv`, `exportCashWalletCsv` (UTF-8 BOM + locale id-ID IDR), `resolveJeSourceEntity`.

---

## Audit checklist (avant de toucher le module accounting)

- [ ] **JE balanced** — pour tout `journal_entries` row : `Σ journal_entry_lines.debit = Σ credit` (colonnes `debit`/`credit`, pas `*_amount`). Toute divergence = trigger bogué ou INSERT direct.
- [ ] **Mapping account existe + postable** — `resolve_mapping_account(key)` lève `P0002 mapping_key_unknown` si la key est absente **ou** si le compte est inactif/supprimé : le message ne distingue pas les deux cas, vérifier `accounts.is_active` avant de conclure.
- [ ] **Fiscal guard actif et fail-closed** — `check_fiscal_period_open` appelé par chaque émetteur, et les périodes de l'année en cours **existent** (sinon `period_undefined` bloque les ventes).
- [ ] **Compte 1151 reste inactif** — `SELECT is_active FROM accounts WHERE code='1151'` → `false`. `update_account_active` refuse explicitement sa réactivation (`account_1151_reserved_non_pkp`, P0001) ; contourner ce garde = violation ADR-005.
- [ ] **Dedupe sale_void/sale_refund** — `get_profit_loss`, `get_balance_sheet` et `close_fiscal_year` excluent `sale_void` quand un refund existe pour le même `order_id`. Vérifier que les bumps futurs préservent cette logique **dans les trois**.
- [ ] **Cash flow réconcilié** — `operating + investing + financing = cash_end − cash_start` doit être vrai au centime sur n'importe quelle période. Un écart = un compte mal classé en `cash_flow_section`.
- [ ] **PPN fournisseur foldé, pas de ligne 1151** — depuis le 2026-07-10, `_emit_expense_je` DR la charge pour le montant **total TTC** (le PPN non récupérable y est inclus) et n'émet plus de ligne vers `EXPENSE_VAT_INPUT`. Son seul garde est un sanity-check `0 ≤ vat_amount ≤ amount` (ERRCODE 22023). Aucune fonction live ne route vers 1151 : si un jour l'une le fait, c'est une régression NON-PKP, pas un « trap » attendu.
- [ ] **REVOKE pair complet** sur toute nouvelle RPC accounting — 3 lignes : `REVOKE FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. Et une RPC `SECURITY DEFINER` sans `has_permission` est lisible par **tout compte authentifié** — un `PermissionGate` de route n'est pas une protection.

---

## Preventive checklists

### Avant de modifier un trigger JE
- [ ] Mapping keys concernés présents dans `accounting_mappings` + comptes `is_active=true`.
- [ ] `current_pb1_rate()` / `_pb1_split` utilisés (pas de hardcode, pas de recalcul maison).
- [ ] Idempotence : index `journal_entries_je_idempotency_uniq` préservé, ou garde explicite si `reference_id` est NULL.
- [ ] `check_fiscal_period_open` appelé.
- [ ] Vente et reversal continuent de partager `_sale_payment_mapping_key` (ADR-013 D3).
- [ ] pgTAP couvre : happy path + période fermée → exception + JE balanced.

### Avant d'ajouter/modifier un compte COA
- [ ] **`cash_flow_section` explicite dans l'INSERT** — le DEFAULT `operating` est silencieux et casse la réconciliation du cash flow.
- [ ] `is_postable=false` sur les comptes synthétiques (agrégats, ex. 3300).
- [ ] Classe = type économique correct (asset=1, liability=2, equity=3, revenue=4, cogs=5, opex=6).
- [ ] Si désactivation : `update_account_active` via BO (gate `accounting.coa.write` SUPER_ADMIN) — pas d'UPDATE direct.
- [ ] Ne jamais DROP un compte qui a des `journal_entry_lines` historiques.

### Avant de toucher la clôture (période ou année)
- [ ] États d'une période : `open` → `closed` → `locked` (irréversible, aucun RPC de déverrouillage n'existe).
- [ ] La clôture annuelle **seede N+1** : toute réécriture qui perd ce seed bloque les ventes au 1ᵉʳ janvier.
- [ ] La garde anti-rejeu de l'année ne repose PAS sur l'index d'idempotence — la préserver explicitement.

---

## Sources de vérité

```
ADR
  docs/adr/005-juridiction-fiscale-lombok-pbjt.md   # ACTUEL — Lombok/NTB, PBJT municipale (supersedes ADR-003)
  docs/adr/003-pkp-status-non-pkp.md                # historique — NON-PKP rationale + conséquences
  docs/adr/013-comptabilite-integrite-void-refund-remise.md  # void/refund/remise, avoir client 2220
  docs/adr/014-pas-de-je-reevaluation-cost-price-correction.md  # pas de JE sur changement de coût / WAC

Migrations                       # chercher par mot-clé, la numérotation bouge
  supabase/migrations/*cash_flow*, *fiscal*, *journal*, *pb1*, *cash_wallet*

Tests pgTAP                      # supabase/tests/
  accounting.test.sql · close_fiscal_year_v1.test.sql · fiscal_guard_fail_closed.test.sql
  pb1_dedup_void_refund.test.sql · pb1_split_helper.test.sql · recalc_order_totals_pb1_inclusive.test.sql
  ledger_appendonly_and_balance.test.sql · update_account_active_v1.test.sql
  cash_wallets.test.sql · cash_register.test.sql · s26_db_hardening.test.sql

CLAUDE.md                        # patterns canoniques du projet
```

---

## Verification before claiming a fix is complete

```bash
# Type-check (cheap, run first)
pnpm typecheck

# Smoke BO accounting (le filtre vitest matche le CHEMIN : features/accounting/**)
pnpm --filter @breakery/app-backoffice test accounting

# pgTAP via MCP execute_sql (enveloppe BEGIN/ROLLBACK) — lancer les fichiers
# touchés par le changement, listés ci-dessus.

# Si RPC modifiée → types regen OBLIGATOIRE :
# mcp__claude_ai_Supabase__generate_typescript_types → packages/supabase/src/types.generated.ts
```

> Les suites BO comportent des échecs pré-existants **env-gated** (`VITE_SUPABASE_URL Required`)
> quand `apps/backoffice/.env.local` est absent. Comparer au run sur `master` avant de conclure
> à une régression — ne pas se fier à un décompte mémorisé.

---

## When to escalate

- **Toucher le taux PB1 ou `tax_inclusive`** (`business_config`) → impact sur toutes les JE futures et sur les rapports PB1 — flag, décision business owner.
- **Réactiver le compte 1151** → violation ADR-005, nécessite un nouvel ADR supersedant + plan de migration PKP complet.
- **Router un mapping vers 2142 ou 2143** → contredit NON-PKP / duplique 2110 ; décision explicite requise.
- **Verrouiller (`locked`) une période fiscale**, ou **clôturer une année** → irréversible, aucun RPC de retour. Confirmer avec l'owner.
- **Ajouter un moyen de paiement** sans l'ajouter à `_sale_payment_mapping_key` → il tombe en caisse en silence. Le helper et l'enum Postgres bougent ensemble.
- **Bump majeur d'une RPC cockpit** (`_vN+1`) → drop `_vN` dans la même migration (RPC versioning monotone CLAUDE.md), + REVOKE pair + types regen + pgTAP.
