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
