-- 20260516000018_seed_inventory_perms_phase2.sql
-- Session 12 / Phase 1 (complete) / migration 7 :
--   Seed des 8 permissions additionnelles inventory + bump has_permission v8.
--
-- Permissions déjà seedées (MVP migration 4) :
--   inventory.read, inventory.adjust, inventory.receive, inventory.waste
--
-- Nouvelles permissions Phase 1 (cf. spec session 12 complete §C8) :
--   inventory.transfer.create, inventory.transfer.receive
--   inventory.opname.create, inventory.opname.finalize
--   inventory.production.create, inventory.production.delete
--   inventory.recipes.update, inventory.sections.update
--
-- Stratégie has_permission v8 : étendre la whitelist MANAGER avec les opérations
-- standard (transfer.*, opname.create, production.create) ; les opérations
-- privilégiées (opname.finalize, production.delete, recipes.update, sections.update)
-- restent ADMIN+ via la branche unconditional-true.

-- 1) Seed permission rows
INSERT INTO permissions (code, module, action, description) VALUES
  ('inventory.transfer.create',  'inventory', 'create', 'Create internal transfer between sections'),
  ('inventory.transfer.receive', 'inventory', 'update', 'Receive an internal transfer (validate items + emit movements)'),
  ('inventory.opname.create',    'inventory', 'create', 'Create / participate in stock opname session'),
  ('inventory.opname.finalize',  'inventory', 'update', 'Finalize opname (emits adjustment movements + JE) — ADMIN+'),
  ('inventory.production.create','inventory', 'create', 'Record a production batch (consumes ingredients via recipe)'),
  ('inventory.production.delete','inventory', 'delete', 'Revert a production record (restores stock + counter-JE) — ADMIN+'),
  ('inventory.recipes.update',   'inventory', 'update', 'Edit recipes (Bill of Materials)'),
  ('inventory.sections.update',  'inventory', 'update', 'Manage sections + stock locations')
ON CONFLICT (code) DO NOTHING;

-- 2) Seed role_permissions (documentary; the gate is has_permission v8 below)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='role_permissions') THEN
    EXECUTE $q$
      INSERT INTO role_permissions (role_code, permission_code) VALUES
        -- MANAGER : opérations standard
        ('MANAGER',     'inventory.transfer.create'),
        ('MANAGER',     'inventory.transfer.receive'),
        ('MANAGER',     'inventory.opname.create'),
        ('MANAGER',     'inventory.production.create'),
        -- ADMIN : tout
        ('ADMIN',       'inventory.transfer.create'),
        ('ADMIN',       'inventory.transfer.receive'),
        ('ADMIN',       'inventory.opname.create'),
        ('ADMIN',       'inventory.opname.finalize'),
        ('ADMIN',       'inventory.production.create'),
        ('ADMIN',       'inventory.production.delete'),
        ('ADMIN',       'inventory.recipes.update'),
        ('ADMIN',       'inventory.sections.update'),
        -- SUPER_ADMIN : tout (idem ADMIN)
        ('SUPER_ADMIN', 'inventory.transfer.create'),
        ('SUPER_ADMIN', 'inventory.transfer.receive'),
        ('SUPER_ADMIN', 'inventory.opname.create'),
        ('SUPER_ADMIN', 'inventory.opname.finalize'),
        ('SUPER_ADMIN', 'inventory.production.create'),
        ('SUPER_ADMIN', 'inventory.production.delete'),
        ('SUPER_ADMIN', 'inventory.recipes.update'),
        ('SUPER_ADMIN', 'inventory.sections.update')
      ON CONFLICT DO NOTHING
    $q$;
  END IF;
END $$;

-- 3) has_permission v8 — étendre MANAGER whitelist avec :
--    inventory.transfer.create, inventory.transfer.receive,
--    inventory.opname.create, inventory.production.create.
--    Les autres restent ADMIN+ via la branche unconditional-true.
--
--    Strict copie de v7 (20260516000004) avec les 4 ajouts à la fin du whitelist MANAGER.

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
      -- carried from v7 :
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
      -- v8 additions (Phase 1 inventory complete) :
      'inventory.transfer.create','inventory.transfer.receive',
      'inventory.opname.create','inventory.production.create'
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
  'v8 (session 12 inventory complete Phase 1): ajout MANAGER whitelist : '
  'inventory.transfer.create/receive, inventory.opname.create, inventory.production.create. '
  'Les autres perms inventory.* (opname.finalize, production.delete, recipes.update, '
  'sections.update) restent ADMIN+ via la branche unconditional-true.';

-- Mirror has_permission_for_profile avec la même matrice
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
      'inventory.opname.create','inventory.production.create'
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
  'v8 mirror of has_permission for direct profile id lookup.';
