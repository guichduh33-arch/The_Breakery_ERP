-- 20260516000002_link_stock_movements_supplier.sql
-- Session 12 / migration 2 : link stock_movements to suppliers (purchase only).
-- Spec: docs/superpowers/specs/2026-05-11-session-12-inventory-mvp-spec.md S3.2

ALTER TABLE stock_movements
  ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE stock_movements
  ADD CONSTRAINT chk_supplier_only_on_purchase CHECK (
    supplier_id IS NULL OR movement_type = 'purchase'
  );

CREATE INDEX idx_stock_movements_supplier
  ON stock_movements(supplier_id, created_at DESC)
  WHERE supplier_id IS NOT NULL;

COMMENT ON COLUMN stock_movements.supplier_id IS
  'Optional supplier reference. CHECK constraint enforces NULL except for movement_type=purchase.';
