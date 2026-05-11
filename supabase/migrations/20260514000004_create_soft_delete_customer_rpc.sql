-- 20260514000004_create_soft_delete_customer_rpc.sql
-- Session 12 (BO loyalty) / migration 4 :
-- Soft-delete a retail customer. SECURITY DEFINER so the UPDATE bypasses the
-- `auth_read` SELECT policy (which would otherwise block setting deleted_at
-- because the row would become invisible to the same authenticated user
-- mid-statement, surfacing as RLS 42501).
--
-- Permission gate: customers.delete (already seeded in session 11, granted
-- only to ADMIN+ via the unconditional-true branch of has_permission).

CREATE OR REPLACE FUNCTION soft_delete_customer(p_customer_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  IF NOT has_permission(v_uid, 'customers.delete') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE customers
     SET deleted_at = now()
   WHERE id = p_customer_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_deleted';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION soft_delete_customer FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION soft_delete_customer TO authenticated;

COMMENT ON FUNCTION soft_delete_customer IS
  'Session 12. Soft-delete a retail customer (sets deleted_at). Required because '
  'direct UPDATE deleted_at=now() is blocked by auth_read RLS policy. '
  'Gated by has_permission(auth.uid(), ''customers.delete'').';
