-- 20260514000002_init_adjust_loyalty_points_rpc.sql
-- Session 12 (BO loyalty) / migration 2 :
--   1. Column-level revoke on loyalty_points/lifetime_points/total_spent/
--      total_visits/last_visit_at — these are mutated only by SECURITY
--      DEFINER functions (complete_order_with_payment, adjust_loyalty_points).
--   2. adjust_loyalty_points RPC (signed delta, 5-char min reason, balance
--      lock, ledger insert).
--
-- NOTE: customers UPDATE policy already exists from session 11
-- (20260513000005_extend_rls_for_module_perms: `perm_update` using
-- has_permission(auth.uid(), 'customers.update')). The customer_type CHECK
-- constraint enforces 'retail' at the schema level. We therefore do NOT add
-- another UPDATE policy here.

-- 1) Column-level GRANT revocation -----------------------------------------

REVOKE UPDATE (loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at)
  ON customers FROM authenticated;

-- 2) The RPC ---------------------------------------------------------------

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
BEGIN
  IF NOT has_permission(v_uid, 'loyalty.adjust') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_delta = 0 OR p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
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
    v_new_balance, p_reason, v_profile_id
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
  'Session 12. Manually credit/debit loyalty points for a customer. '
  'Gated by has_permission(auth.uid(), ''loyalty.adjust''). Always inserts '
  'a loyalty_transactions row of type ''adjust''. Lifetime points only grow.';
