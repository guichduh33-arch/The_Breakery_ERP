-- 20260519000122_grant_inventory_production_schedule_perm.sql
-- Session 15 / Phase 4.B — Seed new permission inventory.production.schedule.
--
-- New permission for scheduling production fournée slots :
--   inventory.production.schedule -> MANAGER, ADMIN, SUPER_ADMIN (Spec §D15).
--
-- D10 / Audit R14 LOCK : has_permission has been a PURE LOOKUP function since
-- Session 13 Phase 1.B (migration 20260517000030). New permissions are
-- declared by INSERT INTO permissions + INSERT INTO role_permissions only —
-- the function body is LOCKED and CI grep-gate enforces this.
-- See docs/workplan/refs/2026-05-13-has_permission-refactor-design.md §7.
--
-- Hotfix 2026-05-16 : the original Phase 4.B body re-CREATEd has_permission
-- with a hardcoded MANAGER whitelist, violating D10 ; this file was rewritten
-- to keep only the table seeds. The companion script
-- restore_has_permission_v9_to_canonical.sql (applied via execute_sql) restored
-- the cloud function to its pure-lookup state.

-- 1) Seed permission row
INSERT INTO permissions (code, module, action, description) VALUES
  ('inventory.production.schedule','inventory','create',
   'Plan production fournée slots (7-day x 4-slot grid)')
ON CONFLICT (code) DO NOTHING;

-- 2) role_permissions seeds — MANAGER+ grant.
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('MANAGER',     'inventory.production.schedule', TRUE),
  ('ADMIN',       'inventory.production.schedule', TRUE),
  ('SUPER_ADMIN', 'inventory.production.schedule', TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;
