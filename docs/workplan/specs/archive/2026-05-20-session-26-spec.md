# Session 26 — Comptable Cockpit (NON-PKP)

> **Date** : 2026-05-20
> **Branche** : `swarm/session-26`
> **Base** : `master` @ `e595a40` (post-audit intégral V3 + post-S27+S27b)
> **Effort** : **9-10 j·h** (5 Waves)
> **Migration block** : `20260603000010..099`

---

## 1. Objectifs

Débloquer **l'audit comptable externe** et **l'usage quotidien du comptable indonésien** sur The Breakery. Combine :

1. **Plan S26 d'origine** (2026-05-19 dans `2026-05-19-S24-to-S30-plan.md` §S26) — 5 pages BO cockpit
2. **Fixes audit V3** (2026-05-20) — 5 findings Critiques/Élevés comptables
3. **ADR-003 NON-PKP** (2026-05-20) — refactor PPN supplier capitalisation + renommage VAT→PB1

---

## 2. Scope (Waves)

### Wave 1 — DB hardening accounting non-PKP (~2j, sequential)

| Phase | Item | Effort | Source |
|---|---|---|---|
| 1.A | ADR-003 NON-PKP formalisé + branche + spec | 1h | Audit F-S26-AC-08 + ratif owner 2026-05-20 |
| 1.B | F-S26-AC-01 PB1 dynamic — `current_pb1_rate()` helper + refactor `create_sale_journal_entry` trigger | 3h | Audit V3 critique |
| 1.C | F-S26-AC-09 (new) — fold PPN supplier dans `INVENTORY_GENERAL`, retire `DR PURCHASE_VAT_INPUT` | 3h | ADR-003 |
| 1.D | F-S26-AC-10 (new) — bump `calculate_pb1_payable_v1` + DROP `calculate_vat_payable` | 1h | ADR-003 |
| 1.E | F-S26-AC-02 split sale JE par `order_payments.method` (1110/1115/1116/1112) | 2h | Audit V3 high |
| 1.F | F-S26-AC-03 `record_cash_movement_v1` émet JE + 2 mapping keys | 3h | Audit V3 high |
| 1.G | F-S26-AC-04 dedupe `sale_void`+`sale_refund` dans BS/P&L (option a) | 2h | Audit V3 critique |
| 1.H | Seed 3200 Retained Earnings + reclasser 5910 → class 6 + désactive 1151 | 1h | Audit V3 med + ADR-003 |
| 1.I | 4 RPCs cockpit : `close_fiscal_period_v1`, `get_general_ledger_v1`, `get_trial_balance_v1`, `create_manual_je_v1` | 4h | Plan S26 |
| 1.J | pgTAP suite intégrée Wave 1 (20+ asserts) | 2h | Quality gate |

**Total Wave 1** : ~22h (~2.5j wall-time)

### Wave 2 — UI cockpit core (~3-4j, parallel-friendly)

| Page | Route | Consume | Effort |
|---|---|---|---|
| ChartOfAccounts | `/accounting/chart-of-accounts` | direct SELECT accounts (read-only viewer + activate/deactivate via admin RPC) | 0.5j |
| JournalEntries | `/accounting/journal-entries` | direct SELECT je + create_manual_je_v1 modal (PIN gate) | 1j |
| GeneralLedger | `/accounting/general-ledger` | get_general_ledger_v1 (drilldown account + paginate) | 0.75j |
| TrialBalance | `/accounting/trial-balance` | get_trial_balance_v1 + CSV export | 0.5j |
| FiscalPeriodModal | embeddé Settings | close_fiscal_period_v1 PIN gate | 0.5j |

**Total Wave 2** : ~3.25j wall-time

### Wave 3 — UI cockpit extended (~2.5j) — scope réduit grâce NON-PKP

| Page | Route | Consume | Effort |
|---|---|---|---|
| PB1ManagementPage *(renommée VAT→PB1)* | `/accounting/pb1-management` | calculate_pb1_payable_v1 + history mensuel | 0.5j |
| ARAging | `/accounting/ar-aging` | view_ar_aging (S24) + CSV/PDF | 0.5j |
| BankReconciliation + ReconciliationDetail | `/accounting/bank-reconciliation` | TBD (probable nouvelle RPC `get_bank_reconciliation_v1`) | 1j |
| CALK | `/accounting/calk` | composite RPCs P&L+BS+CashFlow + notes statiques | 0.5j |

**Total Wave 3** : ~2.5j wall-time

### Wave 4 — Tests intégrés (~1j)

- pgTAP Wave 1 déjà en 1.J
- pgTAP additionnel : cockpit RPCs end-to-end (4 RPCs × 5 cas chacune ≈ 20 asserts)
- BO smoke tests : 9 pages × 2 cas chacune ≈ 18 cas vitest
- typecheck + lint sweep

### Wave 5 — Docs + ADR-003 + INDEX + CLAUDE.md (~0.5j)

- INDEX `docs/workplan/plans/2026-05-20-session-26-INDEX.md`
- Rebase `docs/reference/04-modules/10-accounting-double-entry.md` Partie II (chemins V3 réels)
- CLAUDE.md closeout (current session bumped à S26, migration sequence)
- PR description avec recap des 5 findings audit cleared

---

## 3. RPCs nouvelles (Wave 1)

| RPC | Signature | Gate | Doc |
|---|---|---|---|
| `current_pb1_rate()` | `RETURNS NUMERIC IMMUTABLE` | none (helper) | Lit `business_config.tax_rate` |
| `calculate_pb1_payable_v1(p_start DATE, p_end DATE)` | `RETURNS JSONB` | `reports.financial.read` | Remplace `calculate_vat_payable` |
| `record_cash_movement_v1` | (existant) bumped pour émettre JE | `cash.movements.create` | 3 reasons : apport_owner, bank_transfer, replenishment |
| `close_fiscal_period_v1(p_period_id UUID, p_manager_pin TEXT)` | `RETURNS JSONB` | `accounting.period.close` (à seeder) | PIN gate + lock backdating |
| `get_general_ledger_v1(p_account_id UUID, p_start DATE, p_end DATE, p_cursor JSONB)` | `RETURNS JSONB` | `accounting.gl.read` | Cursor-based paginate |
| `get_trial_balance_v1(p_start DATE, p_end DATE)` | `RETURNS TABLE(...)` | `reports.financial.read` | Tous comptes avec sum dr/cr |
| `create_manual_je_v1(p_description TEXT, p_lines JSONB, p_manager_pin TEXT)` | `RETURNS JSONB` | `accounting.je.create_manual` (à seeder) | Balanced double-entry + PIN |

**Permissions à seeder** :
- `accounting.period.close` (MANAGER+ADMIN+SUPER_ADMIN)
- `accounting.je.create_manual` (MANAGER+ADMIN+SUPER_ADMIN)
- `accounting.gl.read` (MANAGER+ADMIN+SUPER_ADMIN)

---

## 4. Mapping keys ajoutées

| Mapping key | Account code | Description |
|---|---|---|
| `CASH_MOVEMENT_OWNER_CAPITAL_IN` | `3100` | Apport propriétaire en caisse → CR Owner Capital |
| `CASH_MOVEMENT_BANK_TRANSFER` | `1112` | Cash → Bank transfer ou inverse |

---

## 5. Migrations (block `20260603000010..099`)

| Mig | Phase | Description |
|---|---|---|
| `_010` | 1.B | `create_current_pb1_rate_helper.sql` |
| `_011` | 1.B | `bump_create_sale_journal_entry_use_current_pb1_rate.sql` |
| `_012` | 1.C | `bump_create_purchase_journal_entry_fold_vat_into_inventory.sql` |
| `_013` | 1.D | `create_calculate_pb1_payable_v1_drop_calculate_vat_payable.sql` |
| `_014` | 1.E | `bump_create_sale_journal_entry_split_by_payment_method.sql` |
| `_015` | 1.F | `bump_record_cash_movement_v1_emit_je.sql` |
| `_016` | 1.F | `seed_cash_movement_mapping_keys.sql` |
| `_017` | 1.G | `bump_get_profit_loss_v1_dedupe_void_refund.sql` |
| `_018` | 1.G | `bump_get_balance_sheet_v1_dedupe_void_refund.sql` |
| `_019` | 1.H | `seed_account_3200_retained_earnings.sql` |
| `_020` | 1.H | `reclassify_account_5910_to_expense_class.sql` |
| `_021` | 1.H | `deactivate_account_1151_non_pkp.sql` |
| `_022` | 1.I | `create_close_fiscal_period_v1_rpc.sql` |
| `_023` | 1.I | `create_get_general_ledger_v1_rpc.sql` |
| `_024` | 1.I | `create_get_trial_balance_v1_rpc.sql` |
| `_025` | 1.I | `create_create_manual_je_v1_rpc.sql` |
| `_026` | 1.I | `seed_accounting_cockpit_permissions.sql` |
| `_027..099` | reserve | correctives pgTAP-driven |

Numbering monotonic — check `supabase/migrations/` avant ajout.

---

## 6. Risques

| ID | Risque | Mitigation |
|---|---|---|
| R1 | Refactor `create_purchase_journal_entry` casse les flows S22-S23 landed cost | Pré-test pgTAP avant refactor : insert goods_receipt + assert WAC inchangé après cost ajout PPN. Si seed V3 dev a JE historiques avec 1151, audit option B (no replay) → laisser tel quel mais désactiver compte. |
| R2 | `create_manual_je_v1` permet trous SAK EMKM (compte sans `account_class`, JE sans `entry_date`) | Validation stricte côté RPC : tous lines requièrent `account_id` valide, balanced check `SUM(debit) = SUM(credit)`, audit_logs row systématique. |
| R3 | `close_fiscal_period_v1` lock backdating peut casser un import historique en cours | Migration `_022` ajoute aussi un flag `business_config.allow_backdating_until DATE` (default NULL = strict) pour mode admin override audit-logged. |
| R4 | Bank reconciliation TBD : pas de RPC existante, scope mal délimité | Wave 3 BankReconciliation peut glisser en S27c si trop large. Acceptable — la priorité audit est cockpit + PB1, pas la rec bancaire. |
| R5 | Renommage `VATManagementPage` → `PB1ManagementPage` casse les imports BO + routes Storybook | Sweep grep + rename atomique dans le même commit Wave 3. |

---

## 7. Deviations attendues

| ID | Description | Statut |
|---|---|---|
| DEV-S26-1.A-01 | Création dossier `docs/adr/` (n'existait pas) — ADR-001 + ADR-002 absents physiquement, on commence par ADR-003 (référencé dans plan S24-S30). Backlog : créer ADR-001 (mono-site permanent — déjà ratifié), ADR-002 (Mobile NO-GO — recommandé audit), ADR-004 (WONTFIX V3) ultérieurement. | Informational |

---

## 8. Quality gates

- pgTAP suite Wave 1.J : **20+ asserts PASS** via MCP `execute_sql` BEGIN/ROLLBACK envelope
- BO smoke Wave 4 : **18 cas PASS** via `pnpm --filter @breakery/backoffice test accounting`
- `pnpm typecheck` : **6/6 PASS**
- `pnpm build` : PASS
- Aucune `as never` ou `as any` introduite (audit V3 H1/H2 follow-up)

---

## 9. Tests attendus

### pgTAP — `supabase/tests/s26_db_hardening.test.sql`

```
T1   current_pb1_rate() returns business_config.tax_rate
T2   create_sale_journal_entry uses current_pb1_rate() (flip 0.10→0.11, assert JE balanced + PB1 amount correct)
T3   create_purchase_journal_entry folds vat_amount into INVENTORY_GENERAL (1130)
T4   create_purchase_journal_entry does NOT credit PURCHASE_VAT_INPUT (1151)
T5   calculate_pb1_payable_v1 returns pb1_payable = pb1_output (no vat_input subtract)
T6   calculate_vat_payable (old) raises function_does_not_exist
T7   create_sale_journal_entry splits cash + qris into 2 DR (1110 + 1115)
T8   record_cash_movement_v1 reason='apport_owner' emits JE DR 1110 / CR 3100
T9   record_cash_movement_v1 reason='bank_transfer' emits JE DR 1112 / CR 1110
T10  record_cash_movement_v1 reason='replenishment' emits no JE (internal cash rotation)
T11  get_profit_loss_v1 dedupes sale_void when sale_refund exists for same reference_id
T12  get_balance_sheet_v1 dedupes sale_void + sale_refund
T13  account 3200 Retained Earnings exists with account_class='equity'
T14  account 5910 reclassified to account_class='expense'
T15  account 1151 has is_active=false
T16  close_fiscal_period_v1 happy path locks period + audit_logs row
T17  close_fiscal_period_v1 CASHIER raises permission_denied
T18  get_general_ledger_v1 returns lines for account + period
T19  get_trial_balance_v1 returns rows with sum debit/credit per account
T20  create_manual_je_v1 happy path inserts JE + lines balanced
T21  create_manual_je_v1 unbalanced lines raises je_unbalanced
T22  create_manual_je_v1 wrong PIN raises invalid_pin
```

### BO smoke — `apps/backoffice/src/features/accounting/__tests__/*.smoke.test.tsx`

```
chart-of-accounts.smoke.test.tsx       : renders + toggles active
journal-entries.smoke.test.tsx         : renders + opens create modal
general-ledger.smoke.test.tsx          : drilldown account loads + paginate
trial-balance.smoke.test.tsx           : CSV export header + 5 rows
fiscal-period-modal.smoke.test.tsx     : close period PIN required
pb1-management.smoke.test.tsx          : renders + period selector
ar-aging.smoke.test.tsx                : renders + buckets visible
bank-reconciliation.smoke.test.tsx     : renders + reconcile button
calk.smoke.test.tsx                    : renders SAK EMKM sections
```

---

## 10. Closes (TASK + gaps)

- **TASK-10-011** UI partie (visualisation cockpit) — DONE
- **TASK-10-016** month-close foundation — PARTIAL (FiscalPeriodModal livré, mais pas le batch close global)
- **Audit gaps cleared** : F-S26-AC-01, F-S26-AC-02, F-S26-AC-03, F-S26-AC-04, F-S26-AC-08, F-S26-AC-09 *(new)*, F-S26-AC-10 *(new)*, F-S26-AC-11 *(new)*
- **ADR-003** : ratifié et committé

---

## 11. Hors scope (déferré S27/post-prod)

- **e-Faktur**, **e-Bupot**, export DJP XML PPN — exclus définitivement par ADR-003 (NON-PKP)
- **Bank reconciliation full MVP** (juste viewer + reconcile button en S26, pas l'algo de matching)
- **VAT Output workflow** PPN 11% — exclu par ADR-003
- **Multi-currency** journal entries — hors scope V3 (mémoire `mono-currency-idr`)
- **Consolidation multi-entité** — hors scope (mono-site permanent)
