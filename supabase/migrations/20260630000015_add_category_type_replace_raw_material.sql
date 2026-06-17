-- Replace the is_raw_material boolean with a 3-way category_type classifier:
--   raw_material | semi_finished | finished
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS category_type TEXT NOT NULL DEFAULT 'finished'
    CHECK (category_type IN ('raw_material','semi_finished','finished'));

-- Backfill from the previous boolean.
UPDATE categories
   SET category_type = CASE WHEN is_raw_material THEN 'raw_material' ELSE 'finished' END;

ALTER TABLE categories DROP COLUMN IF EXISTS is_raw_material;

COMMENT ON COLUMN categories.category_type IS
  'Classification: raw_material | semi_finished | finished. Drives inventory grouping.';
