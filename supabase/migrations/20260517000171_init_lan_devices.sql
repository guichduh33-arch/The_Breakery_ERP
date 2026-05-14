-- 20260517000171_init_lan_devices.sql
-- Session 13 / Phase 5.A — LAN port : device registry.
--
-- Records every physical device participating in the LAN mesh : POS
-- terminals, KDS screens, customer displays, tablets, network printers.
-- Used by :
--   - `lanHub` to look up routing targets (e.g., print.request → printer device).
--   - `useLanHeartbeat` to update `last_heartbeat_at` every 10 s.
--   - BO `LanDevicesPage` for operator CRUD.
--
-- The `code` column is the human-readable device identifier (e.g.
-- "POS-FRONT-01") — also the kiosk pairing identifier when device_type
-- = 'kiosk_display' (it then maps 1:1 to display_screens.code).

CREATE TABLE lan_devices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT UNIQUE NOT NULL,
  name               TEXT NOT NULL,
  device_type        TEXT NOT NULL
    CHECK (device_type IN ('printer', 'kiosk_display', 'kds', 'tablet', 'pos')),
  ip_address         INET,
  port               INT,
  location           TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_heartbeat_at  TIMESTAMPTZ,
  capabilities       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX idx_lan_devices_active
  ON lan_devices (is_active, device_type)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_lan_devices_heartbeat
  ON lan_devices (last_heartbeat_at DESC)
  WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE TRIGGER lan_devices_set_updated_at
  BEFORE UPDATE ON lan_devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE lan_devices IS
  'Phase 5.A — LAN mesh device registry. One row per physical device. last_heartbeat_at is touched by useLanHeartbeat every 10 s.';
COMMENT ON COLUMN lan_devices.code IS
  'Human-readable device identifier (e.g. "POS-FRONT-01"). For kiosk_display rows this matches display_screens.code.';
COMMENT ON COLUMN lan_devices.capabilities IS
  'Free-form capability blob — e.g. {"print_widths":[58,80], "kitchen_chit":true} for a printer.';

-- ===========================================================================
-- RLS
-- ===========================================================================

ALTER TABLE lan_devices ENABLE ROW LEVEL SECURITY;

-- SELECT : authenticated reads are unrestricted (the LAN mesh needs every
-- POS / KDS / tablet to enumerate peers).
CREATE POLICY lan_devices_select_authenticated
  ON lan_devices
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT / UPDATE / DELETE : gated on the dedicated `lan.devices.manage`
-- permission. ADMIN / SUPER_ADMIN inherit via has_permission's unconditional
-- branch (per CLAUDE.md rule #3 — we do NOT re-CREATE has_permission).
CREATE POLICY lan_devices_insert_manage
  ON lan_devices
  FOR INSERT
  TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'lan.devices.manage'));

CREATE POLICY lan_devices_update_manage
  ON lan_devices
  FOR UPDATE
  TO authenticated
  USING (has_permission(auth.uid(), 'lan.devices.manage'))
  WITH CHECK (has_permission(auth.uid(), 'lan.devices.manage'));

CREATE POLICY lan_devices_delete_manage
  ON lan_devices
  FOR DELETE
  TO authenticated
  USING (has_permission(auth.uid(), 'lan.devices.manage'));

-- One exception : every authenticated session may touch `last_heartbeat_at`
-- on its OWN device row (otherwise heartbeats would require an Edge
-- Function). The dedicated SECURITY DEFINER RPC `update_lan_heartbeat_v1`
-- handles that path. The UPDATE policy above stays strict for everything
-- else.

-- ===========================================================================
-- Heartbeat RPC
-- ===========================================================================

CREATE OR REPLACE FUNCTION update_lan_heartbeat_v1(
  p_device_code TEXT
) RETURNS lan_devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row lan_devices%ROWTYPE;
BEGIN
  UPDATE lan_devices
     SET last_heartbeat_at = NOW(),
         is_active = TRUE
   WHERE code = p_device_code
     AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'lan_devices row with code % not found', p_device_code
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION update_lan_heartbeat_v1 TO authenticated;

COMMENT ON FUNCTION update_lan_heartbeat_v1 IS
  'Touch last_heartbeat_at for a device. Called by useLanHeartbeat every 10 s. Idempotent.';

-- ===========================================================================
-- Permissions (perm rows only — no has_permission() touch)
-- ===========================================================================

INSERT INTO permissions (code, module, action, description) VALUES
  ('lan.devices.read',   'lan', 'read',   'View LAN devices'),
  ('lan.devices.manage', 'lan', 'manage', 'Register / update / remove LAN devices')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('SUPER_ADMIN', 'lan.devices.read',   TRUE),
  ('ADMIN',       'lan.devices.read',   TRUE),
  ('MANAGER',     'lan.devices.read',   TRUE),
  ('SUPER_ADMIN', 'lan.devices.manage', TRUE),
  ('ADMIN',       'lan.devices.manage', TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- ===========================================================================
-- FK from print_queue.device_id → lan_devices.id (now that lan_devices exists)
-- ===========================================================================

ALTER TABLE print_queue
  ADD CONSTRAINT print_queue_device_id_fkey
  FOREIGN KEY (device_id) REFERENCES lan_devices(id) ON DELETE SET NULL;
