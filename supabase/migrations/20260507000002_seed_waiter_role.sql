-- 20260507000002_seed_waiter_role.sql
-- Session 5 / migration 2 : seed waiter role + Waiter Demo user (PIN 5678)
-- Role code 'waiter' (lowercase slug, consistent with spec A3)
-- Permission: sales.create only. No payments.process, no pos.access.

-- 1. Insert waiter role
INSERT INTO roles (code, name, description, is_system) VALUES
  ('waiter', 'Waiter', 'Floor staff — capture orders on tablet, no payments', false)
ON CONFLICT (code) DO NOTHING;

-- 2. Ensure sales.create + payments.process permissions exist
INSERT INTO permissions (code, module, action, description) VALUES
  ('sales.create',    'sales',    'create',  'Create a tablet/floor order'),
  ('payments.process','payments', 'process', 'Process payment at POS')
ON CONFLICT (code) DO NOTHING;

-- 3. Waiter Demo auth.user + user_profile
DO $$
DECLARE
  v_waiter_uid UUID := '00000000-0000-0000-0000-000000000003';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token,
    email_change_token_new, email_change,
    created_at, updated_at
  ) VALUES (
    v_waiter_uid, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'waiter-EMP002@thebreakery.local',
    crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
    now(), '{"provider":"pin"}'::jsonb, '{"provider":"pin","providers":["pin"]}'::jsonb,
    '', '', '', '',
    now(), now()
  ) ON CONFLICT (id) DO UPDATE SET
    raw_app_meta_data     = EXCLUDED.raw_app_meta_data,
    confirmation_token    = EXCLUDED.confirmation_token,
    recovery_token        = EXCLUDED.recovery_token,
    email_change_token_new = EXCLUDED.email_change_token_new,
    email_change          = EXCLUDED.email_change;

  INSERT INTO user_profiles (
    id, auth_user_id, employee_code, full_name, pin_hash, role_code, is_active
  ) VALUES (
    '00000000-0000-0000-0000-000000000003'::uuid,
    v_waiter_uid, 'EMP002', 'Waiter Demo', hash_pin('567800'), 'waiter', true
  ) ON CONFLICT (employee_code) DO NOTHING;
END $$;
