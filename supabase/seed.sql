-- supabase/seed.sql
-- Seed initial : 4 rôles, 13 permissions, 2 users (admin + cashier),
-- 4 catégories, 8 produits.

-- ============================================================
-- ROLES
-- ============================================================
INSERT INTO roles (code, name, description, is_system) VALUES
  ('SUPER_ADMIN', 'Super Admin',  'Accès complet système',                         true),
  ('ADMIN',       'Admin',        'Administration métier',                         true),
  ('MANAGER',     'Manager',      'Gestion opérationnelle (POS + produits)',       true),
  ('CASHIER',     'Cashier',      'Caissier — POS sale + open shift',              true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- PERMISSIONS
-- ============================================================
INSERT INTO permissions (code, module, action, description) VALUES
  ('pos.session.open',        'pos',      'session.open',  'Ouvrir une session de caisse'),
  ('pos.session.close_own',   'pos',      'session.close', 'Clôturer sa propre session'),
  ('pos.session.close_other', 'pos',      'session.close', 'Clôturer la session d''un autre'),
  ('pos.session.view_all',    'pos',      'session.view',  'Voir toutes les sessions'),
  ('pos.sale.create',         'pos',      'sale.create',   'Encaisser une vente'),
  ('pos.sale.void',           'pos',      'sale.void',     'Annuler une vente'),
  ('pos.sale.update',         'pos',      'sale.update',   'Modifier une vente'),
  ('products.read',           'products', 'read',          'Voir le catalogue'),
  ('products.create',         'products', 'create',        'Créer un produit'),
  ('products.update',         'products', 'update',        'Modifier un produit'),
  ('users.create',            'users',    'create',        'Créer un utilisateur'),
  ('users.update',            'users',    'update',        'Modifier un utilisateur'),
  ('users.view_audit',        'users',    'view_audit',    'Voir les logs d''audit')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- BUSINESS CONFIG (singleton)
-- ============================================================
INSERT INTO business_config (id, name, currency, tax_rate, tax_inclusive, fiscal_address, timezone)
VALUES (1, 'The Breakery', 'IDR', 0.10, true, 'Lombok, Indonesia', 'Asia/Makassar')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- AUTH USERS + USER PROFILES
-- ============================================================
-- 2 auth.users, identifiés par email synthétique. Pas de signin par email
-- attendu : les Edge Functions mintent les sessions via PIN.
DO $$
DECLARE
  v_admin_uid    UUID := '00000000-0000-0000-0000-000000000001';
  v_cashier_uid  UUID := '00000000-0000-0000-0000-000000000002';
BEGIN
  -- ADMIN
  -- Note: confirmation_token, recovery_token, etc. must be '' not NULL so
  -- GoTrue's Go scanner (sql.Scan) can read them without error.
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token,
    email_change_token_new, email_change,
    created_at, updated_at
  ) VALUES (
    v_admin_uid, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'cashier-EMP000@thebreakery.local',
    crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
    now(), '{"provider":"pin"}'::jsonb, '{"provider":"pin","providers":["pin"]}'::jsonb,
    '', '',
    '', '',
    now(), now()
  ) ON CONFLICT (id) DO UPDATE SET
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    confirmation_token = EXCLUDED.confirmation_token,
    recovery_token = EXCLUDED.recovery_token,
    email_change_token_new = EXCLUDED.email_change_token_new,
    email_change = EXCLUDED.email_change;

  -- CASHIER
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token,
    email_change_token_new, email_change,
    created_at, updated_at
  ) VALUES (
    v_cashier_uid, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'cashier-EMP001@thebreakery.local',
    crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
    now(), '{"provider":"pin"}'::jsonb, '{"provider":"pin","providers":["pin"]}'::jsonb,
    '', '',
    '', '',
    now(), now()
  ) ON CONFLICT (id) DO UPDATE SET
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    confirmation_token = EXCLUDED.confirmation_token,
    recovery_token = EXCLUDED.recovery_token,
    email_change_token_new = EXCLUDED.email_change_token_new,
    email_change = EXCLUDED.email_change;

  -- USER PROFILES (PIN hashés via hash_pin())
  INSERT INTO user_profiles (
    auth_user_id, employee_code, full_name, pin_hash, role_code, is_active
  ) VALUES (
    v_admin_uid, 'EMP000', 'Mamat (Owner)', hash_pin('1234'), 'SUPER_ADMIN', true
  ) ON CONFLICT (employee_code) DO NOTHING;

  INSERT INTO user_profiles (
    auth_user_id, employee_code, full_name, pin_hash, role_code, is_active
  ) VALUES (
    v_cashier_uid, 'EMP001', 'Test Cashier', hash_pin('5678'), 'CASHIER', true
  ) ON CONFLICT (employee_code) DO NOTHING;
END $$;

-- ============================================================
-- CATEGORIES
-- ============================================================
INSERT INTO categories (id, name, slug, sort_order) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Beverage',  'beverage',  1),
  ('22222222-2222-2222-2222-222222222222', 'Bread',     'bread',     2),
  ('33333333-3333-3333-3333-333333333333', 'Pastry',    'pastry',    3),
  ('44444444-4444-4444-4444-444444444444', 'Sandwiches','sandwiches',4)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- PRODUCTS (8 items, stock 50 chacun)
-- Images: placeholder via.placeholder.com (remplacer plus tard par Cloudinary)
-- ============================================================
INSERT INTO products (sku, name, category_id, retail_price, image_url, current_stock, is_favorite) VALUES
  ('BEV-AMER',  'Americano',       '11111111-1111-1111-1111-111111111111', 35000,  'https://via.placeholder.com/400x400.png?text=Americano',  50, true),
  ('BEV-FLAT',  'Flat White',      '11111111-1111-1111-1111-111111111111', 45000,  'https://via.placeholder.com/400x400.png?text=Flat+White', 50, true),
  ('BEV-CAPP',  'Capuccino',       '11111111-1111-1111-1111-111111111111', 35000,  'https://via.placeholder.com/400x400.png?text=Capuccino',  50, false),
  ('BRD-SOUR',  'Sourdough Loaf',  '22222222-2222-2222-2222-222222222222', 75000,  'https://via.placeholder.com/400x400.png?text=Sourdough',  50, false),
  ('PAS-CROI',  'Croissant',       '33333333-3333-3333-3333-333333333333', 25000,  'https://via.placeholder.com/400x400.png?text=Croissant',  50, true),
  ('PAS-PAIN',  'Pain au Chocolat','33333333-3333-3333-3333-333333333333', 28000,  'https://via.placeholder.com/400x400.png?text=Pain',       50, false),
  ('SND-AMER',  'American Bagel',  '44444444-4444-4444-4444-444444444444', 70000,  'https://via.placeholder.com/400x400.png?text=Bagel',      50, false),
  ('SND-CHEE',  'Cheesy Brie',     '44444444-4444-4444-4444-444444444444', 70000,  'https://via.placeholder.com/400x400.png?text=Cheesy',     50, false)
ON CONFLICT (sku) DO NOTHING;
