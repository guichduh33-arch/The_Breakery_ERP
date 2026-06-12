-- 20260625000010_create_catalog_import_idempotency_keys.sql
-- S41 — dedicated idempotency-keys table for import_catalog_v1 (S25 flavor 2).
-- PK = client-generated UUID. Stores the first successful report for replay.
-- RPC-only access: REVOKE everything from app roles (SECURITY DEFINER bypasses).

CREATE TABLE catalog_import_idempotency_keys (
  key        UUID PRIMARY KEY,
  report     JSONB NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE catalog_import_idempotency_keys IS
  'S41 — idempotency keys for import_catalog_v1 (S25 flavor 2). Replay returns the stored report.';

ALTER TABLE catalog_import_idempotency_keys ENABLE ROW LEVEL SECURITY;
-- No policy: RPC-only access (SECURITY DEFINER), pattern b2b_settings S39.

REVOKE ALL ON catalog_import_idempotency_keys FROM PUBLIC;
REVOKE ALL ON catalog_import_idempotency_keys FROM anon;
REVOKE ALL ON catalog_import_idempotency_keys FROM authenticated;
