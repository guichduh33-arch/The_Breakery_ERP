-- 20260519000020_revoke_calculate_recipe_cost_walk_helper.sql
-- Session 15 / Phase 1.C — paranoia follow-up flagged by recipe-db-arch :
-- The internal recursive helper `_calculate_recipe_cost_walk(UUID, INT, INT,
-- UUID[])` is created by migration 20260519000002 without an explicit REVOKE.
-- It is reachable by `authenticated` and `anon` via the default EXECUTE grant
-- on public functions. The public-facing entry point `calculate_recipe_cost_v1`
-- gates by `has_permission('inventory.read')`, but the internal walker does
-- NOT gate — so a caller who knows the helper's name can call it directly
-- and bypass the read permission.
--
-- Revoke EXECUTE from `authenticated` and `anon`. The SECURITY DEFINER
-- public RPC retains access via the function owner (postgres).

REVOKE EXECUTE ON FUNCTION _calculate_recipe_cost_walk(UUID, INT, INT, UUID[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION _calculate_recipe_cost_walk(UUID, INT, INT, UUID[]) FROM anon;
REVOKE EXECUTE ON FUNCTION _calculate_recipe_cost_walk(UUID, INT, INT, UUID[]) FROM PUBLIC;

COMMENT ON FUNCTION _calculate_recipe_cost_walk(UUID, INT, INT, UUID[]) IS
  'Session 15 — Phase 1.A. Internal recursive helper for calculate_recipe_cost_v1. '
  'Walks the recipes BoM tree, computes cost cascade with cycle detection (path[]). '
  'NOT permission-gated — caller (public RPC) must gate. '
  'EXECUTE revoked from authenticated/anon by migration 20260519000020 (Phase 1.C).';
