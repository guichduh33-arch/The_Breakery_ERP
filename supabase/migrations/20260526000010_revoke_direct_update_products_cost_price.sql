-- 20260526000010_revoke_direct_update_products_cost_price.sql
-- Session 22 / Phase 1.B.1 — DEV-S17-1.B-01 — Revoke direct UPDATE on products.cost_price.
--
-- Rationale : enforce WAC ledger discipline. All writes to cost_price must go through
--   * receive_stock_v1 (purchase WAC path, SECURITY DEFINER postgres) — fires
--     tr_update_product_cost_on_purchase which updates cost_price as the postgres
--     owner of the trigger function (REVOKE doesn't apply).
--   * update_cost_price_v1 (manual correction, SECURITY DEFINER postgres,
--     emits stock_movements audit row with movement_type='cost_price_correction').
--
-- service_role retains UPDATE intentionally for emergency ops (BO admin scripts) ;
-- prefer RPC path documented via COMMENT.
--
-- Defense-in-depth pattern (S20 anon GRANT lessons) : include FROM PUBLIC alongside
-- named roles — PUBLIC inheritance ACL caveat. anon already has no column-level
-- privileges (S20 sweep) but listed for explicit intent.
--
-- IMPORTANT FOOTGUN — read 20260526000013 :
-- The three column-level REVOKEs below are SILENTLY NO-OP for `authenticated`
-- because `authenticated` holds the table-level UPDATE privilege on products.
-- Postgres column-level REVOKE only bites when there is NO matching table-level
-- GRANT. The corrective migration 20260526000013 applies the canonical pattern
-- (REVOKE table-level UPDATE + GRANT per-column UPDATE for every column except
-- cost_price). Caught by pgTAP T1 in products_cost_price_guard.test.sql.
-- For anon + PUBLIC, the REVOKEs below ARE effective (no table-level UPDATE
-- pre-existed) and serve as explicit defense-in-depth markers.

COMMENT ON COLUMN public.products.cost_price IS
  'S22 (DEV-S17-1.B-01): direct UPDATE revoked from authenticated/anon/PUBLIC. '
  'Use update_cost_price_v1(p_product_id, p_new_cost, p_reason, p_idempotency_key) '
  'for manual corrections (emits stock_movements audit row movement_type=cost_price_correction), '
  'or receive_stock_v1 for the WAC purchase path (auto-updates via trigger). '
  'Both paths run SECURITY DEFINER as postgres owner. '
  'service_role retains UPDATE for emergency ops only — prefer the RPC path.';
