-- 20260515000004_harden_adjust_loyalty_points.sql
-- Session 12 hardening — adjust_loyalty_points :
--   1. Reject anonymous caller (defense-in-depth ; has_permission(NULL,…)
--      already returns false but be explicit).
--   2. Bound |p_delta| <= 1_000_000 to avoid INT overflow on
--      v_current_balance + p_delta (INT) and lifetime_points (INT).
--   3. Bound trim(p_reason) length <= 500 — description column is unbounded
--      TEXT so an adversary could spam the ledger.

CREATE OR REPLACE FUNCTION adjust_loyalty_points(
  p_customer_id UUID,
  p_delta       INT,
  p_reason      TEXT
) RETURNS TABLE (
  txn_id       UUID,
  new_balance  INT,
  new_lifetime INT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile_id       UUID;
  v_current_balance  INT;
  v_current_lifetime INT;
  v_new_balance      INT;
  v_new_lifetime     INT;
  v_txn_id           UUID;
  v_trimmed_reason   TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT has_permission(v_uid, 'loyalty.adjust') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_customer_id IS NULL OR p_delta IS NULL OR p_delta = 0 OR p_reason IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  IF abs(p_delta) > 1000000 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  v_trimmed_reason := trim(p_reason);
  IF length(v_trimmed_reason) < 5 OR length(v_trimmed_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT loyalty_points, lifetime_points
    INTO v_current_balance, v_current_lifetime
    FROM customers
    WHERE id = p_customer_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_deleted';
  END IF;

  v_new_balance  := v_current_balance + p_delta;
  v_new_lifetime := v_current_lifetime + GREATEST(p_delta, 0);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  INSERT INTO loyalty_transactions (
    customer_id, order_id, transaction_type, points,
    points_balance_after, description, created_by
  ) VALUES (
    p_customer_id, NULL, 'adjust', p_delta,
    v_new_balance, v_trimmed_reason, v_profile_id
  ) RETURNING id INTO v_txn_id;

  UPDATE customers
     SET loyalty_points  = v_new_balance,
         lifetime_points = v_new_lifetime
   WHERE id = p_customer_id;

  txn_id       := v_txn_id;
  new_balance  := v_new_balance;
  new_lifetime := v_new_lifetime;
  RETURN NEXT;
END $$;

REVOKE EXECUTE ON FUNCTION adjust_loyalty_points FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION adjust_loyalty_points TO authenticated;

COMMENT ON FUNCTION adjust_loyalty_points IS
  'Session 12 (hardened 20260515). Manually credit/debit loyalty points. '
  'Gated by has_permission(auth.uid(), ''loyalty.adjust''). |delta| <= 1e6, '
  'reason length 5..500. Always inserts a loyalty_transactions row of type ''adjust''.';
