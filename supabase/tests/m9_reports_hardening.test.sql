-- supabase/tests/m9_reports_hardening.test.sql
-- pgTAP — M9 audit fix (2026-06-01 §Medium) :
--   T1 get_stock_movements_v2 keyset cursor — rows sharing one created_at paginate
--      with no drop/dupe (the created_at-only v1 cursor dropped them).
--   T2 get_payments_by_method_v2 by_day reconciles — 6 named methods + other = total.
-- S57 B-D4 : repointed v1 -> v2 (v1 dropped, 20260710000094).
-- Run via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(2);

-- ── T1 : keyset cursor over a tie cluster ───────────────────────────────────
DO $$
DECLARE
  v_auth uuid; v_prof uuid; v_cat uuid; v_prod uuid;
  v_ts timestamptz := '2026-06-02 10:00:00+00';
  v_cursor text; v_res jsonb; v_ids uuid[] := '{}'; v_page uuid[]; v_iter int := 0;
  i int;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
  FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.inventory.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;

  INSERT INTO products (name, sku, category_id, retail_price, unit)
  VALUES ('M9 Tie', 'M9-TIE-1', v_cat, 1000, 'pcs') RETURNING id INTO v_prod;
  FOR i IN 1..5 LOOP
    INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by, created_at)
    VALUES (v_prod, 'sale', -1, 'pcs', 'orders', gen_random_uuid(), v_prof, v_ts);
  END LOOP;

  LOOP
    v_iter := v_iter + 1;
    v_res := get_stock_movements_v2('2026-06-02','2026-06-02', v_prod, NULL, 2, v_cursor);
    SELECT array_agg((e->>'id')::uuid) INTO v_page FROM jsonb_array_elements(v_res->'lines') e;
    IF v_page IS NOT NULL THEN v_ids := v_ids || v_page; END IF;
    v_cursor := v_res->>'next_cursor';
    EXIT WHEN v_cursor IS NULL OR v_iter > 20;
  END LOOP;

  PERFORM set_config('breakery.m9_t1',
    (array_length(v_ids,1) = 5 AND (SELECT count(DISTINCT x) FROM unnest(v_ids) x) = 5)::text, false);
END $$;
SELECT ok(current_setting('breakery.m9_t1')::boolean,
  'T1: get_stock_movements_v2 keyset — 5 tied-timestamp rows paginate 2-by-2 with no drop/dupe');

-- ── T2 : by_day reconciliation ──────────────────────────────────────────────
SET LOCAL session_replication_role = replica;  -- suppress the sale-JE trigger for an isolated fixture
DO $$
DECLARE
  v_auth uuid; v_ord uuid; v_res jsonb; v_day jsonb; v_recon numeric; v_total numeric;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'reports.financial.read') LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_via)
  VALUES ('M9B-TEST-1', 'paid', 180, 0, 180, 'tablet') RETURNING id INTO v_ord;
  INSERT INTO order_payments (order_id, method, amount, paid_at) VALUES
    (v_ord, 'cash', 100, '2026-06-02 09:00:00+00'),
    (v_ord, 'card', 50,  '2026-06-02 09:05:00+00'),
    (v_ord, 'qris', 30,  '2026-06-02 09:10:00+00');

  v_res := get_payments_by_method_v2('2026-06-02','2026-06-02');
  v_day := v_res->'by_day'->0;
  v_recon := (v_day->>'cash')::numeric + (v_day->>'card')::numeric + (v_day->>'qris')::numeric
           + (v_day->>'edc')::numeric + (v_day->>'transfer')::numeric
           + (v_day->>'store_credit')::numeric + (v_day->>'other')::numeric;
  v_total := (v_day->>'total')::numeric;
  PERFORM set_config('breakery.m9_t2',
    ((v_day ? 'other') AND v_recon = v_total AND v_total = 180)::text, false);
END $$;
SELECT ok(current_setting('breakery.m9_t2')::boolean,
  'T2: get_payments_by_method_v2 by_day reconciles — cash+card+qris+edc+transfer+store_credit+other = total');

SELECT * FROM finish();
ROLLBACK;
