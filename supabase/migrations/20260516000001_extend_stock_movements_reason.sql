-- 20260516000001_extend_stock_movements_reason.sql
-- Session 12 / migration 1 : etendre stock_movements pour les admin movements
-- (reason + unit_cost + idempotency) ET autoriser reference_id NULL sur admin types.
-- Spec: docs/superpowers/specs/2026-05-11-session-12-inventory-mvp-spec.md S3.2

ALTER TABLE stock_movements
  ADD COLUMN reason          TEXT,
  ADD COLUMN unit_cost       DECIMAL(14,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  ADD COLUMN idempotency_key UUID UNIQUE;

-- reference_id was NOT NULL in session 1 (orders/refunds always carry an id).
-- Admin movements (adjustment/purchase/waste) have no parent reference -> allow NULL,
-- but keep NOT NULL semantics for sale/sale_void via a partial CHECK.
ALTER TABLE stock_movements ALTER COLUMN reference_id DROP NOT NULL;

ALTER TABLE stock_movements
  ADD CONSTRAINT chk_stock_movements_reference_required_for_orders CHECK (
    movement_type NOT IN ('sale', 'sale_void')
    OR reference_id IS NOT NULL
  );

ALTER TABLE stock_movements
  ADD CONSTRAINT chk_stock_movements_reason_required CHECK (
    movement_type IN ('sale', 'sale_void')
    OR (reason IS NOT NULL AND length(trim(reason)) >= 3)
  );

CREATE INDEX idx_stock_movements_type_date
  ON stock_movements(movement_type, created_at DESC);

COMMENT ON COLUMN stock_movements.reason          IS 'Required for admin types (adjustment/waste/purchase/production). Free text >= 3 chars.';
COMMENT ON COLUMN stock_movements.unit_cost       IS 'Optional COGS per unit for purchase/production (informational MVP).';
COMMENT ON COLUMN stock_movements.idempotency_key IS 'Client-supplied UUID to safely retry admin RPCs.';
