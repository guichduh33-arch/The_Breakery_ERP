-- Session 25 — Phase 1.A.1 — _010
-- Idempotency ledger for create_tablet_order_v2 RPC.
-- client_uuid is generated POS-side via crypto.randomUUID() in useRef.

CREATE TABLE tablet_order_idempotency_keys (
  client_uuid UUID PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tablet_order_idempotency_keys_order_id_idx
  ON tablet_order_idempotency_keys(order_id);

ALTER TABLE tablet_order_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- No direct INSERT/UPDATE/DELETE from authenticated (writes go through SECURITY DEFINER RPC).
REVOKE ALL ON TABLE tablet_order_idempotency_keys FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE tablet_order_idempotency_keys FROM authenticated;
GRANT SELECT ON TABLE tablet_order_idempotency_keys TO authenticated;

CREATE POLICY tablet_order_idempotency_keys_select_auth
  ON tablet_order_idempotency_keys FOR SELECT
  TO authenticated USING (true);

COMMENT ON TABLE tablet_order_idempotency_keys IS
  'S25 — idempotency ledger for create_tablet_order_v2 RPC. client_uuid is generated POS-side.';
