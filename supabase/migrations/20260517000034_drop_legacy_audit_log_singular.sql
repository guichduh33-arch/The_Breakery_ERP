-- 20260517000034_drop_legacy_audit_log_singular.sql
-- Session 13 / Phase 1.B — [m5] :
--   Canonical = `audit_logs` (plural, cohérent journal_entries / stock_movements / user_sessions).
--   Drop the legacy `audit_log` (singular) table that shipped in 20260515000002.
--
-- Migration steps:
--   1. Copy rows from singular → plural (column rename : actor_profile_id→actor_id,
--      subject_table→entity_type, subject_id→entity_id, payload→metadata,
--      occurred_at→created_at).
--   2. DROP TABLE audit_log CASCADE.
--   3. Re-create `audit_log` as an updatable VIEW with INSTEAD-OF triggers, so
--      the four legacy consumers (soft_delete_customer, record_stock_movement_v1,
--      4× internal-transfer RPCs) continue to work without re-publishing them.
--      The view is documented as deprecated ; new code MUST write to audit_logs
--      directly. CI grep gate enforces this from this migration forward.
--
-- This avoids re-CREATE-OR-REPLACE'ing inv-stream-owned RPCs and acct-stream-owned RPCs
-- (signature stability rule).
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-INDEX.md Phase 1.B
-- DoD : grep -RE "\baudit_log\b" apps/ packages/ supabase/functions/ returns 0 hits on singular.

-- ============================================================
-- 1. Copy existing rows
-- ============================================================
DO $$
BEGIN
  -- Only run the copy if the legacy table still exists with its original shape.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='audit_log' AND table_type = 'BASE TABLE'
  ) THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
    SELECT actor_profile_id, action, subject_table, subject_id, payload, occurred_at
      FROM audit_log;
  END IF;
END $$;

-- ============================================================
-- 2. Drop the legacy table (CASCADE removes its policies + indexes + grants)
-- ============================================================
DROP TABLE IF EXISTS audit_log CASCADE;

-- ============================================================
-- 3. Compatibility VIEW + INSTEAD-OF trigger
--    Lets the four legacy SECURITY DEFINER RPCs keep their `INSERT INTO audit_log`
--    statement (signature stability rule) by rerouting writes to audit_logs.
-- ============================================================
CREATE OR REPLACE VIEW audit_log AS
  SELECT id, created_at AS occurred_at, actor_id AS actor_profile_id,
         action, entity_type AS subject_table, entity_id AS subject_id,
         metadata AS payload
    FROM audit_logs;

CREATE OR REPLACE FUNCTION audit_log_insert_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (
    NEW.actor_profile_id,
    NEW.action,
    NEW.subject_table,
    NEW.subject_id,
    COALESCE(NEW.payload, '{}'::JSONB),
    COALESCE(NEW.occurred_at, now())
  );
  RETURN NEW;
END $$;

CREATE TRIGGER audit_log_compat_insert
  INSTEAD OF INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_insert_trigger();

-- View shouldn't be readable by anon ; gate via the underlying audit_logs RLS.
REVOKE ALL ON audit_log FROM anon;
GRANT SELECT, INSERT ON audit_log TO authenticated;

COMMENT ON VIEW audit_log IS
  'DEPRECATED — singular legacy view over audit_logs (plural). '
  'Kept only for the four legacy SECURITY DEFINER consumers '
  '(soft_delete_customer, record_stock_movement_v1, transfer RPCs). '
  'New code MUST write to audit_logs directly. Drop scheduled post-Session-13.';
