-- 20260706000010_create_units_registry.sql
-- Central units registry: single source of truth for DIMENSIONAL unit conversion.
-- Dimensional units (mass mg/g/gr/kg, volume ml/mL/l/lt/L) carry a constant
-- factor_to_canonical (mass canonical = gram, volume canonical = ml). Count and
-- supplier-container units (bag/can/pack/...) have NO global factor — their base
-- factor is product-specific and lives in product_unit_alternatives. This table
-- powers convert_quantity (see next migration) and the app's unit pickers.

CREATE TABLE IF NOT EXISTS public.units (
  code                 TEXT PRIMARY KEY,
  label                TEXT NOT NULL,
  dimension            TEXT NOT NULL CHECK (dimension IN ('mass','volume','count','container')),
  factor_to_canonical  NUMERIC(20,10),               -- NULL for count/container
  is_active            BOOLEAN NOT NULL DEFAULT true,
  sort_order           INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A dimensional unit (mass/volume) MUST have a factor; count/container must not rely on one.
  CONSTRAINT units_dimensional_factor_chk CHECK (
    (dimension IN ('mass','volume') AND factor_to_canonical IS NOT NULL AND factor_to_canonical > 0)
    OR (dimension IN ('count','container'))
  )
);

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated; writes only via migrations / service_role.
DROP POLICY IF EXISTS units_read ON public.units;
CREATE POLICY units_read ON public.units FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.units FROM PUBLIC;
REVOKE ALL ON public.units FROM anon;
GRANT SELECT ON public.units TO authenticated;
GRANT ALL ON public.units TO service_role;

-- ── Seed every unit code currently in use across the catalog ─────────────────
INSERT INTO public.units (code, label, dimension, factor_to_canonical, sort_order) VALUES
  -- mass (canonical = gram)
  ('mg', 'Milligram', 'mass', 0.001, 10),
  ('g',  'Gram',      'mass', 1,     20),
  ('gr', 'Gram',      'mass', 1,     21),
  ('kg', 'Kilogram',  'mass', 1000,  30),
  -- volume (canonical = millilitre)
  ('ml', 'Millilitre','volume', 1,    40),
  ('mL', 'Millilitre','volume', 1,    41),
  ('l',  'Litre',     'volume', 1000, 50),
  ('lt', 'Litre',     'volume', 1000, 51),
  ('L',  'Litre',     'volume', 1000, 52),
  -- count
  ('pcs',  'Piece', 'count', 1, 60),
  ('piece','Piece', 'count', 1, 61),
  -- supplier containers (factor is product-specific → NULL here)
  ('bag',  'Bag',   'container', NULL, 70),
  ('Bag',  'Bag',   'container', NULL, 71),
  ('can',  'Can',   'container', NULL, 72),
  ('pack', 'Pack',  'container', NULL, 73),
  ('PACK', 'Pack',  'container', NULL, 74),
  ('roll', 'Roll',  'container', NULL, 75),
  ('ROLL', 'Roll',  'container', NULL, 76),
  ('set',  'Set',   'container', NULL, 77),
  ('plate','Plate', 'container', NULL, 78),
  ('cup',  'Cup',   'container', NULL, 79),
  ('Cup',  'Cup',   'container', NULL, 80)
ON CONFLICT (code) DO NOTHING;
