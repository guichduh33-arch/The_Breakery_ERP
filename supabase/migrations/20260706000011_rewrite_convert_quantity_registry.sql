-- 20260706000011_rewrite_convert_quantity_registry.sql
-- Make convert_quantity derive any same-dimension conversion from the central
-- `units` registry, so g↔kg, g↔gr, ml↔lt, … all resolve without enumerating
-- pairs. Order matters: the legacy exact-pair lookup in unit_conversions runs
-- FIRST, so every conversion that already worked is byte-for-byte preserved
-- (zero regression); the registry only ADDS resolution for pairs that used to
-- raise unit_conversion_missing (the ×1000 recipe-cost bug). Signature and the
-- P0002 missing-conversion contract are unchanged. CREATE OR REPLACE keeps ACLs.

CREATE OR REPLACE FUNCTION public.convert_quantity(p_qty numeric, p_from_unit text, p_to_unit text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_factor    NUMERIC(20,10);
  v_from_dim  TEXT;
  v_from_fac  NUMERIC(20,10);
  v_to_dim    TEXT;
  v_to_fac    NUMERIC(20,10);
BEGIN
  IF p_qty IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_from_unit IS NULL OR p_to_unit IS NULL THEN
    RAISE EXCEPTION 'convert_quantity: from_unit and to_unit must be non-null'
      USING ERRCODE = '22023';
  END IF;
  IF p_from_unit = p_to_unit THEN
    RETURN p_qty;
  END IF;

  -- 1) Legacy exact pair (preserve every currently-working conversion).
  SELECT factor INTO v_factor
    FROM unit_conversions
   WHERE from_unit = p_from_unit AND to_unit = p_to_unit;
  IF v_factor IS NOT NULL THEN
    RETURN p_qty * v_factor;
  END IF;

  -- 2) Derive from the dimensional registry (same dimension, both dimensional).
  SELECT dimension, factor_to_canonical INTO v_from_dim, v_from_fac
    FROM public.units WHERE code = p_from_unit;
  SELECT dimension, factor_to_canonical INTO v_to_dim, v_to_fac
    FROM public.units WHERE code = p_to_unit;

  IF v_from_dim IS NOT NULL AND v_to_dim IS NOT NULL
     AND v_from_dim = v_to_dim
     AND v_from_fac IS NOT NULL AND v_to_fac IS NOT NULL THEN
    RETURN p_qty * (v_from_fac / v_to_fac);
  END IF;

  -- 3) Genuinely unknown (e.g. container/cross-dimension → handled per-product).
  RAISE EXCEPTION 'unit_conversion_missing: % -> %', p_from_unit, p_to_unit
    USING ERRCODE = 'P0002';
END $$;
