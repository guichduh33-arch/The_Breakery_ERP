-- 20260519000041_seed_business_config_yield_threshold.sql
-- Session 15 / Phase 2.A — F5 Yield threshold config.
--
-- Decision D6 : Variance modal triggered when |yield_variance_pct| > threshold.
-- Default 15.00% (= 0.1500 fraction). Stored on the singleton business_config row.
--
-- Schema note : business_config is a SINGLETON (id=1) with typed columns, not a
-- key-value store. We add a column and let the existing default row (id=1) pick
-- up the default. Pattern follows shift_variance_threshold_pct from migration
-- 20260517000136.

ALTER TABLE business_config
  ADD COLUMN IF NOT EXISTS production_yield_variance_threshold_pct
    NUMERIC(6,4) NOT NULL DEFAULT 0.1500;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'business_config_yield_variance_pct_range'
  ) THEN
    ALTER TABLE business_config
      ADD CONSTRAINT business_config_yield_variance_pct_range
      CHECK (production_yield_variance_threshold_pct >= 0
         AND production_yield_variance_threshold_pct <= 1);
  END IF;
END $$;

COMMENT ON COLUMN business_config.production_yield_variance_threshold_pct IS
  'Session 15 D6 — Yield variance modal threshold (fraction). Default 0.1500 = '
  '15.00%. UI requires a yield_variance_reason when |actual-expected|/expected '
  'exceeds this. Modifiable per tenant.';

-- Ensure the singleton row exists (defensive — should already from session 13).
INSERT INTO business_config (id, name)
VALUES (1, 'The Breakery')
ON CONFLICT (id) DO NOTHING;
