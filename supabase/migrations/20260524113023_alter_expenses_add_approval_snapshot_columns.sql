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
