-- 20260514000003_seed_loyalty_perms.sql
-- Session 12 (BO loyalty) / migration 3 :
-- Seed loyalty.read + loyalty.adjust ; rebuild has_permission v6 +
-- has_permission_for_profile to match.

INSERT INTO permissions (code, module, action, description) VALUES
  ('loyalty.read',   'loyalty', 'read',   'View loyalty customers and transactions in BO'),
  ('loyalty.adjust', 'loyalty', 'adjust', 'Manually credit or debit a customer loyalty balance')
ON CONFLICT (code) DO NOTHING;

-- Future-proof : seed role_permissions if the table exists (matches session 11 style).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'role_permissions'
  ) THEN
    EXECUTE $q$
      INSERT INTO role_permissions (role_code, permission_code) VALUES
        ('MANAGER',     'loyalty.read'),
        ('ADMIN',       'loyalty.read'),
        ('ADMIN',       'loyalty.adjust'),
        ('SUPER_ADMIN', 'loyalty.read'),
        ('SUPER_ADMIN', 'loyalty.adjust')
      ON CONFLICT DO NOTHING
    $q$;
  END IF;
END $$;

-- Refresh has_permission to v6 — adds loyalty.read for MANAGER.
-- ADMIN/SUPER_ADMIN auto-allow via the unconditional-true branch (covers loyalty.adjust).
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
      'promotions.read','promotions.create','promotions.update',
      'categories.read','categories.create','categories.update',
      'customers.read','customers.create','customers.update',
      'tables.read','tables.create','tables.update',
      'combos.read','combos.create','combos.update',
      'suppliers.read','suppliers.create','suppliers.update',
      'loyalty.read'
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
  'v6 (session 12): adds loyalty.read (MANAGER+). loyalty.adjust granted to ADMIN+ via the unconditional-true branch.';

-- Mirror has_permission_for_profile (session 10) with the same matrix.
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
      'promotions.read','promotions.create','promotions.update',
      'categories.read','categories.create','categories.update',
      'customers.read','customers.create','customers.update',
      'tables.read','tables.create','tables.update',
      'combos.read','combos.create','combos.update',
      'suppliers.read','suppliers.create','suppliers.update',
      'loyalty.read'
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
