-- 20260517000040_init_stock_lots.sql
-- Session 13 / Phase 1.C — F1 expiry tracking : init `stock_lots` table.
--
-- Pattern : D15 (locked 2026-05-14, pack 2026-05-13-decision-pack.md).
-- F1 (06-001 / 06-002 XL P0) tracks per-batch expiry for perishable products
-- (bakery, dairy, prepared dishes). The ledger `stock_movements` REMAINS
-- append-only — FIFO lot resolution lives UPFRONT inside `record_stock_movement_v1`
-- (extended additively by Phase 1.A migration 20260517000020), which writes
-- `stock_movements.lot_id` AT INSERT time. There is NO trigger AFTER INSERT
-- on `stock_movements`. See `T_F1_NO_TRIGGER_INVARIANT` in
-- `supabase/tests/inventory_f1_lots.test.sql`.
--
-- `stock_lots` itself is NOT append-only :
--   - `quantity` is decremented by `record_stock_movement_v1` in the same
--     transaction as the consuming `stock_movements` INSERT.
--   - `status` is flipped from 'active' → 'expired' by the hourly pg_cron job
--     (migration 20260517000045).
--   - `status` is flipped from 'active' → 'consumed' by `record_stock_movement_v1`
--     when `quantity` reaches 0 on the consuming leg.
-- These UPDATEs are licit on `stock_lots`. Tests assert RLS denies them from
-- the `authenticated` role — only SECURITY DEFINER RPCs may write.
--
-- Status semantics :
--   - 'active'   : usable for FIFO consumption (eligible to back a sale, waste,
--                  transfer_out, production_out, sale_void-reverse).
--   - 'expired'  : `expires_at < now()` AND cron has flipped status. Excluded
--                  from FIFO selection by `_resolve_fifo_lot` (created in
--                  migration 20260517000043).
--   - 'consumed' : `quantity = 0` and no further activity expected.
--
-- Index : (product_id, expires_at, status) WHERE status='active' is the
-- primary lookup path for `_resolve_fifo_lot` (LIMIT 1 ORDER BY expires_at).

CREATE TABLE stock_lots (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID           NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id   UUID           REFERENCES stock_locations(id) ON DELETE SET NULL,
  quantity      DECIMAL(10,3)  NOT NULL CHECK (quantity >= 0),
  unit          TEXT           NOT NULL,
  expires_at    TIMESTAMPTZ    NOT NULL,
  received_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  batch_number  TEXT,
  status        TEXT           NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','expired','consumed')),
  metadata      JSONB          NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key UUID         UNIQUE,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- Primary FIFO lookup index — partial WHERE status='active' keeps it tight.
-- Used by `_resolve_fifo_lot(product_id, qty)` : SELECT ... ORDER BY expires_at ASC LIMIT 1 FOR UPDATE.
CREATE INDEX idx_stock_lots_fifo
  ON stock_lots(product_id, expires_at, status)
  WHERE status = 'active';

-- Secondary index for the BO `get_expiring_lots_v1` RPC : scan all active
-- lots within an upcoming window (24h default).
CREATE INDEX idx_stock_lots_expiring
  ON stock_lots(expires_at)
  WHERE status = 'active';

-- Tertiary index for status sweeps (cron mark_expired_lots_hourly).
CREATE INDEX idx_stock_lots_status_expires
  ON stock_lots(status, expires_at);

CREATE TRIGGER stock_lots_set_updated_at
  BEFORE UPDATE ON stock_lots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE stock_lots IS
  'Session 13 — F1 expiry tracking. One row per physical batch of a perishable '
  'product. Created UPFRONT at receive time (PO receive / production_record). '
  'Consumed FIFO by `record_stock_movement_v1` (decrements quantity, flips '
  'status when quantity=0). Expired hourly by pg_cron job. NOT append-only — '
  'UPDATEs on quantity / status are licit (via SECURITY DEFINER RPCs only).';
COMMENT ON COLUMN stock_lots.quantity IS
  'Remaining quantity on this lot. Decremented by record_stock_movement_v1. '
  'Reaches 0 when fully consumed → status flips to ''consumed''.';
COMMENT ON COLUMN stock_lots.status IS
  '''active'' (FIFO-eligible) / ''expired'' (cron-flipped after expires_at) / '
  '''consumed'' (quantity=0). Excluded from FIFO selection unless active.';
COMMENT ON COLUMN stock_lots.expires_at IS
  'Hard expiry timestamp. Once past + cron sweep, status flips to ''expired'' '
  'and an auto-waste stock_movements row is INSERTed (never UPDATEd).';
COMMENT ON COLUMN stock_lots.idempotency_key IS
  'Optional UUID for create_stock_lot_v1 replay-safety (PO receive retries).';

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS : authenticated SELECT (gated by inventory.read), writes via RPCs only.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE stock_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_read" ON stock_lots FOR SELECT
  USING (is_authenticated() AND has_permission(auth.uid(), 'inventory.read'));

-- No INSERT / UPDATE / DELETE policy — REVOKE locks down writes.
-- SECURITY DEFINER RPCs (create_stock_lot_v1, record_stock_movement_v1,
-- mark_expired_lots_hourly) write as their owner (postgres) → bypass RLS.
REVOKE INSERT, UPDATE, DELETE ON stock_lots FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON stock_lots FROM anon;
