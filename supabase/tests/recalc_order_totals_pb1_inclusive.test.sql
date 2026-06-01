-- supabase/tests/recalc_order_totals_pb1_inclusive.test.sql
-- H2 audit fix (2026-06-01) — _recalc_order_totals must recompute PB1-INCLUSIVE:
--   tax   = round_idr(subtotal * rate / (1 + rate))   (embedded share)
--   total = subtotal                                   (gross == total)
-- Regression guard against the original tax-EXCLUSIVE bug (tax = subtotal*rate,
-- total = subtotal + tax) which inflated edited-order totals by ~PB1%.
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

DO $$
DECLARE
  v_cashier UUID := (SELECT id FROM user_profiles WHERE role_code='CASHIER' LIMIT 1);
  v_product UUID := (SELECT id FROM products WHERE is_active=true LIMIT 1);
  v_session UUID;
  v_order   UUID;
BEGIN
  INSERT INTO pos_sessions (opened_by, opening_cash)
  VALUES (v_cashier, 100000) RETURNING id INTO v_session;

  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total)
  VALUES ('T-ORD-H2-' || gen_random_uuid()::text, v_session, v_cashier, 'dine_in', 'draft', 0, 0, 0)
  RETURNING id INTO v_order;

  -- Single line, gross 100000 (PB1-inclusive price)
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, v_product, 'H2 line', 1, 100000, 100000);

  PERFORM _recalc_order_totals(v_order);
  PERFORM set_config('breakery.h2_order', v_order::text, false);
END $$;

SELECT plan(3);

-- H2-T1: total == subtotal (inclusive — total NOT inflated by tax)
SELECT is(
  (SELECT total FROM orders WHERE id = current_setting('breakery.h2_order')::uuid),
  (SELECT subtotal FROM orders WHERE id = current_setting('breakery.h2_order')::uuid),
  'H2-T1 : total == subtotal (PB1-inclusive, total not inflated)'
);

-- H2-T2: subtotal reflects the line gross
SELECT is(
  (SELECT subtotal FROM orders WHERE id = current_setting('breakery.h2_order')::uuid),
  100000::NUMERIC,
  'H2-T2 : subtotal == sum(line_total) == 100000'
);

-- H2-T3: tax == round_idr(subtotal * rate / (1 + rate)) — embedded PB1 share
SELECT is(
  (SELECT tax_amount FROM orders WHERE id = current_setting('breakery.h2_order')::uuid),
  round_idr(100000 * current_pb1_rate() / (1 + current_pb1_rate())),
  'H2-T3 : tax == round_idr(subtotal * rate/(1+rate)) (inclusive extraction)'
);

SELECT * FROM finish();
ROLLBACK;
