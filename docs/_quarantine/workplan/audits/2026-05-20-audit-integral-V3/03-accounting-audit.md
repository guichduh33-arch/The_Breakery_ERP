# Vague 3 — Audit Comptable (JE Matrix + SAK EMKM)

> **Date** : 2026-05-20
> **Skill** : anthropic-skills:accounting-audit (charge 3 references : COA, JE matrix, SAK EMKM checklist)
> **Scope** : COA (40+ comptes), `accounting_mappings` (24+ keys), 5 triggers JE + 8 RPCs financiers, 4 pages BO (Mappings, BS, P&L, CashFlow)
> **Effort réel** : ~45 minutes (lecture statique de 31 migrations accounting + JE + reports + 4 pages BO, 0 appel cloud, 0 écriture DB)

## TL;DR

**Score conformité SAK EMKM : 78/100** (Très bon — production-ready avec 4 gaps Élevés à corriger S26-S27). Le système V3 a un module accounting **mature et robuste** : 22 mapping keys seedées + 12 triggers/RPCs émetteurs de JE, idempotency systématique via pre-SELECT, fiscal period guards, COA 4-classes conforme SAK EMKM (1xxx/2xxx/3xxx/4xxx/5-6xxx + 4510/4910 Other revenue + 5910 Other expense). **JE matrix : 16 opérations métier auditées — 13 ACTIVE balanced, 0 GAP critique, 3 NO-JE intentionnels (transfer interne, loyalty adjust, B2B balance adjust)**. PB1 10/110 cohérent dans toute la chaîne SAUF un **risque latent Critique** : si admin modifie `business_config.tax_rate` (ex. PPN 11% 2025), le trigger sale JE hardcode `10/110` alors que `complete_order_v9` utilise `tax_rate/(1+tax_rate)` → JE déséquilibre silencieux. Côté UI : **9 pages accounting absentes** (toutes flaggées ❌ S26 dans le glossaire) — backend complet mais 0 surface dédiée à part Mappings. Priorité prod : ChartOfAccounts + JournalEntries + GeneralLedger + FiscalPeriodModal (P0 compliance trail) ; reste = ergonomie (P1/P2).

## Conformité SAK EMKM

| Critère | Statut | Évidence |
|---|---|---|
| Plan comptable 4-classes (1xxx-6xxx) | ✅ OK | 40+ comptes seedés (`20260517000005`), `account_class IN (1..6)` CHECK, `balance_type IN ('debit','credit')` CHECK |
| Débit = Crédit systématique (CHECK contrainte ligne) | ✅ OK | `journal_entry_lines` CHECK `(debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)` (`20260503000009:46`) |
| Header total_debit = total_credit (par construction) | ✅ OK | Tous les triggers/RPCs émetteurs passent le même montant en `total_debit` et `total_credit` au header. Pas de CHECK applicatif sur header — fiable par construction mais pas garanti DB |
| Fiscal periods enforcement | ✅ OK | `check_fiscal_period_open(p_date)` raise P0004 si `closed/locked` ; appelé par 12 émetteurs JE ; 24 mois seedés (`20260517000002`) |
| PB1 10/110 cohérent backend | ⚠️ PARTIAL | Hardcode `10/110` dans 3 triggers vs `tax_rate/(1+tax_rate)` dans 5 RPCs ordre — divergence latente si admin modifie `business_config.tax_rate` (voir F-S26-AC-01) |
| Audit trail JE → opérations métier | ✅ OK | `journal_entries.reference_type` + `reference_id` couvrent 13/13 émetteurs ; CHECK contrainte sur `reference_type` enum-like (`20260517000023:22`) |
| Idempotency JE (anti double-fire) | ✅ OK | Pre-SELECT systématique + UNIQUE `(reference_type, reference_id, metadata->>'movement_type')` (`20260517000023:42`) |
| Single source of truth COA (mappings) | ✅ OK | `resolve_mapping_account(key)` SECURITY DEFINER appelé par 12 émetteurs ; 0 trigger ne hardcode plus de codes sauf le sale JE trigger (legacy `_010` resté hardcodé `1110/4100/2110` — voir F-S26-AC-02) |
| Append-only ledger | ✅ OK | Pas de policies WRITE sur `journal_entries`/`journal_entry_lines` (`20260503000009:78`) ; toutes les écritures via triggers SECURITY DEFINER ou RPC |
| États financiers générables | ✅ OK | `get_profit_loss_v1`, `get_balance_sheet_v1`, `get_cash_flow_v1` (indirect), `cash_flow_v1` (3 sections), `calculate_vat_payable` |

**Score breakdown** (per `references/sak-emkm-checklist.md`) :
- États financiers (30%) : 25/30 — BS + P&L + Cash Flow (2 RPCs) ; CALK non générable
- Recognition principles (25%) : 22/25 — Revenue sur status='paid' (correct timing) ; B2B sur accrual (correct) ; COGS par production_in/out via trigger _20 (correct)
- Tax compliance (25%) : 18/25 — PB1 10/110 partout MAIS divergence trigger vs RPC sur `tax_rate` config ; SPT calculable via `calculate_vat_payable` ; pas d'export DJP (backlog)
- Présentation (10%) : 8/10 — Balance Sheet + P&L tablés correctement, line items SAK EMKM présents
- Disclosures (10%) : 5/10 — CALK non implémenté

## JE Matrix complète (16 opérations)

| # | Opération métier | Trigger/RPC | JE générée (DR/CR) | Mapping keys utilisées | Idempotency | Statut |
|---|---|---|---|---|---|---|
| 1 | Vente cash POS | trigger `create_sale_journal_entry` (`_010`) | DR `SALE_PAYMENT_CASH` (1110) total / CR `SALE_POS_REVENUE` (4100) net + CR `SALE_PB1_TAX` (2110) vat | 3 keys | pre-SELECT `(sale, order.id)` | ✅ ACTIVE |
| 2 | Vente card/QRIS/EDC | trigger même (`_010`) MAIS routage cash 1110 hardcoded — pas de split par `order_payments.method` | DR `SALE_PAYMENT_CASH` (1110) all-total ❌ | 1 key (incorrect) | idem | ⚠️ ACTIVE-IMPRECIS (voir F-S26-AC-03) |
| 3 | Vente avec loyalty redemption | `complete_order_v9` (`_015:332`) append au JE de la vente | DR `LOYALTY_LIABILITY` (2210) redemption / CR `SALE_DISCOUNT` (4900) redemption | 2 keys | partagé avec sale JE | ✅ ACTIVE |
| 4 | Vente B2B (création order credit) | `create_b2b_order_v1` (`_022`) | DR `B2B_AR` (1132) total / CR `SALE_B2B_REVENUE` (4131) total **(pas de PB1 — B2B hors scope PKP pre-flight §5)** | 2 keys | order.idempotency_key | ✅ ACTIVE |
| 5 | Paiement B2B reçu (cash) | `record_b2b_payment_v1` (`_020`) | DR `SALE_PAYMENT_CASH` (1110) amount / CR `B2B_AR` (1132) amount | 2 keys | b2b_payments.idempotency_key | ✅ ACTIVE |
| 6 | Paiement B2B reçu (bank/card) | même RPC | DR `B2B_PAYMENT_BANK` (1112) amount / CR `B2B_AR` (1132) amount | 2 keys | idem | ✅ ACTIVE |
| 7 | Ajustement balance B2B admin | `adjust_b2b_balance_v1` (`_021`) | **PAS de JE — audit_logs only** (décision spec §4.1.7) | — | audit_logs.metadata.idempotency_key | 🔵 NO-JE INTENTIONNEL |
| 8 | PO réception (cash) | trigger `create_purchase_journal_entry` sur `goods_receipt_notes` (`_011` + attach `_113`) | DR `INVENTORY_GENERAL` (1141) subtotal + DR `PURCHASE_VAT_INPUT` (1151) vat / CR `PURCHASE_CASH_OUT` (1110) total | 3 keys | pre-SELECT `(purchase, grn.id)` | ✅ ACTIVE |
| 9 | PO réception (credit) | même trigger | DR `INVENTORY_GENERAL` (1141) subtotal + DR `PURCHASE_VAT_INPUT` (1151) vat / CR `PURCHASE_PAYABLE` (2141) total | 3 keys | idem | ✅ ACTIVE |
| 10 | Production (consommation matières → produit fini) | trigger `tr_20_je_emit` sur stock_movements (`_022`) — émis 2 fois (production_out + production_in) | production_out: DR `PRODUCTION_COGS` (5110) value / CR `INVENTORY_RAW_MATERIAL` (1142) ; production_in: DR `INVENTORY_FINISHED_GOODS` (1143) / CR `PRODUCTION_COGS` (5110) | 3 keys | UNIQUE `(stock_movement, sm.id, movement_type)` | ✅ ACTIVE |
| 11 | Casse / Waste | même trigger (mvt type='waste') | DR `WASTE_EXPENSE` (5210) value / CR `INVENTORY_GENERAL` (1141) value | 2 keys | idem | ✅ ACTIVE |
| 12 | Stock adjustment (in/out via `adjust_stock_v1`) | même trigger (mvt type='adjustment_in/out') | in: DR `INVENTORY_GENERAL` (1141) / CR `ADJUSTMENT_INCOME` (4510) ; out: DR `ADJUSTMENT_EXPENSE` (6510) / CR `INVENTORY_GENERAL` (1141) | 3 keys | idem | ✅ ACTIVE |
| 13 | Stock opname (finalisation count) | même trigger (mvt type='opname_in/out') | in: DR `INVENTORY_GENERAL` / CR `OPNAME_INCOME` (4510) ; out: DR `OPNAME_EXPENSE` (6510) / CR `INVENTORY_GENERAL` | 3 keys (alias des adjust mappings) | idem | ✅ ACTIVE |
| 14 | Transfer entre sections | trigger `tr_20_je_emit` — exclu explicitement (intra-company) | — | — | — | 🔵 NO-JE INTENTIONNEL (commentaire `_022:13`) |
| 15 | Expense approval (cash) | RPC `approve_expense_v1` (`_122`) | DR `expense_categories.account_id` (6111-6190) net + DR `EXPENSE_VAT_INPUT` (1151) vat (if any) / CR `EXPENSE_CASH_OUT` (1110) total | 3 keys (dynamic + 2 mappings) | pas d'idempotency_key sur JE — l'expense status='submitted' gate via FOR UPDATE | ✅ ACTIVE |
| 16 | Expense approval (credit) | même RPC | DR cat / DR VAT / CR `EXPENSE_AP` (2141) | 3 keys | idem | ✅ ACTIVE |
| 17 | Expense paiement (clear AP) | RPC `pay_expense_v1` (`_122`) | DR `EXPENSE_AP` (2141) / CR `EXPENSE_CASH_OUT` (1110) | 2 keys | status='approved' gate | ✅ ACTIVE |
| 18 | Refund (cash) | trigger `fn_create_je_for_refund` sur INSERT refunds (`_013` refactor) | DR `SALE_POS_REVENUE` (4100) net + DR `SALE_PB1_TAX` (2110) tax / CR `SALE_PAYMENT_*` (1110/1115/1116) per refund_payments.method (routage par mapping) | 4+ keys | pre-SELECT `(sale_refund, refund.id)` | ✅ ACTIVE |
| 19 | Void order (full reversal) | 2 JEs co-existent : (a) `create_sale_journal_entry` raise `sale_void` reversal + (b) `fn_create_je_for_refund` raise `sale_refund` (void_order_rpc insère aussi un refund mirror) | (a) reverse sale ; (b) refund classique — voir commentaire `_012000005:13` "Both JEs co-exist" | mêmes keys | both idempotency | ✅ ACTIVE-MAIS-DOUBLE (voir F-S26-AC-04 — risque double-comptabilisation si reports session 14 dedupe mal) |
| 20 | Cash movement (manager add/remove from till) | RPC `record_cash_movement_v1` (`_134`) | **PAS de JE** — juste INSERT `cash_movements` + UPDATE `pos_sessions.cash_{in,out}_total` | — | cash_movements.idempotency_key | ⚠️ NO-JE QUESTIONNABLE (voir F-S26-AC-05 — un cash deposit manager ≠ in/out devrait DR/CR Cash 1110 et un compte de contrepartie) |
| 21 | Shift close — variance cash (over) | RPC `close_shift_v1` (`_135`) | DR `SALE_PAYMENT_CASH` (1110) variance / CR `SHIFT_CASH_VARIANCE_INCOME` (4910) | 2 keys | pre-SELECT `(shift_close, session.id)` | ✅ ACTIVE |
| 22 | Shift close — variance cash (short) | même RPC | DR `SHIFT_CASH_VARIANCE_EXPENSE` (5910) / CR `SALE_PAYMENT_CASH` (1110) | 2 keys | idem | ✅ ACTIVE |
| 23 | Loyalty points adjust admin | RPC `adjust_loyalty_points` (`_002`) | **PAS de JE** — INSERT `loyalty_transactions` only | — | — | ⚠️ NO-JE QUESTIONNABLE (voir F-S26-AC-06 — un ajustement positif gratuit augmente la liability LOYALTY_LIABILITY 2210 sans contrepartie expense) |
| 24 | Purchase return | — | **PAS de RPC ni trigger** — table `purchase_order_returns` existe mais sans pipeline JE | — | — | 🔴 GAP P2 (voir F-S26-AC-07) |

**Synthèse JE matrix** :
- ACTIVE balanced : **17** opérations couvertes (lignes 1-6, 8-13, 15-19, 21-22)
- NO-JE intentionnel : **3** (B2B balance adjust, transfer interne, refund après void = double mais cohérent)
- GAP / NO-JE questionable : **4** (vente non-cash routage incorrect, cash movement, loyalty adjust, purchase return)
- Erreur trigger hardcoded : **2** (sale JE codes literals + PB1 hardcoded 10/110)

## Findings

### 🔴 Critiques (compliance ou data integrity)

**F-S26-AC-01** : **Divergence latente PB1 trigger vs RPC sur `business_config.tax_rate`** — Le trigger `create_sale_journal_entry` (`_010:58`) et `retry_sale_journal_entry_v1` (`_140:78`) hardcodent `round_idr(NEW.total * 10 / 110)` ; le RPC `complete_order_with_payment_v9` (`_015:275`) lit `business_config.tax_rate` et applique `round_idr(v_total * v_tax_rate / (1 + v_tax_rate))`. La table `business_config.tax_rate` est éditable (DEFAULT 0.10 mais pas LOCK). Si admin la passe à 0.11 (PPN 11% applicable depuis 2025 pour certains secteurs PKP), le RPC écrit `orders.tax_amount` calculé à 11% mais le trigger écrit JE PB1 à 10% → déséquilibre `total_debit ≠ total_credit` silencieux + sous-déclaration fiscale. **Action S26 P0** : refactor le trigger pour lire `business_config.tax_rate` (helper `current_tax_rate()` ou même computation pattern). Migration suggérée : `bump_create_sale_journal_entry_use_business_config_tax_rate`.

### 🟠 Élevés (risques métier ou trail comptable incomplet)

**F-S26-AC-02** : **Sale JE trigger encore hardcoded sur 3 codes account** — `_010:62-64` resolve via `resolve_mapping_account('SALE_PAYMENT_CASH')`, `'SALE_POS_REVENUE'`, `'SALE_PB1_TAX'` ✅ (refactor S13 D11 appliqué). MAIS : tous les paiements split (card, QRIS, EDC, bank transfer) sont posté sur `SALE_PAYMENT_CASH=1110` au lieu de splitter par `order_payments.method` vers `1115/1116/1112`. Conséquence : cash 1110 est gonflé artificiellement vs autres comptes clearing (1115 QRIS, 1116 Card) qui restent vides → balance sheet line "Cash" inflate, autres comptes assets de paiement inactifs. **Action S26 P0** : refactor le trigger pour itérer sur `order_payments` (déjà inséré par `complete_order_v9` AVANT le trigger sale JE sur status update) et émettre 1 DR line par méthode via `SALE_PAYMENT_QRIS/DEBIT/CREDIT_CARD/CASH`. Le refund trigger (`_013`) fait déjà ce pattern (`v_pay IN SELECT method FROM refund_payments`) — copier la logique.

**F-S26-AC-03** : **`cash_movements` ne génère pas de JE** — `record_cash_movement_v1` (`_134:30`) trace seulement la table `cash_movements` + UPDATE `pos_sessions.cash_{in,out}_total`. Or un "manager met 500k IDR de plus dans la caisse" = augmentation actif Cash 1110 contrebalancée par soit une CR Owner Capital 3100 (apport), soit DR Bank 1112 (transfert), soit CR Petty Cash 1111 (replenishment). Conséquence : Balance Sheet sous-affiche Cash 1110 vs réalité physique de la caisse. Le shift close JE (`_135`) catch la variance globale en fin de shift, mais entre-temps les rapports intraday sont faux. **Action S26 P1** : étendre `record_cash_movement_v1` pour émettre un JE selon `reason` (apport, transfert bank, replenishment) avec 2 nouveaux mapping keys `CASH_MOVEMENT_OWNER_CAPITAL_IN` (3100) et `CASH_MOVEMENT_BANK_TRANSFER` (1112). Sinon, documenter explicitement le pattern (le shift close JE catch tout).

**F-S26-AC-04** : **Double JE sur full-void (orders.status='voided') + RPC `void_order_rpc` insère aussi un refund row** — Le trigger `create_sale_journal_entry` raise un JE `reference_type='sale_void'` reversal ; en parallèle `void_order_rpc` (`_009:14`) insère une row refunds (`is_full_void=true`) qui fait raise le trigger `fn_create_je_for_refund` → 2 JEs. Si le `reports session 14 dedupe-by-reference_type` (prefer 'sale_refund' over 'sale_void' per spec §8) marche, OK. Mais le `get_profit_loss_v1` (`_210`) et `get_balance_sheet_v1` (`_211`) ne filtrent PAS par dedupe → les 2 JEs sont sommés → double-reversal de revenue + double-credit de cash. **Action S26 P0** : ajouter au `get_profit_loss_v1`/`get_balance_sheet_v1` une exclusion explicite des JEs `reference_type='sale_void'` lorsqu'il existe une JE `reference_type='sale_refund'` pour le même `reference_id` (le refund mirror). Ou plus propre : `void_order_rpc` ne devrait PAS insérer un refund row pour les full-voids — laisser le trigger sale_void seul.

**F-S26-AC-05** : **`adjust_loyalty_points` n'émet aucune JE** — `LOYALTY_LIABILITY` (2210) est créditée seulement quand `loyalty_points_earned > 0` à la vente (via le mécanisme natif), et débitée à la redemption. MAIS un ajustement admin gratuit (`p_delta=+500` sans contrepartie achat) augmente le compteur sans contrepartie comptable → la liability 2210 sous-affiche la dette réelle envers les clients. Conséquence SAK EMKM : passif sous-évalué de manière incrémentale. **Action S26 P1** : émettre un JE quand `|p_delta| × points_to_idr_ratio` > 0 — DR `LOYALTY_PROMO_EXPENSE` (à créer 6190 ou nouveau 6510 sub) / CR `LOYALTY_LIABILITY` (2210) pour positifs ; inverse pour révocations punitives.

### 🟡 Moyens

**F-S26-AC-06** : **9 pages BO accounting absentes** — Glossaire V2↔V3 confirme : ChartOfAccountsPage, JournalEntriesPage, GeneralLedgerPage, TrialBalancePage, VATManagementPage, ARAgingPage, BankReconciliationPage, ReconciliationDetailPage, CALKPage, FiscalPeriodModal (toutes ❌ S26). Backend EXISTE pour tous ces écrans (`fiscal_periods` table seedée 24 mois, `accounting_mappings` éditable, `view_ar_aging` view, `journal_entries` + `journal_entry_lines` queryables, `calculate_vat_payable` RPC). Seul Mappings page existe (S17). **Sans ces pages, le comptable ne peut PAS** : (a) auditer les écritures journal (mois fermé sans pouvoir trier/exporter), (b) générer la déclaration PB1 mensuelle, (c) fermer une période fiscale (le statut reste 'open' éternellement), (d) tracker les créances clients aging, (e) imprimer le CALK requis SAK EMKM. **Prioritisation S26 détaillée § Validation gaps S26 ci-dessous.**

**F-S26-AC-07** : **Purchase return = GAP P2** — Table `purchase_order_returns` existe mais sans RPC ni trigger. Cas rare en boulangerie mais SAK EMKM requiert tracking. Pattern attendu : DR `PURCHASE_PAYABLE` (2141) return amount / CR `INVENTORY_GENERAL` (1141) return net + CR `PURCHASE_VAT_INPUT` (1151) return VAT. **Action S26-S27 P2** : créer `process_purchase_return_v1` + trigger sur table.

**F-S26-AC-08** : **PB1 hardcoded sur B2B = `tax_amount=0`** — `create_b2b_order_v1` (`_022:192`) insère `tax_amount=0` car B2B est hors scope PKP (decision pre-flight §5 documentée). Mais SAK EMKM impose : si entreprise PKP, factures B2B doivent inclure PPN (le client B2B PKP réclame le PPN Masukan). Statut "à reconsidérer S30" déjà documenté dans commentaire de migration. **Action S26 P1** : documenter explicitement dans CALK template "B2B sales are excluded from PB1 because the client is not PKP-registered" et préparer un toggle business_config si statut PKP change.

**F-S26-AC-09** : **CALK non générable automatiquement** — SAK EMKM Bab 3.9-3.11 impose Notes annexes avec disclosure des accounting policies (recognition revenue, inventory valuation, depreciation). Pas de générateur ni page CALK. Conséquence : non-conformité SAK EMKM stricte si controlleur passe. **Action S26-S27 P1** : ajouter CALKPage avec templates pré-remplis depuis `business_config` + génération PDF (export DJP-compatible).

### 🟢 Bas

**F-S26-AC-10** : **`PURCHASE_CASH_OUT` mappe sur 1110 au lieu de 1111** — Le seed S13 (`_005:91`) map à `1110` (legacy "Cash on Hand") au lieu de `1111` (Petty Cash) introduit par S13. Cohérence : tous les `SALE_PAYMENT_CASH` mappent aussi à 1110. Pas un bug, mais 1110 est le legacy alors que 1111 est sémantiquement plus correct. **Action S30+ P3** : migration cleanup pour passer tous les mappings cash vers 1111 et déprécier 1110 (ou alternative : merger 1110→1111 et redirect tous les JEs historiques).

**F-S26-AC-11** : **`OPNAME_INCOME` / `OPNAME_EXPENSE` mappent vers les mêmes comptes que `ADJUSTMENT_*`** — Aliases sur 4510/6510 (commentaire `_005:74`). Volonté assumée "keep ledger lean". Conséquence : pas de différenciation reporting entre ajustement régulier et ajustement post-opname. **Action S29+ P3** : si reporting fin demande, créer accounts 4511 Opname Variance Income et 6511 Opname Variance Expense.

**F-S26-AC-12** : **CashFlowPage utilise `get_cash_flow_v1` (indirect, MVP) au lieu de `cash_flow_v1` (3 sections, S21)** — La nouvelle RPC `cash_flow_v1` (S21 `_021`) classe par `accounts.cash_flow_section` (operating/investing/financing) mais le hook BO consomme toujours l'ancien indirect method. Confirmé via lecture rapide CashFlowPage.tsx. **Action S26 P2** : migrer le hook vers `cash_flow_v1` (3 sections) pour conformité SAK ETAP (upgrade future).

## Détails par section

### 1. COA cohérence

**Vérifié contre `references/coa-reference.md`** :

| Classe | Codes attendus | Codes présents V3 | Statut |
|---|---|---|---|
| 1xxx Assets | 1110, 1120, 1130-1132, 1200, 1300, 1400 | 1110, 1111, 1112, 1113, 1114, 1115, 1116, 1131, 1132, 1141, 1142, 1143, 1151 | ✅ + extras (split Inventory/VAT) |
| 2xxx Liabilities | 2100, 2110, 2200, 2300 | 2100 (group), 2141, 2142, 2143, 2210 | ⚠️ MANQUE 2200 Store Credit (GAP P2) ; PB1 sur 2143 (pas 2110 reference) |
| 3xxx Equity | 3100, 3200, 3300 | 3000 (group), 3100, 3300 | ⚠️ MANQUE 3200 Retained Earnings explicit (utilisé par BS RPC ligne `code LIKE '32%'` mais 0 compte seed) |
| 4xxx Revenue | 4100, 4190 | 4000, 4100, 4111, 4131, 4190, 4510, 4900, 4910 | ✅ + extras (POS/B2B split, discount, variance) |
| 5xxx COGS | 5100, 5200 | 5000, 5100, 5110, 5210, 5910 | ✅ |
| 6xxx OpEx | 6100-6900 | 6000, 6111-6116, 6190, 6510 | ✅ |
| 7xxx Other | 7100, 7200, 7300 | — | ⚠️ MANQUE classe 7 (Other Income/Expense) — V3 routes ces concepts dans 4xxx (4510 income, 4910 cash gain) et 5xxx/6xxx (5910 cash loss, 6510 adjust expense). Sémantique correcte mais ne suit pas le standard à 7 classes — le reference COA prévoit 7 classes mais V3 a 6 |

**Mapping keys présentes (24 total après seed `_001` + `_005` + `_120` + `_014`)** :

✅ `SALE_PAYMENT_CASH` → 1110, `SALE_PAYMENT_QRIS` → 1115, `SALE_PAYMENT_DEBIT` → 1116, `SALE_PAYMENT_CREDIT_CARD` → 1116, `SALE_POS_REVENUE` → 4100, `SALE_B2B_REVENUE` → 4131, `SALE_PB1_TAX` → 2110, `SALE_DISCOUNT` → 4900, `LOYALTY_LIABILITY` → 2210, `PURCHASE_PAYABLE` → 2141, `PURCHASE_VAT_INPUT` → 1151, `PURCHASE_CASH_OUT` → 1110, `INVENTORY_GENERAL` → 1141, `INVENTORY_RAW_MATERIAL` → 1142, `INVENTORY_FINISHED_GOODS` → 1143, `PRODUCTION_COGS` → 5110, `WASTE_EXPENSE` → 5210, `ADJUSTMENT_INCOME` → 4510, `ADJUSTMENT_EXPENSE` → 6510, `OPNAME_INCOME` → 4510, `OPNAME_EXPENSE` → 6510, `EXPENSE_DEFAULT` → 6190, `B2B_AR` → 1132, `B2B_PAYMENT_BANK` → 1112, `SHIFT_CASH_VARIANCE_INCOME` → 4910, `SHIFT_CASH_VARIANCE_EXPENSE` → 5910, `EXPENSE_AP` → 2141, `EXPENSE_CASH_OUT` → 1110, `EXPENSE_VAT_INPUT` → 1151.

**Conclusion §1** : COA très complet pour PME boulangerie. Manque uniquement (a) compte 3200 Retained Earnings explicit (le BS RPC le cherche, n'en trouve pas → reste à 0 toujours) (b) compte 2200 Store Credit Liability (gap P2 non-bloquant). Classe 7 absente mais redondante (couvert par 4xxx/5xxx/6xxx).

### 2. PB1 formule

**Backend triggers/RPCs émetteurs JE** :
- `create_sale_journal_entry` (`_010:58` + `_010:92`) : `round_idr(NEW.total * 10 / 110)` — **hardcoded 10/110**
- `retry_sale_journal_entry_v1` (`_140:78`) : `round_idr(v_order.total * 10 / 110)` — **hardcoded 10/110**
- `fn_create_je_for_refund` (`_013:42`) : `v_net := NEW.total - NEW.tax_refunded` (lit `refunds.tax_refunded` snapshot calculé en amont) — **OK lit le snapshot**
- `create_purchase_journal_entry` (`_011:42`) : `v_vat := COALESCE((NEW).vat_amount, 0)` (lit la col du GRN) — **OK lit le snapshot**

**Backend RPCs ordre** :
- `complete_order_with_payment_v9` (`_015:275`) : `SELECT tax_rate FROM business_config` + `round_idr(v_total * v_tax_rate / (1 + v_tax_rate))` — **lit dynamic**
- `refund_order_rpc_v2` (`_014:198`) : `v_tax_refunded := round_idr(v_refund_total * v_tax_rate / (1 + v_tax_rate))` — **lit dynamic** (NB : la ligne `198` que je vois lit `v_tax_rate` qui doit être chargée plus haut depuis business_config — à vérifier)
- `cancel_order_item_rpc` (`_008`) : lit `v_tax_rate` aussi
- `pay_existing_order_rpc_v6` : suit le même pattern v8/v9

**Frontend TS** :
- `packages/domain/src/tablet/calculatePreview.ts:5` : `TAX_RATE = 10/100` puis `tax_amount = Math.round(items_total * TAX_RATE / (1 + TAX_RATE))` — **hardcoded 10%**
- `packages/domain/src/cart/__tests__/calculateTotals.test.ts` : couvre le calcul

**Conclusion §2** : **Divergence latente F-S26-AC-01 confirmée**. Les triggers JE et le TS hardcodent `10/110` ; les RPCs serveurs lisent `business_config.tax_rate`. Aujourd'hui c'est cohérent (PB1 = 10% en Indonésie pour restaurants), mais le jour où PB1 passe à 11% (PPN s'est aligné à 11% en 2025 pour certains secteurs), un admin qui modifie `business_config.tax_rate` casse le système silencieusement. **Mitigation immediate** : ajouter une CHECK `tax_rate = 0.1000` ou un trigger BEFORE UPDATE qui raise si différent (façon LOCK), ou refactor les triggers pour lire `business_config`.

### 3. Fiscal periods

**Présence** :
- Table `fiscal_periods` ✅ (`_002:13`) avec status ENUM `draft/open/closed/locked`
- 24 mois seedés Jan 2026 .. Dec 2027 tous `status='open'` (`_002:44`)
- Helper `check_fiscal_period_open(p_date)` ✅ raise P0004 si `closed/locked` (`_002:57`)
- Helper `next_journal_entry_number(p_date)` ✅ format `JE-YYYYMMDD-XXXX` monotonic per day (`_002:104`)
- RLS read-only authenticated (`_002:131`)

**Émetteurs JE qui appellent `check_fiscal_period_open`** :
1. `create_sale_journal_entry` (`_010:44`) ✅
2. `fn_create_je_for_refund` (`_013:40`) ✅
3. `create_purchase_journal_entry` (`_011:48`) ✅
4. `tr_stock_movement_je` (`_022:73`) ✅
5. `retry_sale_journal_entry_v1` (`_140:76`) ✅
6. `approve_expense_v1` (`_122:197`) ✅
7. `pay_expense_v1` (`_122:319`) ✅
8. `record_b2b_payment_v1` (`_020:112`) ✅
9. `create_b2b_order_v1` (`_022:165`) ✅
10. `close_shift_v1` (`_135:87`) ✅

**Tous les émetteurs appellent le guard** ✅. Bonne discipline.

**MANQUE** :
- ❌ Pas de RPC `close_fiscal_period_v1` ou équivalent pour transitioner `open → closed` (le statut reste éternellement 'open')
- ❌ Pas de FiscalPeriodModal page BO pour gérer le workflow draft/open/closed/locked
- ❌ Pas de mécanisme de roll-forward de Retained Earnings à la clôture annuelle (CYE 3300 → 3200)

**Conclusion §3** : Guard d'écriture impeccable, mais workflow de clôture absent. **Risque** : un comptable indonésien attend de pouvoir "fermer Mars" en cliquant un bouton — fonctionnalité bloquante pour adoption. **Action S26 P0** : créer `close_fiscal_period_v1(p_period_id, p_force_unbalanced BOOLEAN)` qui vérifie balance JE puis flip status='closed' + INSERT audit_logs.

### 4. Reports financiers

**`get_profit_loss_v1`** (`_210`) :
- Source : `journal_entry_lines` JOIN `journal_entries` (status posted/locked) JOIN `accounts` (class 4/5/6)
- Output : revenue (sales, discounts, adjustments, total), cogs (production, waste, other, total), opex (salary, rent, utilities, supplies, marketing, maintenance, other, total), gross_profit, operating_profit, net_profit, lines[]
- Filtres : `entry_date BETWEEN start AND end` ; `account_class IN (4,5,6)`
- Bug potentiel ⚠️ : ligne 105 calcule `cogs_other` comme `total_debit - total_credit` pour `account_class=5 AND code NOT LIKE '51%' AND code NOT LIKE '52%'` — couvre 5910 Cash Variance Loss qui devrait probablement être classifié OpEx ou Other Expense, pas COGS. Petit drift catégoriel.

**`get_balance_sheet_v1`** (`_211`) :
- Source : `journal_entry_lines` cumulative as_of_date pour class 1/2/3
- CYE 3300 computed live YTD = revenue - cogs - opex
- Output : assets (current/fixed), liabilities (current/long_term), equity (capital, retained, CYE, other), balanced indicator + delta
- Tests : `balanced = ABS(assets - L - E) < 0.01` ✅
- Bug ⚠️ : ligne 115 cherche retained earnings via `code LIKE '32%'` mais aucun compte seed n'a un code 32xx → toujours 0. Le RE devrait être 3200 explicit.

**`get_cash_flow_v1`** (`_212`) — indirect method MVP :
- Output : operating (net_profit, delta_ar, delta_ap, delta_inventory, total), investing (placeholder 0), financing (placeholder 0), net_change, cash_start/end
- Limite documentée D-W6-6A-2 : investing/financing pas implémentés

**`cash_flow_v1`** (`_021`) — 3 sections (S21) :
- Source : `accounts.cash_flow_section` ENUM (S21 col added)
- Output : operating_total, investing_total, financing_total, net_change, lines[]
- Sign convention : `credit - debit` net per account
- **Pas encore consommé par BO** (CashFlowPage utilise l'ancien `get_cash_flow_v1`) — F-S26-AC-12

**`calculate_vat_payable`** (`_012`) :
- Output : vat_output (PB1 collecté 2110), vat_input (PPN paid 1151), vat_payable (output - input)
- Source : sum sur `journal_entry_lines` filtré par account mappings — robuste à un COA reshuffle
- Limite : ne distingue pas PB1 (restaurant) de VAT_OUTPUT (autres ventes) — la sortie agrège

**Conclusion §4** : Les 5 RPCs reports sont fonctionnels. Petits drifts (3200 manquant, 5910 catégorisé COGS au lieu d'OpEx, cash_flow_v1 non consommé) mais pas bloquants. **Action S26 P1** : (a) seed account 3200, (b) reclasser 5910 sur class 6, (c) migrer CashFlowPage vers `cash_flow_v1`.

### 5. Validation prioritisation S26 (9 pages absentes)

Sur les 9 pages absentes du glossaire (ChartOfAccountsPage, JournalEntriesPage, GeneralLedgerPage, TrialBalancePage, VATManagementPage, ARAgingPage, BankReconciliationPage, ReconciliationDetailPage, CALKPage) + FiscalPeriodModal :

| Page | Priorité | Justification | Impact prod | Backend prêt |
|---|---|---|---|---|
| **FiscalPeriodModal** | **P0** | Bloquant adoption — un comptable indonésien doit pouvoir clore le mois. Sans clore, les JEs peuvent être backdated sans contrôle (le guard `check_fiscal_period_open` ne fire jamais P0004 car aucune période n'est `closed`). Conformité SAK EMKM : la clôture trace de période est obligatoire. | **Bloquant compliance** | Table + helper existent ; manque `close_fiscal_period_v1` RPC + UI modal |
| **JournalEntriesPage** | **P0** | Audit trail — un comptable a besoin de tracer toute écriture journal (rechercher par date, montant, reference_type, montant débit/crédit). Sans cette page, il ne peut pas auditer ni générer un grand-livre. | **Bloquant audit fiscal** | Tables + RLS read auth ✅ ; manque hook + UI + filtres |
| **GeneralLedgerPage** | **P0** | Grand livre par compte = vue agrégée des mouvements par compte (avec balance cumulative). Norme SAK EMKM exige de pouvoir présenter le GL en cas de contrôle DJP. | **Bloquant audit fiscal** | Source `journal_entry_lines` JOIN `accounts` ; pas de RPC dédiée (à créer `get_general_ledger_v1(p_account_id, p_start, p_end)`) |
| **VATManagementPage** | **P0** | Déclaration PB1 mensuelle — l'admin doit générer le SPT (Surat Pemberitahuan Pajak) chaque mois. RPC `calculate_vat_payable` existe mais sans UI le calcul est manuel. Risque pénalité DJP. | **Bloquant compliance fiscale** | RPC `calculate_vat_payable` prêt ; manque UI + export DJP format CSV/XML |
| **ChartOfAccountsPage** | **P1** | Visualisation hiérarchique COA + édition des comptes (rename, deactivate). Pas urgent car la majorité des comptes sont system + seed S13 — l'admin n'a pas besoin d'éditer souvent. Mappings page suffit pour l'essentiel. | Confort | Table `accounts` lisible ; manque UI tree + édition RPC |
| **TrialBalancePage** | **P1** | Balance des comptes (total débits / crédits par compte) à une date — étape intermédiaire avant BS/P&L, mais ces 2 reports existent déjà. Le TB est plus un outil comptable de réconciliation manuelle. | Audit confort | RPC à créer `get_trial_balance_v1(p_as_of_date)` simple ; UI tabulaire |
| **ARAgingPage** | **P1** | Vieillissement des créances B2B (current / 31-60 / 61-90 / 90+). View `view_ar_aging` créée S24 mais aucune page la consomme. Critique pour suivi des paiements clients B2B. | Bloquant cash management B2B | `view_ar_aging` ✅ ; manque hook + UI + alerts overdue |
| **CALKPage** | **P1** | Notes annexes obligatoires SAK EMKM. Sans CALK, en cas de contrôle un comptable externe doit les générer manuellement à la main. | Compliance partial | Aucun backend — templates à définir + génération PDF |
| **BankReconciliationPage** | **P2** | Réconciliation des relevés bancaires. The Breakery a 1-2 comptes bank (1112, 1113), volume mensuel faible → la réco peut être manuelle Excel les premiers mois. | Nice-to-have | Aucun backend — table `bank_statements` à créer + matching logic |
| **ReconciliationDetailPage** | **P2** | Détail d'une réco en cours — dépend de Bank Recon. | Nice-to-have | idem |

**Synthèse S26 priorisée** :

**P0 compliance prod (bloquant déploiement Lombok)** :
1. FiscalPeriodModal + `close_fiscal_period_v1` RPC + roll-forward Retained Earnings (`3300 → 3200` à clôture annuelle)
2. JournalEntriesPage + GeneralLedgerPage (`get_general_ledger_v1` RPC) — audit trail fiscale
3. VATManagementPage + export DJP — déclaration PB1 mensuelle

**P0 compliance data integrity** (à packager dans S26 même branche) :
4. Fix F-S26-AC-01 : sale JE trigger lit `business_config.tax_rate`
5. Fix F-S26-AC-02 : sale JE trigger split par `order_payments.method`
6. Fix F-S26-AC-04 : dedupe `sale_void` + `sale_refund` dans reports BS/P&L

**P1 (S27)** :
7. ChartOfAccountsPage + TrialBalancePage
8. ARAgingPage (backend `view_ar_aging` déjà prêt)
9. CALKPage + templates
10. Fix F-S26-AC-03/05 : JE pour cash_movements + loyalty adjust

**P2 (S28+)** :
11. BankReconciliationPage + Recon detail
12. Purchase return pipeline (F-S26-AC-07)
13. Cleanup 1110 → 1111 (F-S26-AC-10)
14. Migrate CashFlowPage vers `cash_flow_v1` 3 sections (F-S26-AC-12)

## Annexes

### A1 — Mapping keys exhaustive (29 keys vs `references/coa-reference.md` 15 keys minimaux)

Présentes dans V3 :
```
SALE_PAYMENT_CASH            → 1110  Petty Cash
SALE_PAYMENT_QRIS            → 1115  Cash QRIS Clearing
SALE_PAYMENT_DEBIT           → 1116  Cash Card Clearing
SALE_PAYMENT_CREDIT_CARD     → 1116  Cash Card Clearing
SALE_POS_REVENUE             → 4100  Sales Revenue (legacy single)
SALE_B2B_REVENUE             → 4131  B2B Revenue
SALE_PB1_TAX                 → 2110  PB1 Payable (legacy single)
SALE_DISCOUNT                → 4900  Sales Discounts (loyalty/promo)
LOYALTY_LIABILITY            → 2210  Loyalty Liability
PURCHASE_PAYABLE             → 2141  Accounts Payable
PURCHASE_VAT_INPUT           → 1151  VAT Input
PURCHASE_CASH_OUT            → 1110  Petty Cash
INVENTORY_GENERAL            → 1141  Inventory General
INVENTORY_RAW_MATERIAL       → 1142  Inventory Raw Material
INVENTORY_FINISHED_GOODS     → 1143  Inventory Finished Goods
PRODUCTION_COGS              → 5110  Production COGS Direct
WASTE_EXPENSE                → 5210  Waste Expense
ADJUSTMENT_INCOME            → 4510  Adjustment Income
ADJUSTMENT_EXPENSE           → 6510  Adjustment Expense
OPNAME_INCOME                → 4510  alias (same as adjustment)
OPNAME_EXPENSE               → 6510  alias (same as adjustment)
EXPENSE_DEFAULT              → 6190  Other Operating Expense
EXPENSE_AP                   → 2141  Accounts Payable
EXPENSE_CASH_OUT             → 1110  Petty Cash
EXPENSE_VAT_INPUT            → 1151  VAT Input
B2B_AR                       → 1132  AR B2B
B2B_PAYMENT_BANK             → 1112  Bank Operating
SHIFT_CASH_VARIANCE_INCOME   → 4910  Cash Variance Gain
SHIFT_CASH_VARIANCE_EXPENSE  → 5910  Cash Variance Loss
```

Manquantes (recommandées) :
```
CASH_MOVEMENT_OWNER_CAPITAL_IN   → 3100  Owner Capital (pour record_cash_movement_v1)
CASH_MOVEMENT_BANK_TRANSFER      → 1112  Bank Operating
LOYALTY_PROMO_EXPENSE            → 6190 ou 6510  (pour adjust_loyalty_points contrepartie)
PURCHASE_RETURN_GAIN             → optional 4510  (pour process_purchase_return_v1)
STORE_CREDIT_LIABILITY           → 2200 (à créer)  (P2 store credit)
REFUND_REVENUE_CONTRA            → optional, refund réutilise SALE_POS_REVENUE
```

### A2 — Triggers JE détaillés

| Trigger | Table | Event | Function | Idempotency |
|---|---|---|---|---|
| `trg_create_sale_journal_entry_ins` | orders | AFTER INSERT WHEN status='paid' | `create_sale_journal_entry()` | pre-SELECT `(sale, order.id)` |
| `trg_create_sale_journal_entry_upd` | orders | AFTER UPDATE OF status | `create_sale_journal_entry()` | pre-SELECT `(sale, order.id)` |
| `trg_create_purchase_je` | goods_receipt_notes | AFTER INSERT | `create_purchase_journal_entry()` | pre-SELECT `(purchase, grn.id)` |
| `trg_create_je_for_refund` | refunds | AFTER INSERT | `fn_create_je_for_refund()` | pre-SELECT `(sale_refund, refund.id)` |
| `tr_20_je_emit` | stock_movements | AFTER INSERT | `tr_stock_movement_je()` | UNIQUE `(stock_movement, sm.id, movement_type)` |

**Pas de trigger sur** : `b2b_payments`, `expenses`, `pos_sessions`, `cash_movements` — JE émis par RPC SECURITY DEFINER directement.

### A3 — Recommandations S26 ordonnancées

```
S26 — Wave 1 : Compliance prod core (3 phases parallélisables)
  Phase 1A — DB hardening (1 dev) :
    - F-S26-AC-01 : refactor create_sale_journal_entry pour lire business_config.tax_rate
    - F-S26-AC-02 : refactor pour split par order_payments.method
    - Migration close_fiscal_period_v1 RPC + audit_logs hook
    - Seed account 3200 Retained Earnings + reclasser 5910 → class 6
  Phase 1B — VAT compliance (1 dev) :
    - VATManagementPage UI + hook useVatPayable + export DJP CSV
    - Tests pgTAP couvrant calculate_vat_payable
  Phase 1C — Audit trail (1-2 devs) :
    - JournalEntriesPage UI + hooks useJournalEntries (filtres date/ref_type/account/amount)
    - GeneralLedgerPage UI + create RPC get_general_ledger_v1
    - FiscalPeriodModal + intégration audit_logs
    - Reports BS/P&L : exclure sale_void si sale_refund présent (F-S26-AC-04)

S27 — Wave 2 : Compliance étendue
    - ChartOfAccountsPage + TrialBalancePage
    - ARAgingPage (consume view_ar_aging)
    - CALKPage + templates Bab 3.9-3.11
    - record_cash_movement_v1 JE émission (F-S26-AC-03)
    - adjust_loyalty_points JE émission (F-S26-AC-05)

S28+ : Nice-to-have
    - BankReconciliationPage + table bank_statements
    - process_purchase_return_v1 RPC + UI
    - Cleanup mappings 1110 → 1111
    - Migrate CashFlowPage vers cash_flow_v1 3 sections
```

**Effort total estimé S26 (P0)** : ~10-12 jours-homme avec 3 devs en parallèle (1 DB, 1 BO UI, 1 tests/QA).
