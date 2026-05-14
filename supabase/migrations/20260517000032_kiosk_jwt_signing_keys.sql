-- 20260517000032_kiosk_jwt_signing_keys.sql
-- Session 13 / Phase 1.B — D18 kiosk auth :
--   Track which JWT signing key is active for kiosk JWT issuance + rotation.
--
-- Per K8 (lead decision): rotation is MANUAL only. This table provides the
-- audit trail and the "active key" pointer that the kiosk-issue-jwt EF reads
-- to choose the secret env var to sign with. Rotation runbook is appended to
-- docs/workplan/refs/2026-05-13-kiosk-auth-design.md (K8 appendix).
--
-- Per design §3.1: we REUSE SUPABASE_JWT_SECRET (same HS256 secret as PIN flow).
-- This table only tracks the key_id label for audit + rotation cadence;
-- the actual secret is read from env (`Deno.env.get('JWT_SECRET')`) by the EF.
-- We never store the raw secret in the DB (the `secret` column would be a
-- security disaster vs. defence-in-depth — it stays in Supabase secrets).

CREATE TABLE IF NOT EXISTS kiosk_jwt_signing_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id      TEXT NOT NULL UNIQUE CHECK (length(key_id) BETWEEN 3 AND 64),
  scope       TEXT NOT NULL CHECK (scope IN ('kds', 'display', 'tablet', 'any')),
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  rotated_in_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_out_at TIMESTAMPTZ,
  created_by  UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  notes       TEXT,
  CONSTRAINT kiosk_jwt_signing_keys_rotation_sane
    CHECK (rotated_out_at IS NULL OR rotated_out_at >= rotated_in_at)
);

-- Only one active key per scope at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kiosk_jwt_signing_keys_active_scope
  ON kiosk_jwt_signing_keys(scope) WHERE is_active = TRUE;

ALTER TABLE kiosk_jwt_signing_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read"
  ON kiosk_jwt_signing_keys FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'rbac.read'));

REVOKE INSERT, UPDATE, DELETE ON kiosk_jwt_signing_keys FROM authenticated;
REVOKE ALL ON kiosk_jwt_signing_keys FROM anon;

-- Seed 1 key for staging/local : matches the SUPABASE_JWT_SECRET env var.
-- Manual rotation = INSERT a new row with `is_active=TRUE` (replaces existing via unique index)
-- + UPDATE previous row SET rotated_out_at = now(), is_active = FALSE.
INSERT INTO kiosk_jwt_signing_keys (key_id, scope, is_active, notes) VALUES
  ('kiosk-default-2026-05', 'any', TRUE,
   'Initial kiosk signing key (Session 13 Phase 1.B). Backed by SUPABASE_JWT_SECRET env var. Rotate per K8 runbook.')
ON CONFLICT (key_id) DO NOTHING;

COMMENT ON TABLE kiosk_jwt_signing_keys IS
  'Audit trail + active-key pointer for kiosk JWT signing. Manual rotation only (K8). '
  'Raw secrets stay in Supabase Vault / env (SUPABASE_JWT_SECRET) — never in this table.';
