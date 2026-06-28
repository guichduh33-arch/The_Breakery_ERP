# Cash Wallets / Trésorerie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track cash across three wallets (Undeposited Funds, Petty Cash, Small Money) as three GL accounts, with every movement posting a balanced journal entry and a `/accounting/cash` treasury page replacing the Excel "Daily Cash" workbook.

**Architecture:** The three wallets are GL accounts (`1110` Undeposited, `1111` Petty Cash, new `1117` Small Money). The General Ledger is the single source of truth — a wallet's ledger is its account's GL lines (Debit=In, Credit=Out, running balance=Saldo). Auto-feed = existing JE (cash sales already DR 1110; cash expenses remapped to CR 1111). Manual movements (transfers/deposits/withdrawals/borrow-repay) post a balanced JE via one new RPC `record_cash_movement_v1`. A dedicated read RPC projects each wallet ledger and aggregates cash sales per shift for the Undeposited view.

**Tech Stack:** Supabase Postgres (migrations + plpgsql RPC via MCP `apply_migration`/`execute_sql`), pgTAP tests, React + TypeScript + TanStack Query (backoffice), `@breakery/ui` primitives, Vitest + Testing Library.

## Global Constraints

- **DB target is Supabase cloud V3 dev `ikcyvlovptebroadgtvd`** — apply migrations via MCP `apply_migration`, run pgTAP via MCP `execute_sql` in a `BEGIN … ROLLBACK` envelope. Never `pnpm db:reset` / `supabase start` (Docker retired).
- **Migration file names monotonic** — current highest NAME-block is `20260706000016`. Use `20260706000017+`.
- **RPC versioning monotonic** — new RPC is `record_cash_movement_v1`; never edit a published `_vN` signature.
- **Anon defense-in-depth** — every new RPC: `REVOKE EXECUTE … FROM PUBLIC` **and** `FROM anon`, `GRANT … TO authenticated`. Every new table: `REVOKE ALL … FROM PUBLIC, anon`, writes only via SECURITY DEFINER RPC.
- **Account codes via `resolve_mapping_account(key)`** — never hard-code account UUIDs/codes in RPC bodies.
- **Fiscal guard** — any RPC posting a JE calls `check_fiscal_period_open(p_date)` (RAISEs `period_locked` P0004 on closed/locked).
- **Idempotency** — money-mutating RPC takes `p_idempotency_key UUID`, backed by a dedicated keys table; replay returns the first JE id.
- **Regen types after every schema change** — MCP `generate_typescript_types` → write `packages/supabase/src/types.generated.ts` → commit. Missing regen is the #1 CI breaker.
- **Files < 500 lines.** Conventional commits, co-author Claude. Branch: `feat/cash-wallets-tresorerie` (already created, spec committed).
- **JE shape** (verified): `journal_entries(entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by)` + `journal_entry_lines(journal_entry_id, account_id, debit, credit, description)`. Entry number via `next_journal_entry_number(p_date DATE) → TEXT`. Status literal `'posted'`.

---

### Task 1: COA accounts, mapping keys, and permissions

Adds the Small Money + Owner's Drawing accounts, the cash-wallet mapping keys, and the two new permissions. Pure additive seed — idempotent.

**Files:**
- Create: `supabase/migrations/20260706000017_cash_wallets_coa_mappings_perms.sql`
- Test: `supabase/tests/cash_wallets.test.sql` (created here, extended in later tasks)

**Interfaces:**
- Produces (mapping keys, resolvable via `resolve_mapping_account`): `CASH_WALLET_UNDEPOSITED`→1110, `CASH_WALLET_PETTY`→1111, `CASH_WALLET_SMALL_MONEY`→1117, `CASH_BANK_OPERATING`→1112, `OWNER_DRAWING`→3110.
- Produces (accounts): `1117` Small Money (Change Float), `3110` Owner's Drawing.
- Produces (permissions): `accounting.cash.read`, `accounting.cash.write`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/cash_wallets.test.sql`:

```sql
BEGIN;
SELECT plan(7);

-- Accounts exist and are postable
SELECT ok( (SELECT is_postable FROM accounts WHERE code='1117'), '1117 Small Money is postable');
SELECT is( (SELECT account_type FROM accounts WHERE code='1117'), 'asset', '1117 is an asset');
SELECT is( (SELECT balance_type FROM accounts WHERE code='3110'), 'debit', '3110 Owner Drawing is debit-balance');

-- Mapping keys resolve
SELECT is( (SELECT code FROM accounts WHERE id = resolve_mapping_account('CASH_WALLET_SMALL_MONEY')), '1117', 'small-money mapping → 1117');
SELECT is( (SELECT code FROM accounts WHERE id = resolve_mapping_account('OWNER_DRAWING')), '3110', 'owner-drawing mapping → 3110');

-- Permissions seeded
SELECT ok( EXISTS(SELECT 1 FROM permissions WHERE code='accounting.cash.write'), 'cash.write permission exists');
SELECT ok( EXISTS(SELECT 1 FROM role_permissions WHERE role_code='MANAGER' AND permission_code='accounting.cash.write'), 'MANAGER has cash.write');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run via MCP `execute_sql` (project `ikcyvlovptebroadgtvd`) pasting the file contents.
Expected: failures — accounts `1117`/`3110` missing, mappings unknown, permission absent.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260706000017_cash_wallets_coa_mappings_perms.sql`:

```sql
-- 20260706000017 — Cash Wallets module : COA accounts + mapping keys + permissions.
-- 3-wallet treasury (Undeposited 1110 / Petty 1111 / Small Money 1117).

-- (a) New accounts (idempotent)
INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_system, is_active) VALUES
  ('1117', 'Small Money (Change Float)', 1, 'asset',  'debit', true, true, true),
  ('3110', 'Owner''s Drawing',           3, 'equity', 'debit', true, true, true)
ON CONFLICT (code) DO NOTHING;

-- (b) Mapping keys (idempotent)
INSERT INTO accounting_mappings (mapping_key, account_code, description, is_active) VALUES
  ('CASH_WALLET_UNDEPOSITED', '1110', 'Cash wallet: Undeposited Funds (main safe)', true),
  ('CASH_WALLET_PETTY',       '1111', 'Cash wallet: Petty Cash (daily expenses)',   true),
  ('CASH_WALLET_SMALL_MONEY', '1117', 'Cash wallet: Small Money (change float)',     true),
  ('CASH_BANK_OPERATING',     '1112', 'Cash wallet: bank deposit target',            true),
  ('OWNER_DRAWING',           '3110', 'Cash wallet: Boss withdrawal (owner drawing)', true)
ON CONFLICT (mapping_key) DO NOTHING;

-- (c) Permissions (idempotent)
INSERT INTO permissions (code, module, action, description) VALUES
  ('accounting.cash.read',  'accounting', 'cash.read',  'Read the cash treasury wallets and ledgers'),
  ('accounting.cash.write', 'accounting', 'cash.write', 'Record a cash wallet movement (posts a JE)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',     'accounting.cash.read'),
  ('ADMIN',       'accounting.cash.read'),
  ('SUPER_ADMIN', 'accounting.cash.read'),
  ('MANAGER',     'accounting.cash.write'),
  ('ADMIN',       'accounting.cash.write'),
  ('SUPER_ADMIN', 'accounting.cash.write')
ON CONFLICT DO NOTHING;
```

Apply via MCP `apply_migration` (name `cash_wallets_coa_mappings_perms`, body = the SQL above).

- [ ] **Step 4: Run the test to verify it passes**

Re-run the pgTAP file via MCP `execute_sql`.
Expected: `ok 1..7`, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260706000017_cash_wallets_coa_mappings_perms.sql supabase/tests/cash_wallets.test.sql
git commit -m "feat(accounting): cash-wallet COA accounts, mappings, permissions"
```

---

### Task 2: `record_cash_movement_v1` RPC + idempotency table

The single write path. Posts one balanced 2-line JE between two cash/bank/equity accounts based on the movement type.

**Files:**
- Create: `supabase/migrations/20260706000018_create_record_cash_movement_v1.sql`
- Modify: `supabase/tests/cash_wallets.test.sql` (append cases)

**Interfaces:**
- Consumes: `resolve_mapping_account(text)`, `check_fiscal_period_open(date)`, `next_journal_entry_number(date)`, `has_permission(uuid, text)`.
- Produces: `record_cash_movement_v1(p_movement_type text, p_amount numeric, p_movement_date date, p_remark text, p_idempotency_key uuid, p_wallet_code text DEFAULT NULL) RETURNS uuid` (the `journal_entry_id`). Table `cash_movement_idempotency_keys(idempotency_key uuid PK, je_id uuid, created_at timestamptz)`.

Movement-type → (DR mapping, CR mapping):

| `p_movement_type` | DR | CR | `p_wallet_code` |
|---|---|---|---|
| `undepo_to_petty` | `CASH_WALLET_PETTY` | `CASH_WALLET_UNDEPOSITED` | ignored |
| `petty_to_undepo` | `CASH_WALLET_UNDEPOSITED` | `CASH_WALLET_PETTY` | ignored |
| `bank_deposit` | `CASH_BANK_OPERATING` | `CASH_WALLET_UNDEPOSITED` | ignored |
| `boss_withdrawal` | `OWNER_DRAWING` | `CASH_WALLET_UNDEPOSITED` | ignored |
| `small_money_lend` | `CASH_WALLET_UNDEPOSITED` | `CASH_WALLET_SMALL_MONEY` | ignored |
| `small_money_repay` | `CASH_WALLET_SMALL_MONEY` | `CASH_WALLET_UNDEPOSITED` | ignored |
| `adjustment_gain` | wallet (`p_wallet_code`) | `SHIFT_CASH_VARIANCE_INCOME` | required: `1110`/`1111`/`1117` |
| `adjustment_loss` | `SHIFT_CASH_VARIANCE_EXPENSE` | wallet (`p_wallet_code`) | required: `1110`/`1111`/`1117` |

- [ ] **Step 1: Write the failing pgTAP test (append to `cash_wallets.test.sql`)**

Replace the `SELECT plan(7);` line with `SELECT plan(14);` and append before `SELECT * FROM finish();`:

```sql
-- record_cash_movement_v1 : undepo → petty posts a balanced JE
DO $$
DECLARE v_je uuid; v_dr numeric; v_cr numeric;
BEGIN
  v_je := record_cash_movement_v1('undepo_to_petty', 100000, CURRENT_DATE, 'test transfer',
                                   '11111111-1111-1111-1111-111111111111', NULL);
  PERFORM set_config('cash.test_je', v_je::text, true);
END $$;

SELECT is(
  (SELECT debit FROM journal_entry_lines jel JOIN accounts a ON a.id=jel.account_id
   WHERE jel.journal_entry_id = current_setting('cash.test_je')::uuid AND a.code='1111'),
  100000::numeric, 'undepo_to_petty debits Petty Cash 1111');
SELECT is(
  (SELECT credit FROM journal_entry_lines jel JOIN accounts a ON a.id=jel.account_id
   WHERE jel.journal_entry_id = current_setting('cash.test_je')::uuid AND a.code='1110'),
  100000::numeric, 'undepo_to_petty credits Undeposited 1110');
SELECT is(
  (SELECT total_debit FROM journal_entries WHERE id = current_setting('cash.test_je')::uuid),
  (SELECT total_credit FROM journal_entries WHERE id = current_setting('cash.test_je')::uuid),
  'JE is balanced');

-- Idempotency replay returns the same JE
SELECT is(
  record_cash_movement_v1('undepo_to_petty', 100000, CURRENT_DATE, 'test transfer',
                          '11111111-1111-1111-1111-111111111111', NULL),
  current_setting('cash.test_je')::uuid, 'replay returns the first JE id');

-- Bad amount rejected
SELECT throws_ok(
  $$ SELECT record_cash_movement_v1('bank_deposit', -5, CURRENT_DATE, 'x',
       '22222222-2222-2222-2222-222222222222', NULL) $$,
  'P0001', NULL, 'non-positive amount rejected');

-- Unknown movement type rejected
SELECT throws_ok(
  $$ SELECT record_cash_movement_v1('teleport', 5, CURRENT_DATE, 'x',
       '33333333-3333-3333-3333-333333333333', NULL) $$,
  'P0001', NULL, 'unknown movement type rejected');

-- adjustment without wallet code rejected
SELECT throws_ok(
  $$ SELECT record_cash_movement_v1('adjustment_gain', 5, CURRENT_DATE, 'count over',
       '44444444-4444-4444-4444-444444444444', NULL) $$,
  'P0001', NULL, 'adjustment requires p_wallet_code');

-- anon cannot execute
SELECT is(
  has_function_privilege('anon', 'record_cash_movement_v1(text,numeric,date,text,uuid,text)', 'EXECUTE'),
  false, 'anon has no EXECUTE on record_cash_movement_v1');
```

- [ ] **Step 2: Run to verify it fails**

MCP `execute_sql` with the file. Expected: function-does-not-exist errors.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260706000018_create_record_cash_movement_v1.sql`:

```sql
-- 20260706000018 — record_cash_movement_v1 : single balanced-JE poster for cash wallets.

CREATE TABLE IF NOT EXISTS cash_movement_idempotency_keys (
  idempotency_key UUID PRIMARY KEY,
  je_id           UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cash_movement_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cash_movement_idempotency_keys FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE cash_movement_idempotency_keys FROM authenticated;
GRANT SELECT ON TABLE cash_movement_idempotency_keys TO authenticated;
DROP POLICY IF EXISTS cash_movement_idem_select_auth ON cash_movement_idempotency_keys;
CREATE POLICY cash_movement_idem_select_auth ON cash_movement_idempotency_keys
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION record_cash_movement_v1(
  p_movement_type   TEXT,
  p_amount          NUMERIC,
  p_movement_date   DATE,
  p_remark          TEXT,
  p_idempotency_key UUID,
  p_wallet_code     TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_existing   UUID;
  v_dr_key     TEXT;
  v_cr_key     TEXT;
  v_dr_acc     UUID;
  v_cr_acc     UUID;
  v_wallet_key TEXT;
  v_entry_no   TEXT;
  v_je_id      UUID;
  v_label      TEXT;
BEGIN
  -- Permission gate (defense in depth on top of UI gate)
  IF NOT public.has_permission(v_uid, 'accounting.cash.write') THEN
    RAISE EXCEPTION 'permission_denied: accounting.cash.write required' USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency replay
  SELECT je_id INTO v_existing FROM cash_movement_idempotency_keys
    WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Resolve the wallet mapping key for adjustments
  IF p_movement_type IN ('adjustment_gain', 'adjustment_loss') THEN
    v_wallet_key := CASE p_wallet_code
      WHEN '1110' THEN 'CASH_WALLET_UNDEPOSITED'
      WHEN '1111' THEN 'CASH_WALLET_PETTY'
      WHEN '1117' THEN 'CASH_WALLET_SMALL_MONEY'
      ELSE NULL END;
    IF v_wallet_key IS NULL THEN
      RAISE EXCEPTION 'adjustment requires p_wallet_code in (1110,1111,1117)' USING ERRCODE = 'P0001';
    END IF;
    IF p_remark IS NULL OR length(trim(p_remark)) = 0 THEN
      RAISE EXCEPTION 'adjustment requires a remark (reason)' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Map movement type → (debit key, credit key)
  SELECT dr, cr, lbl INTO v_dr_key, v_cr_key, v_label FROM (VALUES
    ('undepo_to_petty',  'CASH_WALLET_PETTY',          'CASH_WALLET_UNDEPOSITED',     'Transfer Undeposited → Petty Cash'),
    ('petty_to_undepo',  'CASH_WALLET_UNDEPOSITED',    'CASH_WALLET_PETTY',           'Transfer Petty Cash → Undeposited'),
    ('bank_deposit',     'CASH_BANK_OPERATING',        'CASH_WALLET_UNDEPOSITED',     'Bank deposit'),
    ('boss_withdrawal',  'OWNER_DRAWING',              'CASH_WALLET_UNDEPOSITED',     'Boss withdrawal'),
    ('small_money_lend', 'CASH_WALLET_UNDEPOSITED',    'CASH_WALLET_SMALL_MONEY',     'Small Money lends to Undeposited'),
    ('small_money_repay','CASH_WALLET_SMALL_MONEY',    'CASH_WALLET_UNDEPOSITED',     'Repay Small Money'),
    ('adjustment_gain',  v_wallet_key,                 'SHIFT_CASH_VARIANCE_INCOME',  'Cash count overage'),
    ('adjustment_loss',  'SHIFT_CASH_VARIANCE_EXPENSE', v_wallet_key,                 'Cash count shortage')
  ) AS m(mt, dr, cr, lbl) WHERE m.mt = p_movement_type;

  IF v_dr_key IS NULL OR v_cr_key IS NULL THEN
    RAISE EXCEPTION 'unknown movement_type: %', p_movement_type USING ERRCODE = 'P0001';
  END IF;

  -- Fiscal guard
  PERFORM check_fiscal_period_open(p_movement_date);

  v_dr_acc := resolve_mapping_account(v_dr_key);
  v_cr_acc := resolve_mapping_account(v_cr_key);
  v_entry_no := next_journal_entry_number(p_movement_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, p_movement_date,
    v_label || COALESCE(' — ' || left(p_remark, 80), ''),
    'cash_movement', p_idempotency_key,
    'posted', p_amount, p_amount, v_uid
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_dr_acc, p_amount, 0, COALESCE(p_remark, v_label)),
    (v_je_id, v_cr_acc, 0, p_amount, COALESCE(p_remark, v_label));

  INSERT INTO cash_movement_idempotency_keys (idempotency_key, je_id)
    VALUES (p_idempotency_key, v_je_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'cash.movement', 'journal_entries', v_je_id,
          jsonb_build_object('movement_type', p_movement_type, 'amount', p_amount,
                             'date', p_movement_date, 'remark', p_remark));

  RETURN v_je_id;
EXCEPTION WHEN unique_violation THEN
  -- Concurrent replay race: re-read the winner.
  SELECT je_id INTO v_existing FROM cash_movement_idempotency_keys
    WHERE idempotency_key = p_idempotency_key;
  RETURN v_existing;
END $$;

COMMENT ON FUNCTION record_cash_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) IS
  'Cash Wallets : posts one balanced JE for a wallet movement. Idempotent on p_idempotency_key. '
  'Gated by accounting.cash.write. Fiscal-period guarded.';

REVOKE EXECUTE ON FUNCTION record_cash_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_cash_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION record_cash_movement_v1(TEXT,NUMERIC,DATE,TEXT,UUID,TEXT) TO authenticated;
```

Apply via MCP `apply_migration` (name `create_record_cash_movement_v1`).

> **Note on the pgTAP permission cases:** the suite runs as the migration owner; `has_permission(auth.uid(), …)` returns false when `auth.uid()` is NULL. For the happy-path cases, wrap them with a `SET LOCAL role` / seed a permitted user, OR temporarily assert the permission branch separately. Simplest: in the test envelope, `CREATE OR REPLACE` a stub `has_permission` returning true inside the `BEGIN…ROLLBACK` before calling the RPC (rolled back after). Document this in the test file header.

- [ ] **Step 4: Run to verify it passes**

MCP `execute_sql` with the updated file (include the `has_permission` stub note above).
Expected: `ok 1..14`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260706000018_create_record_cash_movement_v1.sql supabase/tests/cash_wallets.test.sql
git commit -m "feat(accounting): record_cash_movement_v1 RPC + idempotency table"
```

---

### Task 3: Remap cash expenses to Petty Cash + drop shift-drawer trigger

Re-points `EXPENSE_CASH_OUT` from 1110 to 1111 so cash expenses credit Petty Cash, and removes the trigger that deducted cash expenses from the open shift drawer.

**Files:**
- Create: `supabase/migrations/20260706000019_expense_cash_out_to_petty_drop_shift_trigger.sql`
- Modify: `supabase/tests/cash_wallets.test.sql` (append)
- Reference for regression: `supabase/tests/functions/cash-register-close.test.ts`

**Interfaces:**
- Consumes: existing `EXPENSE_CASH_OUT` mapping, trigger `trg_expenses_sync_cash`, function `sync_cash_expense_to_session()`.
- Produces: `EXPENSE_CASH_OUT → 1111`; trigger + function dropped.

- [ ] **Step 1: Write the failing pgTAP test (append, bump plan to 16)**

```sql
-- Cash expenses now credit Petty Cash
SELECT is(
  (SELECT code FROM accounts WHERE id = resolve_mapping_account('EXPENSE_CASH_OUT')),
  '1111', 'EXPENSE_CASH_OUT remapped to Petty Cash 1111');

-- Shift-drawer expense trigger is gone
SELECT is(
  (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'trg_expenses_sync_cash'),
  0, 'trg_expenses_sync_cash dropped');
```

- [ ] **Step 2: Run to verify it fails**

Expected: mapping still `1110`, trigger still present.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260706000019_expense_cash_out_to_petty_drop_shift_trigger.sql`:

```sql
-- 20260706000019 — Cash Wallets : route cash expenses to Petty Cash, drop shift-drawer sync.
-- Cash expenses now CR 1111 Petty Cash (the safe), not 1110. Daily expenses leave the
-- Petty Cash wallet, not the active POS till. Forward-only: historical JE untouched.

UPDATE accounting_mappings
   SET account_code = '1111',
       description  = 'Expense paid cash/transfer/card -> CR Petty Cash (cash wallets module)'
 WHERE mapping_key = 'EXPENSE_CASH_OUT';

DROP TRIGGER IF EXISTS trg_expenses_sync_cash ON expenses;
DROP FUNCTION IF EXISTS sync_cash_expense_to_session();
```

Apply via MCP `apply_migration` (name `expense_cash_out_to_petty_drop_shift_trigger`).

- [ ] **Step 4: Run to verify it passes**

Expected: `ok` for both new assertions; full suite green (1..16).

- [ ] **Step 5: Update the shift-close regression expectation**

Open `supabase/tests/functions/cash-register-close.test.ts`. Find any assertion that subtracts cash expenses from `expected_cash`. Update the expectation to `expected_cash = opening_cash + cash_sales − cash_refunds` (no expense deduction). If the test seeds a paid cash expense and asserts a reduced drawer, change it to assert the drawer is **unaffected** by the expense. Add a comment: `// 2026-06-23: cash expenses now leave Petty Cash (1111), not the shift drawer.`

Run: `pnpm --filter @breakery/supabase test cash-register-close`
Expected: PASS with the new expectation.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260706000019_expense_cash_out_to_petty_drop_shift_trigger.sql supabase/tests/cash_wallets.test.sql supabase/tests/functions/cash-register-close.test.ts
git commit -m "feat(accounting): cash expenses credit Petty Cash; drop shift-drawer expense sync"
```

---

### Task 4: Wallet read RPCs — balances + per-wallet ledger with shift aggregation

Two read RPCs powering the UI. Balances are the GL net per account; the ledger projects In/Out/Saldo with monthly carry-forward and aggregates cash sales per shift for Undeposited.

**Files:**
- Create: `supabase/migrations/20260706000020_create_cash_wallet_read_rpcs.sql`
- Modify: `supabase/tests/cash_wallets.test.sql` (append)

**Interfaces:**
- Produces:
  - `get_cash_wallet_balances_v1() RETURNS TABLE(account_code text, account_name text, balance numeric)` — rows for 1110, 1111, 1117.
  - `get_cash_wallet_ledger_v1(p_account_code text, p_date_start date, p_date_end date) RETURNS TABLE(row_date date, remark text, in_amount numeric, out_amount numeric, saldo numeric, ref_type text)` — opening carry-forward + ordered movements; Undeposited collapses cash-sale JE into one row per `pos_session` labelled `Shift N`.

- [ ] **Step 1: Write the failing pgTAP test (append, bump plan to 19)**

```sql
-- balances RPC returns the three wallets
SELECT ok( EXISTS(SELECT 1 FROM get_cash_wallet_balances_v1() WHERE account_code='1110'), 'balances include 1110');
SELECT ok( EXISTS(SELECT 1 FROM get_cash_wallet_balances_v1() WHERE account_code='1117'), 'balances include 1117');

-- ledger for Petty Cash after the Task 2 transfer shows the In row + running saldo
SELECT ok(
  (SELECT count(*) FROM get_cash_wallet_ledger_v1('1111', CURRENT_DATE - 1, CURRENT_DATE + 1)) >= 1,
  'petty ledger returns at least the transfer row');
```

- [ ] **Step 2: Run to verify it fails**

Expected: function does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260706000020_create_cash_wallet_read_rpcs.sql`:

```sql
-- 20260706000020 — Cash Wallets : read RPCs (balances + ledger with shift aggregation).

-- (a) Balances : GL net (debit-positive for asset accounts) per wallet.
CREATE OR REPLACE FUNCTION get_cash_wallet_balances_v1()
RETURNS TABLE(account_code TEXT, account_name TEXT, balance NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.code, a.name,
         COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE a.code IN ('1110','1111','1117')
  GROUP BY a.code, a.name
  ORDER BY a.code;
$$;
COMMENT ON FUNCTION get_cash_wallet_balances_v1() IS 'Cash Wallets : live GL net balance for 1110/1111/1117.';
REVOKE EXECUTE ON FUNCTION get_cash_wallet_balances_v1() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_cash_wallet_balances_v1() TO authenticated;

-- (b) Ledger : opening carry-forward + movement rows. Undeposited aggregates cash sales per shift.
CREATE OR REPLACE FUNCTION get_cash_wallet_ledger_v1(
  p_account_code TEXT,
  p_date_start   DATE,
  p_date_end     DATE
) RETURNS TABLE(row_date DATE, remark TEXT, in_amount NUMERIC, out_amount NUMERIC, saldo NUMERIC, ref_type TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acc_id  UUID;
  v_opening NUMERIC;
BEGIN
  SELECT id INTO v_acc_id FROM accounts WHERE code = p_account_code;
  IF v_acc_id IS NULL THEN
    RAISE EXCEPTION 'unknown account code %', p_account_code USING ERRCODE = 'P0002';
  END IF;

  -- Opening carry-forward = net balance strictly before the window start.
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO v_opening
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE jel.account_id = v_acc_id AND je.entry_date < p_date_start;

  RETURN QUERY
  WITH raw AS (
    -- Undeposited cash sales → aggregate per session as one "Shift N" row.
    SELECT je.entry_date AS d,
           'Shift ' || dense_rank() OVER (
              PARTITION BY je.entry_date ORDER BY MIN(s.opened_at)
           )::text AS rmk,
           SUM(jel.debit) AS in_amt, SUM(jel.credit) AS out_amt,
           MIN(je.entry_date) AS sort_d, 'sale'::text AS rt,
           1 AS grp
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    JOIN orders o          ON je.reference_type = 'sale' AND je.reference_id = o.id
    LEFT JOIN pos_sessions s ON s.id = o.session_id
    WHERE p_account_code = '1110'
      AND jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY je.entry_date, o.session_id

    UNION ALL

    -- All non-sale lines (and ALL lines for non-Undeposited wallets) pass through 1:1.
    SELECT je.entry_date AS d,
           COALESCE(jel.description, je.description) AS rmk,
           jel.debit AS in_amt, jel.credit AS out_amt,
           je.entry_date AS sort_d, je.reference_type AS rt, 0 AS grp
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    WHERE jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (p_account_code = '1110' AND je.reference_type = 'sale')
  ),
  ordered AS (
    SELECT d, rmk, in_amt, out_amt, rt,
           row_number() OVER (ORDER BY d, grp DESC, rmk) AS rn
    FROM raw
  )
  SELECT o.d, o.rmk, o.in_amt, o.out_amt,
         v_opening + SUM(o.in_amt - o.out_amt) OVER (ORDER BY o.rn
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo,
         o.rt
  FROM ordered o
  ORDER BY o.rn;
END $$;
COMMENT ON FUNCTION get_cash_wallet_ledger_v1(TEXT,DATE,DATE) IS
  'Cash Wallets : In/Out/Saldo ledger for one wallet, opening carry-forward, Undeposited sales aggregated per shift.';
REVOKE EXECUTE ON FUNCTION get_cash_wallet_ledger_v1(TEXT,DATE,DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_cash_wallet_ledger_v1(TEXT,DATE,DATE) TO authenticated;
```

Apply via MCP `apply_migration` (name `create_cash_wallet_read_rpcs`).

- [ ] **Step 4: Run to verify it passes**

Expected: `ok 1..19`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260706000020_create_cash_wallet_read_rpcs.sql supabase/tests/cash_wallets.test.sql
git commit -m "feat(accounting): cash-wallet balances + ledger read RPCs"
```

---

### Task 5: Regenerate TypeScript types

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`

- [ ] **Step 1: Regen types**

MCP `generate_typescript_types` (project `ikcyvlovptebroadgtvd`). Write the returned `types` string to `packages/supabase/src/types.generated.ts` (overwrite).

- [ ] **Step 2: Verify the new RPCs appear**

Run: `grep -nE "record_cash_movement_v1|get_cash_wallet_balances_v1|get_cash_wallet_ledger_v1" packages/supabase/src/types.generated.ts`
Expected: three matches under the `Functions` section.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(types): regen for cash-wallet RPCs"
```

---

### Task 6: Frontend data hooks

Three TanStack Query hooks mirroring the accounting feature's hook conventions.

**Files:**
- Create: `apps/backoffice/src/features/accounting/hooks/useCashWallets.ts`
- Create: `apps/backoffice/src/features/accounting/hooks/useCashWalletLedger.ts`
- Create: `apps/backoffice/src/features/accounting/hooks/useRecordCashMovement.ts`
- Test: `apps/backoffice/src/features/accounting/__tests__/cash-wallets-hooks.smoke.test.tsx`

**Interfaces:**
- Consumes: `supabase.rpc('get_cash_wallet_balances_v1')`, `supabase.rpc('get_cash_wallet_ledger_v1', {...})`, `supabase.rpc('record_cash_movement_v1', {...})`.
- Produces:
  - `useCashWallets()` → `{ data: WalletBalance[], … }`, `WalletBalance = { account_code: string; account_name: string; balance: number }`.
  - `useCashWalletLedger(accountCode, startDate, endDate)` → `{ data: WalletLedgerRow[], … }`, `WalletLedgerRow = { row_date: string; remark: string|null; in_amount: number; out_amount: number; saldo: number; ref_type: string|null }`.
  - `useRecordCashMovement()` → mutation `{ mutate({ movementType, amount, movementDate, remark, walletCode? }), … }`; generates a `useRef` idempotency key per form instance.
  - Exported constants `CASH_WALLETS_KEY`, `CASH_WALLET_LEDGER_KEY`. Movement-type union `CashMovementType`.

- [ ] **Step 1: Write the failing smoke test**

Create `apps/backoffice/src/features/accounting/__tests__/cash-wallets-hooks.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const rpc = vi.fn();
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { useCashWallets } from '../hooks/useCashWallets.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useCashWallets', () => {
  beforeEach(() => rpc.mockReset());

  it('maps the balances RPC payload', async () => {
    rpc.mockResolvedValueOnce({ data: [
      { account_code: '1110', account_name: 'Cash on Hand', balance: 6453000 },
      { account_code: '1111', account_name: 'Petty Cash',  balance: 47200 },
      { account_code: '1117', account_name: 'Small Money', balance: 4000000 },
    ], error: null });

    const { result } = renderHook(() => useCashWallets(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    expect(rpc).toHaveBeenCalledWith('get_cash_wallet_balances_v1', {});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @breakery/backoffice test cash-wallets-hooks`
Expected: FAIL — module `../hooks/useCashWallets.js` not found.

- [ ] **Step 3: Write `useCashWallets.ts`**

```ts
// apps/backoffice/src/features/accounting/hooks/useCashWallets.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface WalletBalance {
  account_code: string;
  account_name: string;
  balance: number;
}

export const CASH_WALLETS_KEY = ['accounting', 'cash-wallets'] as const;

export function useCashWallets() {
  return useQuery<WalletBalance[]>({
    queryKey: CASH_WALLETS_KEY,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cash_wallet_balances_v1', {});
      if (error) throw error;
      return (data ?? []) as WalletBalance[];
    },
  });
}
```

- [ ] **Step 4: Write `useCashWalletLedger.ts`**

```ts
// apps/backoffice/src/features/accounting/hooks/useCashWalletLedger.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface WalletLedgerRow {
  row_date:   string;
  remark:     string | null;
  in_amount:  number;
  out_amount: number;
  saldo:      number;
  ref_type:   string | null;
}

export const CASH_WALLET_LEDGER_KEY = ['accounting', 'cash-wallet-ledger'] as const;

export function useCashWalletLedger(accountCode: string | null, startDate: string, endDate: string) {
  return useQuery<WalletLedgerRow[]>({
    queryKey: [...CASH_WALLET_LEDGER_KEY, accountCode, startDate, endDate],
    enabled: !!accountCode,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cash_wallet_ledger_v1', {
        p_account_code: accountCode as string,
        p_date_start: startDate,
        p_date_end: endDate,
      });
      if (error) throw error;
      return (data ?? []) as WalletLedgerRow[];
    },
  });
}
```

- [ ] **Step 5: Write `useRecordCashMovement.ts`**

```ts
// apps/backoffice/src/features/accounting/hooks/useRecordCashMovement.ts
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CASH_WALLETS_KEY } from './useCashWallets.js';
import { CASH_WALLET_LEDGER_KEY } from './useCashWalletLedger.js';

export type CashMovementType =
  | 'undepo_to_petty' | 'petty_to_undepo' | 'bank_deposit' | 'boss_withdrawal'
  | 'small_money_lend' | 'small_money_repay' | 'adjustment_gain' | 'adjustment_loss';

export interface RecordCashMovementInput {
  movementType: CashMovementType;
  amount: number;
  movementDate: string;       // ISO date (YYYY-MM-DD)
  remark: string;
  walletCode?: '1110' | '1111' | '1117' | null;  // required for adjustments
}

export function useRecordCashMovement() {
  const qc = useQueryClient();
  const idemKey = useRef<string>(crypto.randomUUID());

  return useMutation({
    mutationFn: async (input: RecordCashMovementInput) => {
      const { data, error } = await supabase.rpc('record_cash_movement_v1', {
        p_movement_type: input.movementType,
        p_amount: input.amount,
        p_movement_date: input.movementDate,
        p_remark: input.remark,
        p_idempotency_key: idemKey.current,
        p_wallet_code: input.walletCode ?? null,
      });
      if (error) throw error;
      return data as string; // journal_entry_id
    },
    onSuccess: () => {
      idemKey.current = crypto.randomUUID();   // fresh key for the next distinct movement
      qc.invalidateQueries({ queryKey: CASH_WALLETS_KEY });
      qc.invalidateQueries({ queryKey: CASH_WALLET_LEDGER_KEY });
    },
  });
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @breakery/backoffice test cash-wallets-hooks`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backoffice/src/features/accounting/hooks/useCashWallets.ts apps/backoffice/src/features/accounting/hooks/useCashWalletLedger.ts apps/backoffice/src/features/accounting/hooks/useRecordCashMovement.ts apps/backoffice/src/features/accounting/__tests__/cash-wallets-hooks.smoke.test.tsx
git commit -m "feat(accounting): cash-wallet data hooks"
```

---

### Task 7: UI — wallet cards, ledger table, movement modal

The core treasury components and the page shell (reconciliation + analysis added in Task 9).

**Files:**
- Create: `apps/backoffice/src/features/accounting/components/WalletCard.tsx`
- Create: `apps/backoffice/src/features/accounting/components/WalletLedgerTable.tsx`
- Create: `apps/backoffice/src/features/accounting/components/RecordCashMovementModal.tsx`
- Create: `apps/backoffice/src/features/accounting/pages/CashTreasuryPage.tsx`
- Test: `apps/backoffice/src/features/accounting/__tests__/cash-treasury-page.smoke.test.tsx`

**Interfaces:**
- Consumes: `useCashWallets`, `useCashWalletLedger`, `useRecordCashMovement`, `WalletBalance`, `WalletLedgerRow`, `CashMovementType`.
- Produces: default-exported `CashTreasuryPage`. `WalletCard` props `{ wallet: WalletBalance; selected: boolean; onSelect: () => void; fixedFloat?: number }`. `RecordCashMovementModal` props `{ open: boolean; onClose: () => void }`. `WalletLedgerTable` props `{ rows: WalletLedgerRow[]; loading: boolean }`.

Use `@breakery/ui` per `breakery-ui-kit` conventions: **no `Select`/`SelectItem` exports** — use a native `<select>` styled with the project's input classes. Use `Dialog`, `Card`, `Badge`, `Button` from `@breakery/ui`. Format currency with the existing IDR formatter (check `packages/utils` for `formatIDR`/`formatCurrency`; if absent use `new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })`).

- [ ] **Step 1: Write the failing smoke test**

Create `apps/backoffice/src/features/accounting/__tests__/cash-treasury-page.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const rpc = vi.fn();
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/components/PermissionGate.js', () => ({ default: ({ children }: any) => <>{children}</>, PermissionGate: ({ children }: any) => <>{children}</> }));

import CashTreasuryPage from '../pages/CashTreasuryPage.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('CashTreasuryPage', () => {
  beforeEach(() => rpc.mockReset());

  it('renders the three wallet cards from balances', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'get_cash_wallet_balances_v1') return Promise.resolve({ data: [
        { account_code: '1110', account_name: 'Cash on Hand', balance: 6453000 },
        { account_code: '1111', account_name: 'Petty Cash',  balance: 47200 },
        { account_code: '1117', account_name: 'Small Money', balance: 4000000 },
      ], error: null });
      return Promise.resolve({ data: [], error: null });
    });

    render(<CashTreasuryPage />, { wrapper });
    await waitFor(() => expect(screen.getByText(/Undeposited/i)).toBeInTheDocument());
    expect(screen.getByText(/Petty Cash/i)).toBeInTheDocument();
    expect(screen.getByText(/Small Money/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @breakery/backoffice test cash-treasury-page`
Expected: FAIL — `CashTreasuryPage` not found.

- [ ] **Step 3: Write `WalletCard.tsx`**

```tsx
// apps/backoffice/src/features/accounting/components/WalletCard.tsx
import { Card, Badge } from '@breakery/ui';
import type { WalletBalance } from '../hooks/useCashWallets.js';

const LABELS: Record<string, string> = {
  '1110': 'Undeposited Funds',
  '1111': 'Petty Cash',
  '1117': 'Small Money',
};

const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

export function WalletCard({
  wallet, selected, onSelect, fixedFloat,
}: { wallet: WalletBalance; selected: boolean; onSelect: () => void; fixedFloat?: number }) {
  const label = LABELS[wallet.account_code] ?? wallet.account_name;
  const lentOut = fixedFloat != null && wallet.balance !== fixedFloat;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left transition ${selected ? 'ring-2 ring-primary' : ''}`}
      aria-pressed={selected}
    >
      <Card className="p-4 min-w-[200px]">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          {fixedFloat != null && (
            <Badge variant={lentOut ? 'destructive' : 'secondary'}>
              {lentOut ? 'Lent out' : 'Float OK'}
            </Badge>
          )}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{idr.format(wallet.balance)}</div>
        {fixedFloat != null && (
          <div className="mt-1 text-xs text-muted-foreground">Fixed float: {idr.format(fixedFloat)}</div>
        )}
      </Card>
    </button>
  );
}
```

- [ ] **Step 4: Write `WalletLedgerTable.tsx`**

```tsx
// apps/backoffice/src/features/accounting/components/WalletLedgerTable.tsx
import type { WalletLedgerRow } from '../hooks/useCashWalletLedger.js';

const idr = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export function WalletLedgerTable({ rows, loading }: { rows: WalletLedgerRow[]; loading: boolean }) {
  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading ledger…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-muted-foreground">No movements in this period.</div>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground border-b">
          <th className="py-2">Date</th><th>Remark</th>
          <th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Saldo</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0">
            <td className="py-1.5 whitespace-nowrap">{r.row_date}</td>
            <td className="truncate max-w-[280px]">{r.remark}</td>
            <td className="text-right tabular-nums">{r.in_amount ? idr.format(r.in_amount) : ''}</td>
            <td className="text-right tabular-nums">{r.out_amount ? idr.format(r.out_amount) : ''}</td>
            <td className="text-right tabular-nums font-medium">{idr.format(r.saldo)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Write `RecordCashMovementModal.tsx`**

```tsx
// apps/backoffice/src/features/accounting/components/RecordCashMovementModal.tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button } from '@breakery/ui';
import { useRecordCashMovement, type CashMovementType } from '../hooks/useRecordCashMovement.js';

const TYPES: { value: CashMovementType; label: string; needsWallet?: boolean }[] = [
  { value: 'undepo_to_petty',   label: 'Transfer Undeposited → Petty Cash' },
  { value: 'petty_to_undepo',   label: 'Return Petty Cash → Undeposited' },
  { value: 'bank_deposit',      label: 'Bank deposit' },
  { value: 'boss_withdrawal',   label: 'Boss withdrawal' },
  { value: 'small_money_lend',  label: 'Small Money lends to Undeposited' },
  { value: 'small_money_repay', label: 'Repay Small Money' },
  { value: 'adjustment_gain',   label: 'Adjustment — count overage', needsWallet: true },
  { value: 'adjustment_loss',   label: 'Adjustment — count shortage', needsWallet: true },
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const inputCls = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

export function RecordCashMovementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [type, setType] = useState<CashMovementType>('undepo_to_petty');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [remark, setRemark] = useState('');
  const [wallet, setWallet] = useState<'1110' | '1111' | '1117'>('1110');
  const mut = useRecordCashMovement();

  const needsWallet = TYPES.find((t) => t.value === type)?.needsWallet ?? false;
  const amt = Number(amount);
  const valid = amt > 0 && (!needsWallet || remark.trim().length > 0);

  const submit = () => {
    if (!valid) return;
    mut.mutate(
      { movementType: type, amount: amt, movementDate: date, remark: remark.trim(),
        walletCode: needsWallet ? wallet : null },
      { onSuccess: () => { setAmount(''); setRemark(''); onClose(); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New cash movement</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">Type
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as CashMovementType)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          {needsWallet && (
            <label className="block text-sm">Wallet
              <select className={inputCls} value={wallet} onChange={(e) => setWallet(e.target.value as '1110'|'1111'|'1117')}>
                <option value="1110">Undeposited Funds</option>
                <option value="1111">Petty Cash</option>
                <option value="1117">Small Money</option>
              </select>
            </label>
          )}
          <label className="block text-sm">Amount (IDR)
            <input className={inputCls} type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block text-sm">Date
            <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block text-sm">Remark{needsWallet ? ' (reason — required)' : ''}
            <input className={inputCls} value={remark} onChange={(e) => setRemark(e.target.value)} />
          </label>
          {mut.isError && <p className="text-sm text-destructive">{(mut.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={!valid || mut.isPending}>
              {mut.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

> Verify the exact `Dialog` sub-component export names against `packages/ui` before finalizing (the `breakery-ui-kit` skill lists them). Adjust imports if the project uses `Sheet` or a different Dialog API.

- [ ] **Step 6: Write `CashTreasuryPage.tsx`**

```tsx
// apps/backoffice/src/features/accounting/pages/CashTreasuryPage.tsx
import { useMemo, useState } from 'react';
import { Button, Card } from '@breakery/ui';
import { useCashWallets } from '../hooks/useCashWallets.js';
import { useCashWalletLedger } from '../hooks/useCashWalletLedger.js';
import { WalletCard } from '../components/WalletCard.js';
import { WalletLedgerTable } from '../components/WalletLedgerTable.js';
import { RecordCashMovementModal } from '../components/RecordCashMovementModal.js';

const SMALL_MONEY_FLOAT = 4_000_000;
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function CashTreasuryPage() {
  const { data: wallets = [], isLoading } = useCashWallets();
  const [selected, setSelected] = useState('1110');
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(todayISO());
  const [modalOpen, setModalOpen] = useState(false);

  const ledger = useCashWalletLedger(selected, start, end);
  const ordered = useMemo(
    () => ['1110', '1111', '1117'].map((c) => wallets.find((w) => w.account_code === c)).filter(Boolean) as typeof wallets,
    [wallets],
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cash Treasury</h1>
        <Button onClick={() => setModalOpen(true)}>New movement</Button>
      </div>

      <div className="flex flex-wrap gap-3">
        {isLoading && <span className="text-sm text-muted-foreground">Loading wallets…</span>}
        {ordered.map((w) => (
          <WalletCard
            key={w.account_code}
            wallet={w}
            selected={selected === w.account_code}
            onSelect={() => setSelected(w.account_code)}
            fixedFloat={w.account_code === '1117' ? SMALL_MONEY_FLOAT : undefined}
          />
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3 text-sm">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                 className="rounded-md border border-input bg-background px-2 py-1" />
          <span>→</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                 className="rounded-md border border-input bg-background px-2 py-1" />
        </div>
        <WalletLedgerTable rows={ledger.data ?? []} loading={ledger.isLoading} />
      </Card>

      <RecordCashMovementModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm --filter @breakery/backoffice test cash-treasury-page`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backoffice/src/features/accounting/components/WalletCard.tsx apps/backoffice/src/features/accounting/components/WalletLedgerTable.tsx apps/backoffice/src/features/accounting/components/RecordCashMovementModal.tsx apps/backoffice/src/features/accounting/pages/CashTreasuryPage.tsx apps/backoffice/src/features/accounting/__tests__/cash-treasury-page.smoke.test.tsx
git commit -m "feat(accounting): cash treasury page — wallet cards, ledger, movement modal"
```

---

### Task 8: Route + sidebar wiring

Mounts the page under `/backoffice/accounting/cash` and adds the nav entry.

**Files:**
- Modify: `apps/backoffice/src/routes/index.tsx` (import + `<Route>` near the other accounting routes, ~line 494-525)
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx` (Accounting group children, ~line 119-125)
- Modify: `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx` (permission list + expectation)

**Interfaces:**
- Consumes: `CashTreasuryPage` (default export), `PermissionGate`, permission `accounting.cash.read`.

- [ ] **Step 1: Add the failing nav assertion**

In `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx`, add `'accounting.cash.read'` to the granted-permissions fixture array, and add an expectation in the accounting-group test:

```tsx
expect(screen.getByRole('link', { name: /Cash Treasury/i })).toBeInTheDocument();
```

Run: `pnpm --filter @breakery/backoffice test Sidebar`
Expected: FAIL — no "Cash Treasury" link.

- [ ] **Step 2: Wire the route**

In `apps/backoffice/src/routes/index.tsx`, add the import beside the other accounting pages (~line 92):

```tsx
import CashTreasuryPage from '@/features/accounting/pages/CashTreasuryPage.js';
```

Add the route inside the accounting block (after the `trial-balance` route, ~line 525):

```tsx
<Route
  path="accounting/cash"
  element={
    <PermissionGate required="accounting.cash.read">
      <CashTreasuryPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 3: Add the sidebar entry**

In `apps/backoffice/src/layouts/Sidebar.tsx`, add to the Accounting group `children` (after the `general-ledger` entry, ~line 122). Pick an icon already imported in the file (e.g. `Wallet` from lucide-react; add it to the existing lucide import line):

```tsx
{ to: '/backoffice/accounting/cash', label: 'Cash Treasury', icon: Wallet, permission: 'accounting.cash.read' },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @breakery/backoffice test Sidebar`
Expected: PASS.

- [ ] **Step 5: Typecheck + build**

Run: `pnpm typecheck && pnpm --filter @breakery/backoffice build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/routes/index.tsx apps/backoffice/src/layouts/Sidebar.tsx apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx
git commit -m "feat(accounting): mount /accounting/cash route + sidebar entry"
```

---

### Task 9: Reconciliation panel + analysis panel + CSV export

Adds the "counted vs GL" reconciliation (one-click adjustment) and the Excel "Private Analysis" replica, plus CSV export of the active ledger.

**Files:**
- Create: `apps/backoffice/src/features/accounting/components/CashReconciliationPanel.tsx`
- Create: `apps/backoffice/src/features/accounting/components/CashAnalysisPanel.tsx`
- Create: `apps/backoffice/src/features/accounting/components/exportCashWalletCsv.ts`
- Create: `supabase/migrations/20260706000021_create_cash_wallet_analysis_rpc.sql`
- Modify: `apps/backoffice/src/features/accounting/pages/CashTreasuryPage.tsx` (mount the two panels + export button)
- Modify: `supabase/tests/cash_wallets.test.sql` (append analysis assertion, bump plan to 20)
- Test: `apps/backoffice/src/features/accounting/__tests__/cash-reconciliation.smoke.test.tsx`

**Interfaces:**
- Produces: `get_cash_wallet_analysis_v1(p_date_start date, p_date_end date) RETURNS jsonb` — `{ revenue_by_shift: [...], top_petty_categories: [...], transfers: {...}, deposits_total, boss_withdrawals_total }`.
- Produces: `exportCashWalletCsv(rows: WalletLedgerRow[], walletName: string): void` (browser download). `CashReconciliationPanel` props `{ wallet: WalletBalance }`. `CashAnalysisPanel` props `{ start: string; end: string }`.

- [ ] **Step 1: Write the analysis RPC migration**

Create `supabase/migrations/20260706000021_create_cash_wallet_analysis_rpc.sql`:

```sql
-- 20260706000021 — Cash Wallets : analysis RPC (Excel "Private Analysis" replica).
CREATE OR REPLACE FUNCTION get_cash_wallet_analysis_v1(p_date_start DATE, p_date_end DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revenue_by_shift JSONB;
  v_top_petty        JSONB;
  v_deposits         NUMERIC;
  v_boss             NUMERIC;
BEGIN
  -- Revenue per shift = cash-sale debits on 1110 grouped per session, ranked per day.
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_revenue_by_shift FROM (
    SELECT je.entry_date AS d,
           'Shift ' || dense_rank() OVER (PARTITION BY je.entry_date ORDER BY MIN(s.opened_at))::text AS shift,
           SUM(jel.debit) AS total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status='posted'
    JOIN accounts a ON a.id = jel.account_id AND a.code='1110'
    JOIN orders o ON je.reference_type='sale' AND je.reference_id=o.id
    LEFT JOIN pos_sessions s ON s.id=o.session_id
    WHERE je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY je.entry_date, o.session_id
    ORDER BY je.entry_date
  ) t;

  -- Top Petty Cash spend categories = expense JE crediting 1111, grouped by category account.
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_petty FROM (
    SELECT cat.name AS category, SUM(line.debit) AS total, count(*) AS occurrences
    FROM journal_entries je
    JOIN journal_entry_lines credit ON credit.journal_entry_id=je.id
      JOIN accounts ca ON ca.id=credit.account_id AND ca.code='1111' AND credit.credit > 0
    JOIN journal_entry_lines line ON line.journal_entry_id=je.id AND line.debit > 0
    JOIN accounts cat ON cat.id=line.account_id
    WHERE je.reference_type='expense' AND je.status='posted'
      AND je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY cat.name
    ORDER BY SUM(line.debit) DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(SUM(jel.debit),0) INTO v_deposits
  FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id=je.id
  JOIN accounts a ON a.id=jel.account_id AND a.code='1112'
  WHERE je.reference_type='cash_movement' AND je.status='posted'
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  SELECT COALESCE(SUM(jel.debit),0) INTO v_boss
  FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id=je.id
  JOIN accounts a ON a.id=jel.account_id AND a.code='3110'
  WHERE je.reference_type='cash_movement' AND je.status='posted'
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  RETURN jsonb_build_object(
    'revenue_by_shift', v_revenue_by_shift,
    'top_petty_categories', v_top_petty,
    'deposits_total', v_deposits,
    'boss_withdrawals_total', v_boss
  );
END $$;
COMMENT ON FUNCTION get_cash_wallet_analysis_v1(DATE,DATE) IS 'Cash Wallets : Private-Analysis replica (revenue/shift, top petty categories, deposits, boss withdrawals).';
REVOKE EXECUTE ON FUNCTION get_cash_wallet_analysis_v1(DATE,DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_cash_wallet_analysis_v1(DATE,DATE) TO authenticated;
```

Apply via MCP `apply_migration` (name `create_cash_wallet_analysis_rpc`). Then re-run Task 5's type regen and commit the types delta with this task.

- [ ] **Step 2: Append the analysis pgTAP assertion (bump plan to 20)**

```sql
SELECT ok(
  (get_cash_wallet_analysis_v1(CURRENT_DATE - 31, CURRENT_DATE + 1)) ? 'revenue_by_shift',
  'analysis payload has revenue_by_shift key');
```

Run via MCP `execute_sql`. Expected: passes.

- [ ] **Step 3: Write `exportCashWalletCsv.ts`**

```ts
// apps/backoffice/src/features/accounting/components/exportCashWalletCsv.ts
import type { WalletLedgerRow } from '../hooks/useCashWalletLedger.js';

export function exportCashWalletCsv(rows: WalletLedgerRow[], walletName: string): void {
  const header = ['Date', 'Remark', 'In', 'Out', 'Saldo'];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.row_date, r.remark ?? '', String(r.in_amount ?? 0), String(r.out_amount ?? 0), String(r.saldo)]
      .map(escape).join(','));
  const csv = [header.map(escape).join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cash-${walletName.toLowerCase().replace(/\s+/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
```

> Check `packages/domain` for an existing `buildCsv` helper first; if present, build the CSV body with it and keep only the Blob/download glue here.

- [ ] **Step 4: Write `CashReconciliationPanel.tsx`**

```tsx
// apps/backoffice/src/features/accounting/components/CashReconciliationPanel.tsx
import { useState } from 'react';
import { Card, Button } from '@breakery/ui';
import type { WalletBalance } from '../hooks/useCashWallets.js';
import { useRecordCashMovement } from '../hooks/useRecordCashMovement.js';

const idr = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const todayISO = () => new Date().toISOString().slice(0, 10);

export function CashReconciliationPanel({ wallet }: { wallet: WalletBalance }) {
  const [counted, setCounted] = useState('');
  const mut = useRecordCashMovement();
  const diff = counted === '' ? 0 : Number(counted) - wallet.balance;

  const book = () => {
    if (diff === 0) return;
    mut.mutate({
      movementType: diff > 0 ? 'adjustment_gain' : 'adjustment_loss',
      amount: Math.abs(diff),
      movementDate: todayISO(),
      remark: `Reconciliation ${wallet.account_code}: counted ${counted} vs GL ${wallet.balance}`,
      walletCode: wallet.account_code as '1110' | '1111' | '1117',
    }, { onSuccess: () => setCounted('') });
  };

  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-medium">Reconcile {wallet.account_name}</h3>
      <div className="text-sm text-muted-foreground">GL balance: {idr.format(wallet.balance)}</div>
      <input type="number" placeholder="Counted (physical)" value={counted}
             onChange={(e) => setCounted(e.target.value)}
             className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      {counted !== '' && (
        <div className={`text-sm ${diff === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
          Difference: {idr.format(diff)}
        </div>
      )}
      <Button disabled={diff === 0 || mut.isPending} onClick={book}>
        {diff === 0 ? 'Balanced' : `Book ${diff > 0 ? 'overage' : 'shortage'}`}
      </Button>
    </Card>
  );
}
```

- [ ] **Step 5: Write `CashAnalysisPanel.tsx`**

```tsx
// apps/backoffice/src/features/accounting/components/CashAnalysisPanel.tsx
import { useQuery } from '@tanstack/react-query';
import { Card } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';

const idr = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

interface Analysis {
  revenue_by_shift: { d: string; shift: string; total: number }[];
  top_petty_categories: { category: string; total: number; occurrences: number }[];
  deposits_total: number;
  boss_withdrawals_total: number;
}

export function CashAnalysisPanel({ start, end }: { start: string; end: string }) {
  const { data } = useQuery<Analysis>({
    queryKey: ['accounting', 'cash-analysis', start, end],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cash_wallet_analysis_v1', { p_date_start: start, p_date_end: end });
      if (error) throw error;
      return data as Analysis;
    },
  });
  if (!data) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4">
        <h3 className="font-medium mb-2">Top Petty Cash categories</h3>
        <ul className="text-sm space-y-1">
          {data.top_petty_categories.map((c) => (
            <li key={c.category} className="flex justify-between">
              <span>{c.category} <span className="text-muted-foreground">×{c.occurrences}</span></span>
              <span className="tabular-nums">{idr.format(c.total)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-4 space-y-2">
        <h3 className="font-medium mb-2">Movements summary</h3>
        <div className="flex justify-between text-sm"><span>Bank deposits</span><span className="tabular-nums">{idr.format(data.deposits_total)}</span></div>
        <div className="flex justify-between text-sm"><span>Boss withdrawals</span><span className="tabular-nums">{idr.format(data.boss_withdrawals_total)}</span></div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Mount the panels + export button in `CashTreasuryPage.tsx`**

Add imports and render the reconciliation panel for the selected wallet, the analysis panel, and an export button beside the date filters:

```tsx
import { CashReconciliationPanel } from '../components/CashReconciliationPanel.js';
import { CashAnalysisPanel } from '../components/CashAnalysisPanel.js';
import { exportCashWalletCsv } from '../components/exportCashWalletCsv.js';
// …
// inside the Card header row, after the date inputs:
<Button variant="outline" size="sm"
  onClick={() => exportCashWalletCsv(ledger.data ?? [], ordered.find(w => w.account_code === selected)?.account_name ?? 'wallet')}>
  Export CSV
</Button>
// …
// after the ledger Card:
{ordered.find((w) => w.account_code === selected) && (
  <CashReconciliationPanel wallet={ordered.find((w) => w.account_code === selected)!} />
)}
<CashAnalysisPanel start={start} end={end} />
```

- [ ] **Step 7: Write the reconciliation smoke test**

Create `apps/backoffice/src/features/accounting/__tests__/cash-reconciliation.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: vi.fn().mockResolvedValue({ data: 'je-1', error: null }) } }));
import { CashReconciliationPanel } from '../components/CashReconciliationPanel.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('CashReconciliationPanel', () => {
  it('computes the difference and enables booking', () => {
    render(<CashReconciliationPanel wallet={{ account_code: '1111', account_name: 'Petty Cash', balance: 47200 }} />, { wrapper });
    fireEvent.change(screen.getByPlaceholderText(/Counted/i), { target: { value: '50000' } });
    expect(screen.getByText(/Difference/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Book overage/i })).toBeEnabled();
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @breakery/backoffice test cash-reconciliation cash-treasury-page`
Expected: PASS.

- [ ] **Step 9: Regen types (analysis RPC), typecheck, commit**

MCP `generate_typescript_types` → overwrite `packages/supabase/src/types.generated.ts`. Then:

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add supabase/migrations/20260706000021_create_cash_wallet_analysis_rpc.sql supabase/tests/cash_wallets.test.sql packages/supabase/src/types.generated.ts apps/backoffice/src/features/accounting/components/CashReconciliationPanel.tsx apps/backoffice/src/features/accounting/components/CashAnalysisPanel.tsx apps/backoffice/src/features/accounting/components/exportCashWalletCsv.ts apps/backoffice/src/features/accounting/pages/CashTreasuryPage.tsx apps/backoffice/src/features/accounting/__tests__/cash-reconciliation.smoke.test.tsx
git commit -m "feat(accounting): cash reconciliation + analysis panels + CSV export"
```

---

### Task 10: Full suite, drift check, and PR

- [ ] **Step 1: Run the full backoffice + supabase test suites**

Run: `pnpm --filter @breakery/backoffice test && pnpm --filter @breakery/supabase test`
Expected: green except the known env-gated baseline (see CLAUDE.md). Triage any new red against the baseline; fix regressions.

- [ ] **Step 2: Build + typecheck**

Run: `pnpm build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Migration drift check**

MCP `list_migrations` — confirm `20260706000017..021` are applied to `ikcyvlovptebroadgtvd` and match local files.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/cash-wallets-tresorerie
gh pr create --base master --title "feat(accounting): 3-wallet cash treasury module" --body "<summary + test evidence>"
```

---

## Notes for the implementer

- **Opening balances (spec §5):** not built as code. At rollout the owner provides May-end balances for 1110/1111/1117; record them via the movement modal using `adjustment_gain` against `3100 Owner Capital`-style opening, or a one-off seed migration. Confirm the exact mechanism with the owner before the first managed month.
- **`pos_sessions.opened_at` / `orders.session_id`** (verified to exist) are the basis for shift aggregation. If `opened_at` is named differently, adjust the `ORDER BY` in `get_cash_wallet_ledger_v1` and `get_cash_wallet_analysis_v1`.
- **`@breakery/ui` Dialog API:** verify exact export names (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`) via the `breakery-ui-kit` skill before Task 7; the kit has **no** `Select` export — native `<select>` is intentional.
- **pgTAP `has_permission` stub:** the write-path tests need a permitted caller; stub `has_permission` to `true` inside the `BEGIN…ROLLBACK` envelope (rolled back), as noted in Task 2.
```
