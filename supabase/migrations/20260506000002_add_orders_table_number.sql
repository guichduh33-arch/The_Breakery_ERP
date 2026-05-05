-- 20260506000002_add_orders_table_number.sql
-- Session 4 / migration 2 : orders.table_number + index sparse occupancy
-- F1: TEXT (pas de FK rigide) pour cohérence avec les references V2

ALTER TABLE orders
  ADD COLUMN table_number TEXT;

-- Sparse index pour Realtime occupancy query (F3)
CREATE INDEX idx_orders_active_table
  ON orders(table_number)
  WHERE table_number IS NOT NULL
    AND status NOT IN ('completed', 'voided');
