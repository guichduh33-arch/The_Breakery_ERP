-- 20260516000004_seed_inventory_perms.sql
-- Session 12 / migration 4 : Seed inventory permissions + bump has_permission to v7.
--
-- has_permission v6 (session 12 loyalty) hardcodes MANAGER whitelist and does NOT
-- read role_permissions. To grant inventory.{read,receive,waste} to MANAGER, we
-- must rebuild has_permission and has_permission_for_profile with the additions.
-- inventory.adjust is reserved to ADMIN+ (covered by the unconditional-true branch).

-- 1) Seed permission rows
INSERT INTO permissions (code, module, action, description) VALUES
  ('inventory.read',    'inventory', 'read',   'View stock levels + movement history'),
  ('inventory.adjust',  'inventory', 'update', 'Manual stock adjustment (count correction)'),
  ('inventory.receive', 'inventory', 'create', 'Record stock receipt from supplier (purchase)'),
  ('inventory.waste',   'inventory', 'update', 'Record stock waste / spoilage')
ON CONFLICT (code) DO NOTHING;

-- 2) Seed role_permissions (documentary — has_permission v7 below is the real gate;
--    role_permissions kept in sync for future generic perm-resolution).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='role_permissions') THEN
    EXECUTE $q$
      INSERT INTO role_permissions (role_code, permission_code) VALUES
        ('MANAGER',     'inventory.read'),
        ('MANAGER',     'inventory.receive'),
        ('MANAGER',     'inventory.waste'),
        ('ADMIN',       'inventory.read'),
        ('ADMIN',       'inventory.adjust'),
        ('ADMIN',       'inventory.receive'),
        ('ADMIN',       'inventory.waste'),
        ('SUPER_ADMIN', 'inventory.read'),
        ('SUPER_ADMIN', 'inventory.adjust'),
        ('SUPER_ADMIN', 'inventory.receive'),
        ('SUPER_ADMIN', 'inventory.waste')
      ON CONFLICT DO NOTHING
    $q$;
  END IF;
END $$;

-- 3) has_permission v7 — adds inventory.{read,receive,waste} to MANAGER whitelist.
--    inventory.adjust covered by ADMIN/SUPER_ADMIN unconditional-true branch.
--    Strict copy of v6 from 20260514000003_seed_loyalty_perms.sql with 3 perms added.
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
      'loyalty.read',
      -- v7 additions :
      'inventory.read','inventory.receive','inventory.waste'
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
  'v7 (session 12 inventory MVP): adds inventory.read/receive/waste to MANAGER. '
  'inventory.adjust covered by ADMIN/SUPER_ADMIN unconditional branch.';

-- Mirror has_permission_for_profile with the same matrix.
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
      'loyalty.read',
      'inventory.read','inventory.receive','inventory.waste'
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

COMMENT ON FUNCTION has_permission_for_profile IS
  'v7 mirror of has_permission for direct profile id lookup (session 10 introduced).';
