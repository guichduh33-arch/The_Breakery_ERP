---
name: accounting
description: >-
  Accounting cockpit expert — COA, journal entries, PB1 (NON-PKP, ADR-003), fiscal periods
  & year close, general ledger, trial balance, P&L, balance sheet, mapping accounts. Audits
  JE balance/mapping/fiscal-guard AND guides accounting changes. Use this skill whenever the
  task mentions journal entry / écriture comptable / JE, COA / plan comptable, PB1, PPN, TVA,
  NON-PKP, fiscal period / période fiscale, clôture annuelle / year close, general ledger /
  grand livre, trial balance / balance, COGS, retained earnings, mapping account, compta /
  comptabilité — or touches apps/backoffice accounting features/pages,
  SettingsAccountingPage, or supabase migrations/tests around journal/fiscal/ledger/pb1.
  Invoke it BEFORE editing any JE-emitting RPC or accounting report, even for a one-line fix.
pathPatterns:
  - 'apps/backoffice/src/features/accounting/**'
  - 'apps/backoffice/src/pages/accounting/**'
  - 'apps/backoffice/src/pages/settings/SettingsAccountingPage*'
  - 'supabase/migrations/*journal*.sql'
  - 'supabase/migrations/*fiscal*.sql'
  - 'supabase/migrations/*ledger*.sql'
  - 'supabase/migrations/*pb1*.sql'
  - 'supabase/tests/*accounting*.test.sql'
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
    - 'general ledger'
    - 'trial balance'
    - 'COGS'
    - 'retained earnings'
    - 'mapping account'
---

# Accounting — The Breakery ERP

Expert on the accounting cockpit: chart of accounts, journal entries, PB1 fiscal reporting, general ledger, trial balance, fiscal period management.

**`CLAUDE.md` est la source de vérité** for project-wide patterns (RPC versioning, REVOKE pairs, PIN header, audit_logs). This skill adds the accounting-specific mental model, verified account codes, RPC signatures, and audit checklists that CLAUDE.md doesn't carry.

---

## Mental model NON-PKP (ADR-003, ratifié 2026-05-20)

**The Breakery est NON-PKP.** Décision irrévocable — re-read `docs/adr/003-pkp-status-non-pkp.md` before any fiscal change.

- **Output tax** : **PB1 10%** (PEMDA Bali, Perda Bali F&B). Pas de PPN sortant, pas d'e-Faktur, pas d'export DJP.
- **Input tax** : PPN 11% fournisseurs PKP est **non-récupérable** → **folded dans le coût d'acquisition** (`INVENTORY_GENERAL` 1130). Le compte `1151 VAT Input` est **désactivé** (`is_active=false`, `name='VAT Input — RESERVED (NON-PKP, see ADR-003)'`). Ne jamais le réactiver sans créer ADR-005.
- **`current_pb1_rate()`** : helper stable lit `business_config.tax_rate` (migration `20260603000010`). Toujours utiliser ce helper — pas de hardcode `10/110`.
- **`calculate_pb1_payable_v1(p_period_start DATE, p_period_end DATE)`** : formule simplifiée `pb1_payable = pb1_output` (pas de soustraction `vat_input`). Remplace l'ancien `calculate_vat_payable` (droppé migration `20260603000013`).

---

## JE backbone (triggers automatiques)

Toutes les JE passent par des **triggers** — ne jamais INSERT dans `journal_entries` directement.

| Trigger / fonction | Quand se déclenche |
|---|---|
| `create_sale_journal_entry()` | `AFTER UPDATE ON orders WHERE status IN ('paid','voided')` |
| `create_purchase_journal_entry()` | Goods receipt (PO) |
| `tr_20_je_emit` → `tr_stock_movement_je` | INSERT stock_movements type `waste/adjustment_*/opname_*/production_*` |
| `record_cash_movement_v2` | Shift cash events (raison : `apport_owner`, `bank_transfer`, `replenishment`) |

**Split paiement (S26 `_014`)** : `create_sale_journal_entry` boucle sur `order_payments` → 1 DR par méthode via mapping key :
- `cash` → `SALE_PAYMENT_CASH` → **1110** Cash on hand
- `qris` → `SALE_PAYMENT_QRIS` → **1115** QRIS Clearing
- `debit_card`/`credit_card` → `SALE_PAYMENT_DEBIT`/`SALE_PAYMENT_CREDIT_CARD` → **1116** Card Clearing
- `transfer` → `SALE_PAYMENT_CASH` (fallback — enrichissable S26+)

CR côté vente : `SALE_POS_REVENUE` + `SALE_PB1_TAX` → **2110** PB1 Payable.

**Idempotence** : `UNIQUE journal_entries_je_idempotency_uniq`. **Fiscal guard** : chaque trigger appelle `check_fiscal_period_open(date)` — écriture dans une période fermée/verouillée lève une exception.

**Cash movements JE** (S26 `_016`, mapping keys `_015`) :
- `apport_owner` → DR 1110 / CR **3100** Owner Capital
- `bank_transfer` → DR/CR 1110 ↔ **1112** Bank Operating
- `replenishment`/`misc`/NULL → pas de JE

---

## COA réel (account codes vérifiés)

| Code | Nom | Classe | Notes |
|------|-----|--------|-------|
| **1110** | Cash on hand | 1 asset | Caisse shift |
| **1112** | Bank Operating | 1 asset | Mapping `CASH_MOVEMENT_BANK` |
| **1115** | QRIS Clearing | 1 asset | Mapping `SALE_PAYMENT_QRIS` |
| **1116** | Card Clearing | 1 asset | Mapping `SALE_PAYMENT_DEBIT/CREDIT` |
| **1130** | Inventory General | 1 asset | Reçoit PPN supplier (folded, NON-PKP) |
| **1151** | VAT Input | 1 asset | **DÉSACTIVÉ NON-PKP** (ADR-003) |
| **2110** | PB1 Payable | 2 liability | Sortie PEMDA Bali mensuelle |
| **3100** | Owner Capital | 3 equity | Mapping `CASH_MOVEMENT_OWNER_CAPITAL` |
| **3200** | Retained Earnings | 3 equity | Seeded `_019` ; alimenté lors de la clôture annuelle |
| **5910** | Cash Variance Loss | 6 opex | Reclassé classe 5→6 (`_020`) ; renommer to 6910 différé |

> ⚠️ `5910` est code "classe 5" mais `account_class = 6` depuis S26 `_020` — ne pas s'y fier pour inférer la classe.

---

## Cockpit RPCs (S26 + S26b)

Toutes ces RPCs sont `SECURITY DEFINER`, perm-gatées, audit-logged. Voir les migrations `20260603000022..026` + `20260523135820` pour les signatures exactes.

| RPC | Signature | Gate | Notes |
|-----|-----------|------|-------|
| `close_fiscal_period_v1` | `(p_period_id UUID, p_manager_pin TEXT, p_lock BOOLEAN DEFAULT FALSE)` | `accounting.period.close` + PIN | Status `closed` ou `locked` |
| `get_general_ledger_v1` | `(p_account_id UUID, p_date_start DATE, p_date_end DATE, p_limit INT DEFAULT 50, p_cursor JSONB DEFAULT NULL)` | `accounting.gl.read` | SECURITY INVOKER, cursor-paginé, retourne `opening_balance` + `lines` + `next_cursor` |
| `get_trial_balance_v1` | `(p_date_start DATE, p_date_end DATE)` | `accounting.tb.read` | SECURITY INVOKER, `balanced` flag + tous comptes actifs |
| `create_manual_je_v1` | `(p_description TEXT, p_entry_date DATE, p_lines JSONB, p_manager_pin TEXT)` | `accounting.je.create_manual` + PIN | Validation : lines ≥ 2, Σdebit=Σcredit, debit XOR credit, accounts is_active+is_postable, fiscal guard |
| `update_account_active_v1` | `(p_account_id UUID, p_is_active BOOLEAN)` | `accounting.coa.write` SUPER_ADMIN only | S26b, audit_log row ; RLS UPDATE non-disponible sur `accounts` |
| `calculate_pb1_payable_v1` | `(p_period_start DATE, p_period_end DATE)` | — | Rapport mensuel PB1, pb1_payable = pb1_output |

**Idempotency** : `create_manual_je_v1` génère un `entry_no` interne — pas d'arg idempotency client. Si replay nécessaire, vérifier si row existe par description+date+montant.

---

## Permissions (vérifiées migration `20260603000026`)

| Code | Roles |
|------|-------|
| `accounting.period.close` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.je.create_manual` | ADMIN, SUPER_ADMIN |
| `accounting.gl.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.tb.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.coa.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.coa.write` | SUPER_ADMIN **uniquement** |

---

## BO surface (S26b)

Pages + hooks dans `apps/backoffice/src/features/accounting/` (vérifiés) :

- **Pages** : `AccountingIndexPage` (hub 4 tuiles), `ChartOfAccountsPage`, `JournalEntriesPage`, `GeneralLedgerPage` (accepte `?account_id=&start=&end=` URL params S32), `TrialBalancePage`, `SettingsAccountingPage` (FiscalPeriods)
- **Hooks** : `useChartOfAccounts`, `useJournalEntries`, `useJournalEntryLines`, `useGeneralLedger`, `useTrialBalance`, `useFiscalPeriods`, `useCloseFiscalPeriod`, `useCreateManualJournalEntry`, `useUpdateAccountActive`, `usePostableAccounts`, `useAccountIdByCode`
- **Components** : `CreateManualJEModal` (stepper 2 steps, PIN header), `FiscalPeriodModal`, `JournalEntryDetailDrawer`
- **Helper domaine** : `exportTrialBalanceCsv` (UTF-8 BOM + id-ID locale IDR)

---

## Audit checklist (avant de toucher le module accounting)

- [ ] **JE balanced** — pour tout `journal_entries` row : `Σ journal_entry_lines.debit_amount = Σ credit_amount`. Toute divergence = trigger bogué ou INSERT direct.
- [ ] **Mapping account existe + postable** — `resolve_mapping_account(key)` lève P0002 si la key est absente OU si le compte est `is_active=false`. Vérifier avant d'ajouter un nouveau mapping key.
- [ ] **Fiscal guard actif** — `check_fiscal_period_open(date)` doit exister et être appelé par chaque trigger JE. `SELECT proname FROM pg_proc WHERE proname = 'check_fiscal_period_open'`.
- [ ] **Compte 1151 reste inactif** — `SELECT is_active FROM accounts WHERE code='1151'` doit retourner `false`. Toute réactivation = violation ADR-003.
- [ ] **Dedupe sale_void/sale_refund** — `get_profit_loss_v1` et `get_balance_sheet_v1` excluent `sale_void` quand un refund existe pour le même `order_id` (S26 `_017`/`_018`). Vérifier que les bumps futurs préservent cette logique.
- [ ] **VAT trap** — si un `expense.vat_amount > 0` passe dans `_emit_expense_je`, cela lève P0002 (compte 1151 inactif). Non-régression S28 : ne jamais activer 1151 comme contournement.
- [ ] **REVOKE pair complet** sur toute nouvelle RPC accounting — 3 lignes : `REVOKE FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`.

---

## Preventive checklists

### Avant de modifier un trigger JE (create_sale_journal_entry, create_purchase_journal_entry)
- [ ] Mapping keys concernés existent dans `accounting_mappings` + comptes `is_active=true`.
- [ ] `current_pb1_rate()` utilisé (pas de hardcode).
- [ ] Idempotency `UNIQUE journal_entries_je_idempotency_uniq` préservée.
- [ ] `check_fiscal_period_open` appelé.
- [ ] pgTAP couvre : happy path + période fermée → exception + JE balanced.

### Avant d'ajouter/modifier un compte COA
- [ ] `is_postable=false` sur les comptes synthétiques (agrégats, ex: 3300 CYE).
- [ ] Classe = type economic correct (asset=1, liability=2, equity=3, revenue=4, cogs=5, opex=6).
- [ ] Si désactivation : `update_account_active_v1` via BO (gate `accounting.coa.write` SUPER_ADMIN) — pas d'UPDATE direct.
- [ ] Ne jamais DROP un compte qui a des `journal_entry_lines` historiques.

### Avant de toucher `close_fiscal_period_v1`
- [ ] Comprendre les états : `open` → `closed` → `locked` (irréversible sauf un nouveau RPC SUPER_ADMIN).
- [ ] Clôture annuelle (carry-forward 3300→3200) non encore implémentée — documenter le gap si scope change.

---

## Sources de vérité

```
ADR (lire en premier pour contexte fiscal)
  docs/adr/003-pkp-status-non-pkp.md            # NON-PKP rationale + conséquences

Migrations S26 (bloc chronologique)
  supabase/migrations/20260603000010..026_*.sql  # S26 DB hardening 17 migrations
  supabase/migrations/20260523135820_*.sql       # S26b update_account_active_v1

Tests pgTAP
  supabase/tests/s26_db_hardening.test.sql       # 15 tests T1-T15

CLAUDE.md §S26/S26b                              # session references + workplan
```

---

## Verification before claiming a fix is complete

```bash
# Type-check (cheap, run first)
pnpm typecheck

# BO accounting smoke (6 fichiers, ~12 tests)
pnpm --filter @breakery/app-backoffice test accounting

# pgTAP DB via MCP execute_sql (BEGIN/ROLLBACK envelope)
# Fichier : supabase/tests/s26_db_hardening.test.sql
# Attendu : 15/15 PASS

# Si RPC modifiée → types regen OBLIGATOIRE :
# mcp__claude_ai_Supabase__generate_typescript_types
# → packages/supabase/src/types.generated.ts
```

> Baseline pré-existante : ~24 BO échecs env-gated (`VITE_SUPABASE_URL Required`) sur master — pas une régression, voir DEV-S25-2.A-02.

---

## When to escalate

- **Toucher le taux PB1** (`business_config.tax_rate`) → impact sur toutes les JE futures et les rapports `calculate_pb1_payable_v1` — flag, décision business owner.
- **Réactiver le compte 1151** → violation ADR-003, nécessite ADR-005 + plan de migration PKP complet.
- **Verrouiller (`locked`) une période fiscale** → irréversible sans RPC SUPER_ADMIN dédié (pas encore implémenté). Confirmer avec owner.
- **Ajouter un nouveau mapping key** qui route vers 1151 → bloqué par `is_active=false` dans `resolve_mapping_account`, mais la migration elle-même ne serait pas refusée — double-check explicitement.
- **Bump majeur d'une RPC cockpit** (`_vN+1`) → drop `_vN` dans la même migration (RPC versioning monotone CLAUDE.md), + REVOKE pair + types regen + pgTAP.
