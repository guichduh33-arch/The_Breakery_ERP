-- supabase/tests/lan_devices_rls.test.sql
-- 2026-07-06 (spec print-bridge D8) — ancre le design "CRUD BO = writes directs
-- sous RLS lan.devices.manage" (policies S13, migration 20260517000171).
-- Runner : MCP execute_sql, enveloppe BEGIN..ROLLBACK portée par ce fichier.
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;
-- Les sections sous SET LOCAL ROLE authenticated doivent pouvoir enregistrer
-- leurs résultats dans la temp table créée en postgres (DEV-S65 : absent du plan,
-- la 1re exécution échouait en 42501 sur _r).
GRANT SELECT, INSERT ON _r TO authenticated;

-- Fixture (en tant que postgres, bypass RLS) : un device témoin.
DO $$
DECLARE v_code TEXT := 'TEST-RLS-' || substr(gen_random_uuid()::text, 1, 8);
BEGIN
  INSERT INTO lan_devices (code, name, device_type, ip_address, port, capabilities)
  VALUES (v_code, 'RLS fixture printer', 'printer', '192.168.1.250', 9100, '{"station":"kitchen"}'::jsonb);
  PERFORM set_config('breakery.lanrls_code', v_code, true);
END $$;

-- ── En tant que CASHIER (pas lan.devices.manage) ────────────────────────────
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
END $$;
SET LOCAL ROLE authenticated;

-- T1 : INSERT refusé (WITH CHECK → 42501).
DO $$ BEGIN
  INSERT INTO lan_devices (code, name, device_type) VALUES ('TEST-RLS-DENY', 'x', 'pos');
  INSERT INTO _r VALUES ('t1_insert_denied', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _r VALUES ('t1_insert_denied', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_insert_denied', false);
END $$;

-- T2 : UPDATE silencieusement filtré (USING → 0 ligne touchée).
DO $$
DECLARE n INT;
BEGIN
  UPDATE lan_devices SET name = 'hacked'
   WHERE code = current_setting('breakery.lanrls_code');
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _r VALUES ('t2_update_filtered', n = 0);
EXCEPTION WHEN OTHERS THEN
  -- un 42501 (pas de GRANT UPDATE colonne) vaut aussi refus
  INSERT INTO _r VALUES ('t2_update_filtered', SQLSTATE = '42501');
END $$;

-- T3 : SELECT visible pour CASHIER (S66, dette D-9 : lan.devices.read est
-- désormais seedée aux rôles POS par la migration _117 — le chemin
-- useStationPrinters du POS doit voir les imprimantes ; avant S66 la policy
-- has_permission(auth.uid(), 'lan.devices.read') renvoyait 0 ligne en silence).
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM lan_devices WHERE code = current_setting('breakery.lanrls_code');
  INSERT INTO _r VALUES ('t3_cashier_select_visible', n = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_cashier_select_visible', false);
END $$;

RESET ROLE;

-- ── En tant que SUPER_ADMIN (a lan.devices.manage) ──────────────────────────
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
END $$;
SET LOCAL ROLE authenticated;

-- T4 : INSERT autorisé.
DO $$ BEGIN
  INSERT INTO lan_devices (code, name, device_type, ip_address, port, capabilities)
  VALUES ('TEST-RLS-ADMIN-' || substr(gen_random_uuid()::text, 1, 8),
          'Admin insert', 'printer', '192.168.1.251', 9100, '{"station":"barista"}'::jsonb);
  INSERT INTO _r VALUES ('t4_admin_insert', true);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_admin_insert', false);
END $$;

-- T4b : SELECT visible avec lan.devices.read (SUPER_ADMIN voit la fixture).
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM lan_devices WHERE code = current_setting('breakery.lanrls_code');
  INSERT INTO _r VALUES ('t4b_admin_select', n = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4b_admin_select', false);
END $$;

-- T5 : UPDATE (soft-delete) autorisé et effectif.
DO $$
DECLARE n INT;
BEGIN
  UPDATE lan_devices SET deleted_at = now()
   WHERE code = current_setting('breakery.lanrls_code');
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _r VALUES ('t5_admin_softdelete', n = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_admin_softdelete', false);
END $$;

RESET ROLE;

-- T6 : update_lan_heartbeat_v2 — un code soft-deleted est IGNORÉ (le fixture
-- vient d'être soft-deleted en T5 : le batch ne doit plus le toucher — spec
-- 006x lot 2, plus de P0002 : un code mort ne fait pas échouer le batch).
DO $$ BEGIN
  INSERT INTO _r
  SELECT 't6_heartbeat_deleted_ignored',
         NOT EXISTS (
           SELECT 1 FROM update_lan_heartbeat_v2(
             ARRAY[current_setting('breakery.lanrls_code')])
         );
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_heartbeat_deleted_ignored', false);
END $$;

SELECT format('lan_devices_rls: %s/%s pass', count(*) FILTER (WHERE pass), count(*)) AS result,
       COALESCE(array_agg(name) FILTER (WHERE NOT pass), '{}') AS failures
  FROM _r;

ROLLBACK;
