-- 20260517000042_add_stock_movements_lot_id_fk.sql
-- Session 13 / Phase 1.C — F1 expiry tracking : FK stock_movements.lot_id → stock_lots(id).
--
-- The column `stock_movements.lot_id` was added by Phase 1.A migration
-- `20260517000021_add_stock_movements_lot_id_column.sql` (acct-stream) so the
-- v1 RPC extension `20260517000020` could reference it without depending on
-- `stock_lots` existing yet. This migration only adds the foreign-key
-- constraint, now that `stock_lots` (created `20260517000040`) is present.
--
-- ON DELETE SET NULL : if a lot row is dropped (very rare — e.g. data fix),
-- the ledger reference is nulled but the movement row itself stays intact.
-- This preserves the append-only invariant on `stock_movements` (we never
-- DELETE or break ledger rows; nulling a FK is permitted because the column
-- itself is nullable by design — older rows pre-F1 simply have lot_id=NULL).
--
-- NOTE : the FK is added AFTER the column already exists. If the column is
-- not present (e.g. acct-stream migration 000021 hasn't landed yet), this
-- migration will fail loudly — that is the desired ordering signal.

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_lot_id_fkey
    FOREIGN KEY (lot_id) REFERENCES stock_lots(id) ON DELETE SET NULL;

-- Index `idx_stock_movements_lot_id` (partial WHERE lot_id IS NOT NULL) is
-- already created by Phase 1.A migration `20260517000021_add_stock_movements_lot_id_column.sql`.
-- We do NOT recreate it here to avoid duplicate-index errors.

COMMENT ON CONSTRAINT stock_movements_lot_id_fkey ON stock_movements IS
  'Session 13 — F1 expiry tracking. Set at INSERT by record_stock_movement_v1 '
  'via FIFO resolution (or caller override). NEVER updated post-INSERT. '
  'ON DELETE SET NULL preserves the append-only ledger if a lot row is dropped.';
