-- 20260517000041_add_products_default_shelf_life.sql
-- Session 13 / Phase 1.C — F1 expiry tracking : products.default_shelf_life_hours.
--
-- The shelf-life column tells the lot-creation flow (PO receive,
-- production_record, BO manual lot creation) how to default `expires_at` when
-- the caller does NOT supply one explicitly :
--
--   expires_at := COALESCE(p_expires_at, now() + (products.default_shelf_life_hours * INTERVAL '1 hour'))
--
-- NULL = no default ⇒ caller MUST pass `p_expires_at` ⇒ products that don't
-- expire (non-perishable) or whose shelf life varies per batch (bakery custom
-- recipes) keep this NULL. Bakery defaults (croissants 24h, pastries 48h,
-- sandwiches 12h) are set via UPDATE in subsequent operational scripts, NOT
-- in this migration (data, not schema).
--
-- The column is also surfaced read-only on the BO Products page as a hint :
-- "default expiry 24h after receipt" UI string.

ALTER TABLE products
  ADD COLUMN default_shelf_life_hours INT
    CHECK (default_shelf_life_hours IS NULL OR default_shelf_life_hours >= 0);

COMMENT ON COLUMN products.default_shelf_life_hours IS
  'Session 13 — F1 expiry tracking. Default hours-from-now used by '
  'create_stock_lot_v1 / record_production_v1 to compute expires_at when '
  'caller does not supply one. NULL = no default (non-perishable or per-batch).';
