-- 20260513000004_seed_backoffice_crud_perms.sql
-- Session 11 — seed all 28 new permissions for the 8 CRUD modules.
-- Refresh has_permission to v5 with the full matrix (see spec §3.4).

-- 1. Catalog new perms (read = check existing or skip ; products.read already seeded session 1).
INSERT INTO permissions (code, module, action, description) VALUES
  -- products: read+create+update already exist. delete is new.
  ('products.delete',                'products',             'delete', 'Soft-delete products'),

  -- categories
  ('categories.read',                'categories',           'read',   'View product categories'),
  ('categories.create',              'categories',           'create', 'Create product categories'),
  ('categories.update',              'categories',           'update', 'Update product categories'),
  ('categories.delete',              'categories',           'delete', 'Soft-delete product categories'),

  -- customers
  ('customers.read',                 'customers',            'read',   'View customers'),
  ('customers.create',               'customers',            'create', 'Create customers'),
  ('customers.update',               'customers',            'update', 'Update customers'),
  ('customers.delete',               'customers',            'delete', 'Soft-delete customers'),

  -- customer_categories (sensitive — affects pricing)
  ('customer_categories.read',       'customer_categories',  'read',   'View customer categories'),
  ('customer_categories.create',     'customer_categories',  'create', 'Create customer categories'),
  ('customer_categories.update',     'customer_categories',  'update', 'Update customer categories'),
  ('customer_categories.delete',     'customer_categories',  'delete', 'Soft-delete customer categories'),

  -- restaurant_tables
  ('tables.read',                    'tables',               'read',   'View restaurant tables'),
  ('tables.create',                  'tables',               'create', 'Create restaurant tables'),
  ('tables.update',                  'tables',               'update', 'Update restaurant tables'),
  ('tables.delete',                  'tables',               'delete', 'Soft-delete restaurant tables'),

  -- combos (rows in products with product_type='combo' + rows in combo_items)
  ('combos.read',                    'combos',               'read',   'View combos'),
  ('combos.create',                  'combos',               'create', 'Create combos (header + components)'),
  ('combos.update',                  'combos',               'update', 'Update combos'),
  ('combos.delete',                  'combos',               'delete', 'Soft-delete combos'),

  -- discount_templates
  ('discount_templates.read',        'discount_templates',   'read',   'View discount templates'),
  ('discount_templates.create',      'discount_templates',   'create', 'Create discount templates'),
  ('discount_templates.update',      'discount_templates',   'update', 'Update discount templates'),
  ('discount_templates.delete',      'discount_templates',   'delete', 'Soft-delete discount templates'),

  -- suppliers
  ('suppliers.read',                 'suppliers',            'read',   'View suppliers'),
  ('suppliers.create',               'suppliers',            'create', 'Create suppliers'),
  ('suppliers.update',               'suppliers',            'update', 'Update suppliers'),
  ('suppliers.delete',               'suppliers',            'delete', 'Soft-delete suppliers')
ON CONFLICT (code) DO NOTHING;

-- 2. Future-proof : seed role_permissions if the table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'role_permissions'
  ) THEN
    EXECUTE $q$
      INSERT INTO role_permissions (role_code, permission_code)
      SELECT r.role_code, p.permission_code
        FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS r(role_code)
       CROSS JOIN (
         VALUES
           ('categories.read'),  ('categories.create'),  ('categories.update'),
           ('customers.read'),   ('customers.create'),   ('customers.update'),
           ('tables.read'),      ('tables.create'),      ('tables.update'),
           ('combos.read'),      ('combos.create'),      ('combos.update'),
           ('suppliers.read'),   ('suppliers.create'),   ('suppliers.update')
       ) AS p(permission_code)
      ON CONFLICT DO NOTHING;

      INSERT INTO role_permissions (role_code, permission_code)
      SELECT r.role_code, p.permission_code
        FROM (VALUES ('ADMIN'), ('SUPER_ADMIN')) AS r(role_code)
       CROSS JOIN (
         VALUES
           ('products.delete'),
           ('categories.delete'),
           ('customers.delete'),
           ('customer_categories.read'), ('customer_categories.create'),
           ('customer_categories.update'), ('customer_categories.delete'),
           ('tables.delete'),
           ('combos.delete'),
           ('discount_templates.read'), ('discount_templates.create'),
           ('discount_templates.update'), ('discount_templates.delete'),
           ('suppliers.delete')
       ) AS p(permission_code)
      ON CONFLICT DO NOTHING;
    $q$;
  END IF;
END $$;

-- 3. Refresh has_permission v5 — full matrix.
-- ADMIN/SUPER_ADMIN auto via the unconditional-true branch.
-- MANAGER : every {module}.read/create/update for the 8 modules ; sensitive deletes excluded.
-- CUSTOMER_CATEGORIES + DISCOUNT_TEMPLATES are ADMIN+ only (per spec §3.4 sensitivity).
-- has_permission_for_profile (session 10) mirrors the same matrix — kept in sync below.

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
      -- session 11 module CRUDs (read+create+update for MANAGER)
      'categories.read','categories.create','categories.update',
      'customers.read','customers.create','customers.update',
      'tables.read','tables.create','tables.update',
      'combos.read','combos.create','combos.update',
      'suppliers.read','suppliers.create','suppliers.update'
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
  'v5 (session 11): adds 8 CRUD module perms (categories/customers/tables/combos/suppliers) for MANAGER. customer_categories + discount_templates + product/category/customer/etc deletes reserved to ADMIN+ via the unconditional-true branch.';

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
      'suppliers.read','suppliers.create','suppliers.update'
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
