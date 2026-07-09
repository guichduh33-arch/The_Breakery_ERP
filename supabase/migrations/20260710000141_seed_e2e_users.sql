-- 20260710000141_seed_e2e_users.sql
-- S71 — E2E nightly : seed 2 dedicated E2E users (owner ADMIN, cashier CASHIER).
-- Additive & idempotent. PINs are placeholders here ('000000') and are
-- overwritten at CI run time from secrets by scripts/e2e/provision-pins.sql
-- (so real PIN values never live in the repo). Mirrors the waiter-demo seed
-- pattern (20260507000002): one auth.users row + one user_profiles row sharing
-- the same UUID (id = auth_user_id) so auth.uid() maps to the profile under
-- PIN-JWT and has_permission() resolves the role.

DO $$
DECLARE
  v_owner_uid   UUID := '0e2e0000-0000-4000-a000-000000000001';
  v_cashier_uid UUID := '0e2e0000-0000-4000-a000-000000000002';
BEGIN
  -- auth.users rows (password login disabled — PIN-JWT only)
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at
  ) VALUES
    (v_owner_uid, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'e2e-owner@thebreakery.local',
     crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
     now(), '{"provider":"pin"}'::jsonb, '{"provider":"pin","providers":["pin"]}'::jsonb,
     '', '', '', '', now(), now()),
    (v_cashier_uid, '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'e2e-cashier@thebreakery.local',
     crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
     now(), '{"provider":"pin"}'::jsonb, '{"provider":"pin","providers":["pin"]}'::jsonb,
     '', '', '', '', now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- user_profiles rows (placeholder PIN, overwritten at run time)
  INSERT INTO user_profiles (
    id, auth_user_id, employee_code, full_name, pin_hash, role_code, is_active
  ) VALUES
    (v_owner_uid,   v_owner_uid,   'E2E001', 'E2E Owner',   hash_pin('000000'), 'ADMIN',   true),
    (v_cashier_uid, v_cashier_uid, 'E2E002', 'E2E Cashier', hash_pin('000000'), 'CASHIER', true)
  ON CONFLICT (employee_code) DO NOTHING;
END $$;
