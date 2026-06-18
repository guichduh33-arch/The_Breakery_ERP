-- 20260701000012_create_purchase_payments_table.sql
-- Session 46 / Wave A4 — purchase_payments append-only ledger.
--
-- R3 (Spec §3): trace payments against purchase orders independently of the
-- goods receipt. Mirrors the b2b_payments pattern (S24, migration 20260601000010):
--   • append-only (REVOKE UPDATE/DELETE for authenticated)
--   • RLS SELECT for authenticated
--   • all writes through record_po_payment_v1 (SECURITY DEFINER)
--
-- Payment status (unpaid/partial/paid) is derived from:
--   SUM(amount) vs purchase_orders.total_amount
-- This is computed in-RPC and never stored as a column (avoids double writes).
--
-- idempotency_key is UNIQUE and NOT NULL: idempotency is flavor 2 (S25)
-- — every insert carries a client-generated UUID, and the RPC returns the
-- first result on replay.

CREATE TABLE purchase_payments (
  id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID           NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  amount           NUMERIC(14,2)   NOT NULL CHECK (amount > 0),
  method           TEXT            NOT NULL,
  paid_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  paid_by          UUID            REFERENCES user_profiles(id) ON DELETE SET NULL,
  reference        TEXT,
  idempotency_key  UUID            NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_payments_po_id    ON purchase_payments(purchase_order_id);
CREATE INDEX idx_purchase_payments_paid_at  ON purchase_payments(paid_at DESC);

-- RLS: authenticated can SELECT; no write policy — all writes via SECURITY DEFINER RPC.
ALTER TABLE purchase_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON purchase_payments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = purchase_payments.purchase_order_id
        AND has_permission(auth.uid(), 'purchasing.po.read')
    )
  );

-- Append-only: REVOKE UPDATE/DELETE (pattern: b2b_payments + stock_movements).
-- SECURITY DEFINER RPCs bypass RLS and operate as postgres owner.
REVOKE INSERT, UPDATE, DELETE ON purchase_payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON purchase_payments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON purchase_payments FROM PUBLIC;

COMMENT ON TABLE purchase_payments IS
  'Session 46 — S46-A4. Append-only ledger of payments made against purchase orders. '
  'Mirrors b2b_payments (S24) pattern. Payment status (unpaid/partial/paid) is derived '
  'from SUM(amount) vs purchase_orders.total_amount — not stored. All writes via '
  'record_po_payment_v1 (SECURITY DEFINER). REVOKE UPDATE/DELETE = append-only.';

COMMENT ON COLUMN purchase_payments.idempotency_key IS
  'NOT NULL UNIQUE — flavor 2 (S25) idempotency. Client generates a UUID v4 per '
  'payment attempt; record_po_payment_v1 returns the first result on replay.';

COMMENT ON COLUMN purchase_payments.method IS
  'Payment method: ''cash'' | ''transfer'' | ''bank'' | any text matching method '
  'supported by record_po_payment_v1. Drives credit account selection in the JE.';
