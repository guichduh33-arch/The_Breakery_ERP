-- 20260618000014_create_order_edit_idempotency_keys_table.sql
-- Session 33 / Wave 1.4 — dedicated idempotency table for the 3 edit RPCs.
-- S25 flavor 2 pattern (RPC arg + UNIQUE constraint).

CREATE TABLE order_edit_idempotency_keys (
  key         UUID PRIMARY KEY,
  action      TEXT NOT NULL CHECK (action IN ('add', 'update_qty', 'remove')),
  order_id    UUID NOT NULL REFERENCES orders(id),
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_edit_idem_keys_order ON order_edit_idempotency_keys(order_id);
CREATE INDEX idx_order_edit_idem_keys_created ON order_edit_idempotency_keys(created_at);

ALTER TABLE order_edit_idempotency_keys ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON order_edit_idempotency_keys FROM authenticated, anon;
GRANT SELECT ON order_edit_idempotency_keys TO authenticated;

COMMENT ON TABLE order_edit_idempotency_keys IS
  'S33 — Dedup keys for add_order_item / update_order_item_qty / remove_order_item RPCs. '
  'PK = client-generated UUID. Replay returns row.result JSONB without re-executing.';
