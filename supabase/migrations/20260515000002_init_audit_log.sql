-- 20260515000002_init_audit_log.sql
-- Session 12 hardening — generic audit_log table.
--
-- Domain actions with their own ledger (loyalty_transactions, stock_movements,
-- payments…) do NOT write here. This table captures forensic events that
-- otherwise leave no trace: soft-deletes, perm changes, dangerous toggles.
--
-- First customer : soft_delete_customer (session 12). Without an audit row,
-- ADMIN-only deletion of a PII-bearing customer was invisible after the fact.

CREATE TABLE audit_log (
  id               BIGSERIAL PRIMARY KEY,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_profile_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  action           TEXT NOT NULL CHECK (length(action) BETWEEN 3 AND 64),
  subject_table    TEXT NOT NULL CHECK (length(subject_table) BETWEEN 1 AND 64),
  subject_id       UUID,
  payload          JSONB
);

CREATE INDEX idx_audit_log_subject     ON audit_log(subject_table, subject_id);
CREATE INDEX idx_audit_log_actor       ON audit_log(actor_profile_id) WHERE actor_profile_id IS NOT NULL;
CREATE INDEX idx_audit_log_occurred_at ON audit_log(occurred_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT gated by audit_log.read perm. ADMIN+ pass via the unconditional
-- branch of has_permission; no explicit seed yet — wire when an audit UI lands.
CREATE POLICY "perm_read" ON audit_log FOR SELECT
  USING (has_permission(auth.uid(), 'audit_log.read'));

-- No INSERT / UPDATE / DELETE policies : SECURITY DEFINER RPCs are the only
-- writers and they bypass RLS.

REVOKE ALL ON audit_log FROM authenticated;
REVOKE ALL ON audit_log FROM anon;
GRANT SELECT ON audit_log TO authenticated;

COMMENT ON TABLE audit_log IS
  'Forensic trail for actions that have no domain-specific ledger. '
  'Writes come exclusively from SECURITY DEFINER functions.';
