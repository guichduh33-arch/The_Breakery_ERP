# Session 28 — Expense Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable multi-step expense approval (with separation-of-duties) + cash-paid expenses sync to `pos_sessions.cash_out_total` + admin settings page for thresholds. Closes TASK-11-001.

**Architecture:** Two new tables (`expense_approval_thresholds` configurable + `expense_approvals` append-only audit) + 3 ALTER columns on `expenses` (snapshot freeze pattern). 4 new/bumped SECURITY DEFINER RPCs (`submit_expense_v2`, `approve_expense_v2`, `set_expense_threshold_v1`, `delete_expense_threshold_v1`) all with REVOKE pair S25 canonical. 1 trigger function `sync_cash_expense_to_session` AFTER UPDATE on expenses. BO ships 1 new settings page + 4 components + 5 hooks + sidebar entry.

**Tech Stack:** PostgreSQL 15 (Supabase cloud V3 dev `ikcyvlovptebroadgtvd`), pgTAP for DB tests, TypeScript, React, Vitest + React Testing Library for BO smoke. shadcn/Radix Dialog + Sheet, lucide-react icons, React Query for mutations. Apply migrations via `mcp__plugin_supabase_supabase__apply_migration` (Docker is retired).

**Spec:** [`docs/workplan/specs/2026-05-24-session-28-spec.md`](../../specs/archive/2026-05-24-session-28-spec.md)

**Migration block:** `20260605000010..099` — monotonic, MCP-assigned timestamps. Convention: keep the cloud-assigned timestamp to match `supabase_migrations.schema_migrations.version`.

---

## File Structure

### Created
- `supabase/migrations/_create_expense_approval_thresholds_table.sql` (cloud TS `_010`)
- `supabase/migrations/_create_expense_approvals_table.sql` (cloud TS `_011`)
- `supabase/migrations/_alter_expenses_add_approval_snapshot_columns.sql` (cloud TS `_012`)
- `supabase/migrations/_seed_expense_approval_thresholds_defaults.sql` (cloud TS `_013`)
- `supabase/migrations/_bump_submit_expense_v2_rpc.sql` (cloud TS `_014`)
- `supabase/migrations/_revoke_anon_submit_expense_v2.sql` (cloud TS `_015`)
- `supabase/migrations/_bump_approve_expense_v2_rpc.sql` (cloud TS `_016`)
- `supabase/migrations/_revoke_anon_approve_expense_v2.sql` (cloud TS `_017`)
- `supabase/migrations/_create_set_expense_threshold_v1_rpc.sql` (cloud TS `_018`)
- `supabase/migrations/_revoke_anon_set_expense_threshold_v1.sql` (cloud TS `_019`)
- `supabase/migrations/_create_delete_expense_threshold_v1_rpc.sql` (cloud TS `_020`)
- `supabase/migrations/_revoke_anon_delete_expense_threshold_v1.sql` (cloud TS `_021`)
- `supabase/migrations/_create_sync_cash_expense_trigger.sql` (cloud TS `_022`)
- `supabase/migrations/_seed_perms_expenses_thresholds.sql` (cloud TS `_030`)
- `supabase/tests/expense_governance.test.sql`
- `apps/backoffice/src/features/settings/expense-thresholds/ExpenseThresholdsPage.tsx`
- `apps/backoffice/src/features/settings/expense-thresholds/ThresholdFormDialog.tsx`
- `apps/backoffice/src/features/settings/expense-thresholds/hooks/useExpenseThresholds.ts`
- `apps/backoffice/src/features/settings/expense-thresholds/hooks/useSetExpenseThreshold.ts`
- `apps/backoffice/src/features/settings/expense-thresholds/hooks/useDeleteExpenseThreshold.ts`
- `apps/backoffice/src/features/expenses/components/ApprovalTimeline.tsx`
- `apps/backoffice/src/features/expenses/components/ThresholdResolutionBadge.tsx`
- `apps/backoffice/src/features/expenses/hooks/useExpenseApprovals.ts`
- `apps/backoffice/src/features/expenses/__tests__/expense-thresholds-page.smoke.test.tsx`
- `apps/backoffice/src/features/expenses/__tests__/approval-timeline.smoke.test.tsx`
- `apps/backoffice/src/features/expenses/__tests__/approve-dialog-sod.smoke.test.tsx`
- `packages/domain/src/expenses/types.ts` (if not present — extend with `ApprovalStep`)
- `docs/workplan/plans/2026-05-24-session-28-INDEX.md` (Wave 6)

### Modified
- `packages/supabase/src/types.generated.ts` — regen post Wave 1.D + post Wave 3 (MCP)
- `packages/utils/src/permissions.ts` (or wherever `PermissionCode` union lives) — add 2 codes
- `apps/backoffice/src/features/expenses/components/ApproveDialog.tsx` — SOD-aware (disable button if `user.id === created_by` or already approved)
- `apps/backoffice/src/features/expenses/hooks/useApproveExpense.ts` — call `approve_expense_v2` with PIN-in-header (S25 pattern)
- `apps/backoffice/src/features/expenses/hooks/useSubmitExpense.ts` — call `submit_expense_v2` + `useRef(crypto.randomUUID())` for idempotency_key
- `apps/backoffice/src/pages/expenses/ExpenseDetailPage.tsx` — wire `<ApprovalTimeline>` + `<ThresholdResolutionBadge>`
- `apps/backoffice/src/components/layout/Sidebar.tsx` (or wherever sidebar entries live) — add "Expense Thresholds" entry under Settings, gate `expenses.thresholds.read`
- `apps/backoffice/src/router.tsx` (or routes config) — register `/settings/expense-thresholds` route
- `CLAUDE.md` — update "Active Workplan" section with S28 closeout reference (Wave 6)

---

## Wave 1 — DB Schema (4 migrations + types regen)

### Task 1.A: Create `expense_approval_thresholds` table

**Files:**
- Apply via MCP: `mcp__plugin_supabase_supabase__apply_migration` (project_id `ikcyvlovptebroadgtvd`, name `create_expense_approval_thresholds_table`)
- Locally mirror in `supabase/migrations/<cloud-ts>_create_expense_approval_thresholds_table.sql`

- [ ] **Step 1: Apply migration via MCP**

```sql
CREATE TABLE expense_approval_thresholds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
  amount_min   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount_min >= 0),
  amount_max   NUMERIC(15,2) NOT NULL CHECK (amount_max > 0),
  steps        JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT thresholds_amount_range CHECK (amount_max > amount_min),
  CONSTRAINT thresholds_steps_array CHECK (jsonb_typeof(steps) = 'array')
);

CREATE INDEX idx_thresholds_category_range
  ON expense_approval_thresholds (category_id NULLS FIRST, amount_min, amount_max);

ALTER TABLE expense_approval_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY expense_thresholds_select_auth ON expense_approval_thresholds
  FOR SELECT TO authenticated USING (true);

-- Writes go through SECURITY DEFINER RPCs only — no INSERT/UPDATE/DELETE policy
REVOKE INSERT, UPDATE, DELETE ON expense_approval_thresholds FROM authenticated, anon, PUBLIC;
GRANT SELECT ON expense_approval_thresholds TO authenticated;

-- updated_at trigger (reuse expenses_set_updated_at from S13)
CREATE TRIGGER trg_expense_thresholds_set_updated_at
  BEFORE UPDATE ON expense_approval_thresholds
  FOR EACH ROW EXECUTE FUNCTION expenses_set_updated_at();

COMMENT ON TABLE expense_approval_thresholds IS
  'S28 : configurable per-category approval thresholds. Resolution = best match (category-specific > NULL default). steps=[] = auto-approve.';
```

- [ ] **Step 2: Verify table created via MCP `execute_sql`**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'expense_approval_thresholds'
ORDER BY ordinal_position;
```
Expected: 7 rows (id, category_id, amount_min, amount_max, steps, created_at, updated_at).

- [ ] **Step 3: Mirror migration file locally**

Use the timestamp returned by MCP (e.g. `20260605000010` or whatever cloud assigns). Save file as `supabase/migrations/<cloud-ts>_create_expense_approval_thresholds_table.sql` with the exact SQL applied.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_create_expense_approval_thresholds_table.sql
git commit -m "feat(db): session 28 — wave 1.A — expense_approval_thresholds table"
```

---

### Task 1.B: Create `expense_approvals` table (append-only audit)

**Files:**
- Apply via MCP: name `create_expense_approvals_table`
- Locally mirror in `supabase/migrations/<cloud-ts>_create_expense_approvals_table.sql`

- [ ] **Step 1: Apply migration via MCP**

```sql
CREATE TABLE expense_approvals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id        UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  approver_user_id  UUID NOT NULL REFERENCES user_profiles(id),
  step              SMALLINT NOT NULL CHECK (step > 0),
  approved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_expense_step      UNIQUE (expense_id, step),
  CONSTRAINT uniq_expense_approver  UNIQUE (expense_id, approver_user_id)
);

CREATE INDEX idx_expense_approvals_expense ON expense_approvals (expense_id);

ALTER TABLE expense_approvals ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON expense_approvals FROM authenticated, anon, PUBLIC;
GRANT SELECT ON expense_approvals TO authenticated;

CREATE POLICY expense_approvals_select_auth ON expense_approvals
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE expense_approvals IS
  'S28 : per-step approval audit (append-only). UNIQUE(expense_id, approver_user_id) enforces SOD — same user cannot approve multiple steps.';
```

- [ ] **Step 2: Verify via MCP `execute_sql`**

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'expense_approvals'::regclass
  AND contype = 'u'
ORDER BY conname;
```
Expected: `uniq_expense_approver`, `uniq_expense_step`.

- [ ] **Step 3: Mirror migration file locally + commit**

```bash
git add supabase/migrations/*_create_expense_approvals_table.sql
git commit -m "feat(db): session 28 — wave 1.B — expense_approvals append-only audit table"
```

---

### Task 1.C: ALTER `expenses` + 3 columns (snapshot/current_step/auto_approved)

**Files:**
- Apply via MCP: name `alter_expenses_add_approval_snapshot_columns`

- [ ] **Step 1: Apply migration via MCP**

```sql
ALTER TABLE expenses
  ADD COLUMN required_approval_steps_snapshot JSONB NULL,
  ADD COLUMN current_approval_step SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN auto_approved BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN expenses.required_approval_steps_snapshot IS
  'S28 : frozen copy of required steps from threshold at submit time. NULL = pre-S28 expense (fallback to v1 workflow).';
COMMENT ON COLUMN expenses.current_approval_step IS
  'S28 : incremented at each approve. 0 = not started. = array_length(snapshot) → status=approved.';
COMMENT ON COLUMN expenses.auto_approved IS
  'S28 : true if steps=[] (auto-approve under threshold) — no row in expense_approvals.';
```

- [ ] **Step 2: Verify via MCP `execute_sql`**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'expenses'
  AND column_name IN ('required_approval_steps_snapshot', 'current_approval_step', 'auto_approved')
ORDER BY column_name;
```
Expected: 3 rows.

- [ ] **Step 3: Mirror migration file locally + commit**

```bash
git add supabase/migrations/*_alter_expenses_add_approval_snapshot_columns.sql
git commit -m "feat(db): session 28 — wave 1.C — expenses +3 cols snapshot/current_step/auto_approved"
```

---

### Task 1.D: Seed default thresholds + types regen

**Files:**
- Apply via MCP: name `seed_expense_approval_thresholds_defaults`
- Regen types: `mcp__plugin_supabase_supabase__generate_typescript_types`

- [ ] **Step 1: Apply seed migration via MCP**

```sql
INSERT INTO expense_approval_thresholds (category_id, amount_min, amount_max, steps) VALUES
  (NULL, 0,       100000,    '[]'::jsonb),
  (NULL, 100000,  1000000,   '[{"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"}]'::jsonb),
  (NULL, 1000000, 9999999999, '[
     {"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"},
     {"role_codes":["ADMIN","SUPER_ADMIN"],"label":"Owner approval"}
   ]'::jsonb);
```

- [ ] **Step 2: Verify rows via MCP `execute_sql`**

```sql
SELECT amount_min, amount_max, jsonb_array_length(steps) AS step_count
FROM expense_approval_thresholds
WHERE category_id IS NULL
ORDER BY amount_min;
```
Expected: 3 rows with step_count 0, 1, 2.

- [ ] **Step 3: Regen TS types via MCP**

Call `mcp__plugin_supabase_supabase__generate_typescript_types` and write result to `packages/supabase/src/types.generated.ts`.

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```
Expected: PASS (6/6 packages).

- [ ] **Step 5: Mirror migration + commit**

```bash
git add supabase/migrations/*_seed_expense_approval_thresholds_defaults.sql packages/supabase/src/types.generated.ts
git commit -m "feat(db,types): session 28 — wave 1.D — seed default thresholds + types regen"
```

---

## Wave 2 — RPCs + Trigger (10 migrations: 5 RPCs + 5 REVOKE pairs + 1 trigger)

> **Pattern reminder (S25 canonical)** — each RPC migration is followed by a REVOKE pair migration that:
> ```sql
> REVOKE EXECUTE ON FUNCTION <name>(<args>) FROM anon;
> REVOKE EXECUTE ON FUNCTION <name>(<args>) FROM PUBLIC;
> ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
> ```
> The third statement is idempotent project-wide (set in S20) but kept for defense-in-depth.

### Task 2.A: Bump `submit_expense_v2` (drops v1 in same migration)

**Files:**
- Apply via MCP: name `bump_submit_expense_v2_rpc`

- [ ] **Step 1: Apply migration via MCP**

```sql
-- Drop v1
DROP FUNCTION IF EXISTS submit_expense_v1(UUID);

-- Create v2 with threshold resolution + snapshot
CREATE OR REPLACE FUNCTION submit_expense_v2(
  p_expense_id      UUID,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid       UUID := auth.uid();
  v_caller_profile   UUID;
  v_expense          expenses;
  v_resolved_steps   JSONB;
  v_step_count       INT;
  v_replay           expenses;
BEGIN
  -- Idempotency replay (same key already used)
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_replay FROM expenses WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'expense_id', v_replay.id,
        'status', v_replay.status,
        'auto_approved', v_replay.auto_approved,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles WHERE auth_user_id = v_caller_uid LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v2: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  -- Perm gate (expenses.create or expenses.manage)
  IF NOT (has_permission(v_caller_uid, 'expenses.create') OR has_permission(v_caller_uid, 'expenses.manage')) THEN
    RAISE EXCEPTION 'submit_expense_v2: missing permission expenses.create' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_expense_v2: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF v_expense.status != 'draft' THEN
    RAISE EXCEPTION 'submit_expense_v2: expense % is not in draft (current=%)', p_expense_id, v_expense.status USING ERRCODE = 'P0001';
  END IF;

  -- Resolve threshold (best match : category-specific > NULL default)
  SELECT steps INTO v_resolved_steps
  FROM expense_approval_thresholds
  WHERE (category_id = v_expense.category_id OR category_id IS NULL)
    AND v_expense.amount >= amount_min
    AND v_expense.amount <  amount_max
  ORDER BY category_id NULLS LAST
  LIMIT 1;

  IF v_resolved_steps IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v2: no threshold matches amount % category %', v_expense.amount, v_expense.category_id
      USING ERRCODE = 'P0002';
  END IF;

  v_step_count := jsonb_array_length(v_resolved_steps);

  -- Snapshot freeze + status transition
  IF v_step_count = 0 THEN
    -- Auto-approve path
    UPDATE expenses SET
      required_approval_steps_snapshot = v_resolved_steps,
      auto_approved                    = true,
      status                           = 'approved',
      submitted_at                     = now(),
      submitted_by                     = v_caller_profile,
      approved_at                      = now(),
      approved_by                      = v_caller_profile,
      idempotency_key                  = COALESCE(p_idempotency_key, idempotency_key)
    WHERE id = p_expense_id;

    -- Emit JE (reuse v1 logic — call helper or inline). For brevity, audit_log + emit via existing trigger.
    INSERT INTO audit_logs (action, entity, entity_id, actor_user_id, payload)
    VALUES ('expense.auto_approved', 'expenses', p_expense_id, v_caller_uid,
            jsonb_build_object('amount', v_expense.amount, 'category_id', v_expense.category_id));

    -- TODO_RPC_HELPER : call internal _emit_expense_je(p_expense_id) helper (extracted from approve_expense_v1)
    PERFORM _emit_expense_je(p_expense_id);
  ELSE
    UPDATE expenses SET
      required_approval_steps_snapshot = v_resolved_steps,
      auto_approved                    = false,
      status                           = 'submitted',
      submitted_at                     = now(),
      submitted_by                     = v_caller_profile,
      idempotency_key                  = COALESCE(p_idempotency_key, idempotency_key)
    WHERE id = p_expense_id;

    INSERT INTO audit_logs (action, entity, entity_id, actor_user_id, payload)
    VALUES ('expense.submitted', 'expenses', p_expense_id, v_caller_uid,
            jsonb_build_object('amount', v_expense.amount, 'steps_required', v_step_count));
  END IF;

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'status', CASE WHEN v_step_count = 0 THEN 'approved' ELSE 'submitted' END,
    'auto_approved', v_step_count = 0,
    'steps_required', v_step_count
  );
END $$;

GRANT EXECUTE ON FUNCTION submit_expense_v2(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION submit_expense_v2(UUID, UUID) IS
  'S28 : submit expense + resolve threshold + snapshot freeze + auto-approve under bracket [0,100k). Idempotent via p_idempotency_key.';
```

> **NOTE for the implementer**: the helper `_emit_expense_je(UUID)` must be extracted from the existing `approve_expense_v1` body into a SECURITY DEFINER internal function during this task (or inlined here if extraction is too invasive). Verify by reading `supabase/migrations/20260517000122_create_expense_rpcs.sql` lines 150-267 for the JE emission block.

- [ ] **Step 2: Extract JE helper `_emit_expense_je`**

If not already extracted, create a private function in the same migration:
```sql
CREATE OR REPLACE FUNCTION _emit_expense_je(p_expense_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
-- Body: copy from approve_expense_v1 lines that build journal_entries + journal_entry_lines.
-- Reuses accounting_mappings keys EXPENSE_AP, EXPENSE_CASH_OUT, EXPENSE_VAT_INPUT.
-- Returns the created je_id.
DECLARE
  v_expense   expenses;
  v_je_id     UUID;
  v_dr_acct   UUID;
  v_cr_acct   UUID;
BEGIN
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;

  SELECT account_id INTO v_dr_acct FROM expense_categories WHERE id = v_expense.category_id;

  IF v_expense.payment_method = 'credit' THEN
    SELECT a.id INTO v_cr_acct FROM accounts a JOIN accounting_mappings m ON m.account_code = a.code WHERE m.mapping_key = 'EXPENSE_AP';
  ELSE
    SELECT a.id INTO v_cr_acct FROM accounts a JOIN accounting_mappings m ON m.account_code = a.code WHERE m.mapping_key = 'EXPENSE_CASH_OUT';
  END IF;

  INSERT INTO journal_entries (entry_date, description, source_type, source_id)
  VALUES (v_expense.expense_date, 'Expense ' || v_expense.expense_number, 'expense', p_expense_id)
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_je_id, v_dr_acct, v_expense.amount, 0, 'Expense ' || v_expense.expense_number),
    (v_je_id, v_cr_acct, 0, v_expense.amount, 'Expense ' || v_expense.expense_number);

  UPDATE expenses SET je_id = v_je_id WHERE id = p_expense_id;
  RETURN v_je_id;
END $$;

GRANT EXECUTE ON FUNCTION _emit_expense_je(UUID) TO authenticated;
```

- [ ] **Step 3: Verify v1 dropped, v2 created**

```sql
SELECT proname, pronargs FROM pg_proc WHERE proname IN ('submit_expense_v1', 'submit_expense_v2', '_emit_expense_je');
```
Expected: 2 rows — `submit_expense_v2` (2 args), `_emit_expense_je` (1 arg). No `submit_expense_v1`.

- [ ] **Step 4: Mirror migration + commit**

```bash
git add supabase/migrations/*_bump_submit_expense_v2_rpc.sql
git commit -m "feat(db): session 28 — wave 2.A — submit_expense_v2 (drops v1) + _emit_expense_je helper"
```

---

### Task 2.B: REVOKE pair for `submit_expense_v2`

- [ ] **Step 1: Apply migration via MCP**

```sql
REVOKE EXECUTE ON FUNCTION submit_expense_v2(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION submit_expense_v2(UUID, UUID) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Mirror file + commit**

```bash
git add supabase/migrations/*_revoke_anon_submit_expense_v2.sql
git commit -m "feat(db): session 28 — wave 2.B — REVOKE pair submit_expense_v2"
```

---

### Task 2.C: Bump `approve_expense_v2` (SOD + chain)

**Files:**
- Apply via MCP: name `bump_approve_expense_v2_rpc`

- [ ] **Step 1: Apply migration via MCP**

```sql
DROP FUNCTION IF EXISTS approve_expense_v1(UUID, TEXT);

CREATE OR REPLACE FUNCTION approve_expense_v2(
  p_expense_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_caller_role    TEXT;
  v_expense        expenses;
  v_snapshot       JSONB;
  v_step_count     INT;
  v_next_step_idx  INT;
  v_required_roles TEXT[];
  v_step_label     TEXT;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id, role_code INTO v_caller_profile, v_caller_role
  FROM user_profiles WHERE auth_user_id = v_caller_uid LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v2: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  -- Perm gate
  IF NOT has_permission(v_caller_uid, 'expenses.approve') THEN
    RAISE EXCEPTION 'approve_expense_v2: missing permission expenses.approve' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_expense_v2: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF v_expense.status != 'submitted' THEN
    RAISE EXCEPTION 'approve_expense_v2: expense % is not submitted (current=%)', p_expense_id, v_expense.status USING ERRCODE = 'P0001';
  END IF;

  -- SOD block 1 : creator cannot approve
  IF v_expense.created_by = v_caller_profile THEN
    RAISE EXCEPTION 'approve_expense_v2: sod_creator_block — creator cannot approve own expense' USING ERRCODE = 'P0001';
  END IF;

  v_snapshot := v_expense.required_approval_steps_snapshot;

  -- Fallback for legacy expenses (snapshot NULL) → 1-step v1 behavior
  IF v_snapshot IS NULL THEN
    v_snapshot := '[{"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"}]'::jsonb;
  END IF;

  v_step_count := jsonb_array_length(v_snapshot);
  v_next_step_idx := v_expense.current_approval_step;  -- 0-based index into snapshot

  IF v_next_step_idx >= v_step_count THEN
    RAISE EXCEPTION 'approve_expense_v2: all steps already approved (step %/%)', v_next_step_idx, v_step_count USING ERRCODE = 'P0001';
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(v_snapshot -> v_next_step_idx -> 'role_codes')),
         v_snapshot -> v_next_step_idx ->> 'label'
    INTO v_required_roles, v_step_label;

  IF NOT (v_caller_role = ANY(v_required_roles)) THEN
    RAISE EXCEPTION 'approve_expense_v2: missing_role — step % requires one of %', v_next_step_idx + 1, v_required_roles USING ERRCODE = 'P0003';
  END IF;

  -- SOD block 2 : UNIQUE(expense_id, approver_user_id) catches the case here
  BEGIN
    INSERT INTO expense_approvals (expense_id, approver_user_id, step)
    VALUES (p_expense_id, v_caller_profile, v_next_step_idx + 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'approve_expense_v2: sod_already_approved — caller already approved this expense' USING ERRCODE = 'P0001';
  END;

  UPDATE expenses SET
    current_approval_step = v_next_step_idx + 1
  WHERE id = p_expense_id;

  -- If this was the last step → status='approved' + emit JE
  IF v_next_step_idx + 1 = v_step_count THEN
    UPDATE expenses SET
      status      = 'approved',
      approved_at = now(),
      approved_by = v_caller_profile
    WHERE id = p_expense_id;

    PERFORM _emit_expense_je(p_expense_id);
  END IF;

  INSERT INTO audit_logs (action, entity, entity_id, actor_user_id, payload)
  VALUES ('expense.approved_step', 'expenses', p_expense_id, v_caller_uid,
          jsonb_build_object(
            'step', v_next_step_idx + 1,
            'of_total', v_step_count,
            'final', v_next_step_idx + 1 = v_step_count
          ));

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'step', v_next_step_idx + 1,
    'of_total', v_step_count,
    'status', CASE WHEN v_next_step_idx + 1 = v_step_count THEN 'approved' ELSE 'submitted' END
  );
END $$;

GRANT EXECUTE ON FUNCTION approve_expense_v2(UUID) TO authenticated;

COMMENT ON FUNCTION approve_expense_v2(UUID) IS
  'S28 : multi-step approve with SOD enforcement (creator block + UNIQUE expense_approvals approver). PIN gate handled client-side via header x-manager-pin (S25 pattern).';
```

- [ ] **Step 2: Verify v1 dropped, v2 created**

```sql
SELECT proname, pronargs FROM pg_proc WHERE proname IN ('approve_expense_v1', 'approve_expense_v2');
```
Expected: 1 row — `approve_expense_v2` (1 arg).

- [ ] **Step 3: Mirror migration + commit**

```bash
git add supabase/migrations/*_bump_approve_expense_v2_rpc.sql
git commit -m "feat(db): session 28 — wave 2.C — approve_expense_v2 SOD + multi-step chain (drops v1)"
```

---

### Task 2.D: REVOKE pair for `approve_expense_v2`

- [ ] **Step 1: Apply migration via MCP**

```sql
REVOKE EXECUTE ON FUNCTION approve_expense_v2(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION approve_expense_v2(UUID) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Mirror file + commit**

```bash
git add supabase/migrations/*_revoke_anon_approve_expense_v2.sql
git commit -m "feat(db): session 28 — wave 2.D — REVOKE pair approve_expense_v2"
```

---

### Task 2.E: Create `set_expense_threshold_v1` RPC

**Files:**
- Apply via MCP: name `create_set_expense_threshold_v1_rpc`

- [ ] **Step 1: Apply migration via MCP**

```sql
CREATE OR REPLACE FUNCTION set_expense_threshold_v1(
  p_threshold_id  UUID DEFAULT NULL,
  p_category_id   UUID DEFAULT NULL,
  p_amount_min    NUMERIC DEFAULT 0,
  p_amount_max    NUMERIC DEFAULT NULL,
  p_steps         JSONB DEFAULT '[]'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid  UUID := auth.uid();
  v_result_id   UUID;
  v_overlap     INT;
  v_step        JSONB;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Admin only
  IF NOT has_permission(v_caller_uid, 'expenses.thresholds.write') THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: missing permission expenses.thresholds.write' USING ERRCODE = '42501';
  END IF;

  -- Validate p_steps schema (array of {role_codes: TEXT[] non-empty, label: TEXT non-empty})
  IF jsonb_typeof(p_steps) != 'array' THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: p_steps must be a JSONB array' USING ERRCODE = '22023';
  END IF;
  FOR v_step IN SELECT jsonb_array_elements(p_steps) LOOP
    IF jsonb_typeof(v_step -> 'role_codes') != 'array'
       OR jsonb_array_length(v_step -> 'role_codes') = 0
       OR jsonb_typeof(v_step -> 'label') != 'string'
       OR length(v_step ->> 'label') = 0 THEN
      RAISE EXCEPTION 'set_expense_threshold_v1: invalid step shape — each step needs non-empty role_codes array + non-empty label' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Range validation
  IF p_amount_max IS NULL OR p_amount_max <= p_amount_min THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: p_amount_max must be > p_amount_min' USING ERRCODE = '22023';
  END IF;

  -- Overlap validation : no other row with same (category_id IS NOT DISTINCT FROM p_category_id) overlapping [p_amount_min, p_amount_max)
  SELECT COUNT(*) INTO v_overlap
  FROM expense_approval_thresholds
  WHERE id IS DISTINCT FROM p_threshold_id  -- exclude self on update
    AND category_id IS NOT DISTINCT FROM p_category_id
    AND p_amount_min < amount_max
    AND p_amount_max > amount_min;

  IF v_overlap > 0 THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: threshold_overlap — another row covers part of [%, %) for this category', p_amount_min, p_amount_max
      USING ERRCODE = 'P0002';
  END IF;

  IF p_threshold_id IS NULL THEN
    INSERT INTO expense_approval_thresholds (category_id, amount_min, amount_max, steps)
    VALUES (p_category_id, p_amount_min, p_amount_max, p_steps)
    RETURNING id INTO v_result_id;
  ELSE
    UPDATE expense_approval_thresholds
    SET category_id = p_category_id,
        amount_min  = p_amount_min,
        amount_max  = p_amount_max,
        steps       = p_steps
    WHERE id = p_threshold_id
    RETURNING id INTO v_result_id;

    IF v_result_id IS NULL THEN
      RAISE EXCEPTION 'set_expense_threshold_v1: threshold % not found', p_threshold_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO audit_logs (action, entity, entity_id, actor_user_id, payload)
  VALUES (
    CASE WHEN p_threshold_id IS NULL THEN 'expense_threshold.created' ELSE 'expense_threshold.updated' END,
    'expense_approval_thresholds', v_result_id, v_caller_uid,
    jsonb_build_object('category_id', p_category_id, 'amount_min', p_amount_min, 'amount_max', p_amount_max, 'steps', p_steps)
  );

  RETURN v_result_id;
END $$;

GRANT EXECUTE ON FUNCTION set_expense_threshold_v1(UUID, UUID, NUMERIC, NUMERIC, JSONB) TO authenticated;

COMMENT ON FUNCTION set_expense_threshold_v1(UUID, UUID, NUMERIC, NUMERIC, JSONB) IS
  'S28 : UPSERT threshold (admin-gated). Validates step shape + range + overlap. Returns threshold id.';
```

- [ ] **Step 2: Mirror migration + commit**

```bash
git add supabase/migrations/*_create_set_expense_threshold_v1_rpc.sql
git commit -m "feat(db): session 28 — wave 2.E — set_expense_threshold_v1 RPC (UPSERT + overlap validation)"
```

---

### Task 2.F: REVOKE pair for `set_expense_threshold_v1`

- [ ] **Step 1: Apply migration via MCP**

```sql
REVOKE EXECUTE ON FUNCTION set_expense_threshold_v1(UUID, UUID, NUMERIC, NUMERIC, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION set_expense_threshold_v1(UUID, UUID, NUMERIC, NUMERIC, JSONB) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/*_revoke_anon_set_expense_threshold_v1.sql
git commit -m "feat(db): session 28 — wave 2.F — REVOKE pair set_expense_threshold_v1"
```

---

### Task 2.G: Create `delete_expense_threshold_v1` RPC

**Files:**
- Apply via MCP: name `create_delete_expense_threshold_v1_rpc`

- [ ] **Step 1: Apply migration via MCP**

```sql
CREATE OR REPLACE FUNCTION delete_expense_threshold_v1(p_threshold_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_deleted    INT;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'delete_expense_threshold_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'expenses.thresholds.write') THEN
    RAISE EXCEPTION 'delete_expense_threshold_v1: missing permission expenses.thresholds.write' USING ERRCODE = '42501';
  END IF;

  DELETE FROM expense_approval_thresholds WHERE id = p_threshold_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'delete_expense_threshold_v1: threshold % not found', p_threshold_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audit_logs (action, entity, entity_id, actor_user_id, payload)
  VALUES ('expense_threshold.deleted', 'expense_approval_thresholds', p_threshold_id, v_caller_uid, '{}'::jsonb);

  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION delete_expense_threshold_v1(UUID) TO authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/*_create_delete_expense_threshold_v1_rpc.sql
git commit -m "feat(db): session 28 — wave 2.G — delete_expense_threshold_v1 RPC"
```

---

### Task 2.H: REVOKE pair for `delete_expense_threshold_v1`

- [ ] **Step 1: Apply migration via MCP**

```sql
REVOKE EXECUTE ON FUNCTION delete_expense_threshold_v1(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION delete_expense_threshold_v1(UUID) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/*_revoke_anon_delete_expense_threshold_v1.sql
git commit -m "feat(db): session 28 — wave 2.H — REVOKE pair delete_expense_threshold_v1"
```

---

### Task 2.I: Trigger `sync_cash_expense_to_session`

**Files:**
- Apply via MCP: name `create_sync_cash_expense_trigger`

- [ ] **Step 1: Apply migration via MCP**

```sql
CREATE OR REPLACE FUNCTION sync_cash_expense_to_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id  UUID;
  v_total       NUMERIC(15,2);
BEGIN
  IF OLD.status = 'paid' OR NEW.status != 'paid' OR NEW.payment_method != 'cash' THEN
    RETURN NEW;
  END IF;

  -- Total to deduct from cash : amount + vat (VAT also paid in cash)
  v_total := NEW.amount + COALESCE(NEW.vat_amount, 0);

  -- Find the open session of the paid_by user
  SELECT s.id INTO v_session_id
  FROM pos_sessions s
  JOIN user_profiles p ON p.id = NEW.paid_by AND p.auth_user_id = s.opened_by
  WHERE s.status = 'open'
  LIMIT 1;

  IF v_session_id IS NULL THEN
    -- No open session : log + WARNING, do NOT block
    INSERT INTO audit_logs (action, entity, entity_id, actor_user_id, payload)
    VALUES ('expense.cash_paid_no_session', 'expenses', NEW.id, auth.uid(),
            jsonb_build_object(
              'expense_id', NEW.id,
              'amount', v_total,
              'paid_by', NEW.paid_by,
              'reason', 'no_open_session_for_paid_by_user'
            ));
    RAISE WARNING 'sync_cash_expense_to_session: no open session for paid_by % — cash_out_total NOT updated', NEW.paid_by;
    RETURN NEW;
  END IF;

  UPDATE pos_sessions
  SET cash_out_total = cash_out_total + v_total
  WHERE id = v_session_id;

  INSERT INTO audit_logs (action, entity, entity_id, actor_user_id, payload)
  VALUES ('expense.cash_synced_to_session', 'expenses', NEW.id, auth.uid(),
          jsonb_build_object(
            'expense_id', NEW.id,
            'session_id', v_session_id,
            'amount_added', v_total
          ));

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_expenses_sync_cash ON expenses;
CREATE TRIGGER trg_expenses_sync_cash
  AFTER UPDATE OF status ON expenses
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.payment_method = 'cash')
  EXECUTE FUNCTION sync_cash_expense_to_session();
```

- [ ] **Step 2: Verify trigger exists**

```sql
SELECT tgname FROM pg_trigger WHERE tgrelid = 'expenses'::regclass AND tgname = 'trg_expenses_sync_cash';
```
Expected: 1 row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*_create_sync_cash_expense_trigger.sql
git commit -m "feat(db): session 28 — wave 2.I — sync_cash_expense_to_session trigger"
```

---

## Wave 3 — Permissions seed + Types regen

### Task 3.A: Seed `expenses.thresholds.{read,write}` permissions

**Files:**
- Apply via MCP: name `seed_perms_expenses_thresholds`

- [ ] **Step 1: Apply migration via MCP**

```sql
INSERT INTO permissions (code, module, action, description) VALUES
  ('expenses.thresholds.read',  'expenses', 'read',   'Read expense approval thresholds (settings page + UI badges).'),
  ('expenses.thresholds.write', 'expenses', 'update', 'Configure expense approval thresholds (admin-only).')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('CASHIER',     'expenses.thresholds.read',  true),
  ('MANAGER',     'expenses.thresholds.read',  true),
  ('ADMIN',       'expenses.thresholds.read',  true),
  ('SUPER_ADMIN', 'expenses.thresholds.read',  true),
  ('ADMIN',       'expenses.thresholds.write', true),
  ('SUPER_ADMIN', 'expenses.thresholds.write', true)
ON CONFLICT (role_code, permission_code) DO NOTHING;
```

- [ ] **Step 2: Verify perms**

```sql
SELECT code FROM permissions WHERE code LIKE 'expenses.thresholds.%' ORDER BY code;
```
Expected: 2 rows.

- [ ] **Step 3: Regen TS types via MCP**

Call `mcp__plugin_supabase_supabase__generate_typescript_types`, write to `packages/supabase/src/types.generated.ts`.

- [ ] **Step 4: Extend `PermissionCode` union in TS**

File: `packages/utils/src/permissions.ts` (or wherever the `PermissionCode` type lives — grep `expenses.approve` to locate).

```ts
export type PermissionCode =
  // ... existing codes ...
  | 'expenses.thresholds.read'
  | 'expenses.thresholds.write';
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_seed_perms_expenses_thresholds.sql packages/supabase/src/types.generated.ts packages/utils/src/permissions.ts
git commit -m "feat(db,types): session 28 — wave 3.A — seed expenses.thresholds perms + PermissionCode union"
```

---

## Wave 4 — pgTAP tests

### Task 4.A: Write pgTAP suite (18 asserts)

**Files:**
- Create: `supabase/tests/expense_governance.test.sql`
- Run via MCP `execute_sql` with `BEGIN ... ROLLBACK` envelope

- [ ] **Step 1: Write the test file**

```sql
-- supabase/tests/expense_governance.test.sql
-- Run with: BEGIN; \i tests/expense_governance.test.sql ROLLBACK;
-- Or via MCP execute_sql with the same envelope.

BEGIN;

SELECT plan(18);

-- ============================================================================
-- Fixtures
-- ============================================================================

-- 3 user_profiles : creator (CASHIER), manager (MANAGER), admin (ADMIN)
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000C01', 'creator@t.test'),
  ('00000000-0000-0000-0000-000000000M01', 'manager@t.test'),
  ('00000000-0000-0000-0000-000000000A01', 'admin@t.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles (id, auth_user_id, full_name, role_code, pin_hash, is_active) VALUES
  ('11111111-1111-1111-1111-111111111C01', '00000000-0000-0000-0000-000000000C01', 'Creator', 'CASHIER', 'x', true),
  ('11111111-1111-1111-1111-111111111M01', '00000000-0000-0000-0000-000000000M01', 'Manager', 'MANAGER', 'x', true),
  ('11111111-1111-1111-1111-111111111A01', '00000000-0000-0000-0000-000000000A01', 'Admin',   'ADMIN',   'x', true)
ON CONFLICT (id) DO NOTHING;

-- Test category
INSERT INTO expense_categories (id, code, name, account_id)
  SELECT '22222222-2222-2222-2222-222222222C01', 'T_CAT', 'Test Category', a.id
  FROM accounts a WHERE a.code = '6190' LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================================
-- T1 : auto-approve under 100k bracket
-- ============================================================================

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000C01"}';

INSERT INTO expenses (id, expense_number, category_id, amount, payment_method, description, created_by, status)
VALUES ('33333333-3333-3333-3333-333333333001', 'EXP-T-001', '22222222-2222-2222-2222-222222222C01', 50000, 'cash', 'T1', '11111111-1111-1111-1111-111111111C01', 'draft');

PERFORM submit_expense_v2('33333333-3333-3333-3333-333333333001');

SELECT is(
  (SELECT status FROM expenses WHERE id = '33333333-3333-3333-3333-333333333001'),
  'approved',
  'T1 : amount 50k → auto-approved'
);

SELECT is(
  (SELECT auto_approved FROM expenses WHERE id = '33333333-3333-3333-3333-333333333001'),
  true,
  'T1b : auto_approved flag set'
);

-- ============================================================================
-- T2 : 1-step bracket
-- ============================================================================

INSERT INTO expenses (id, expense_number, category_id, amount, payment_method, description, created_by, status)
VALUES ('33333333-3333-3333-3333-333333333002', 'EXP-T-002', '22222222-2222-2222-2222-222222222C01', 500000, 'transfer', 'T2', '11111111-1111-1111-1111-111111111C01', 'draft');

PERFORM submit_expense_v2('33333333-3333-3333-3333-333333333002');

SELECT is(
  (SELECT jsonb_array_length(required_approval_steps_snapshot) FROM expenses WHERE id = '33333333-3333-3333-3333-333333333002'),
  1,
  'T2 : amount 500k → 1 step snapshot'
);

-- ============================================================================
-- T3 : 2-step bracket
-- ============================================================================

INSERT INTO expenses (id, expense_number, category_id, amount, payment_method, description, created_by, status)
VALUES ('33333333-3333-3333-3333-333333333003', 'EXP-T-003', '22222222-2222-2222-2222-222222222C01', 2000000, 'transfer', 'T3', '11111111-1111-1111-1111-111111111C01', 'draft');

PERFORM submit_expense_v2('33333333-3333-3333-3333-333333333003');

SELECT is(
  (SELECT jsonb_array_length(required_approval_steps_snapshot) FROM expenses WHERE id = '33333333-3333-3333-3333-333333333003'),
  2,
  'T3 : amount 2M → 2 step snapshot'
);

-- ============================================================================
-- T4 : SOD block 1 — creator cannot approve own expense
-- ============================================================================

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000C01"}';
SELECT throws_ok(
  $$ SELECT approve_expense_v2('33333333-3333-3333-3333-333333333002') $$,
  'P0001',
  NULL,
  'T4 : SOD creator block raises P0001'
);

-- ============================================================================
-- T5 : CASHIER cannot approve (missing role)
-- T5 setup : have another cashier (not creator) try
-- ============================================================================

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000C02', 'creator2@t.test') ON CONFLICT DO NOTHING;
INSERT INTO user_profiles (id, auth_user_id, full_name, role_code, pin_hash, is_active)
  VALUES ('11111111-1111-1111-1111-111111111C02', '00000000-0000-0000-0000-000000000C02', 'Creator2', 'CASHIER', 'x', true)
ON CONFLICT DO NOTHING;

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000C02"}';
SELECT throws_ok(
  $$ SELECT approve_expense_v2('33333333-3333-3333-3333-333333333002') $$,
  '42501',
  NULL,
  'T5 : CASHIER missing expenses.approve → 42501'
);

-- ============================================================================
-- T6 : approve step 1 by MANAGER
-- ============================================================================

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000M01"}';
PERFORM approve_expense_v2('33333333-3333-3333-3333-333333333003');

SELECT is(
  (SELECT current_approval_step FROM expenses WHERE id = '33333333-3333-3333-3333-333333333003'),
  1::SMALLINT,
  'T6 : step 1 by MANAGER → current_approval_step=1'
);

SELECT is(
  (SELECT status FROM expenses WHERE id = '33333333-3333-3333-3333-333333333003'),
  'submitted',
  'T6b : status stays submitted while chain incomplete'
);

-- ============================================================================
-- T7 : SOD block 2 — same MANAGER cannot approve step 2
-- ============================================================================

SELECT throws_ok(
  $$ SELECT approve_expense_v2('33333333-3333-3333-3333-333333333003') $$,
  'P0001',
  NULL,
  'T7 : sod_already_approved (UNIQUE expense_approvals)'
);

-- ============================================================================
-- T8 : different ADMIN completes step 2 → status approved
-- ============================================================================

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000A01"}';
PERFORM approve_expense_v2('33333333-3333-3333-3333-333333333003');

SELECT is(
  (SELECT status FROM expenses WHERE id = '33333333-3333-3333-3333-333333333003'),
  'approved',
  'T8 : final step by ADMIN → status=approved'
);

SELECT isnt(
  (SELECT je_id FROM expenses WHERE id = '33333333-3333-3333-3333-333333333003'),
  NULL,
  'T8b : JE emitted on final approve'
);

-- ============================================================================
-- T9 : set_expense_threshold_v1 overlap → P0002
-- ============================================================================

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000A01"}';
SELECT throws_ok(
  $$ SELECT set_expense_threshold_v1(NULL, NULL, 50000, 200000, '[]'::jsonb) $$,
  'P0002',
  NULL,
  'T9 : overlap with default [0,100k) raises P0002'
);

-- ============================================================================
-- T10 : MANAGER cannot set threshold (admin-only)
-- ============================================================================

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000M01"}';
SELECT throws_ok(
  $$ SELECT set_expense_threshold_v1(NULL, NULL, 10000000, 20000000, '[]'::jsonb) $$,
  '42501',
  NULL,
  'T10 : MANAGER missing thresholds.write → 42501'
);

-- ============================================================================
-- T11 : category-specific override priority
-- ============================================================================

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000A01"}';
PERFORM set_expense_threshold_v1(
  NULL,
  '22222222-2222-2222-2222-222222222C01',
  100000,
  1000000,
  '[
    {"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager"},
    {"role_codes":["ADMIN","SUPER_ADMIN"],"label":"Owner"}
  ]'::jsonb
);

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000C01"}';
INSERT INTO expenses (id, expense_number, category_id, amount, payment_method, description, created_by, status)
VALUES ('33333333-3333-3333-3333-333333333011', 'EXP-T-011', '22222222-2222-2222-2222-222222222C01', 500000, 'transfer', 'T11', '11111111-1111-1111-1111-111111111C01', 'draft');

PERFORM submit_expense_v2('33333333-3333-3333-3333-333333333011');

SELECT is(
  (SELECT jsonb_array_length(required_approval_steps_snapshot) FROM expenses WHERE id = '33333333-3333-3333-3333-333333333011'),
  2,
  'T11 : category-specific override (2 steps) wins over NULL default (1 step)'
);

-- ============================================================================
-- T12 : cash sync trigger
-- ============================================================================

-- Open a POS session for manager
INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
VALUES ('44444444-4444-4444-4444-444444444001', '00000000-0000-0000-0000-000000000M01', 100000, 'open')
ON CONFLICT DO NOTHING;

-- Mark expense T1 (50k cash, already approved) as paid by manager
UPDATE expenses SET
  status = 'paid',
  paid_at = now(),
  paid_by = '11111111-1111-1111-1111-111111111M01'
WHERE id = '33333333-3333-3333-3333-333333333001';

SELECT is(
  (SELECT cash_out_total FROM pos_sessions WHERE id = '44444444-4444-4444-4444-444444444001'),
  50000::numeric,
  'T12 : cash sync → pos_sessions.cash_out_total += 50000'
);

-- ============================================================================
-- T13 : no open session → WARNING + audit but no block
-- ============================================================================

-- Close the session
UPDATE pos_sessions SET status = 'closed' WHERE id = '44444444-4444-4444-4444-444444444001';

INSERT INTO expenses (id, expense_number, category_id, amount, payment_method, description, created_by, status, paid_by, paid_at)
VALUES ('33333333-3333-3333-3333-333333333013', 'EXP-T-013', '22222222-2222-2222-2222-222222222C01', 50000, 'cash', 'T13', '11111111-1111-1111-1111-111111111C01', 'approved', '11111111-1111-1111-1111-111111111M01', now())
ON CONFLICT DO NOTHING;

UPDATE expenses SET status = 'paid', paid_at = now() WHERE id = '33333333-3333-3333-3333-333333333013';

SELECT ok(
  EXISTS (
    SELECT 1 FROM audit_logs
    WHERE entity_id = '33333333-3333-3333-3333-333333333013'
      AND action = 'expense.cash_paid_no_session'
  ),
  'T13 : audit row created when no open session'
);

-- ============================================================================
-- T14 : audit_log completeness for set/approve/sync
-- ============================================================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM audit_logs
    WHERE entity = 'expense_approval_thresholds'
      AND action = 'expense_threshold.created'
  ),
  'T14 : audit_log row for set_expense_threshold_v1'
);

-- ============================================================================
-- T15 : boundary inclusive lower
-- ============================================================================

INSERT INTO expenses (id, expense_number, category_id, amount, payment_method, description, created_by, status)
VALUES ('33333333-3333-3333-3333-333333333015', 'EXP-T-015', '22222222-2222-2222-2222-222222222C01', 100000, 'transfer', 'T15', '11111111-1111-1111-1111-111111111C01', 'draft');

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000C01"}';
PERFORM submit_expense_v2('33333333-3333-3333-3333-333333333015');

-- This expense's category T_CAT has a specific [100k, 1M) row from T11 with 2 steps
SELECT is(
  (SELECT jsonb_array_length(required_approval_steps_snapshot) FROM expenses WHERE id = '33333333-3333-3333-3333-333333333015'),
  2,
  'T15 : boundary 100k inclusive lower → uses [100k, 1M) bracket'
);

-- ============================================================================
-- T16 : legacy expense fallback (snapshot NULL)
-- ============================================================================

INSERT INTO expenses (id, expense_number, category_id, amount, payment_method, description, created_by, status, submitted_at, submitted_by)
VALUES ('33333333-3333-3333-3333-333333333016', 'EXP-T-016', '22222222-2222-2222-2222-222222222C01', 500000, 'transfer', 'T16-legacy', '11111111-1111-1111-1111-111111111C01', 'submitted', now(), '11111111-1111-1111-1111-111111111C01');
-- Explicitly leaving required_approval_steps_snapshot NULL (legacy pre-S28 row)

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000M01"}';
PERFORM approve_expense_v2('33333333-3333-3333-3333-333333333016');

SELECT is(
  (SELECT status FROM expenses WHERE id = '33333333-3333-3333-3333-333333333016'),
  'approved',
  'T16 : legacy expense (NULL snapshot) → fallback 1-step v1 approves OK'
);

-- ============================================================================
-- T17 : delete_expense_threshold_v1 OK
-- ============================================================================

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000A01"}';
-- Find the category-specific row from T11
SELECT delete_expense_threshold_v1(id) FROM expense_approval_thresholds
WHERE category_id = '22222222-2222-2222-2222-222222222C01' LIMIT 1;

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM expense_approval_thresholds
    WHERE category_id = '22222222-2222-2222-2222-222222222C01'
  ),
  'T17 : delete_expense_threshold_v1 removes the row'
);

-- ============================================================================
-- T18 : REVOKE EXECUTE FROM anon on all 4 RPCs
-- ============================================================================

SELECT is(
  (SELECT bool_and(NOT has_function_privilege('anon', oid, 'EXECUTE'))
   FROM pg_proc
   WHERE proname IN ('submit_expense_v2', 'approve_expense_v2', 'set_expense_threshold_v1', 'delete_expense_threshold_v1')),
  true,
  'T18 : anon REVOKEd on all 4 S28 RPCs'
);

SELECT * FROM finish();

ROLLBACK;
```

- [ ] **Step 2: Run via MCP `execute_sql` and confirm 18/18 PASS**

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/expense_governance.test.sql
git commit -m "test(db): session 28 — wave 4 — pgTAP expense_governance 18/18 PASS"
```

---

## Wave 5 — BO components + hooks

### Task 5.A: Hook `useExpenseThresholds` (read)

**Files:**
- Create: `apps/backoffice/src/features/settings/expense-thresholds/hooks/useExpenseThresholds.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export interface ApprovalStep {
  role_codes: string[];
  label: string;
}

export interface ExpenseThresholdRow {
  id: string;
  category_id: string | null;
  category_name?: string | null;
  amount_min: number;
  amount_max: number;
  steps: ApprovalStep[];
  created_at: string;
  updated_at: string;
}

export function useExpenseThresholds() {
  return useQuery({
    queryKey: ['expense_thresholds'],
    queryFn: async (): Promise<ExpenseThresholdRow[]> => {
      const { data, error } = await supabase
        .from('expense_approval_thresholds')
        .select('id, category_id, amount_min, amount_max, steps, created_at, updated_at, expense_categories(name)')
        .order('category_id', { nullsFirst: false })
        .order('amount_min', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        category_name: (r as { expense_categories?: { name: string } | null }).expense_categories?.name ?? null,
        steps: r.steps as ApprovalStep[],
      })) as ExpenseThresholdRow[];
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backoffice/src/features/settings/expense-thresholds/hooks/useExpenseThresholds.ts
git commit -m "feat(backoffice): session 28 — wave 5.A — useExpenseThresholds read hook"
```

---

### Task 5.B: Hooks `useSetExpenseThreshold` + `useDeleteExpenseThreshold`

**Files:**
- Create: `apps/backoffice/src/features/settings/expense-thresholds/hooks/useSetExpenseThreshold.ts`
- Create: `apps/backoffice/src/features/settings/expense-thresholds/hooks/useDeleteExpenseThreshold.ts`

- [ ] **Step 1: Write `useSetExpenseThreshold`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';
import type { ApprovalStep } from './useExpenseThresholds';

export interface SetThresholdInput {
  threshold_id?: string | null;
  category_id?: string | null;
  amount_min: number;
  amount_max: number;
  steps: ApprovalStep[];
}

export function useSetExpenseThreshold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetThresholdInput): Promise<string> => {
      const { data, error } = await supabase.rpc('set_expense_threshold_v1', {
        p_threshold_id: input.threshold_id ?? null,
        p_category_id:  input.category_id ?? null,
        p_amount_min:   input.amount_min,
        p_amount_max:   input.amount_max,
        p_steps:        input.steps,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense_thresholds'] });
    },
  });
}
```

- [ ] **Step 2: Write `useDeleteExpenseThreshold`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export function useDeleteExpenseThreshold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threshold_id: string): Promise<boolean> => {
      const { data, error } = await supabase.rpc('delete_expense_threshold_v1', {
        p_threshold_id: threshold_id,
      });
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense_thresholds'] });
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/settings/expense-thresholds/hooks/useSetExpenseThreshold.ts apps/backoffice/src/features/settings/expense-thresholds/hooks/useDeleteExpenseThreshold.ts
git commit -m "feat(backoffice): session 28 — wave 5.B — useSet+useDelete expense threshold hooks"
```

---

### Task 5.C: Hook `useExpenseApprovals` (per-expense read)

**Files:**
- Create: `apps/backoffice/src/features/expenses/hooks/useExpenseApprovals.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export interface ExpenseApprovalRow {
  id: string;
  expense_id: string;
  approver_user_id: string;
  approver_name: string | null;
  step: number;
  approved_at: string;
}

export function useExpenseApprovals(expenseId: string | null) {
  return useQuery({
    queryKey: ['expense_approvals', expenseId],
    enabled: !!expenseId,
    queryFn: async (): Promise<ExpenseApprovalRow[]> => {
      const { data, error } = await supabase
        .from('expense_approvals')
        .select('id, expense_id, approver_user_id, step, approved_at, user_profiles(full_name)')
        .eq('expense_id', expenseId!)
        .order('step', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        approver_name: (r as { user_profiles?: { full_name: string } | null }).user_profiles?.full_name ?? null,
      })) as ExpenseApprovalRow[];
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backoffice/src/features/expenses/hooks/useExpenseApprovals.ts
git commit -m "feat(backoffice): session 28 — wave 5.C — useExpenseApprovals per-expense read hook"
```

---

### Task 5.D: Bump `useSubmitExpense` + `useApproveExpense` (v2 + PIN-in-header)

**Files:**
- Modify: `apps/backoffice/src/features/expenses/hooks/useSubmitExpense.ts`
- Modify: `apps/backoffice/src/features/expenses/hooks/useApproveExpense.ts`

- [ ] **Step 1: Locate existing hooks**

```bash
grep -rn "submit_expense_v1\|approve_expense_v1" apps/backoffice/src
```
Note the exact file paths and surrounding code structure (signature of existing hooks, query invalidations, mutation envelope).

- [ ] **Step 2: Bump `useSubmitExpense` to v2**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { supabase } from '@breakery/supabase';

export function useSubmitExpense() {
  const qc = useQueryClient();
  // Per-mount idempotency key — survives re-renders within a single modal open
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const mutation = useMutation({
    mutationFn: async (expense_id: string) => {
      const { data, error } = await supabase.rpc('submit_expense_v2', {
        p_expense_id: expense_id,
        p_idempotency_key: idempotencyKey.current,
      });
      if (error) throw error;
      return data as { expense_id: string; status: string; auto_approved: boolean; steps_required: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });

  return {
    ...mutation,
    resetIdempotency: () => {
      idempotencyKey.current = crypto.randomUUID();
    },
  };
}
```

- [ ] **Step 3: Bump `useApproveExpense` to v2 (PIN-in-header)**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

interface ApproveInput {
  expense_id: string;
  manager_pin: string;
}

export function useApproveExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ expense_id, manager_pin }: ApproveInput) => {
      // PIN-in-header (S25 canonical pattern). Use existing helper if present.
      const { data, error } = await supabase
        .rpc('approve_expense_v2', { p_expense_id: expense_id }, {
          // @ts-expect-error supabase-js v2 supports headers on rpc options
          headers: { 'x-manager-pin': manager_pin },
        });
      if (error) throw error;
      return data as { expense_id: string; step: number; of_total: number; status: string };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense_approvals', vars.expense_id] });
    },
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/features/expenses/hooks/useSubmitExpense.ts apps/backoffice/src/features/expenses/hooks/useApproveExpense.ts
git commit -m "feat(backoffice): session 28 — wave 5.D — submit+approve hooks bumped to v2 (PIN-in-header + idempotency)"
```

---

### Task 5.E: Component `<ThresholdFormDialog>`

**Files:**
- Create: `apps/backoffice/src/features/settings/expense-thresholds/ThresholdFormDialog.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@breakery/ui';
import { Button, Input, Label, Select, SelectItem } from '@breakery/ui';
import { Trash2, Plus } from 'lucide-react';
import { useSetExpenseThreshold } from './hooks/useSetExpenseThreshold';
import type { ApprovalStep, ExpenseThresholdRow } from './hooks/useExpenseThresholds';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ExpenseThresholdRow | null;
  categories: { id: string; name: string }[];
}

const ROLE_OPTIONS = ['CASHIER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];

export function ThresholdFormDialog({ open, onOpenChange, initial, categories }: Props) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amountMin, setAmountMin] = useState<number>(0);
  const [amountMax, setAmountMax] = useState<number>(100000);
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const setMut = useSetExpenseThreshold();

  useEffect(() => {
    if (open) {
      setCategoryId(initial?.category_id ?? null);
      setAmountMin(initial?.amount_min ?? 0);
      setAmountMax(initial?.amount_max ?? 100000);
      setSteps(initial?.steps ?? []);
    }
  }, [open, initial]);

  const addStep = () =>
    setSteps((s) => [...s, { role_codes: ['MANAGER', 'ADMIN', 'SUPER_ADMIN'], label: 'Approval' }]);
  const removeStep = (idx: number) => setSteps((s) => s.filter((_, i) => i !== idx));
  const updateStepLabel = (idx: number, label: string) =>
    setSteps((s) => s.map((st, i) => (i === idx ? { ...st, label } : st)));
  const toggleStepRole = (idx: number, role: string) =>
    setSteps((s) =>
      s.map((st, i) =>
        i === idx
          ? {
              ...st,
              role_codes: st.role_codes.includes(role)
                ? st.role_codes.filter((r) => r !== role)
                : [...st.role_codes, role],
            }
          : st,
      ),
    );

  const submit = async () => {
    await setMut.mutateAsync({
      threshold_id: initial?.id ?? null,
      category_id: categoryId,
      amount_min: amountMin,
      amount_max: amountMax,
      steps,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle data-testid="threshold-form-title">{initial ? 'Edit threshold' : 'New threshold'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Category</Label>
            <Select value={categoryId ?? '__all__'} onValueChange={(v) => setCategoryId(v === '__all__' ? null : v)}>
              <SelectItem value="__all__">All categories (default)</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount min (IDR)</Label>
              <Input type="number" value={amountMin} onChange={(e) => setAmountMin(Number(e.target.value))} />
            </div>
            <div>
              <Label>Amount max (IDR, exclusive)</Label>
              <Input type="number" value={amountMax} onChange={(e) => setAmountMax(Number(e.target.value))} />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <Label>Approval steps</Label>
              <Button variant="outline" size="sm" onClick={addStep} data-testid="add-step-btn">
                <Plus className="w-4 h-4 mr-1" />
                Add step
              </Button>
            </div>
            <div className="text-sm text-muted-foreground mb-2">
              {steps.length === 0 ? 'No steps → auto-approve' : `${steps.length} step(s) required`}
            </div>
            {steps.map((step, idx) => (
              <div key={idx} className="border rounded p-3 mb-2 space-y-2" data-testid={`step-row-${idx}`}>
                <div className="flex justify-between items-center">
                  <Input value={step.label} onChange={(e) => updateStepLabel(idx, e.target.value)} placeholder="Step label" />
                  <Button variant="ghost" size="sm" onClick={() => removeStep(idx)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {ROLE_OPTIONS.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => toggleStepRole(idx, role)}
                      className={`px-2 py-1 text-xs rounded ${
                        step.role_codes.includes(role) ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {setMut.error && (
            <div className="text-sm text-destructive" data-testid="threshold-form-error">
              {(setMut.error as Error).message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={setMut.isPending} data-testid="threshold-form-submit">
            {setMut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backoffice/src/features/settings/expense-thresholds/ThresholdFormDialog.tsx
git commit -m "feat(backoffice): session 28 — wave 5.E — ThresholdFormDialog (create/edit with steps builder)"
```

---

### Task 5.F: Page `<ExpenseThresholdsPage>` + route + sidebar

**Files:**
- Create: `apps/backoffice/src/features/settings/expense-thresholds/ExpenseThresholdsPage.tsx`
- Modify: router config (locate via `grep -rn "settings/accounting" apps/backoffice/src/router*` or `apps/backoffice/src/App.tsx`)
- Modify: sidebar component (locate via `grep -rn "Settings.*Sidebar\|SidebarMenu" apps/backoffice/src/components/layout`)

- [ ] **Step 1: Write the page**

```tsx
import { useState } from 'react';
import { useExpenseThresholds, type ExpenseThresholdRow } from './hooks/useExpenseThresholds';
import { useDeleteExpenseThreshold } from './hooks/useDeleteExpenseThreshold';
import { ThresholdFormDialog } from './ThresholdFormDialog';
import { Button, Table, TableHeader, TableBody, TableRow, TableCell, TableHead } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore'; // adjust import to project's authStore path
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useExpenseCategories } from '../../expenses/hooks/useExpenseCategories'; // adjust path

export function ExpenseThresholdsPage() {
  const { hasPermission } = useAuthStore();
  const canWrite = hasPermission('expenses.thresholds.write');
  const { data: thresholds = [], isLoading } = useExpenseThresholds();
  const { data: categories = [] } = useExpenseCategories();
  const deleteMut = useDeleteExpenseThreshold();
  const [editing, setEditing] = useState<ExpenseThresholdRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const formatIDR = (n: number) => new Intl.NumberFormat('id-ID').format(n);

  return (
    <div className="p-6" data-testid="expense-thresholds-page">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Expense Approval Thresholds</h1>
          <p className="text-sm text-muted-foreground">
            Configure approval chains by amount bracket and category. Changes apply to new expenses only — in-flight expenses
            keep their original approval chain.
          </p>
        </div>
        {canWrite && (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            data-testid="new-threshold-btn"
          >
            <Plus className="w-4 h-4 mr-1" />
            New threshold
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead>Amount range (IDR)</TableHead>
            <TableHead>Steps</TableHead>
            <TableHead>Roles required</TableHead>
            {canWrite && <TableHead className="w-32" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={canWrite ? 5 : 4}>Loading…</TableCell>
            </TableRow>
          )}
          {thresholds.map((t) => (
            <TableRow key={t.id} data-testid={`threshold-row-${t.id}`}>
              <TableCell>{t.category_name ?? <em>All categories (default)</em>}</TableCell>
              <TableCell>
                {formatIDR(t.amount_min)} – {formatIDR(t.amount_max)}
              </TableCell>
              <TableCell>{t.steps.length === 0 ? 'Auto-approve' : `${t.steps.length} step(s)`}</TableCell>
              <TableCell>
                {t.steps.map((s, i) => (
                  <span key={i} className="block text-xs">
                    {s.label}: {s.role_codes.join(', ')}
                  </span>
                ))}
              </TableCell>
              {canWrite && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(t);
                      setDialogOpen(true);
                    }}
                    aria-label="Edit threshold"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (window.confirm('Delete this threshold?')) {
                        deleteMut.mutate(t.id);
                      }
                    }}
                    aria-label="Delete threshold"
                    data-testid={`delete-threshold-${t.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {dialogOpen && (
        <ThresholdFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initial={editing}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register route `/settings/expense-thresholds`**

Locate the router file (probably `apps/backoffice/src/App.tsx` or `apps/backoffice/src/router.tsx`). Add the route per the existing `/settings/accounting` pattern (S26b). Wrap in a `PermissionGuard permission='expenses.thresholds.read'` if such a primitive exists, else gate inline.

- [ ] **Step 3: Add sidebar entry**

Locate the sidebar (`grep -rn "Settings.*Accounting\|Fiscal Periods" apps/backoffice/src/components`). Add:

```tsx
{
  to: '/settings/expense-thresholds',
  label: 'Expense Thresholds',
  icon: Scale,
  permission: 'expenses.thresholds.read',
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/features/settings/expense-thresholds/ExpenseThresholdsPage.tsx apps/backoffice/src/App.tsx apps/backoffice/src/components/layout/*
git commit -m "feat(backoffice): session 28 — wave 5.F — ExpenseThresholdsPage + route + sidebar entry"
```

---

### Task 5.G: Component `<ApprovalTimeline>`

**Files:**
- Create: `apps/backoffice/src/features/expenses/components/ApprovalTimeline.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Check, Circle, CircleDot } from 'lucide-react';
import { useExpenseApprovals, type ExpenseApprovalRow } from '../hooks/useExpenseApprovals';
import type { ApprovalStep } from '../../settings/expense-thresholds/hooks/useExpenseThresholds';

interface Props {
  expenseId: string;
  snapshot: ApprovalStep[] | null;
  autoApproved: boolean;
  currentStep: number;
}

export function ApprovalTimeline({ expenseId, snapshot, autoApproved, currentStep }: Props) {
  const { data: approvals = [] } = useExpenseApprovals(expenseId);

  if (autoApproved) {
    return (
      <div className="border rounded p-3" data-testid="approval-timeline-auto">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Auto-approved (under threshold)</span>
        </div>
      </div>
    );
  }

  if (!snapshot || snapshot.length === 0) {
    return null;
  }

  return (
    <div className="border rounded p-3" data-testid="approval-timeline">
      <div className="text-sm font-medium mb-2">Approval chain</div>
      <ol className="space-y-2">
        {snapshot.map((step, idx) => {
          const approval = approvals.find((a) => a.step === idx + 1);
          const isDone = !!approval;
          const isCurrent = !isDone && idx === currentStep;
          return (
            <li key={idx} className="flex items-start gap-2" data-testid={`timeline-step-${idx}`}>
              {isDone ? (
                <Check className="w-4 h-4 text-green-600 mt-0.5" />
              ) : isCurrent ? (
                <CircleDot className="w-4 h-4 text-blue-600 mt-0.5" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground mt-0.5" />
              )}
              <div className="flex-1">
                <div className="text-sm">
                  Step {idx + 1}: {step.label}
                </div>
                <div className="text-xs text-muted-foreground">{step.role_codes.join(', ')}</div>
                {approval && (
                  <div className="text-xs text-muted-foreground" data-testid={`timeline-approver-${idx}`}>
                    Approved by {approval.approver_name ?? 'unknown'} on {new Date(approval.approved_at).toLocaleString()}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backoffice/src/features/expenses/components/ApprovalTimeline.tsx
git commit -m "feat(backoffice): session 28 — wave 5.G — ApprovalTimeline stepper component"
```

---

### Task 5.H: Component `<ThresholdResolutionBadge>` + wire `<ApproveDialog>` SOD + `ExpenseDetailPage` wiring

**Files:**
- Create: `apps/backoffice/src/features/expenses/components/ThresholdResolutionBadge.tsx`
- Modify: `apps/backoffice/src/features/expenses/components/ApproveDialog.tsx`
- Modify: `apps/backoffice/src/pages/expenses/ExpenseDetailPage.tsx`

- [ ] **Step 1: Write `<ThresholdResolutionBadge>`**

```tsx
import { Badge } from '@breakery/ui';
import type { ApprovalStep } from '../../settings/expense-thresholds/hooks/useExpenseThresholds';

interface Props {
  snapshot: ApprovalStep[] | null;
  autoApproved: boolean;
}

export function ThresholdResolutionBadge({ snapshot, autoApproved }: Props) {
  if (autoApproved) {
    return <Badge variant="secondary" data-testid="threshold-badge-auto">Auto-approved</Badge>;
  }
  if (!snapshot || snapshot.length === 0) return null;
  if (snapshot.length === 1) {
    return <Badge variant="outline" data-testid="threshold-badge-1step">Manager approval required</Badge>;
  }
  return (
    <Badge variant="outline" data-testid="threshold-badge-Nstep">
      {snapshot.length}-step approval required
    </Badge>
  );
}
```

- [ ] **Step 2: Bump `<ApproveDialog>` with SOD-aware button state**

Locate the existing `ApproveDialog.tsx`:
```bash
cat apps/backoffice/src/features/expenses/components/ApproveDialog.tsx
```

Add 2 props (`createdByUserId`, `approvals`) + 2 derived booleans (`isCreator`, `alreadyApproved`) + button disabled state + tooltip. Pseudo-diff:

```tsx
// Add to props interface:
interface Props {
  // ... existing props
  createdByUserId: string | null;
  approvals: ExpenseApprovalRow[];
  currentUserId: string | null;  // from authStore.user.user_profile_id
}

// Inside component:
const isCreator = !!createdByUserId && createdByUserId === currentUserId;
const alreadyApproved = approvals.some((a) => a.approver_user_id === currentUserId);
const sodBlocked = isCreator || alreadyApproved;
const sodReason = isCreator ? "You can't approve your own expense" : alreadyApproved ? 'You already approved this expense' : '';

// Replace the submit button:
<Button
  onClick={handleApprove}
  disabled={sodBlocked || mutation.isPending}
  title={sodReason || undefined}
  data-testid="approve-submit-btn"
>
  {sodBlocked ? 'Cannot approve' : 'Approve'}
</Button>
```

- [ ] **Step 3: Wire `<ApprovalTimeline>` + `<ThresholdResolutionBadge>` + bump `<ApproveDialog>` callers in `ExpenseDetailPage.tsx`**

Locate the page:
```bash
cat apps/backoffice/src/pages/expenses/ExpenseDetailPage.tsx
```

Add imports + render the 2 new components above the existing approve button area, and pass the new props down to `<ApproveDialog>`:

```tsx
import { ApprovalTimeline } from '@/features/expenses/components/ApprovalTimeline';
import { ThresholdResolutionBadge } from '@/features/expenses/components/ThresholdResolutionBadge';
import { useExpenseApprovals } from '@/features/expenses/hooks/useExpenseApprovals';

// Inside component, after fetching expense:
const { data: approvals = [] } = useExpenseApprovals(expense?.id ?? null);
const snapshot = expense?.required_approval_steps_snapshot as ApprovalStep[] | null;

// In JSX, beside the status badge:
<ThresholdResolutionBadge snapshot={snapshot} autoApproved={expense?.auto_approved ?? false} />

// In JSX, above the approve button area:
{expense?.status === 'submitted' && (
  <ApprovalTimeline
    expenseId={expense.id}
    snapshot={snapshot}
    autoApproved={expense.auto_approved}
    currentStep={expense.current_approval_step}
  />
)}

// Pass props to ApproveDialog:
<ApproveDialog
  // ... existing props
  createdByUserId={expense?.created_by ?? null}
  approvals={approvals}
  currentUserId={currentUser?.user_profile_id ?? null}
/>
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/expenses/components/ThresholdResolutionBadge.tsx apps/backoffice/src/features/expenses/components/ApproveDialog.tsx apps/backoffice/src/pages/expenses/ExpenseDetailPage.tsx
git commit -m "feat(backoffice): session 28 — wave 5.H — badge + ApproveDialog SOD + ExpenseDetailPage wiring"
```

---

## Wave 6 — BO Smoke Tests

### Task 6.A: Smoke `expense-thresholds-page.smoke.test.tsx` (3 asserts)

**Files:**
- Create: `apps/backoffice/src/features/expenses/__tests__/expense-thresholds-page.smoke.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExpenseThresholdsPage } from '@/features/settings/expense-thresholds/ExpenseThresholdsPage';

// Mock hooks
const mockData = [
  { id: 't1', category_id: null, category_name: null, amount_min: 0, amount_max: 100000, steps: [], created_at: '', updated_at: '' },
  { id: 't2', category_id: null, category_name: null, amount_min: 100000, amount_max: 1000000, steps: [{ role_codes: ['MANAGER'], label: 'Manager' }], created_at: '', updated_at: '' },
];
const mockSetMutate = vi.fn();
const mockDeleteMutate = vi.fn();

vi.mock('@/features/settings/expense-thresholds/hooks/useExpenseThresholds', () => ({
  useExpenseThresholds: () => ({ data: mockData, isLoading: false }),
}));
vi.mock('@/features/settings/expense-thresholds/hooks/useSetExpenseThreshold', () => ({
  useSetExpenseThreshold: () => ({ mutateAsync: mockSetMutate, isPending: false, error: null }),
}));
vi.mock('@/features/settings/expense-thresholds/hooks/useDeleteExpenseThreshold', () => ({
  useDeleteExpenseThreshold: () => ({ mutate: mockDeleteMutate, isPending: false }),
}));
vi.mock('@/features/expenses/hooks/useExpenseCategories', () => ({
  useExpenseCategories: () => ({ data: [{ id: 'c1', name: 'Rent' }] }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true }),
}));

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExpenseThresholdsPage />
    </QueryClientProvider>,
  );
};

describe('ExpenseThresholdsPage smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn().mockReturnValue(true);
  });

  it('T1 renders default rows', () => {
    renderPage();
    expect(screen.getByTestId('threshold-row-t1')).toBeInTheDocument();
    expect(screen.getByTestId('threshold-row-t2')).toBeInTheDocument();
  });

  it('T2 opens form dialog from "New threshold" button', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('new-threshold-btn'));
    expect(screen.getByTestId('threshold-form-title')).toHaveTextContent('New threshold');
  });

  it('T3 delete row calls useDeleteExpenseThreshold.mutate', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('delete-threshold-t1'));
    await waitFor(() => expect(mockDeleteMutate).toHaveBeenCalledWith('t1'));
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm --filter @breakery/app-backoffice test expense-thresholds-page.smoke
```
Expected: 3/3 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/expenses/__tests__/expense-thresholds-page.smoke.test.tsx
git commit -m "test(backoffice): session 28 — wave 6.A — ExpenseThresholdsPage smoke 3/3 PASS"
```

---

### Task 6.B: Smoke `approval-timeline.smoke.test.tsx` (3 asserts)

**Files:**
- Create: `apps/backoffice/src/features/expenses/__tests__/approval-timeline.smoke.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalTimeline } from '@/features/expenses/components/ApprovalTimeline';

vi.mock('@/features/expenses/hooks/useExpenseApprovals', () => ({
  useExpenseApprovals: vi.fn(),
}));
import { useExpenseApprovals } from '@/features/expenses/hooks/useExpenseApprovals';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('ApprovalTimeline smoke', () => {
  it('T1 snapshot=1 step + 0 approvals → 1 pending row', () => {
    vi.mocked(useExpenseApprovals).mockReturnValue({ data: [] } as ReturnType<typeof useExpenseApprovals>);
    wrap(
      <ApprovalTimeline
        expenseId="e1"
        snapshot={[{ role_codes: ['MANAGER'], label: 'Manager approval' }]}
        autoApproved={false}
        currentStep={0}
      />,
    );
    expect(screen.getByTestId('timeline-step-0')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-approver-0')).not.toBeInTheDocument();
  });

  it('T2 snapshot=2 steps + 1 approval → 1 approved + 1 pending', () => {
    vi.mocked(useExpenseApprovals).mockReturnValue({
      data: [{ id: 'a1', expense_id: 'e1', approver_user_id: 'u1', approver_name: 'Bob', step: 1, approved_at: '2026-05-24T10:00:00Z' }],
    } as ReturnType<typeof useExpenseApprovals>);
    wrap(
      <ApprovalTimeline
        expenseId="e1"
        snapshot={[
          { role_codes: ['MANAGER'], label: 'Manager' },
          { role_codes: ['ADMIN'], label: 'Owner' },
        ]}
        autoApproved={false}
        currentStep={1}
      />,
    );
    expect(screen.getByTestId('timeline-approver-0')).toHaveTextContent('Bob');
    expect(screen.queryByTestId('timeline-approver-1')).not.toBeInTheDocument();
  });

  it('T3 auto_approved=true → "Auto-approved" badge', () => {
    vi.mocked(useExpenseApprovals).mockReturnValue({ data: [] } as ReturnType<typeof useExpenseApprovals>);
    wrap(<ApprovalTimeline expenseId="e1" snapshot={[]} autoApproved={true} currentStep={0} />);
    expect(screen.getByTestId('approval-timeline-auto')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test + commit**

```bash
pnpm --filter @breakery/app-backoffice test approval-timeline.smoke
git add apps/backoffice/src/features/expenses/__tests__/approval-timeline.smoke.test.tsx
git commit -m "test(backoffice): session 28 — wave 6.B — ApprovalTimeline smoke 3/3 PASS"
```

---

### Task 6.C: Smoke `approve-dialog-sod.smoke.test.tsx` (2 asserts)

**Files:**
- Create: `apps/backoffice/src/features/expenses/__tests__/approve-dialog-sod.smoke.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApproveDialog } from '@/features/expenses/components/ApproveDialog';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('ApproveDialog SOD smoke', () => {
  it('T1 button disabled if user is creator', () => {
    wrap(
      <ApproveDialog
        open={true}
        onOpenChange={vi.fn()}
        expenseId="e1"
        createdByUserId="u1"
        approvals={[]}
        currentUserId="u1"
      />,
    );
    const btn = screen.getByTestId('approve-submit-btn');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', "You can't approve your own expense");
  });

  it('T2 button disabled if user already in approvals', () => {
    wrap(
      <ApproveDialog
        open={true}
        onOpenChange={vi.fn()}
        expenseId="e1"
        createdByUserId="other"
        approvals={[{ id: 'a1', expense_id: 'e1', approver_user_id: 'u1', approver_name: 'Self', step: 1, approved_at: '' }]}
        currentUserId="u1"
      />,
    );
    const btn = screen.getByTestId('approve-submit-btn');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'You already approved this expense');
  });
});
```

- [ ] **Step 2: Run test + commit**

```bash
pnpm --filter @breakery/app-backoffice test approve-dialog-sod.smoke
git add apps/backoffice/src/features/expenses/__tests__/approve-dialog-sod.smoke.test.tsx
git commit -m "test(backoffice): session 28 — wave 6.C — ApproveDialog SOD smoke 2/2 PASS"
```

---

## Wave 7 — Closeout

### Task 7.A: Run full typecheck + targeted test sweeps

- [ ] **Step 1: Run full typecheck**

```bash
pnpm typecheck
```
Expected: 6/6 PASS.

- [ ] **Step 2: Run targeted BO test sweep**

```bash
pnpm --filter @breakery/app-backoffice test expense
```
Expected: all expense-related smoke tests PASS (including S13 existing + S28 new).

- [ ] **Step 3: If failures**

For each failure, identify root cause (mocked hook signature drift, missing testid, snapshot stale). Fix inline + re-run before moving on. Do NOT mark Wave 7 complete with failing tests.

---

### Task 7.B: Write Session 28 INDEX

**Files:**
- Create: `docs/workplan/plans/2026-05-24-session-28-INDEX.md`

- [ ] **Step 1: Write the INDEX**

Follow the structure of `docs/workplan/plans/2026-05-24-session-27c-INDEX.md`:

1. Résumé exécutif
2. Commits (full table with SHA, wave, description — fill at the end with `git log --oneline`)
3. Migrations DB (14 rows)
4. Pages livrées (1)
5. Composants livrés (4)
6. Hooks livrés (5)
7. Tests (pgTAP 18 + BO smoke 8 = 26)
8. Permissions / Roles utilisés
9. Closes (TASK + gaps)
10. Hors scope (déféré S29+)
11. Déviations & DEV log (informationnel + medium si correctives appliquées)
12. Métriques (wall-time, lines diff, etc.)
13. PR (template Summary + Test plan)

- [ ] **Step 2: Commit**

```bash
git add docs/workplan/plans/2026-05-24-session-28-INDEX.md
git commit -m "docs(s28): wave 7.B — session 28 INDEX"
```

---

### Task 7.C: Update CLAUDE.md "Active Workplan"

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "Current session" bullet**

In `CLAUDE.md` under "Active Workplan", change "Current session" to point at S29 / next backlog candidate, and move S28 to "Previous session reference" bullet with full summary (mirror the pattern used for S27c → S26b → S26 in the existing file).

The summary should mention: 14 migrations, 5 RPCs (4 new/bumped + 1 trigger), 2 new tables, 3 new expense cols, 2 perms seedées, 4 BO components, 5 hooks, 26 tests, closes TASK-11-001.

Also extend the **Migration sequence active** sub-bullet with the S28 block timestamps.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(s28): wave 7.C — CLAUDE.md Active Workplan update for S28 closeout"
```

---

### Task 7.D: Final check — verify branch state

- [ ] **Step 1: `git log --oneline` against base**

```bash
git log --oneline master..HEAD
```
Expected: ~30 commits across 7 waves.

- [ ] **Step 2: Verify cloud DB drift**

```bash
# Via MCP : list_migrations
mcp__plugin_supabase_supabase__list_migrations(project_id='ikcyvlovptebroadgtvd')
```
Compare last 14 timestamps with `supabase/migrations/` local. Mirror any missing locally + commit.

- [ ] **Step 3: Pre-PR sanity**

```bash
pnpm typecheck      # 6/6 PASS
pnpm --filter @breakery/app-backoffice test  # expect S13 + S28 expense tests green
git status --short  # no uncommitted
```

- [ ] **Step 4: Ready for PR**

Branch `swarm/session-28` is ready to merge. Open PR with the template from INDEX §13.

---

## Self-Review Checklist (done after writing)

- **Spec coverage**:
  - §2.1 schema (3 changes) → Tasks 1.A, 1.B, 1.C ✓
  - §2.2 seed defaults → Task 1.D ✓
  - §2.3 resolution algorithm → embedded in submit_expense_v2 body (Task 2.A) ✓
  - §3 RPCs (5) → Tasks 2.A, 2.C, 2.E, 2.G + trigger 2.I ✓
  - §3 REVOKE pairs (4) → Tasks 2.B, 2.D, 2.F, 2.H ✓
  - §3 permissions seed → Task 3.A ✓
  - §4 BO 1 page + 4 components → Tasks 5.F (page), 5.E + 5.G + 5.H (components — ApprovalTimeline / ThresholdFormDialog / ThresholdResolutionBadge / ApproveDialog bump) ✓
  - §5 hooks (5) → Tasks 5.A, 5.B, 5.C, 5.D ✓
  - §7 tests (18 pgTAP + 8 BO smoke) → Task 4.A (pgTAP) + Tasks 6.A, 6.B, 6.C (BO smoke) ✓
  - §8 migrations (14) → all covered ✓
  - §10 closes → §7.C CLAUDE.md update ✓
- **Placeholder scan**: only one explicit "TODO_RPC_HELPER" remains as a label in Task 2.A Step 1 (extracted to Step 2). No other TBD/TODO outside actionable code.
- **Type consistency**: `ApprovalStep` defined in 5.A and reused in 5.B/5.E/5.G/5.H ✓ ; `ExpenseApprovalRow` defined in 5.C and reused in 5.H ✓ ; RPC arg names match between SQL and TS hooks ✓.

---

## Execution Handoff

Plan complete and saved to [`docs/workplan/plans/2026-05-24-session-28-plan.md`](./2026-05-24-session-28-plan.md).
