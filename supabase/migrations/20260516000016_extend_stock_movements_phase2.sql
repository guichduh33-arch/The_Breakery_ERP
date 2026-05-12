-- 20260516000016_extend_stock_movements_phase2.sql
-- Session 12 / Phase 1 (complete) / migration 5 :
--   ALTER stock_movements : ajouter from_section_id, to_section_id (FK sections),
--   unit (NOT NULL backfillé depuis products.unit), metadata (JSONB) +
--   indexes section + CHECKs cohérence.
--
-- Préalable : sections existent (migration 12), products.unit existe (migration 15).
-- La migration MVP 1 (20260516000001) a déjà ajouté reason / unit_cost / idempotency_key
-- et drop NOT NULL sur reference_id. La migration MVP 2 a ajouté supplier_id.

-- Ajouter les colonnes sections + metadata
ALTER TABLE stock_movements
  ADD COLUMN from_section_id UUID REFERENCES sections(id) ON DELETE RESTRICT,
  ADD COLUMN to_section_id   UUID REFERENCES sections(id) ON DELETE RESTRICT,
  ADD COLUMN metadata        JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Ajouter unit avec NOT NULL en 3 étapes : default → backfill → drop default
ALTER TABLE stock_movements
  ADD COLUMN unit TEXT;

-- Backfill depuis products.unit pour les rows existantes
UPDATE stock_movements sm
   SET unit = COALESCE(p.unit, 'pcs')
  FROM products p
 WHERE sm.product_id = p.id
   AND sm.unit IS NULL;

-- Forcer NOT NULL maintenant que tout est rempli
ALTER TABLE stock_movements
  ALTER COLUMN unit SET NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- CHECKs de cohérence
-- ──────────────────────────────────────────────────────────────────────────────

-- Pour les types qui n'ont pas d'origine externe (purchase = supplier, sale = customer,
-- incoming = supplier external, sale_void = customer return), une section source OU
-- destination est requise (sinon mouvement orphelin).
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_stock_movements_section_required CHECK (
    movement_type IN ('purchase', 'incoming', 'sale', 'sale_void', 'purchase_return')
    OR from_section_id IS NOT NULL
    OR to_section_id IS NOT NULL
  );

-- transfer_in et transfer_out doivent avoir BOTH sections renseignées (transfert intra)
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_stock_movements_transfer_both_sections CHECK (
    movement_type NOT IN ('transfer_in', 'transfer_out')
    OR (from_section_id IS NOT NULL AND to_section_id IS NOT NULL)
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────────────────────

CREATE INDEX idx_stock_movements_from_section
  ON stock_movements(from_section_id, created_at DESC)
  WHERE from_section_id IS NOT NULL;

CREATE INDEX idx_stock_movements_to_section
  ON stock_movements(to_section_id, created_at DESC)
  WHERE to_section_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- Comments
-- ──────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN stock_movements.from_section_id IS
  'Section source du mouvement (NULL pour purchase/incoming/sale/sale_void/purchase_return). '
  'Obligatoire pour transfer_in/out et adjustment_*/opname_*/waste/production_*.';
COMMENT ON COLUMN stock_movements.to_section_id IS
  'Section destination du mouvement (NULL pour sale/sale_void/waste). '
  'Obligatoire pour transfer_in/out et purchase/incoming/production_in/adjustment_in/opname_in.';
COMMENT ON COLUMN stock_movements.unit IS
  'Unité de la quantité (pcs/kg/g/L/mL/...). Backfillée depuis products.unit. '
  'Doit être cohérente avec convert_quantity() pour les recipes / receives.';
COMMENT ON COLUMN stock_movements.metadata IS
  'Contextes additionnels (batch_id, transfer_notes, qc_notes, etc.). '
  'Permet d''ajouter des champs sans nouvelle migration.';
