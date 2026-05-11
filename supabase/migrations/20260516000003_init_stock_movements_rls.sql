-- 20260516000003_init_stock_movements_rls.sql
-- Session 12 / migration 3 : Lockdown stock_movements RLS.
-- Replace permissive auth_read with perm_read (inventory.read) and revoke writes.
-- SECURITY DEFINER RPCs (record_stock_movement_v1 et wrappers) continuent
-- a ecrire en tant qu'owner (postgres) en bypass de RLS.

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY; -- idempotent if already on

-- Replace the permissive auth_read policy from session 1 (20260503000007_init_rls.sql)
DROP POLICY IF EXISTS "auth_read" ON stock_movements;

CREATE POLICY "perm_read" ON stock_movements FOR SELECT
  USING (has_permission(auth.uid(), 'inventory.read'));

REVOKE INSERT, UPDATE, DELETE ON stock_movements FROM authenticated;
-- SECURITY DEFINER RPCs continue to write via their owner role (postgres).

COMMENT ON POLICY "perm_read" ON stock_movements IS
  'Session 12: gated by inventory.read perm. Writes are denied at GRANT level — '
  'SECURITY DEFINER RPCs are the sole writers.';
