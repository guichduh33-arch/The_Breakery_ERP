-- 20260517000031_init_edge_function_rate_limits.sql
-- Session 13 / Phase 1.B — Task 25-002 :
--   Postgres-backed Edge Function rate-limit table.
--
-- The in-memory rate-limit map in supabase/functions/_shared/rate-limit.ts is
-- single-instance and dies on cold-start. This table provides a durable,
-- cross-instance backend that the shared helper can opt into (read/upsert per
-- window) for hardening sensitive EFs (auth-verify-pin, kiosk-issue-jwt).
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-INDEX.md Phase 1.B
-- Design   : in-memory remains the primary fast path ; this table is the
--            durable fallback wired from EFs via shared/rate-limit.ts (Phase 1.B).

CREATE TABLE IF NOT EXISTS edge_function_rate_limits (
  id              BIGSERIAL PRIMARY KEY,
  function_name   TEXT NOT NULL CHECK (length(function_name) BETWEEN 1 AND 64),
  ip_address      TEXT NOT NULL CHECK (length(ip_address) BETWEEN 1 AND 64),
  bucket_key      TEXT NOT NULL CHECK (length(bucket_key) BETWEEN 1 AND 128),
  request_count   INT  NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  window_start    TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_end      TIMESTAMPTZ NOT NULL,
  CONSTRAINT edge_function_rate_limits_window_sane
    CHECK (window_end > window_start)
);

-- Primary lookup index: (function_name, bucket_key) within active window.
CREATE INDEX IF NOT EXISTS idx_ef_rate_limits_lookup
  ON edge_function_rate_limits(function_name, bucket_key, window_end DESC);

-- Cleanup index for purge cron : sweep rows where window has expired.
CREATE INDEX IF NOT EXISTS idx_ef_rate_limits_expired
  ON edge_function_rate_limits(window_end)
  WHERE window_end < now();

ALTER TABLE edge_function_rate_limits ENABLE ROW LEVEL SECURITY;

-- ADMIN+ can read to debug. Writes only via service_role from EFs.
CREATE POLICY "admin_read"
  ON edge_function_rate_limits FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'rbac.read'));

REVOKE INSERT, UPDATE, DELETE ON edge_function_rate_limits FROM authenticated;
REVOKE ALL ON edge_function_rate_limits FROM anon;

COMMENT ON TABLE edge_function_rate_limits IS
  'Durable rate-limit buckets for Edge Functions. Service-role writes only. '
  'Active row matched by (function_name, bucket_key) AND window_end > now().';
