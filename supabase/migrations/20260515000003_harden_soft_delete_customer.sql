-- 20260515000003_harden_soft_delete_customer.sql
-- Session 12 hardening — soft_delete_customer:
--   1. Accept an optional p_reason for the audit trail.
--   2. Resolve caller's user_profiles.id and reject anonymous callers.
--   3. Write an audit_log row capturing actor + subject + reason.
--
-- Backwards-compatible : existing callers passing only p_customer_id keep
-- working (p_reason defaults to NULL).

DROP FUNCTION IF EXISTS soft_delete_customer(UUID);

CREATE OR REPLACE FUNCTION soft_delete_customer(
  p_customer_id UUID,
  p_reason      TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile_id   UUID;
  v_customer_name TEXT;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT has_permission(v_uid, 'customers.delete') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE customers
     SET deleted_at = now()
   WHERE id = p_customer_id
     AND deleted_at IS NULL
   RETURNING name INTO v_customer_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_deleted';
  END IF;

  INSERT INTO audit_log (actor_profile_id, action, subject_table, subject_id, payload)
  VALUES (
    v_profile_id,
    'customer.soft_delete',
    'customers',
    p_customer_id,
    jsonb_build_object(
      'customer_name', v_customer_name,
      'reason', NULLIF(trim(coalesce(p_reason, '')), '')
    )
  );
END $$;

REVOKE EXECUTE ON FUNCTION soft_delete_customer FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION soft_delete_customer TO authenticated;

COMMENT ON FUNCTION soft_delete_customer IS
  'Session 12 (hardened 20260515). Soft-delete a retail customer (sets '
  'deleted_at). Writes an audit_log row with actor + customer name + optional '
  'reason. Gated by has_permission(auth.uid(), ''customers.delete'').';
