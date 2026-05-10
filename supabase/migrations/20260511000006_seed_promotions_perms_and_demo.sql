-- 20260511000006_seed_promotions_perms_and_demo.sql
-- Session 9 — seed promotions permissions + 2 demo promos.
-- Spec §3.7 + BO2.
--
-- Permissions matrix (BO2):
--   SUPER_ADMIN/ADMIN  : read + create + update + delete  (auto via the SUPER_ADMIN/ADMIN
--                                                          branch returning true unconditionally)
--   MANAGER            : read + create + update           (NO delete)
--   CASHIER / waiter   : nothing (route protected)
--                        — note: CASHIER may still SELECT promotions via the auth_read RLS policy,
--                        which is required for runtime evaluation in the POS.

-- 1. Insert the 4 new permissions
INSERT INTO permissions (code, module, action, description) VALUES
  ('promotions.read',   'promotions', 'read',   'View promotions'),
  ('promotions.create', 'promotions', 'create', 'Create promotions'),
  ('promotions.update', 'promotions', 'update', 'Update promotions'),
  ('promotions.delete', 'promotions', 'delete', 'Soft-delete promotions')
ON CONFLICT (code) DO NOTHING;

-- 2. Refresh the role_permissions join-table if it exists (future-proof — not present today)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'role_permissions'
  ) THEN
    EXECUTE $q$
      INSERT INTO role_permissions (role_code, permission_code) VALUES
        ('MANAGER',     'promotions.read'),
        ('MANAGER',     'promotions.create'),
        ('MANAGER',     'promotions.update'),
        ('ADMIN',       'promotions.read'),
        ('ADMIN',       'promotions.create'),
        ('ADMIN',       'promotions.update'),
        ('ADMIN',       'promotions.delete'),
        ('SUPER_ADMIN', 'promotions.read'),
        ('SUPER_ADMIN', 'promotions.create'),
        ('SUPER_ADMIN', 'promotions.update'),
        ('SUPER_ADMIN', 'promotions.delete')
      ON CONFLICT DO NOTHING
    $q$;
  END IF;
END $$;

-- 3. Refresh the hardcoded has_permission() to recognise the 4 new perms.
-- Note : SUPER_ADMIN/ADMIN already returns true unconditionally → all 4 perms granted automatically.
-- We only need to add the read/create/update entries for MANAGER. Delete stays SUPER_ADMIN/ADMIN-only.
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
  'v3 (session 9): adds promotions.read/create/update for MANAGER+. Delete reserved to SUPER_ADMIN/ADMIN (auto via the unconditional-true branch). Replace with role_permissions join-table in session 10+.';

-- 4. Demo promotions
-- 4a. Happy Hour Beverage : -10% on category=beverage, daily 18h-20h, priority 100, non-stackable_with_promo
INSERT INTO promotions (
  name, slug, description,
  type, scope, discount_value, scope_category_ids,
  start_hour, end_hour,
  priority, stackable_with_promo, stackable_with_manual,
  is_active
)
SELECT
  'Happy Hour Beverage', 'happy-hour-bev',
  'Happy Hour 18h-20h — 10% off all beverages',
  'percentage'::promotion_type, 'category'::promotion_scope, 10,
  ARRAY[(SELECT id FROM categories WHERE slug = 'beverage')]::UUID[],
  18, 20,
  100, false, true,
  true
WHERE EXISTS (SELECT 1 FROM categories WHERE slug = 'beverage')
ON CONFLICT (slug) DO NOTHING;

-- 4b. VIP Free Croissant : free PAS-CROI for VIP customers when items_total >= 100k IDR.
-- Note : spec §3.7 references SKU 'SKU-CROISSANT' but the actual seed (supabase/seed.sql)
-- uses 'PAS-CROI' (deliberate naming convention : Pastries category prefix). We use the
-- real SKU here so the seed inserts cleanly when seed.sql has run.
INSERT INTO promotions (
  name, slug, description,
  type, gift_product_id, gift_qty,
  min_items_total, customer_category_ids,
  priority, stackable_with_promo, stackable_with_manual,
  is_active
)
SELECT
  'VIP Free Croissant', 'vip-free-croissant',
  'VIP customers — free croissant on orders >= 100,000 IDR',
  'free_product'::promotion_type,
  (SELECT id FROM products WHERE sku = 'PAS-CROI'),
  1,
  100000,
  ARRAY[(SELECT id FROM customer_categories WHERE slug = 'vip')]::UUID[],
  50, true, true,
  true
WHERE EXISTS (SELECT 1 FROM products WHERE sku = 'PAS-CROI')
  AND EXISTS (SELECT 1 FROM customer_categories WHERE slug = 'vip')
ON CONFLICT (slug) DO NOTHING;
