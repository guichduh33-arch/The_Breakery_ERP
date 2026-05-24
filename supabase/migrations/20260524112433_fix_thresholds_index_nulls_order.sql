DROP INDEX IF EXISTS idx_thresholds_category_range;

CREATE INDEX idx_thresholds_category_range
  ON expense_approval_thresholds (category_id NULLS LAST, amount_min, amount_max);
