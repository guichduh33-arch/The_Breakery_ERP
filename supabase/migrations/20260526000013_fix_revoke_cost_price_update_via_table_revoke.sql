-- 20260526000013_fix_revoke_cost_price_update_via_table_revoke.sql
-- Session 22 / Phase 1.B.1 — DEV-S17-1.B-01 — Corrective for 20260526000010.
--
-- Empirical finding : `REVOKE UPDATE (cost_price) ON products FROM authenticated`
-- is a no-op when `authenticated` holds the TABLE-LEVEL UPDATE privilege on
-- products (as it does on this project). Per PostgreSQL semantics, the table-
-- level UPDATE implicitly covers every column, and a column-level REVOKE only
-- bites when there is NO matching table-level GRANT.
--
-- This migration applies the canonical Postgres pattern for "all-columns-but-one
-- writable" :
--   1) REVOKE UPDATE ON TABLE products FROM authenticated   (remove table-level)
--   2) GRANT  UPDATE (<every column except cost_price>) ON products
--             TO authenticated                              (re-grant per-column)
--
-- Anon / PUBLIC were never granted table-level UPDATE so 20260526000010's anon
-- + PUBLIC revokes were already correct (defense-in-depth comments preserved).
--
-- Deviation : tracked as DEV-S22-1.B-02 (medium — the original 000010 was a
-- silent no-op for column-level revoke and would have shipped without the
-- pgTAP T1 catching it).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Remove table-level UPDATE from authenticated.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON TABLE public.products FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Re-grant per-column UPDATE for every column except cost_price. This list
--    must mirror the products table columns as of 2026-05-18 (see ALTER TABLE
--    history in supabase/migrations/). If you add a new column AND want it to
--    be authenticated-writable, you MUST also add it here (otherwise the new
--    column defaults to "not writable by authenticated" — fail-safe).
-- ─────────────────────────────────────────────────────────────────────────────
GRANT UPDATE (
  sku,
  name,
  category_id,
  retail_price,
  tax_inclusive,
  image_url,
  current_stock,
  is_active,
  is_favorite,
  updated_at,
  deleted_at,
  wholesale_price,
  product_type,
  min_stock_threshold,
  unit,
  default_shelf_life_hours,
  target_gross_margin_pct,
  allergens,
  is_semi_finished
) ON public.products TO authenticated;

-- Note: id, created_at are immutable identity/audit columns and intentionally
-- not in the re-grant list — they were never meant to be UPDATE-able by app
-- code, and the implicit table-level UPDATE was a footgun. This corrective
-- migration tightens the surface in passing.

COMMENT ON COLUMN public.products.cost_price IS
  'S22 (DEV-S17-1.B-01): UPDATE revoked from authenticated/anon/PUBLIC via '
  'corrective 20260526000013 (table-level REVOKE + per-column re-grant skipping '
  'cost_price). Use update_cost_price_v1(p_product_id, p_new_cost, p_reason, '
  'p_idempotency_key) for manual corrections (emits stock_movements audit row '
  'movement_type=cost_price_correction), or receive_stock_v1 for the WAC '
  'purchase path (auto-updates via trigger). Both paths run SECURITY DEFINER as '
  'postgres owner. service_role retains UPDATE for emergency ops only — prefer '
  'the RPC path.';
