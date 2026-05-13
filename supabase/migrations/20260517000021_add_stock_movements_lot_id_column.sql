-- 20260517000021_add_stock_movements_lot_id_column.sql
-- Session 13 / Phase 1.A / [m4] split 1/3 :
--   Adds stock_movements.lot_id UUID NULL column + partial index.
--
-- Note : the actual column ADD was emitted defensively from migration 000020
-- (record_stock_movement_v1 references the column at CREATE time, and
-- check_function_bodies=on requires it to exist). This file consolidates the
-- index + comment + future FK that inv-stream (000040..045) wires when
-- stock_lots arrives. Keep this migration in place to preserve the [m4]
-- numbering contract from the INDEX plan (line 224).

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS lot_id UUID;

-- Partial index : most movements have NULL lot_id (legacy + non-consumer types).
CREATE INDEX IF NOT EXISTS idx_stock_movements_lot_id
  ON stock_movements (lot_id)
  WHERE lot_id IS NOT NULL;

-- FK to stock_lots(id) is added by inv-stream (Phase 1.C) when the table exists.
-- We deliberately DO NOT add the FK here to avoid coupling to inv-stream ordering.

COMMENT ON COLUMN stock_movements.lot_id IS
  'D15 (Phase 1.A [m4] split 1/3). Optional pointer to the stock_lots row consumed '
  'by this movement. Set ONLY at INSERT by record_stock_movement_v1 (B1 pattern a). '
  'Never updated post-INSERT — append-only invariant guarded by pgTAP T_F1_NO_UPDATE_INVARIANT.';
