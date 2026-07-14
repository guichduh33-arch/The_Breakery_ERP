-- pay_existing_flag_aware.test.sql
-- S53 P1.4 — pay_existing_order_v11 is flag-aware: it now respects
-- business_config.allow_negative_stock (v10 rejected oversell unconditionally).
-- Deduction routes through _record_sale_stock_v1, whose guard honours the flag.
--
-- Run via MCP execute_sql under BEGIN/ROLLBACK. Cashier ...0002 has pos.sale.create + payments.process.
-- Captures each assertion's TAP line into _cap and returns (failures, total, lines).
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('00000000-0000-0000-0000-0000000cf002','00000000-0000-0000-0000-000000000002', 0, 'open');
INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory) VALUES
  ('00000000-0000-0000-0000-0000000fd001','S53-FA-Y','S53 FlagAware Y','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',5000,'finished',0,true);

-- Fire a simple tracked item at stock 0 (fire persists the snapshot; no deduction yet).
DO $$
DECLARE r jsonb;
BEGIN
  r := fire_counter_order_v4(
    p_client_uuid := '00000000-0000-0000-0000-0000000cfbbb'::uuid,
    p_session_id := '00000000-0000-0000-0000-0000000cf002',
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000fd001","quantity":1,"unit_price":5000,"modifiers":[]}]'::jsonb,
    p_order_type := 'dine_in'::order_type,
    p_table_number := 'PFA-T1'  -- S77: garde table_required_for_dine_in (_122)
  );
  PERFORM set_config('fa.order_id', r->>'order_id', false);
END $$;

CREATE TEMP TABLE _r(name text PRIMARY KEY, pass boolean) ON COMMIT DROP;

-- allow_negative = false -> pay must reject (insufficient); order stays unpaid.
UPDATE business_config SET allow_negative_stock=false WHERE id=1;
DO $$ DECLARE r jsonb; BEGIN
  r := pay_existing_order_v11(p_order_id := current_setting('fa.order_id')::uuid,
        p_payment := '{"method":"cash","amount":5000,"cash_received":5000,"change_given":0}'::jsonb);
  INSERT INTO _r VALUES ('blocked', false);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('blocked', true); END $$;
INSERT INTO _r VALUES ('still_unpaid', (SELECT status::text FROM orders WHERE id=current_setting('fa.order_id')::uuid) <> 'paid');

-- allow_negative = true -> pay succeeds, stock goes to -1.
UPDATE business_config SET allow_negative_stock=true WHERE id=1;
DO $$ DECLARE r jsonb; BEGIN
  r := pay_existing_order_v11(p_order_id := current_setting('fa.order_id')::uuid,
        p_payment := '{"method":"cash","amount":5000,"cash_received":5000,"change_given":0}'::jsonb);
  INSERT INTO _r VALUES ('paid_neg', (SELECT status::text FROM orders WHERE id=current_setting('fa.order_id')::uuid)='paid'
                                     AND (SELECT current_stock FROM products WHERE id='00000000-0000-0000-0000-0000000fd001')=-1);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('paid_neg', false); END $$;

SELECT plan(3);
CREATE TEMP TABLE _cap(l text);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='blocked'), 'v11 allow_negative=false rejects oversell at pay (NEW flag-aware)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='still_unpaid'), 'order remains unpaid after rejected pay');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='paid_neg'), 'v11 allow_negative=true pays + drives stock to -1 (flag respected)');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l,' | ') AS lines FROM _cap;
ROLLBACK;
