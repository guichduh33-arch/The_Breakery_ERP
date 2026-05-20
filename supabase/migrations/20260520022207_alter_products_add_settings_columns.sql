-- Session 27 / Wave 1.A.1 — ALTER products ADD 5 columns for settings.
--
-- Discovery 2026-05-20: GeneralPanel.tsx renders 5 toggles + 1 TEXT description
-- that don't exist in the DB. This migration creates them with safe defaults
-- so update_product_v1 whitelist can apply patches against real columns.

ALTER TABLE products
  ADD COLUMN description        TEXT,
  ADD COLUMN visible_on_pos     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN available_for_sale BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN track_inventory    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN deduct_stock       BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN products.description IS
  'Optional product description shown in BO product detail General tab and on POS detail view.';
COMMENT ON COLUMN products.visible_on_pos IS
  'When false, product is hidden from POS grid even if is_active=true. Used for seasonal items / staging.';
COMMENT ON COLUMN products.available_for_sale IS
  'When false, product appears greyed-out on POS but can still be queried in admin reports.';
COMMENT ON COLUMN products.track_inventory IS
  'When false, stock_movements are not recorded for this product (e.g. service items, intangibles).';
COMMENT ON COLUMN products.deduct_stock IS
  'When false, sales do not auto-deduct stock at order completion. Used for opname-only items.';
