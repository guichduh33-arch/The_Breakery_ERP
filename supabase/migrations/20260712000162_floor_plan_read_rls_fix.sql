-- 20260712000162_floor_plan_read_rls_fix.sql
-- S75 Lot 1 (DEV-S75-01) — read-RLS follow-up for the Floor Plan BO page.
--
-- 1. restaurant_tables.auth_read filtered `is_active` unconditionally, so a
--    deactivated table vanished from every SELECT — the BO Inactive badge +
--    reactivate flow could never render. Drop the is_active condition (POS
--    filters `.eq('is_active', true)` client-side; RPCs are SECURITY DEFINER).
-- 2. table_sections.auth_read was USING (true), leaking soft-deleted sections
--    into the BO list + section selects. Hide them at the row level.

ALTER POLICY auth_read ON restaurant_tables
  USING (is_authenticated() AND deleted_at IS NULL);

ALTER POLICY auth_read ON table_sections
  USING (deleted_at IS NULL);
