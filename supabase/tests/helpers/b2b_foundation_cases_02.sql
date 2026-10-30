-- ===========================================================================
-- T13 — create_b2b_order_v1 idempotency replay
-- ===========================================================================
DO $t13$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_key UUID := 'aabbccdd-0000-0000-0000-000000000013';
  v_r1 JSONB;
  v_r2 JSONB;
  v_count INT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE customers SET b2b_current_balance = 0
   WHERE id = 'b2bf0001-0000-0000-0000-000000000002';
  UPDATE products SET current_stock = 100.000
   WHERE id = 'b2bf0002-0000-0000-0000-000000000001';

  v_r1 := create_b2b_order_v8(
    p_customer_id     => 'b2bf0001-0000-0000-0000-000000000002',
    p_items           => jsonb_build_array(jsonb_build_object(
      'product_id', 'b2bf0002-0000-0000-0000-000000000001',
      'quantity',   1,
      'unit_price', 10000
    )),
    p_idempotency_key => v_key
  );

  v_r2 := create_b2b_order_v8(
    p_customer_id     => 'b2bf0001-0000-0000-0000-000000000002',
    p_items           => jsonb_build_array(jsonb_build_object(
      'product_id', 'b2bf0002-0000-0000-0000-000000000001',
      'quantity',   1,
      'unit_price', 10000
    )),
    p_idempotency_key => v_key
  );

  SELECT COUNT(*) INTO v_count FROM orders WHERE idempotency_key = v_key;

  PERFORM set_config('breakery.t13_pass',
    CASE WHEN
      v_count = 1
      AND (v_r1->>'order_id') = (v_r2->>'order_id')
      AND (v_r2->>'idempotent_replay')::boolean = TRUE
    THEN 'true' ELSE 'false' END, false);
END $t13$;
SELECT ok(current_setting('breakery.t13_pass')::boolean,
  'T13: create_b2b_order_v1 idempotency — 2 calls same key → 1 order, replay flag');

-- ===========================================================================
-- T14 — REVOKE UPDATE customers.b2b_current_balance pour authenticated
-- ===========================================================================
-- SET LOCAL ROLE authenticated pour bypasser le superuser et tester l'ACL réel.
DO $t14$
DECLARE
  v_caught BOOLEAN := FALSE;
BEGIN
  -- Reset to known state
  UPDATE customers SET b2b_current_balance = 0
   WHERE id = 'b2bf0001-0000-0000-0000-000000000002';

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE customers SET b2b_current_balance = 999999
      WHERE id = 'b2bf0001-0000-0000-0000-000000000002';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := TRUE;
  END;
  RESET ROLE;

  PERFORM set_config('breakery.t14_pass',
    CASE WHEN v_caught THEN 'true' ELSE 'false' END, false);
END $t14$;
SELECT ok(current_setting('breakery.t14_pass')::boolean,
  'T14: UPDATE customers.b2b_current_balance as authenticated raises insufficient_privilege');

-- ===========================================================================
-- T15 — validate_b2b_credit_limit_v1 est bien câblé dans create_b2b_order_v1
--       Sanity : forge un customer avec limite, tente order au-dessus →
--       erreur DOIT contenir "credit_limit_exceeded" (preuve du câblage).
-- ===========================================================================
DO $t15$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_err_message TEXT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE customers SET b2b_current_balance = 0
   WHERE id = 'b2bf0001-0000-0000-0000-000000000004';
  UPDATE products SET current_stock = 100.000
   WHERE id = 'b2bf0002-0000-0000-0000-000000000001';

  BEGIN
    PERFORM create_b2b_order_v8(
      p_customer_id => 'b2bf0001-0000-0000-0000-000000000004',
      p_items       => jsonb_build_array(jsonb_build_object(
        'product_id', 'b2bf0002-0000-0000-0000-000000000001',
        'quantity',   20,
        'unit_price', 50000
      ))
    );
    v_err_message := 'NO_ERROR_RAISED';
  EXCEPTION WHEN OTHERS THEN
    v_err_message := SQLERRM;
  END;

  PERFORM set_config('breakery.t15_pass',
    CASE WHEN v_err_message ILIKE '%credit_limit_exceeded%' THEN 'true' ELSE 'false' END,
    false);
END $t15$;
SELECT ok(current_setting('breakery.t15_pass')::boolean,
  'T15: validate_b2b_credit_limit_v1 wired in create_b2b_order_v1 — error contains credit_limit_exceeded');

SELECT * FROM finish();
