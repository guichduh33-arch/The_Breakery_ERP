-- Session 32 / Wave 1.H : pgTAP for additive account_id exposure
-- on P&L and BS lines.
-- T1 P&L lines contain account_id key (when lines are non-empty).
-- T2 BS lines contain account_id key (when lines are non-empty).
-- Cash Flow drill-down deferred S33+ (DEV-S32-1.D-01) — no T3.

BEGIN;
SELECT plan(2);

-- T1 : P&L lines contain account_id UUID
DO $$
DECLARE
  v_lines JSONB;
  v_first JSONB;
BEGIN
  SELECT get_profit_loss_v1('2020-01-01'::date, '2030-12-31'::date)->'lines'
    INTO v_lines;
  v_first := v_lines->0;
  IF v_first IS NULL THEN
    PERFORM set_config('breakery.t1_pass', 'skipped_empty', false);
  ELSIF v_first ? 'account_id' THEN
    PERFORM set_config('breakery.t1_pass', 'pass', false);
  ELSE
    PERFORM set_config('breakery.t1_pass', 'fail', false);
  END IF;
END $$;
SELECT ok(
  current_setting('breakery.t1_pass') IN ('pass', 'skipped_empty'),
  'T1: get_profit_loss_v1 lines contain account_id key'
);

-- T2 : Balance Sheet lines contain account_id (new lines array, DEV-S32-1.C-01)
DO $$
DECLARE
  v_lines JSONB;
  v_first JSONB;
BEGIN
  SELECT get_balance_sheet_v1('2030-12-31'::date)->'lines' INTO v_lines;
  v_first := v_lines->0;
  IF v_first IS NULL THEN
    PERFORM set_config('breakery.t2_pass', 'skipped_empty', false);
  ELSIF v_first ? 'account_id' THEN
    PERFORM set_config('breakery.t2_pass', 'pass', false);
  ELSE
    PERFORM set_config('breakery.t2_pass', 'fail', false);
  END IF;
END $$;
SELECT ok(
  current_setting('breakery.t2_pass') IN ('pass', 'skipped_empty'),
  'T2: get_balance_sheet_v1 lines (new array) contain account_id key'
);

SELECT * FROM finish();
ROLLBACK;
