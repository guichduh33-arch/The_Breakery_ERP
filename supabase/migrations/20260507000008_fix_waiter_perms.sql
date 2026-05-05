-- 20260507000008_fix_waiter_perms.sql
-- Session 5 fix-up: enforce spec A3 — waiter role has sales.create ONLY.
-- The permission system uses the has_permission() function (20260507000001);
-- waiter is already limited to sales.create + products.read there.
-- This migration removes any stale row from role_permissions (if that table
-- is later added) and re-asserts the has_permission guard for waiter.

-- Guard: only execute if role_permissions table exists (future-proof).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'role_permissions'
  ) THEN
    DELETE FROM role_permissions
    WHERE role_id = (
            SELECT id FROM roles WHERE code = 'waiter'
          )
      AND permission_id = (
            SELECT id FROM permissions WHERE code = 'payments.process'
          );
  END IF;
END $$;

-- Re-assert: has_permission MUST NOT grant payments.process to waiter.
-- Verify via assertion that will raise if the guard is broken.
DO $$
BEGIN
  IF has_permission('00000000-0000-0000-0000-000000000003'::uuid, 'payments.process') THEN
    RAISE EXCEPTION 'Waiter Demo (EMP002) must NOT have payments.process — spec A3 violated';
  END IF;
END $$;
