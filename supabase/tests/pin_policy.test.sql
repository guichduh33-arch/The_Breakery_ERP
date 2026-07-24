-- supabase/tests/pin_policy.test.sql
-- ADR-006 déc. 9 — PIN policy (migration _220) : set_setting_v9 clés
-- pin_max_failed [3,10] / pin_lockout_minutes [5,120], readback catégorie
-- security via get_settings_by_category_v7, CHECKs table, audit, ACL.
-- (Le comportement de l'EF auth-verify-pin n'est pas testable en pgTAP.)
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- ── Seed : impersonation d'un utilisateur réel porteur de settings.update ────
DO $$
DECLARE
  v_auth UUID;
BEGIN
  SELECT up.auth_user_id INTO v_auth
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'settings.update')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
END $$;

-- T1: défauts post-_220 lisibles via la catégorie security (5 / 15).
DO $$ DECLARE v JSONB; BEGIN
  v := get_settings_by_category_v7('security')->'settings';
  INSERT INTO _r VALUES ('t1_defaults',
    (v->>'pin_max_failed')::int = 5 AND (v->>'pin_lockout_minutes')::int = 15);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_defaults', false);
END $$;

-- T2: set des deux clés -> readback.
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v9('pin_max_failed', '3'::jsonb, 'security');
  PERFORM set_setting_v9('pin_lockout_minutes', '30'::jsonb, 'security');
  v := get_settings_by_category_v7('security')->'settings';
  INSERT INTO _r VALUES ('t2_set_readback',
    (v->>'pin_max_failed')::int = 3 AND (v->>'pin_lockout_minutes')::int = 30);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_set_readback', false);
END $$;

-- T3: type non numérique rejeté (setting_type_invalid).
DO $$ BEGIN
  PERFORM set_setting_v9('pin_max_failed', '"5"'::jsonb, 'security');
  INSERT INTO _r VALUES ('t3_nonnumber', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t3_nonnumber', SQLERRM = 'setting_type_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_nonnumber', false);
END $$;

-- T4: bornes + entier strict rejetés (setting_value_invalid).
DO $$ DECLARE v_ok BOOLEAN := true; BEGIN
  BEGIN
    PERFORM set_setting_v9('pin_max_failed', '2'::jsonb, 'security');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM set_setting_v9('pin_max_failed', '11'::jsonb, 'security');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM set_setting_v9('pin_max_failed', '5.5'::jsonb, 'security');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM set_setting_v9('pin_lockout_minutes', '121'::jsonb, 'security');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM set_setting_v9('pin_lockout_minutes', '4'::jsonb, 'security');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  INSERT INTO _r VALUES ('t4_bounds', v_ok);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_bounds', false);
END $$;

-- T5: le set T2 a écrit une ligne audit_logs setting.update avec old/new.
DO $$ DECLARE v_md JSONB; BEGIN
  SELECT metadata INTO v_md
    FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'pin_lockout_minutes'
   ORDER BY created_at DESC
   LIMIT 1;
  INSERT INTO _r VALUES ('t5_audit',
    v_md IS NOT NULL
    AND (v_md->>'new')::int = 30
    AND v_md->>'category' = 'security');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_audit', false);
END $$;

-- T6: CHECK table — un UPDATE direct hors bornes échoue même en bypass RPC.
DO $$ BEGIN
  UPDATE business_config SET pin_max_failed = 99 WHERE id = 1;
  INSERT INTO _r VALUES ('t6_check', false);
EXCEPTION WHEN SQLSTATE '23514' THEN
  INSERT INTO _r VALUES ('t6_check', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_check', false);
END $$;

-- T7: ACL — anon n'a EXECUTE sur aucune des 2 fonctions bumpées.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t7_acl_anon',
    NOT has_function_privilege('anon', 'public.set_setting_v9(text,jsonb,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.get_settings_by_category_v7(text)', 'EXECUTE'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_acl_anon', false);
END $$;

SELECT plan(7);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_defaults'),     'T1: defaults 5/15 readable via category security');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_set_readback'), 'T2: both keys persist and read back');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_nonnumber'),    'T3: non-number rejected (setting_type_invalid)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_bounds'),       'T4: out-of-range and non-integer rejected (22023)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_audit'),        'T5: set writes audit_logs setting.update old/new');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_check'),        'T6: table CHECK blocks direct out-of-range UPDATE (23514)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_acl_anon'),     'T7: anon has no EXECUTE on the bumped settings RPCs');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
