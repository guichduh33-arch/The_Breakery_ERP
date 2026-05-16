-- 20260519000122_grant_inventory_production_schedule_perm.sql
-- Session 15 / Phase 4.B — Seed new permission inventory.production.schedule.
--
-- New permission for scheduling production fournée slots :
--   inventory.production.schedule -> MANAGER+ (Spec §D15).
--
-- has_permission is already structured so SUPER_ADMIN / ADMIN return TRUE for
-- any permission code, so we only need to extend the MANAGER whitelist.
-- Idempotent — wrapped in DO blocks + ON CONFLICT clauses.

-- 1) Seed permission row
INSERT INTO permissions (code, module, action, description) VALUES
  ('inventory.production.schedule','inventory','create',
   'Plan production fournée slots (7-day x 4-slot grid)')
ON CONFLICT (code) DO NOTHING;

-- 2) role_permissions seed (documentary)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='role_permissions'
  ) THEN
    EXECUTE $q$
      INSERT INTO role_permissions (role_code, permission_code) VALUES
        ('MANAGER',     'inventory.production.schedule'),
        ('ADMIN',       'inventory.production.schedule'),
        ('SUPER_ADMIN', 'inventory.production.schedule')
      ON CONFLICT DO NOTHING
    $q$;
  END IF;
END $$;

-- 3) has_permission v9 — extend MANAGER whitelist with the new code.
--    Copy of v8 (20260516000018) + 'inventory.production.schedule' on MANAGER.
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
      'inventory.read','inventory.receive','inventory.waste',
      'inventory.transfer.create','inventory.transfer.receive',
      'inventory.opname.create','inventory.production.create',
      -- v9 addition (Session 15 / Phase 4.B) :
      'inventory.production.schedule'
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
  'v9 (Session 15 / Phase 4.B) - extends MANAGER whitelist with '
  'inventory.production.schedule (new). All other permissions stay at v8 matrix.';

-- Mirror has_permission_for_profile for direct profile id lookup.
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
      'inventory.read','inventory.receive','inventory.waste',
      'inventory.transfer.create','inventory.transfer.receive',
      'inventory.opname.create','inventory.production.create',
      'inventory.production.schedule'
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
  'v9 mirror of has_permission for direct profile id lookup.';
