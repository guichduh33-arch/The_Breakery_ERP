-- 20260516000013_init_unit_conversions.sql
-- Session 12 / Phase 1 (complete) / migration 2 :
--   Table unit_conversions + helper SQL convert_quantity().
--
-- Objectif métier : gérer les conversions kg ↔ g, L ↔ mL, etc. (cf. INVENTORY.md §14
--   "Conversion d''unités"). Une réception en kg doit pouvoir mettre à jour un stock
--   stocké en g sans perte.

CREATE TABLE unit_conversions (
  from_unit  TEXT           NOT NULL,
  to_unit    TEXT           NOT NULL,
  factor     DECIMAL(20,10) NOT NULL CHECK (factor > 0),
  notes      TEXT,
  created_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
  PRIMARY KEY (from_unit, to_unit)
);

COMMENT ON TABLE unit_conversions IS
  'Conversion entre unités : qty_to = qty_from * factor. Seedée pour les paires '
  'usuelles (kg↔g, L↔mL, identités). Ajouter de nouvelles paires via INSERT direct '
  'ou la future page /backoffice/inventory/units (V3+).';

-- Identités (pour simplifier le helper convert_quantity quand from = to)
INSERT INTO unit_conversions (from_unit, to_unit, factor, notes) VALUES
  ('pcs', 'pcs', 1.0, 'identity'),
  ('g',   'g',   1.0, 'identity'),
  ('kg',  'kg',  1.0, 'identity'),
  ('mL',  'mL',  1.0, 'identity'),
  ('L',   'L',   1.0, 'identity'),
  ('mg',  'mg',  1.0, 'identity'),
  -- Masse
  ('kg',  'g',   1000.0,    'kg → g'),
  ('g',   'kg',  0.001,     'g → kg'),
  ('kg',  'mg',  1000000.0, 'kg → mg'),
  ('mg',  'kg',  0.000001,  'mg → kg'),
  ('g',   'mg',  1000.0,    'g → mg'),
  ('mg',  'g',   0.001,     'mg → g'),
  -- Volume
  ('L',   'mL',  1000.0,    'L → mL'),
  ('mL',  'L',   0.001,     'mL → L')
ON CONFLICT (from_unit, to_unit) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- Helper convert_quantity(qty, from_unit, to_unit) → DECIMAL
--   Renvoie qty * factor où factor est trouvé dans unit_conversions.
--   Raise 'unit_conversion_missing' si la paire n'existe pas.
--   Cas trivial from = to → renvoie qty (factor 1 garanti par les seeds).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION convert_quantity(
  p_qty       DECIMAL(20,10),
  p_from_unit TEXT,
  p_to_unit   TEXT
)
RETURNS DECIMAL(20,10)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_factor DECIMAL(20,10);
BEGIN
  IF p_qty IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_from_unit IS NULL OR p_to_unit IS NULL THEN
    RAISE EXCEPTION 'convert_quantity: from_unit and to_unit must be non-null'
      USING ERRCODE='22023';
  END IF;
  IF p_from_unit = p_to_unit THEN
    RETURN p_qty;
  END IF;

  SELECT factor INTO v_factor
    FROM unit_conversions
   WHERE from_unit = p_from_unit AND to_unit = p_to_unit;

  IF v_factor IS NULL THEN
    RAISE EXCEPTION 'unit_conversion_missing: % -> %', p_from_unit, p_to_unit
      USING ERRCODE='P0002';
  END IF;

  RETURN p_qty * v_factor;
END $$;

COMMENT ON FUNCTION convert_quantity IS
  'Convertit une quantité entre deux unités via la table unit_conversions. '
  'Raise unit_conversion_missing (P0002) si la paire n''est pas seedée. '
  'Utilisé par record_production_v1 pour convertir recipe.unit → material.unit, '
  'et par receive/incoming pour réconcilier l''unité de commande à l''unité de stock.';

-- RLS : table publique en lecture pour tout user authentifié (référentiel statique)
--       writes via migration uniquement (pas de page UI MVP)
ALTER TABLE unit_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON unit_conversions FOR SELECT
  USING (is_authenticated());
