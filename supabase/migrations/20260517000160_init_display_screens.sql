-- 20260517000160_init_display_screens.sql
-- Session 13 / Phase 4.C — D-4C-1.
--
-- Customer-display registry. Each row represents a physical display device
-- mounted in the shop (face-client second screen). The `code` column is the
-- pairing identifier the admin types into the device during onboarding ; it
-- maps 1:1 to `kiosk_id` used in `obtainKioskJwt(scope='display')` (see
-- `apps/pos/src/lib/kioskAuth.ts`).
--
-- The actual JWT signing key lives in `kiosk_jwt_signing_keys` (Phase 1.B,
-- migration 000032). DO NOT duplicate the secret per-screen — see D-4C-1.

CREATE TABLE display_screens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  location        TEXT,
  code            TEXT UNIQUE NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_display_screens_active
  ON display_screens(is_active)
  WHERE deleted_at IS NULL;

CREATE TRIGGER display_screens_set_updated_at
  BEFORE UPDATE ON display_screens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE display_screens ENABLE ROW LEVEL SECURITY;

-- RLS: any authenticated user (including kiosk scope) can read ; only
-- display.manage holders can mutate. Per D-4C-2 we do NOT touch
-- has_permission() — ADMIN/SUPER_ADMIN inherit via the unconditional
-- branch.

CREATE POLICY display_screens_select_authenticated
  ON display_screens
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY display_screens_insert_manage
  ON display_screens
  FOR INSERT
  TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'display.manage'));

CREATE POLICY display_screens_update_manage
  ON display_screens
  FOR UPDATE
  TO authenticated
  USING (has_permission(auth.uid(), 'display.manage'))
  WITH CHECK (has_permission(auth.uid(), 'display.manage'));

CREATE POLICY display_screens_delete_manage
  ON display_screens
  FOR DELETE
  TO authenticated
  USING (has_permission(auth.uid(), 'display.manage'));

-- Seeds : module-level perms (idempotent ON CONFLICT).
INSERT INTO permissions (code, module, action, description) VALUES
  ('display.manage', 'display', 'manage', 'Pair / revoke customer display devices'),
  ('display.read',   'display', 'read',   'List paired customer display devices')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE display_screens IS
  'Customer-display device registry (Session 13 / Phase 4.C). One row per physical face-client screen. `code` = kiosk_id consumed by kiosk-issue-jwt EF. JWT signing key lives in kiosk_jwt_signing_keys (do NOT duplicate per-screen).';
COMMENT ON COLUMN display_screens.code IS
  'Pairing code typed into the device on onboarding ; maps 1:1 to kiosk_id in obtainKioskJwt(scope=display).';
COMMENT ON COLUMN display_screens.last_seen_at IS
  'Updated by the display heartbeat (Phase 5.A LAN port). NULL until first heartbeat.';
