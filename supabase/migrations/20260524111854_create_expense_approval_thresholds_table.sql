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
