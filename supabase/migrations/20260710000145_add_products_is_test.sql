-- Reports POS refonte (Lot A) — dedicated test/demo flag on products.
-- A single source of truth so test data (e.g. a "test" product) is excluded
-- from ALL POS/BO report aggregations, not via ad-hoc name filters.
-- Additive, non-destructive; default false so existing rows are "real".

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- Partial index: report queries filter `AND is_test = false` (or exclude
-- orders touching a test product); the few test rows are cheap to look up.
CREATE INDEX IF NOT EXISTS idx_products_is_test
  ON public.products (is_test) WHERE is_test = true;

COMMENT ON COLUMN public.products.is_test IS
  'Marks a product as test/demo data. Excluded from ALL POS/BO report aggregations. Default false.';
