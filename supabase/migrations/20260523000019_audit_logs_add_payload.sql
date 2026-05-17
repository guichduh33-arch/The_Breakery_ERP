-- 20260523000019_audit_logs_add_payload.sql
-- Session 19 / Phase 1.B — Prerequisite for update_role_session_timeout_v1.
--
-- The existing audit_logs table has only `metadata JSONB` for structured data,
-- but the Phase 1.B RPC writes a structured before/after diff and we prefer
-- a dedicated `payload` column for clarity (per INDEX §4 Phase 1.B Step 4
-- option a). Idempotent — safe to re-run.
--
-- Decision refs : D6/D8/D9, D19 (migration block 20260523000019..021 = Thread B).

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS payload JSONB;

COMMENT ON COLUMN audit_logs.payload IS
  'Structured before/after payload for mutate-audit RPCs (Session 19+). '
  'Distinct from metadata which carries contextual/free-form fields.';
