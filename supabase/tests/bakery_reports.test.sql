-- supabase/tests/bakery_reports.test.sql
-- S30 Wave 2 — pgTAP tests for 5 bakery reports RPCs (15 assertions T1–T15).
--
-- Covers:
--   T1  : get_wastage_report_v2 MANAGER happy path — 5-key JSONB
--
-- Audit Reports 2026-08-01 (R-02/R-08) : repointed v1 -> v2 (v1 dropped,
-- 20260801000002 — fenetre resolue dans business_config.timezone au lieu de
-- bornes UTC, et cle additive `truncated`). Aucune assertion ici ne depend du
-- decalage de fuseau ; T1 verifie en plus la presence de `truncated`.
--   T2  : get_wastage_report_v2 CASHIER denied (42501)
--   T3  : get_wastage_report_v2 empty period returns 0 totals
--   T3b : get_wastage_report_v2 00:30 LOCAL on the start day is inside the window
--   T3c : get_wastage_report_v2 03:00 LOCAL on end-day+1 is outside the window
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

SELECT plan(17);

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
  v_result := get_wastage_report_v2('2026-01-01', '2026-12-31');
  v_ok := (v_result ? 'period')
      AND (v_result ? 'summary')
      AND (v_result ? 'by_product')
      AND (v_result ? 'lines')
      AND (v_result ? 'truncated');
  PERFORM set_config('breakery.t1_pass', v_ok::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t1_pass')::boolean,
  'T1: get_wastage_report_v2 MANAGER happy path returns 5-key JSONB'
);

-- T2 perm denied : CASHIER → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_wastage_report_v2('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t2_pass', v_caught::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t2_pass')::boolean,
  'T2: get_wastage_report_v2 CASHIER raises 42501'
);

-- T3 empty period returns 0 totals
DO $$
DECLARE
  v_result JSONB;
  v_zero   BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_wastage_report_v2('1900-01-01', '1900-12-31');
  v_zero := (v_result->'summary'->>'total_qty')::numeric = 0
        AND (v_result->'summary'->>'line_count')::int = 0;
  PERFORM set_config('breakery.t3_pass', v_zero::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t3_pass')::boolean,
  'T3: get_wastage_report_v2 empty period returns 0 totals'
);

-- T3b / T3c : la fenetre est resolue dans business_config.timezone, pas en UTC.
-- v1 bornait `${date}T00:00:00Z` / `${date}T23:59:59Z`, ce qui sur Asia/Makassar
-- (UTC+8) demarrait a 08:00 LOCALE et finissait a 07:59 LOCALE le lendemain : la
-- fenetre perdait les pertes du petit matin du jour de debut et ramassait celles
-- du lendemain matin du jour de fin. Ces deux assertions verrouillent le
-- comportement dans les deux sens.
DO $$
DECLARE
  v_pid  UUID;
  v_uid  UUID;
  v_res  JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT id INTO v_pid FROM products WHERE deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_uid FROM user_profiles
   WHERE auth_user_id = '00000000-0000-0000-0000-000000000004';

  INSERT INTO stock_movements
    (product_id, movement_type, quantity, unit, unit_cost, reason, reference_type, created_by, created_at)
  VALUES
    (v_pid, 'waste', -3, 'pcs', 1000, 'tz-probe-early',    'admin_action', v_uid,
     ('2026-03-10'::date + TIME '00:30') AT TIME ZONE 'Asia/Makassar'),
    (v_pid, 'waste', -7, 'pcs', 1000, 'tz-probe-next-day', 'admin_action', v_uid,
     ('2026-03-11'::date + TIME '03:00') AT TIME ZONE 'Asia/Makassar');

  v_res := get_wastage_report_v2('2026-03-10', '2026-03-10');

  PERFORM set_config('breakery.t3b_pass', EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_res->'lines') l
     WHERE l->>'reason' = 'tz-probe-early')::text, false);
  PERFORM set_config('breakery.t3c_pass', (NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_res->'lines') l
     WHERE l->>'reason' = 'tz-probe-next-day'))::text, false);
END
$$;
SELECT ok(
  current_setting('breakery.t3b_pass')::boolean,
  'T3b: 00:30 local waste on the start day is INSIDE the window'
);
SELECT ok(
  current_setting('breakery.t3c_pass')::boolean,
  'T3c: 03:00 local waste on end-day+1 is OUTSIDE the window'
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
