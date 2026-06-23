# Cash Wallets / Trésorerie — 3-Wallet Cash Tracking in Accounting

Date: 2026-06-23
Status: approved (design validated by owner via brainstorming Q&A)
Branch: `feat/cash-wallets-tresorerie` (proposed)

## Problem

The Breakery currently tracks daily cash flow in an Excel workbook
(`docs/Design/Daily Cash June 2026.xlsx`) with three running-balance ledgers
(In / Out / Saldo) and a hidden reconciliation sheet:

1. **Undeposited Funds** — the *main wallet* (safe). Counted cash from each POS
   shift lands here ("Shift 1", "Shift 2"). Outflows: bank deposits, transfers to
   Petty Cash, Boss withdrawals, loans repaid to Small Money.
2. **Petty Cash** — the *daily small-expense wallet*. Replenished by "from Undepo"
   transfers; spent on small daily purchases (vegetables, ice, electricity tokens…).
3. **Small Money** — the *change float* (petite coupure). Fixed value (4 000 000 IDR),
   only deviates when cash is **borrowed** for a purchase and later **repaid**.

The app today has **no equivalent**. The cash-register/shift module explicitly
defers this: per `docs/reference/04-modules/12-cash-register-shift.md:421`,
"toute écriture comptable de fin de journée (gestion du fond de caisse, dépôt en
banque) est gérée séparément côté Accounting." That separate handling does not
exist yet — this spec fills the gap.

### Current accounting reality (verified against migrations)

- **All cash lives on one account, `1110 Cash on Hand`.**
  - `SALE_PAYMENT_CASH → 1110` (`20260517000001_init_accounting_mappings.sql:40`):
    every cash sale posts `DR 1110` in real time, per order.
  - `EXPENSE_CASH_OUT → 1110` (`20260517000120_init_expenses.sql:25`): every
    cash/transfer/card expense posts `CR 1110` at approval.
  - `PURCHASE_CASH_OUT → 1110`.
- **`1111 Petty Cash` exists in the COA but is never used** (`20260517000005_seed_full_coa_sak_emkm.sql:23`).
- **Cash expenses also reduce the open shift drawer** via trigger
  `sync_cash_expense_to_session` (`20260524122632`): a paid cash expense adds to
  `pos_sessions.cash_out_total`, lowering `expected_cash` at close. This was a
  workaround for the absence of a Petty Cash wallet.
- Equity has only `3100 Owner Capital`; no drawings account for Boss withdrawals.

## Owner-confirmed decisions (brainstorming Q&A)

1. **Integration depth: hybrid (auto + manual).** Wallets are real ledgers.
   Undeposited auto-accumulates from cash sales; Petty Cash auto-drains from cash
   expenses; manual entries cover transfers, deposits, withdrawals, and the Small
   Money borrow/repay. No double data-entry.
2. **Accounting coupling: every movement posts a balanced JE.** The three wallets
   are three GL accounts; each movement is double-entry into the General Ledger.
3. **Ledger storage: GL is the single source of truth.** No parallel movements
   table. A wallet's ledger = the General Ledger filtered to its account
   (Debit = In, Credit = Out, running balance = Saldo). Manual movements post a JE
   via a new RPC; auto-fed movements are the *existing* JE — zero double-posting.
4. **Petty Cash becomes the source of cash expenses.** Remap `EXPENSE_CASH_OUT`
   from `1110` to `1111`. Cash expenses now credit Petty Cash, as in the Excel.
5. **Drop the shift-drawer expense trigger.** With Petty Cash as the expense
   source, daily cash expenses leave the *safe* (Petty Cash), not the active POS
   till. Shift reconciliation becomes `expected_cash = opening_cash + cash_sales −
   cash_refunds` (no expense deduction).

## Design

### 1. Chart-of-accounts additions (1 migration)

| Code | Name | Class | Type | Balance | Purpose |
|------|------|-------|------|---------|---------|
| `1117` | Small Money (Change Float) | 1 asset | asset | debit | The petite-coupure float wallet |
| `3110` | Owner's Drawing | 3 equity | equity | debit | Contra-equity for Boss cash withdrawals |

Both `is_postable=true`, `is_system=true`, `is_active=true`, idempotent
`ON CONFLICT (code) DO NOTHING`. New mapping keys:

- `CASH_WALLET_UNDEPOSITED → 1110`
- `CASH_WALLET_PETTY → 1111`
- `CASH_WALLET_SMALL_MONEY → 1117`
- `CASH_BANK_OPERATING → 1112`
- `OWNER_DRAWING → 3110`

### 2. Remap cash expenses to Petty Cash (1 migration)

- `UPDATE accounting_mappings SET account_code='1111' WHERE mapping_key='EXPENSE_CASH_OUT'`.
  (No RPC signature change — `pay_expense_v1` / `approve_expense` resolve the
  mapping at runtime.)
- `DROP TRIGGER trg_expenses_sync_cash ON expenses;` and drop
  `sync_cash_expense_to_session()`. Historical `cash_out_total` rows are left
  intact (no backfill of closed sessions).
- **No retroactive re-posting** of past expense JE (they stay on 1110). The remap
  is forward-only; the Undeposited opening balance for the first managed month is
  set by an opening adjustment (see §5).

### 3. New RPC `record_cash_movement_v1` (1 migration)

Single SECURITY DEFINER RPC posting one balanced 2-line JE between two cash /
bank / equity accounts. Monotonic versioning; if a future signature change is
needed, create `_v2` and `DROP FUNCTION ... _v1(<args>)` in the same migration.

```
record_cash_movement_v1(
  p_movement_type   text,        -- enum: see table
  p_amount          numeric,     -- > 0
  p_movement_date   date,        -- backdatable, fiscal-guard applies
  p_remark          text,
  p_idempotency_key uuid         -- replay-safe (dedicated cash_movement_idempotency_keys)
) RETURNS uuid                    -- journal_entry_id
```

| `p_movement_type` | DR | CR | Notes |
|---|---|---|---|
| `undepo_to_petty` | 1111 | 1110 | Replenish Petty Cash from the safe |
| `bank_deposit` | 1112 | 1110 | Deposit safe cash to bank |
| `boss_withdrawal` | 3110 | 1110 | Boss takes cash |
| `small_money_lend` | 1110 | 1117 | Small Money lends to Undepo for a purchase |
| `small_money_repay` | 1117 | 1110 | Repay Small Money |
| `petty_to_undepo` | 1110 | 1111 | Return excess Petty Cash to safe |
| `adjustment_gain` | 1110/1111/1117 | 4910 | Count overage (gated, reason required) |
| `adjustment_loss` | 5910 | 1110/1111/1117 | Count shortage (gated, reason required) |

Behaviour & guards:
- Account codes resolved via `resolve_mapping_account` / the new mapping keys —
  never hard-coded UUIDs.
- Reuses the existing balanced-JE insertion path (`journal_entries` +
  `journal_entry_lines`, `next_journal_entry_number(p_movement_date)`), same shape
  as `approve_expense` / `create_sale_journal_entry`.
- Respects the fiscal-period close guard (rejects movements in a closed period).
- `p_amount > 0` check; `p_movement_type` validated against the enum.
- Idempotency: dedicated `cash_movement_idempotency_keys (key uuid PK, je_id uuid,
  created_at)`; replay returns the existing `je_id` (PK `unique_violation` catch +
  re-read), per the project's RPC idempotency pattern.
- `REVOKE EXECUTE ... FROM PUBLIC` **and** `FROM anon`; grant to `authenticated`
  only; `ALTER DEFAULT PRIVILEGES` already covers future-proofing. Permission gate
  enforced server-side (manager/accounting role) in addition to the UI gate.
- `adjustment_*` types require a non-empty `p_remark` (reason) and a stricter role.

### 4. Wallet ledger projection (read side)

A SQL function/view `cash_wallet_ledger(p_account_code, p_from, p_to)` returning
ordered rows `{ date, remark, in, out, saldo }`:
- Source = `journal_entry_lines` joined to `journal_entries` for the wallet's
  account, within `[p_from, p_to]`.
- `in = debit`, `out = credit`, `saldo` = running balance (opening + Σ).
- **Opening balance / carry-forward**: `saldo` seeds from the account balance as of
  `p_from − 1 day` (so each month opens on the prior close, like "Ending Cash May").
- **Cash-sale aggregation (Undeposited only)**: JE lines whose source is a cash
  sale are grouped by `pos_session` into one row per shift ("Shift 1 — 2 923 000")
  instead of one row per order, keeping the ledger readable like the Excel.
  Implementation: tag sale JE with the session id (already linkable via the order →
  session relation) and `GROUP BY` in the projection; all other lines pass through 1:1.

Frontend hooks (TanStack Query, mirror `useGeneralLedger`):
`useCashWallets()` (3 balances), `useCashWalletLedger(account, range)`,
`useRecordCashMovement()` (calls the RPC with a `useRef` idempotency key).

### 5. Opening balances (one-time)

A seed/manual step records the May-end closing balances of each wallet as opening
`adjustment_*`-style JE (or a dedicated `cash_opening_balance` mapping against
`3100 Owner Capital`) so the first managed month opens on the Excel's
"Ending Cash May 2026" figures. Captured as data, not a schema concern; the exact
opening figures are owner-provided at rollout.

### 6. UI — `apps/backoffice/src/features/accounting` → page `/accounting/cash`

`CashTreasuryPage` (new route under the Accounting group, behind `PermissionGate`):

- **3 wallet cards** — name, live balance, tiny trend; Small Money card shows
  "fixed 4 000 000" + a badge when currently lent-out (balance ≠ float).
- **Expandable ledger** per card — In/Out/Saldo table, period filter, reuses the
  stock-card/GL ledger layout conventions; CSV via `buildCsv` + `ExportButtons`,
  PDF via the `generate-pdf` EF (new `cash-wallet-ledger` template).
- **"New movement" modal** — typed picker (the §3 movement types), amount, date
  (backdatable), remark; calls `useRecordCashMovement`. Adjustment types reveal a
  required reason field and are gated to the stricter role.
- **Reconciliation panel** — "counted (physical) vs GL balance" per wallet, with
  a one-click `adjustment_gain/loss` to book the difference.
- **Analysis section** — replicates the Excel *Private Analysis* sheet: revenue by
  shift, top Petty Cash spend categories, cross-transfer consistency
  (Undepo→Petty out vs in), deposits & Boss withdrawals totals.

Files (all new, co-located under `features/accounting`):
`pages/CashTreasuryPage.tsx`, `components/WalletCard.tsx`,
`components/WalletLedgerTable.tsx`, `components/RecordCashMovementModal.tsx`,
`components/CashReconciliationPanel.tsx`, `components/CashAnalysisPanel.tsx`,
`hooks/useCashWallets.ts`, `hooks/useCashWalletLedger.ts`,
`hooks/useRecordCashMovement.ts`; route wired in `routes/index.tsx`; nav entry in
the accounting group; `exportCashWalletCsv.ts` helper. Keep every file < 500 lines.

### 7. Permissions

- New permission (or reuse the accounting/manager gate already used by manual JE).
  `record_cash_movement_v1` gated server-side; UI wrapped in `PermissionGate`.
  `adjustment_*` and `boss_withdrawal` require the stricter manager role.

## Testing

- **pgTAP** (`supabase/tests/cash_wallets.test.sql`, run via MCP `execute_sql` in a
  `BEGIN … ROLLBACK` envelope): each movement type posts a balanced JE to the right
  accounts; idempotency replay returns the same JE; fiscal-guard rejects closed
  periods; anon/PUBLIC EXECUTE revoked; `p_amount<=0` and bad `p_movement_type`
  rejected; ledger projection running balance & carry-forward correct; Undeposited
  shift aggregation collapses multiple sale lines into one row per session.
- **Vitest live RPC** (`supabase/tests/functions/cash-wallets-*.test.ts`): RPC happy
  paths + replay + permission denial.
- **BO smoke/unit** (co-located `__tests__/`): wallet cards render balances; modal
  validates amount/reason; reconciliation books the diff; CSV export shape.
- **Regression**: confirm shift reconciliation no longer deducts cash expenses
  after the trigger drop (update `cash-register-close` expectations);
  `expected_cash = opening + cash_sales − cash_refunds`.
- After every schema change: regen types via MCP `generate_typescript_types` →
  `packages/supabase/src/types.generated.ts` → commit.

## Out of scope (YAGNI)

- Per-expense "pay from" source picker (rejected in favour of the flat
  Petty-Cash-as-source remap).
- Retroactive re-posting of historical expense JE from 1110 to 1111.
- Multi-currency, multi-location wallets, automated bank-statement reconciliation.
- Backfilling closed `pos_sessions.cash_out_total` after the trigger drop.

## Open items for the plan

- Exact opening-balance figures and the opening-JE mechanism (§5) — owner-provided.
- The precise sale-JE → session linkage used for Undeposited shift aggregation (§4):
  confirm the column/relation that ties a sale's journal entry to its `pos_session`
  before relying on `GROUP BY`.
- Whether to introduce a dedicated `cash:manage` permission or reuse the existing
  accounting/manager gate.
