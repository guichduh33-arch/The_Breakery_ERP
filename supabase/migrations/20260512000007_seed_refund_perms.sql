-- 20260512000010_seed_refund_perms.sql
-- Session 10 — has_permission_for_profile helper + has_permission v4 (adds 2 new perms).
--
-- Two new permissions:
--   pos.sale.refund       — partial line refund of a paid order   (MANAGER, ADMIN, SUPER_ADMIN)
--   pos.sale.cancel_item  — cancel order item after send_to_kitchen (idem)
--
-- pos.sale.void already exists from session 1 init_helpers seed.
--
-- Note: there is no role_permissions JOIN table in the current schema (session 9 §3.7 spec
-- mentions a future migration); has_permission() is a hardcoded CASE on role_code. Until
-- session 10+ migrates everything to a table-driven model, has_permission_for_profile()
-- mirrors the same hardcoded approach but keyed by profile_id rather than auth_user_id.

-- 1. Insert the 2 new permissions (catalog only — has_permission below enforces grants)
INSERT INTO permissions (code, module, action, description) VALUES
  ('pos.sale.refund',       'pos.sale', 'refund',       'Refund a portion of a paid order'),
  ('pos.sale.cancel_item',  'pos.sale', 'cancel_item',  'Cancel an order item after send_to_kitchen')
ON CONFLICT (code) DO NOTHING;

-- 2. Future-proof : seed role_permissions if the table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'role_permissions'
  ) THEN
    EXECUTE $q$
      INSERT INTO role_permissions (role_code, permission_code) VALUES
        ('MANAGER',     'pos.sale.refund'),
        ('MANAGER',     'pos.sale.cancel_item'),
        ('ADMIN',       'pos.sale.refund'),
        ('ADMIN',       'pos.sale.cancel_item'),
        ('SUPER_ADMIN', 'pos.sale.refund'),
        ('SUPER_ADMIN', 'pos.sale.cancel_item')
      ON CONFLICT DO NOTHING
    $q$;
  END IF;
END $$;

-- 3. Refresh has_permission v4 — adds pos.sale.refund + pos.sale.cancel_item to MANAGER's list.
-- ADMIN / SUPER_ADMIN auto via the unconditional-true branch.
CREATE OR REPLACE FUNCTION has_permission(p_uid UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role_code INTO v_role FROM user_profiles WHERE auth_user_id = p_uid AND deleted_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  RETURN CASE
    WHEN v_role IN ('SUPER_ADMIN', 'ADMIN') THEN true
    WHEN v_role = 'MANAGER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.session.close_other',
      'pos.session.view_all','pos.sale.create','pos.sale.void','pos.sale.update',
      'pos.sale.refund','pos.sale.cancel_item',
      'products.read','products.create','products.update',
      'payments.process',
      'sales.discount',
      'promotions.read','promotions.create','promotions.update'
    )
    WHEN v_role = 'CASHIER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.sale.create','products.read',
      'payments.process'
    )
    WHEN v_role = 'waiter' THEN p_perm IN (
      'sales.create','products.read'
    )
    ELSE false
  END;
END $$;

COMMENT ON FUNCTION has_permission IS
  'v4 (session 10): adds pos.sale.refund + pos.sale.cancel_item for MANAGER+. ADMIN/SUPER_ADMIN auto via unconditional-true branch.';

-- 4. has_permission_for_profile : profile-keyed variant. Used by cancel_order_item_rpc,
-- void_order_rpc, refund_order_rpc — they receive a manager_profile_id (whose PIN was JUST
-- verified by the Edge Function) which is NOT necessarily the auth.uid() of the request.
-- Implementation : resolve profile → role_code, then delegate to has_permission via the
-- same hardcoded matrix. We CAN'T just call has_permission(auth_user_id, p) because the
-- target manager may not have an auth_user_id at all (PIN-only legacy users).

CREATE OR REPLACE FUNCTION has_permission_for_profile(p_profile_id UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role_code INTO v_role FROM user_profiles
    WHERE id = p_profile_id AND deleted_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  RETURN CASE
    WHEN v_role IN ('SUPER_ADMIN', 'ADMIN') THEN true
    WHEN v_role = 'MANAGER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.session.close_other',
      'pos.session.view_all','pos.sale.create','pos.sale.void','pos.sale.update',
      'pos.sale.refund','pos.sale.cancel_item',
      'products.read','products.create','products.update',
      'payments.process',
      'sales.discount',
      'promotions.read','promotions.create','promotions.update'
    )
    WHEN v_role = 'CASHIER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.sale.create','products.read',
      'payments.process'
    )
    WHEN v_role = 'waiter' THEN p_perm IN (
      'sales.create','products.read'
    )
    ELSE false
  END;
END $$;

GRANT EXECUTE ON FUNCTION has_permission_for_profile(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION has_permission_for_profile IS
  'Session 10: profile-keyed permission check (mirrors has_permission v4 matrix). Used by cancel_order_item_rpc, void_order_rpc, refund_order_rpc to verify the manager whose PIN was JUST verified by the Edge Function.';
