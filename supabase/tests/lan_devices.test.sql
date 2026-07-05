-- supabase/tests/lan_devices.test.sql
-- Session 13 / Phase 5.A — pgTAP suite for lan_devices.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(13);

-- ---------------------------------------------------------------------------
-- T_LD_01 : table + columns exist
-- ---------------------------------------------------------------------------
SELECT has_table('lan_devices', 'T_LD_01a lan_devices table exists');
SELECT has_column('lan_devices', 'id',                'T_LD_01b id');
SELECT has_column('lan_devices', 'code',              'T_LD_01c code');
SELECT has_column('lan_devices', 'device_type',       'T_LD_01d device_type');
SELECT has_column('lan_devices', 'last_heartbeat_at', 'T_LD_01e last_heartbeat_at');
SELECT has_column('lan_devices', 'capabilities',      'T_LD_01f capabilities');

-- ---------------------------------------------------------------------------
-- T_LD_02 : device_type CHECK covers all five values
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'lan_devices'
      AND pg_get_constraintdef(con.oid) LIKE '%printer%'
      AND pg_get_constraintdef(con.oid) LIKE '%kiosk_display%'
      AND pg_get_constraintdef(con.oid) LIKE '%kds%'
      AND pg_get_constraintdef(con.oid) LIKE '%tablet%'
      AND pg_get_constraintdef(con.oid) LIKE '%pos%'
  ),
  'T_LD_02 device_type CHECK covers printer/kiosk_display/kds/tablet/pos'
);

-- ---------------------------------------------------------------------------
-- T_LD_03 : code is UNIQUE
-- ---------------------------------------------------------------------------
SELECT col_is_unique('lan_devices', 'code', 'T_LD_03 code is UNIQUE');

-- ---------------------------------------------------------------------------
-- T_LD_04 : update_lan_heartbeat_v1 exists with correct signature
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'update_lan_heartbeat_v1',
                    ARRAY['text'],
                    'T_LD_04 update_lan_heartbeat_v1(text) exists');

-- ---------------------------------------------------------------------------
-- T_LD_05 : heartbeat touches last_heartbeat_at
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id          UUID;
  v_before      TIMESTAMPTZ;
  v_after       TIMESTAMPTZ;
  v_row         lan_devices%ROWTYPE;
BEGIN
  INSERT INTO lan_devices (code, name, device_type, is_active, last_heartbeat_at)
  VALUES ('TEST-LAN-01', 'pgTAP fixture', 'pos', TRUE, NOW() - INTERVAL '1 hour')
  RETURNING id, last_heartbeat_at INTO v_id, v_before;

  v_row := update_lan_heartbeat_v1('TEST-LAN-01');
  v_after := v_row.last_heartbeat_at;

  IF v_after IS NULL OR v_after <= v_before THEN
    RAISE EXCEPTION 'expected heartbeat to bump last_heartbeat_at from % to a recent time, got %', v_before, v_after;
  END IF;
END $$;

SELECT ok(true, 'T_LD_05 update_lan_heartbeat_v1 bumps last_heartbeat_at');

-- ---------------------------------------------------------------------------
-- T_LD_06 : permissions seeded
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS(SELECT 1 FROM permissions WHERE code = 'lan.devices.read'),
  'T_LD_06a lan.devices.read seeded'
);
SELECT ok(
  EXISTS(SELECT 1 FROM permissions WHERE code = 'lan.devices.manage'),
  'T_LD_06b lan.devices.manage seeded'
);

-- ---------------------------------------------------------------------------
-- T_LD_08 : RLS policy on UPDATE gates on has_permission(lan.devices.manage)
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policy
     WHERE polname = 'lan_devices_update_manage'
       AND pg_get_expr(polqual, polrelid)
           LIKE '%lan.devices.manage%'
  ),
  'T_LD_08 lan_devices_update_manage policy references lan.devices.manage'
);

SELECT * FROM finish();

ROLLBACK;
