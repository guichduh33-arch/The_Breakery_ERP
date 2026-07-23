-- supabase/tests/payments_by_method_v2_timezone.test.sql
-- S57 Chantier B (B-D4) — pgTAP: get_payments_by_method_v3 timezone bucketing.
--
-- v1 bucketed on hardcoded UTC (p_date||'T00:00:00Z'/'T23:59:59Z' + DATE(paid_at));
-- v2 buckets on business_config.timezone (default Asia/Makassar), matching the
-- canonical pattern already used by get_daily_sales_v1 (20260624000011). This
-- suite checks the two RPCs AGREE on which LOCAL calendar day a
-- boundary-crossing sale belongs to.
--
-- T1 : a sale at local 00:15 (falls on the PREVIOUS UTC calendar date for any
--      positive-offset tz) is bucketed on the LOCAL day D by BOTH
--      get_payments_by_method_v3 and get_daily_sales_v1.
-- T2 : the same sale is NOT attributed to local day D-1 by either RPC (no
--      UTC-day leakage — the exact regression v1 had).
--
-- Fixture uses a far-future date (2031) to avoid collision with real seed
-- data in the shared V3 dev DB. Run via MCP execute_sql (BEGIN..ROLLBACK).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(2);

SET LOCAL session_replication_role = replica;  -- suppress sale-JE/other triggers for an isolated fixture

DO $$
DECLARE
  v_auth     uuid;
  v_prof     uuid;
  v_sess     uuid;
  v_tz       text;
  v_ord      uuid;
  v_paid_at  timestamptz;
  v_ppm_d    jsonb;
  v_ppm_dm1  jsonb;
  v_ds_d     jsonb;
  v_ds_dm1   jsonb;
  v_t1       boolean;
  v_t2       boolean;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.sales.read')
    AND has_permission(up.auth_user_id, 'reports.financial.read')
  LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz FROM business_config WHERE id = 1;

  -- orders_session_id_required_for_pos : created_via='pos' requires a real session_id.
  INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open')
  RETURNING id INTO v_sess;

  -- Local day 2031-04-16, 00:15 local — falls on 2031-04-15 in UTC for any
  -- positive-offset tz (same construction as get_gross_margin_by_product_v1's
  -- T2 fixture, gross_margin_by_product.test.sql).
  v_paid_at := ('2031-04-16 00:15:00')::timestamp AT TIME ZONE v_tz;

  INSERT INTO orders (order_number, session_id, status, subtotal, tax_amount, total, created_via, paid_at)
  VALUES ('PPM-TZ-ORD-1', v_sess, 'paid', 1000, 100, 1100, 'pos', v_paid_at)
  RETURNING id INTO v_ord;
  INSERT INTO order_payments (order_id, method, amount, paid_at)
  VALUES (v_ord, 'cash', 1100, v_paid_at);

  v_ppm_d   := get_payments_by_method_v3('2031-04-16', '2031-04-16');
  v_ppm_dm1 := get_payments_by_method_v3('2031-04-15', '2031-04-15');
  v_ds_d    := get_daily_sales_v1('2031-04-16', '2031-04-16');
  v_ds_dm1  := get_daily_sales_v1('2031-04-15', '2031-04-15');

  v_t1 := (v_ppm_d->'summary'->>'total_amount')::numeric = 1100
      AND jsonb_array_length(v_ppm_d->'by_day') = 1
      AND (v_ds_d->'summary'->>'order_count')::int = 1
      AND (v_ds_d->'summary'->>'total')::numeric = 1100;
  PERFORM set_config('breakery.ppmtz_t1', v_t1::text, false);

  v_t2 := (v_ppm_dm1->'summary'->>'total_amount')::numeric = 0
      AND jsonb_array_length(v_ppm_dm1->'by_day') = 0
      AND (v_ds_dm1->'summary'->>'order_count')::int = 0;
  PERFORM set_config('breakery.ppmtz_t2', v_t2::text, false);
END
$$;

SELECT ok(current_setting('breakery.ppmtz_t1')::boolean,
  'T1: sale at local 00:15 bucketed on local day D by both get_payments_by_method_v3 and get_daily_sales_v1');
SELECT ok(current_setting('breakery.ppmtz_t2')::boolean,
  'T2: same sale NOT attributed to local day D-1 by either RPC (no UTC-day leakage)');

SELECT * FROM finish();
ROLLBACK;
