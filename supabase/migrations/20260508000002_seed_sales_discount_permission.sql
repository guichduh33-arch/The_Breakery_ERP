-- 20260508000002_seed_sales_discount_permission.sql
-- Session 6 — seed the 'sales.discount' permission and grant it to MANAGER role.
--
-- Architecture note: roles.code is the PK (no separate id/slug).
-- has_permission() (20260503000006) is hardcoded. This migration:
--   1. Inserts the permission row.
--   2. Replaces has_permission() to include sales.discount for MANAGER/ADMIN/SUPER_ADMIN.
--   3. If a role_permissions join-table ever exists (future session), seeds the row.

INSERT INTO permissions (code, module, action, description) VALUES
  ('sales.discount', 'sales', 'discount', 'Manager can verify discounts beyond threshold')
ON CONFLICT (code) DO NOTHING;

-- Guard: only execute if role_permissions table exists (introduced in a future session).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'role_permissions'
  ) THEN
    EXECUTE $q$
      INSERT INTO role_permissions (role_code, permission_code)
      VALUES ('MANAGER', 'sales.discount')
      ON CONFLICT DO NOTHING
    $q$;
  END IF;
END $$;

-- Update the hardcoded has_permission() to recognise 'sales.discount' for manager-tier roles.
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
      'products.read','products.create','products.update',
      'payments.process',
      'sales.discount'
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
  'v2 (session 6): hardcoded role→permission map. Adds sales.discount for MANAGER+. Replace with role_permissions join-table in session 10+.';
