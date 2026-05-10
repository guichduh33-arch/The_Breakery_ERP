-- 20260512000002_extend_order_items_cancel.sql
-- Session 10 — item-cancel-after-send.
-- Adds soft-cancel flags on order_items. A cancelled item is excluded from
-- order totals (recomputed by cancel_order_item_rpc) and rendered struck-through
-- on the cart panel and red-CANCELLED on KDS cards.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS is_cancelled     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by     UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

-- Consistency: all 4 fields move together. cancelled_reason >= 3 chars when set.
ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS chk_order_items_cancel_consistency;
ALTER TABLE order_items
  ADD  CONSTRAINT chk_order_items_cancel_consistency CHECK (
    (is_cancelled = false
       AND cancelled_at IS NULL
       AND cancelled_reason IS NULL
       AND cancelled_by IS NULL)
    OR
    (is_cancelled = true
       AND cancelled_at IS NOT NULL
       AND cancelled_reason IS NOT NULL AND length(cancelled_reason) >= 3
       AND cancelled_by IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_order_items_cancelled
  ON order_items(order_id) WHERE is_cancelled = true;

COMMENT ON COLUMN order_items.is_cancelled     IS 'Session 10: true if cancelled post-send_to_kitchen via cancel_order_item_rpc (manager-PIN gated).';
COMMENT ON COLUMN order_items.cancelled_at     IS 'Session 10: timestamp of cancellation.';
COMMENT ON COLUMN order_items.cancelled_reason IS 'Session 10: cashier-entered reason (>= 3 chars).';
COMMENT ON COLUMN order_items.cancelled_by     IS 'Session 10: profile_id of the manager whose PIN authorized.';
