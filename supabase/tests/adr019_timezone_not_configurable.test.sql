-- supabase/tests/adr019_timezone_not_configurable.test.sql
-- ADR-019 (D3), lot 1 « le verrou » — la famille d'écriture des réglages refuse
-- la clé timezone avec un motif explicite, sans rien casser d'autre : la colonne
-- miroir reste LISIBLE (D2) et les autres clés de la catégorie localization
-- restent écrivables.
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

-- T1: la clé est refusée avec le motif explicite, même par un porteur du droit.
DO $$ BEGIN
  PERFORM set_setting_v13('timezone', '"Asia/Jakarta"'::jsonb, 'localization');
  INSERT INTO _r VALUES ('t1_refused', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t1_refused', SQLERRM = 'setting_not_configurable');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_refused', false);
END $$;

-- T2: une valeur bien formée est refusée elle aussi — le refus porte sur la
-- CLÉ, pas sur la validité de la zone (il n'y a plus de valeur acceptable).
DO $$ DECLARE v_before TEXT; v_after TEXT; BEGIN
  SELECT timezone INTO v_before FROM business_config WHERE id = 1;
  BEGIN
    PERFORM set_setting_v13('timezone', to_jsonb(v_before), 'localization');
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  SELECT timezone INTO v_after FROM business_config WHERE id = 1;
  INSERT INTO _r VALUES ('t2_mirror_untouched', v_after IS NOT DISTINCT FROM v_before);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_mirror_untouched', false);
END $$;

-- T3: la colonne miroir reste LISIBLE via la catégorie localization (D2) —
-- le verrou ferme l'écriture, il ne retire pas la donnée.
DO $$ DECLARE v JSONB; BEGIN
  v := get_settings_by_category_v10('localization')->'settings';
  INSERT INTO _r VALUES ('t3_still_readable',
    (v->>'timezone') IS NOT NULL
    AND (v->>'timezone') = (SELECT timezone FROM business_config WHERE id = 1));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_still_readable', false);
END $$;

-- T4: non-régression du bump — l'autre clé de localization reste écrivable.
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v13('currency', '"SGD"'::jsonb, 'localization');
  v := get_settings_by_category_v10('localization')->'settings';
  INSERT INTO _r VALUES ('t4_currency_still_writable', (v->>'currency') = 'SGD');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_currency_still_writable', false);
END $$;

-- T5: le refus n'écrit pas d'entrée d'audit (on sort avant l'INSERT).
DO $$ DECLARE v_before BIGINT; v_after BIGINT; BEGIN
  SELECT count(*) INTO v_before FROM audit_logs
   WHERE action = 'setting.update' AND metadata->>'key' = 'timezone';
  BEGIN
    PERFORM set_setting_v13('timezone', '"UTC"'::jsonb, 'localization');
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  SELECT count(*) INTO v_after FROM audit_logs
   WHERE action = 'setting.update' AND metadata->>'key' = 'timezone';
  INSERT INTO _r VALUES ('t5_no_audit_on_refusal', v_after = v_before);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_no_audit_on_refusal', false);
END $$;

-- T6: versioning monotone — l'ancienne version est droppée, pas laissée vivante.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t6_v11_dropped',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'set_setting_v11'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_v11_dropped', false);
END $$;

-- T7: ACL — anon n'a pas EXECUTE sur la nouvelle version (defense-in-depth).
DO $$ BEGIN
  INSERT INTO _r VALUES ('t7_acl_anon',
    NOT has_function_privilege('anon', 'public.set_setting_v13(text,jsonb,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.set_setting_v13(text,jsonb,text)', 'EXECUTE'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_acl_anon', false);
END $$;

SELECT plan(7);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_refused'),                'T1: timezone refused with setting_not_configurable');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_mirror_untouched'),       'T2: refusal leaves the mirror column untouched');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_still_readable'),         'T3: mirror column still readable via localization (D2)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_currency_still_writable'),'T4: currency still writable after the bump');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_no_audit_on_refusal'),    'T5: a refused write logs no setting.update row');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_v11_dropped'),            'T6: set_setting_v11 dropped in the same migration');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_acl_anon'),               'T7: anon has no EXECUTE, authenticated does');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
