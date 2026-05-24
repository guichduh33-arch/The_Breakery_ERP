-- Session 27c / Wave 1 — ENUM type for product variant axes.
--
-- 3 axes (1 per parent, no matrix combinatorics per business decision 2026-05-24):
-- - 'flavor' : croissant nature/amande/chocolat (recipes physiquement différentes)
-- - 'size'   : café 12oz/16oz/20oz (recipe scaling possible)
-- - 'format' : entier/demi/tranché, fresh/frozen (stock distinct)

CREATE TYPE variant_axis_type AS ENUM ('flavor', 'size', 'format');

COMMENT ON TYPE variant_axis_type IS
  'Product variant axis. One axis per parent product (no matrix combinatorics). Add new values with ALTER TYPE … ADD VALUE in a future migration if business need arises.';
