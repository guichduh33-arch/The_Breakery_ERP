-- supabase/tests/bakery_reports.test.sql
-- S30 Wave 2 — pgTAP tests for 5 bakery reports RPCs (15 assertions T1–T15).
--
-- Covers:
--   T1  : get_wastage_report_v1 MANAGER happy path — 4-key JSONB
--   T2  : get_wastage_report_v1 CASHIER denied (42501)
--   T3  : get_wastage_report_v1 empty period returns 0 totals
--   T4  : get_payments_by_method_v3 MANAGER happy path — 4-key JSONB
--   T5  : get_payments_by_method_v3 CASHIER denied (42501)
--   T6  : get_payments_by_method_v3 by_day pivots 9 methods + other + total + day
--
-- S57 B-D4 : repointed v1 -> v2 (v1 dropped, 20260710000094 — UTC bucketing
-- fixed to business_config.timezone, no assertion here depends on the tz fix).
--   T7  : get_pb1_report_v1 happy month — 8-key JSONB
--   T8  : get_pb1_report_v1 CASHIER denied (42501)
--   T9  : get_pb1_report_v1 month=13 raises 22023
--   T10 : get_stock_movements_v2 returns lines[] + next_cursor
--   T11 : get_stock_movements_v2 movement_type filter returns only matching rows
--   T12 : get_stock_movements_v2 p_limit=999 clamps to <= 200
--
-- S57 B-D4 sweep : T10-T12 repointed v1 -> v2 (pre-existing staleness found
-- while executing this suite, unrelated to S57's own scope — v1 (6-arg,
-- created_at-only cursor) was dropped by 20260602130000 in favor of v2
-- (opaque TEXT keyset cursor "<created_at>|<id>"); same key names
-- lines/next_cursor, same gate reports.inventory.read, last positional arg
-- is now ::text instead of ::timestamptz.
--   T13 : get_perishable_turnover_v1 returns period + by_product array
--   T14 : get_perishable_turnover_v1 velocity_score in [1..5] on every row
--   T15 : get_perishable_turnover_v1 CASHIER denied (42501)
--
-- Seeded users reused (no new fixtures needed):
--   MANAGER : auth_user_id = 00000000-0000-0000-0000-000000000004
--   CASHIER : auth_user_id = 00000000-0000-0000-0000-000000000002
--
-- Run via mcp execute_sql wrapped in BEGIN/ROLLBACK — self-cleaning.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

-- ============================================================
-- B.1 Wastage & Spoilage (T1–T3)
-- ============================================================

-- T1 happy path : MANAGER calls with valid period, returns JSONB with 4 keys
DO $$
DECLARE
  v_result JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_wastage_report_v1('2026-01-01', '2026-12-31');
  v_ok := (v_result ? 'period')
      AND (v_result ? 'summary')
      AND (v_result ? 'by_product')
      AND (v_result ? 'lines');
  PERFORM set_config('breakery.t1_pass', v_ok::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t1_pass')::boolean,
  'T1: get_wastage_report_v1 MANAGER happy path returns 4-key JSONB'
);

-- T2 perm denied : CASHIER → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_wastage_report_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t2_pass', v_caught::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t2_pass')::boolean,
  'T2: get_wastage_report_v1 CASHIER raises 42501'
);

-- T3 empty period returns 0 totals
DO $$
DECLARE
  v_result JSONB;
  v_zero   BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_wastage_report_v1('1900-01-01', '1900-12-31');
  v_zero := (v_result->'summary'->>'total_qty')::numeric = 0
        AND (v_result->'summary'->>'line_count')::int = 0;
  PERFORM set_config('breakery.t3_pass', v_zero::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t3_pass')::boolean,
  'T3: get_wastage_report_v1 empty period returns 0 totals'
);

-- ============================================================
-- B.2 Payment by Method (T4–T6)
-- ============================================================

-- T4 happy path : returns 4-key JSONB
DO $$
DECLARE
  v_result JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_payments_by_method_v3('2026-01-01', '2026-12-31');
  v_ok := (v_result ? 'period')
      AND (v_result ? 'summary')
      AND (v_result ? 'by_method')
      AND (v_result ? 'by_day');
  PERFORM set_config('breakery.t4_pass', v_ok::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t4_pass')::boolean,
  'T4: get_payments_by_method_v3 MANAGER happy path returns 4-key JSONB'
);

-- T5 CASHIER perm denied → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_payments_by_method_v3('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t5_pass', v_caught::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t5_pass')::boolean,
  'T5: get_payments_by_method_v3 CASHIER raises 42501'
);

-- T6 by_day shape : if non-empty, each entry has required keys
DO $$
DECLARE
  v_result JSONB;
  v_by_day JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_payments_by_method_v3('2026-01-01', '2026-12-31');
  v_by_day := v_result->'by_day';
  -- If empty array, shape test passes vacuously
  v_ok := (jsonb_array_length(v_by_day) = 0)
       OR (
            (v_by_day->0 ? 'cash')
        AND (v_by_day->0 ? 'card')
        AND (v_by_day->0 ? 'qris')
        AND (v_by_day->0 ? 'edc')
        AND (v_by_day->0 ? 'transfer')
        AND (v_by_day->0 ? 'store_credit')
        AND (v_by_day->0 ? 'gopay')  -- lot C: e-wallet columns out of `other`
        AND (v_by_day->0 ? 'ovo')
        AND (v_by_day->0 ? 'dana')
        AND (v_by_day->0 ? 'other')  -- M9(b) catch-all
        AND (v_by_day->0 ? 'total')
        AND (v_by_day->0 ? 'day')
       );
  PERFORM set_config('breakery.t6_pass', v_ok::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t6_pass')::boolean,
  'T6: get_payments_by_method_v3 by_day pivots 9 methods + other + total + day'
);

-- ============================================================
-- B.3 PB1 monthly report (T7–T9)
-- ============================================================

-- T7 happy month : 8-key JSONB + balance_account_code = '2110'
DO $$
DECLARE
  v_result JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_pb1_report_v1(5, 2026);
  v_ok := (v_result->'period'->>'month')::int = 5
      AND (v_result->'period'->>'year')::int  = 2026
      AND (v_result ? 'pb1_rate')
      AND (v_result ? 'taxable_base')
      AND (v_result ? 'pb1_collected')
      AND (v_result ? 'pb1_payable')
      AND (v_result ? 'by_day')
      AND (v_result->>'balance_account_code') = '2110';
  PERFORM set_config('breakery.t7_pass', v_ok::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t7_pass')::boolean,
  'T7: get_pb1_report_v1 happy month returns 8-key JSONB with balance_account_code=2110'
);

-- T8 CASHIER perm denied → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_pb1_report_v1(5, 2026);
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t8_pass', v_caught::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t8_pass')::boolean,
  'T8: get_pb1_report_v1 CASHIER raises 42501'
);

-- T9 invalid month (13) rejected with 22023
DO $$
DECLARE
  v_caught   BOOLEAN := false;
  v_sqlstate TEXT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_pb1_report_v1(13, 2026);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_caught := (v_sqlstate = '22023');
  END;
  PERFORM set_config('breakery.t9_pass', v_caught::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t9_pass')::boolean,
  'T9: get_pb1_report_v1 month=13 raises 22023'
);

-- ============================================================
-- B.4 Stock Movement history (T10–T12)
-- ============================================================

-- T10 happy paginate : returns lines[] + next_cursor key
-- NOTE: explicit casts kept for clarity (last positional arg is the opaque
-- TEXT keyset cursor "<created_at>|<id>" in v2, was TIMESTAMPTZ in v1).
DO $$
DECLARE
  v_result JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_stock_movements_v2(
    '2026-01-01'::text, '2026-12-31'::text,
    NULL::uuid, NULL::text, 50::int, NULL::text
  );
  v_ok := (v_result ? 'lines')
      AND (v_result ? 'next_cursor')
      AND jsonb_typeof(v_result->'lines') = 'array';
  PERFORM set_config('breakery.t10_pass', v_ok::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t10_pass')::boolean,
  'T10: get_stock_movements_v2 returns lines[] + next_cursor'
);

-- T11 filter movement_type=waste returns only waste rows
DO $$
DECLARE
  v_result    JSONB;
  v_all_waste BOOLEAN := true;
  v_line      JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_stock_movements_v2(
    '2026-01-01'::text, '2026-12-31'::text,
    NULL::uuid, 'waste'::text, 50::int, NULL::text
  );
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_result->'lines') LOOP
    IF v_line->>'movement_type' <> 'waste' THEN
      v_all_waste := false;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t11_pass', v_all_waste::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t11_pass')::boolean,
  'T11: get_stock_movements_v2 movement_type=waste filter returns only waste rows'
);

-- T12 p_limit=999 clamps to <= 200
DO $$
DECLARE
  v_result JSONB;
  v_count  INT;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_stock_movements_v2(
    '2026-01-01'::text, '2026-12-31'::text,
    NULL::uuid, NULL::text, 999::int, NULL::text
  );
  v_count := jsonb_array_length(v_result->'lines');
  v_ok := v_count <= 200;
  PERFORM set_config('breakery.t12_pass', v_ok::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t12_pass')::boolean,
  'T12: get_stock_movements_v2 p_limit=999 clamps to <= 200 rows'
);

-- ============================================================
-- B.5 Perishable Turnover (T13–T15)
-- ============================================================

-- T13 happy returns period + by_product[]
DO $$
DECLARE
  v_result JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_perishable_turnover_v1('2026-01-01', '2026-12-31');
  v_ok := (v_result ? 'period')
      AND (v_result ? 'by_product')
      AND jsonb_typeof(v_result->'by_product') = 'array';
  PERFORM set_config('breakery.t13_pass', v_ok::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t13_pass')::boolean,
  'T13: get_perishable_turnover_v1 returns period + by_product array'
);

-- T14 velocity_score is in [1..5] on every row (vacuously true if empty)
DO $$
DECLARE
  v_result       JSONB;
  v_row          JSONB;
  v_score        INT;
  v_all_in_range BOOLEAN := true;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_perishable_turnover_v1('2026-01-01', '2026-12-31');
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_result->'by_product') LOOP
    v_score := (v_row->>'velocity_score')::int;
    IF v_score IS NULL OR v_score < 1 OR v_score > 5 THEN
      v_all_in_range := false;
    END IF;
  END LOOP;
  PERFORM set_config('breakery.t14_pass', v_all_in_range::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t14_pass')::boolean,
  'T14: get_perishable_turnover_v1 velocity_score in [1..5] on every row'
);

-- T15 CASHIER perm denied → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_perishable_turnover_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t15_pass', v_caught::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t15_pass')::boolean,
  'T15: get_perishable_turnover_v1 CASHIER raises 42501'
);

SELECT * FROM finish();
ROLLBACK;
