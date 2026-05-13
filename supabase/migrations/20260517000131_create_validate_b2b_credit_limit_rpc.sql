-- Session 13 / Phase 3.C — Migration 131
-- validate_b2b_credit_limit_v1: STABLE check used by order-creation flows
-- (POS/BO) to decide whether a B2B credit-style order can be accepted.
--
-- Returns JSONB:
--   allowed BOOLEAN, customer_type TEXT, current_balance, credit_limit,
--   available, would_exceed_by

CREATE OR REPLACE FUNCTION public.validate_b2b_credit_limit_v1(
  p_customer_id  UUID,
  p_order_amount NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_type     customer_type;
  v_limit    NUMERIC(14,2);
  v_balance  NUMERIC(14,2);
  v_avail    NUMERIC(14,2);
  v_exceed   NUMERIC(14,2);
  v_allowed  BOOLEAN;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_order_amount IS NULL OR p_order_amount < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  SELECT customer_type, b2b_credit_limit, b2b_current_balance
    INTO v_type, v_limit, v_balance
    FROM customers
   WHERE id = p_customer_id
     AND deleted_at IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_type <> 'b2b' THEN
    RETURN jsonb_build_object(
      'allowed', TRUE,
      'customer_type', v_type::text,
      'current_balance', COALESCE(v_balance, 0),
      'credit_limit', v_limit,
      'available', NULL,
      'would_exceed_by', 0
    );
  END IF;

  IF v_limit IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', TRUE,
      'customer_type', v_type::text,
      'current_balance', COALESCE(v_balance, 0),
      'credit_limit', NULL,
      'available', NULL,
      'would_exceed_by', 0
    );
  END IF;

  v_avail   := v_limit - COALESCE(v_balance, 0);
  v_exceed  := GREATEST(0, COALESCE(v_balance, 0) + p_order_amount - v_limit);
  v_allowed := v_exceed = 0;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'customer_type', v_type::text,
    'current_balance', COALESCE(v_balance, 0),
    'credit_limit', v_limit,
    'available', v_avail,
    'would_exceed_by', v_exceed
  );
END $function$;

REVOKE ALL ON FUNCTION public.validate_b2b_credit_limit_v1(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_b2b_credit_limit_v1(UUID, NUMERIC) TO authenticated;

COMMENT ON FUNCTION public.validate_b2b_credit_limit_v1(UUID, NUMERIC) IS
  'B2B credit-limit gate. Returns jsonb with allowed/current_balance/credit_limit/available/would_exceed_by/customer_type. STABLE — does not write.';
