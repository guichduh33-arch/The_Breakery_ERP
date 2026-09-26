# accounting — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Carte des automatisations — zéro double saisie
- COA — extrait de lecture
- Cockpit RPCs (familles — vérifier la version live avant tout call-site)
- Permissions (relevé `role_permissions` au 2026-08-17)
- Surface BO

Périmètre : comptabilité du back-office et SQL de journal, fiscalité, ledger et coffres. Charger ce skill avant de modifier une RPC émettant des écritures ou un rapport comptable ; conserver la distinction entre conseil fiscal légal et mécanique des exports.

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
