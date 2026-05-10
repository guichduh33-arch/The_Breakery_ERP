-- 20260512000003_extend_orders_void_columns.sql
-- Session 10 — post-checkout full void.
-- Adds void audit columns on orders. status='voided' transitions are gated by
-- the consistency CHECK : voided_at + voided_by + void_reason must all be set
-- when status='voided', and all three must be NULL otherwise.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_void_consistency;
ALTER TABLE orders
  ADD  CONSTRAINT chk_orders_void_consistency CHECK (
    (status <> 'voided'
       AND voided_at IS NULL
       AND voided_by IS NULL
       AND void_reason IS NULL)
    OR
    (status = 'voided'
       AND voided_at IS NOT NULL
       AND voided_by IS NOT NULL
       AND void_reason IS NOT NULL AND length(void_reason) >= 3)
  );

COMMENT ON COLUMN orders.voided_at   IS 'Session 10: timestamp of void via void_order_rpc.';
COMMENT ON COLUMN orders.voided_by   IS 'Session 10: profile_id of the manager whose PIN authorized.';
COMMENT ON COLUMN orders.void_reason IS 'Session 10: cashier-entered reason (>= 3 chars).';
