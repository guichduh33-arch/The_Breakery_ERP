-- supabase/tests/gross_margin_by_product.test.sql
-- S57 Chantier B (B-D1/B-D2/B-D3) — pgTAP for get_gross_margin_by_product_v1.
--
-- Covers:
--   T1 : happy path — revenue/cogs/margin/margin_pct computed correctly from a
--        known fixture (qty * unit_price = revenue via order_items.line_total,
--        qty * products.cost_price = cogs).
--   T2 : local-day tz attribution — a sale is counted on the LOCAL business
--        day (business_config.timezone), not the UTC calendar day.
--        NOTE ON DEVIATION vs brief wording ("vente à 23h30 Asia/Makassar") :
--        for a UTC+8 zone (Makassar default), local 23:30 stays on the SAME
--        UTC calendar date (local = UTC+8, so 23:30 - 8h = 15:30, no
--        rollover) — that clock value does not actually exercise the tz fix.
--        The genuinely boundary-crossing hours for a positive-offset tz are
--        LOCAL 00:00-07:59 (which land on the PREVIOUS UTC date). Adapted the
--        fixture to local 00:15 so the assertion is a real discriminator
--        between UTC-naive and tz-aware bucketing.
--   T3 : voided order excluded from revenue/cogs (belt-and-suspenders — the
--        RPC already filters on status IN ('paid','completed')).
--   T4 : caller without reports.financial.read -> 42501.
--   T5 : settled B2B order (status='paid', paid_at set — mirrors
--        record_b2b_payment_v2's full-settlement semantics, 20260710000067)
--        is included alongside POS sales.
--
-- Fixtures use far-future dates (2031) to avoid collision with real seed/demo
-- data in the shared V3 dev DB. Run via MCP execute_sql (BEGIN..ROLLBACK).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

SET LOCAL session_replication_role = replica;  -- suppress sale-JE/other triggers for isolated fixtures

-- ── T1 : happy path margin/margin_pct ───────────────────────────────────────
DO $$
DECLARE
  v_auth  uuid;
  v_cat   uuid;
  v_prod  uuid;
  v_ord   uuid;
  v_res   jsonb;
  v_line  jsonb;
  v_ok    boolean;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.financial.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO products (name, sku, category_id, retail_price, unit, cost_price)
  VALUES ('GM Test Product 1', 'GM-TEST-1', v_cat, 2500, 'pcs', 1000)
  RETURNING id INTO v_prod;

  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_via, paid_at)
  VALUES ('GM-TEST-ORD-1', 'paid', 7500, 750, 8250, 'pos', '2031-03-15 10:00:00+00')
  RETURNING id INTO v_ord;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_ord, v_prod, 'GM Test Product 1', 2500, 3, 7500);

  v_res := get_gross_margin_by_product_v1('2031-03-15', '2031-03-15');
  SELECT e INTO v_line FROM jsonb_array_elements(v_res->'by_product') e
    WHERE (e->>'product_id')::uuid = v_prod;

  v_ok := v_line IS NOT NULL
      AND (v_line->>'revenue')::numeric    = 7500
      AND (v_line->>'cogs')::numeric       = 3000
      AND (v_line->>'margin')::numeric     = 4500
      AND (v_line->>'margin_pct')::numeric = 60.00;
  PERFORM set_config('breakery.gm_t1', v_ok::text, false);
END
$$;
SELECT ok(current_setting('breakery.gm_t1')::boolean,
  'T1: get_gross_margin_by_product_v1 computes revenue/cogs/margin/margin_pct correctly');

-- ── T2 : local-day tz attribution ───────────────────────────────────────────
DO $$
DECLARE
  v_auth      uuid;
  v_cat       uuid;
  v_tz        text;
  v_prod      uuid;
  v_ord       uuid;
  v_paid_at   timestamptz;
  v_res_d     jsonb;
  v_res_dm1   jsonb;
  v_found_d   boolean;
  v_found_dm1 boolean;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.financial.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz FROM business_config WHERE id = 1;
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO products (name, sku, category_id, retail_price, unit, cost_price)
  VALUES ('GM Test Product TZ', 'GM-TEST-TZ', v_cat, 1000, 'pcs', 400)
  RETURNING id INTO v_prod;

  -- Local day 2031-03-16, 00:15 local time — falls on 2031-03-15 in UTC for
  -- any positive-offset tz.
  v_paid_at := ('2031-03-16 00:15:00')::timestamp AT TIME ZONE v_tz;

  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_via, paid_at)
  VALUES ('GM-TEST-ORD-TZ', 'paid', 1000, 100, 1100, 'pos', v_paid_at)
  RETURNING id INTO v_ord;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_ord, v_prod, 'GM Test Product TZ', 1000, 1, 1000);

  v_res_d   := get_gross_margin_by_product_v1('2031-03-16', '2031-03-16');
  v_res_dm1 := get_gross_margin_by_product_v1('2031-03-15', '2031-03-15');

  v_found_d   := EXISTS (SELECT 1 FROM jsonb_array_elements(v_res_d->'by_product') e
                          WHERE (e->>'product_id')::uuid = v_prod);
  v_found_dm1 := EXISTS (SELECT 1 FROM jsonb_array_elements(v_res_dm1->'by_product') e
                          WHERE (e->>'product_id')::uuid = v_prod);

  PERFORM set_config('breakery.gm_t2', (v_found_d AND NOT v_found_dm1)::text, false);
END
$$;
SELECT ok(current_setting('breakery.gm_t2')::boolean,
  'T2: sale at local 00:15 (tz boundary) attributed to the LOCAL day, not the UTC day');

-- ── T3 : voided order excluded ──────────────────────────────────────────────
DO $$
DECLARE
  v_auth  uuid;
  v_cat   uuid;
  v_prod  uuid;
  v_ord   uuid;
  v_res   jsonb;
  v_found boolean;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.financial.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO products (name, sku, category_id, retail_price, unit, cost_price)
  VALUES ('GM Test Product Void', 'GM-TEST-VOID', v_cat, 1000, 'pcs', 400)
  RETURNING id INTO v_prod;

  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_via, paid_at, voided_at)
  VALUES ('GM-TEST-ORD-VOID', 'voided', 1000, 100, 1100, 'pos',
          '2031-03-17 10:00:00+00', '2031-03-17 10:05:00+00')
  RETURNING id INTO v_ord;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_ord, v_prod, 'GM Test Product Void', 1000, 1, 1000);

  v_res := get_gross_margin_by_product_v1('2031-03-17', '2031-03-17');
  v_found := EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'by_product') e
                       WHERE (e->>'product_id')::uuid = v_prod);
  PERFORM set_config('breakery.gm_t3', (NOT v_found)::text, false);
END
$$;
SELECT ok(current_setting('breakery.gm_t3')::boolean,
  'T3: voided order excluded from gross margin');

-- ── T4 : permission gate ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_caught boolean := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_gross_margin_by_product_v1('2031-01-01', '2031-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.gm_t4', v_caught::text, false);
END
$$;
SELECT ok(current_setting('breakery.gm_t4')::boolean,
  'T4: get_gross_margin_by_product_v1 CASHIER raises 42501 (reports.financial.read required)');

-- ── T5 : B2B settled order included ─────────────────────────────────────────
DO $$
DECLARE
  v_auth  uuid;
  v_cat   uuid;
  v_prod  uuid;
  v_cust  uuid;
  v_ord   uuid;
  v_res   jsonb;
  v_found boolean;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.financial.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO customers (name) VALUES ('GM Test B2B Customer') RETURNING id INTO v_cust;
  INSERT INTO products (name, sku, category_id, retail_price, unit, cost_price)
  VALUES ('GM Test Product B2B', 'GM-TEST-B2B', v_cat, 5000, 'pcs', 2000)
  RETURNING id INTO v_prod;

  -- Mirrors record_b2b_payment_v2 full-settlement semantics (20260710000067):
  -- status flips to 'paid' + paid_at is set only once the invoice is fully
  -- settled (unsettled B2B orders sit in 'b2b_pending' with paid_at NULL and
  -- are correctly excluded by this RPC's status filter).
  INSERT INTO orders (order_number, order_type, status, customer_id, subtotal, tax_amount, total,
                       created_via, paid_at)
  VALUES ('GM-TEST-ORD-B2B', 'b2b', 'paid', v_cust, 10000, 0, 10000, 'pos', '2031-03-18 10:00:00+00')
  RETURNING id INTO v_ord;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
  VALUES (v_ord, v_prod, 'GM Test Product B2B', 5000, 2, 10000);

  v_res := get_gross_margin_by_product_v1('2031-03-18', '2031-03-18');
  v_found := EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'by_product') e
                       WHERE (e->>'product_id')::uuid = v_prod);
  PERFORM set_config('breakery.gm_t5', v_found::text, false);
END
$$;
SELECT ok(current_setting('breakery.gm_t5')::boolean,
  'T5: settled B2B order (status=paid) included in gross margin alongside POS sales');

SELECT * FROM finish();
ROLLBACK;
