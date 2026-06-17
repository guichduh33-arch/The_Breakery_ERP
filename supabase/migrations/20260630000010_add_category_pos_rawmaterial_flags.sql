-- Session (pos-design-polish) — category settings flags.
-- show_in_pos     : whether the category (and its products) surface in the POS grid.
-- is_raw_material : classification flag for inventory management.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS show_in_pos     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_raw_material BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN categories.show_in_pos IS
  'When false, the category is hidden from the POS product grid (still usable in backoffice/inventory).';
COMMENT ON COLUMN categories.is_raw_material IS
  'Marks the category as raw material for inventory management.';
