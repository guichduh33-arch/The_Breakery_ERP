-- supabase/tests/settings_business_identity.test.sql
-- Settings §6.A (migration 20260716000168) — company identity keys
-- npwp/phone/logo_url/alert_email : columns, business category on
-- get_settings_by_category_v2, set_setting_v2 round-trip + validation + audit,
-- v1 RPCs dropped, branding bucket + policies.
-- Run via MCP execute_sql / API-from-file (BEGIN..ROLLBACK envelope carried by
-- this file; temp-table capture pattern, cf. settings_org_display_printing.test.sql).
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
     AND has_permission(up.auth_user_id, 'settings.read')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
END $$;

-- T1: les 4 nouvelles colonnes existent (nullables).
DO $$ BEGIN
  INSERT INTO _r VALUES ('t1_columns',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'business_config'
        AND column_name IN ('npwp','phone','logo_url','alert_email')
        AND is_nullable = 'YES') = 4);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_columns', false);
END $$;

-- T2: la catégorie business expose les 6 clés.
DO $$ DECLARE v JSONB; BEGIN
  v := get_settings_by_category_v2('business')->'settings';
  INSERT INTO _r VALUES ('t2_get_business',
    (v ? 'name') AND (v ? 'fiscal_address') AND (v ? 'npwp')
    AND (v ? 'phone') AND (v ? 'logo_url') AND (v ? 'alert_email'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_get_business', false);
END $$;

-- T3: round-trip npwp + phone ; trim appliqué ; '' normalisé en NULL.
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v2('npwp', to_jsonb('  01.234.567.8-901.000  '::text), 'business');
  PERFORM set_setting_v2('phone', to_jsonb('+62-370-000000'::text), 'business');
  v := get_settings_by_category_v2('business')->'settings';
  IF NOT (v->>'npwp' = '01.234.567.8-901.000' AND v->>'phone' = '+62-370-000000') THEN
    INSERT INTO _r VALUES ('t3_roundtrip', false);
  ELSE
    PERFORM set_setting_v2('phone', to_jsonb('   '::text), 'business');
    v := get_settings_by_category_v2('business')->'settings';
    INSERT INTO _r VALUES ('t3_roundtrip', (v->'phone') = 'null'::jsonb);
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_roundtrip', false);
END $$;

-- T4: logo_url — https accepté, http rejeté (setting_value_invalid).
DO $$ DECLARE v JSONB; v_ok BOOLEAN := true; BEGIN
  PERFORM set_setting_v2('logo_url', to_jsonb('https://example.supabase.co/storage/v1/object/public/branding/logo.png'::text), 'business');
  v := get_settings_by_category_v2('business')->'settings';
  v_ok := v->>'logo_url' LIKE 'https://%';
  BEGIN
    PERFORM set_setting_v2('logo_url', to_jsonb('http://insecure.example/logo.png'::text), 'business');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_ok := v_ok AND SQLERRM = 'setting_value_invalid';
  END;
  INSERT INTO _r VALUES ('t4_logo_url', v_ok);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_logo_url', false);
END $$;

-- T5: alert_email — adresse valide acceptée, format invalide rejeté.
DO $$ DECLARE v JSONB; v_ok BOOLEAN := true; BEGIN
  PERFORM set_setting_v2('alert_email', to_jsonb('alerts@thebreakery.id'::text), 'business');
  v := get_settings_by_category_v2('business')->'settings';
  v_ok := v->>'alert_email' = 'alerts@thebreakery.id';
  BEGIN
    PERFORM set_setting_v2('alert_email', to_jsonb('not-an-email'::text), 'business');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_ok := v_ok AND SQLERRM = 'setting_value_invalid';
  END;
  INSERT INTO _r VALUES ('t5_alert_email', v_ok);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_alert_email', false);
END $$;

-- T6: type invalide rejeté (nombre sur npwp) + longueur max (npwp > 30).
DO $$ DECLARE v_ok BOOLEAN := true; BEGIN
  BEGIN
    PERFORM set_setting_v2('npwp', '42'::jsonb, 'business');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_ok := v_ok AND SQLERRM = 'setting_type_invalid';
  END;
  BEGIN
    PERFORM set_setting_v2('npwp', to_jsonb(repeat('9', 31)), 'business');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_ok := v_ok AND SQLERRM = 'setting_value_invalid';
  END;
  INSERT INTO _r VALUES ('t6_validation', v_ok);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_validation', false);
END $$;

-- T7: null explicite efface la valeur.
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v2('npwp', 'null'::jsonb, 'business');
  v := get_settings_by_category_v2('business')->'settings';
  INSERT INTO _r VALUES ('t7_null_clears', (v->'npwp') = 'null'::jsonb);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_null_clears', false);
END $$;

-- T8: le set alert_email a écrit une ligne audit_logs setting.update.
DO $$ DECLARE v_md JSONB; BEGIN
  SELECT metadata INTO v_md
    FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'alert_email'
   ORDER BY created_at DESC
   LIMIT 1;
  INSERT INTO _r VALUES ('t8_audit',
    v_md IS NOT NULL
    AND v_md->>'new' = 'alerts@thebreakery.id'
    AND v_md ? 'old'
    AND v_md->>'category' = 'business');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t8_audit', false);
END $$;

-- T9: les v1 sont droppées, les v2 existent avec ACL sans anon/PUBLIC.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t9_versioning',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('get_settings_by_category_v1','set_setting_v1')) = 0
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('get_settings_by_category_v2','set_setting_v2')
        AND p.proacl::text NOT LIKE '%anon%'
        AND p.proacl::text NOT LIKE '{=X%') = 2);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t9_versioning', false);
END $$;

-- T10: bucket branding public (PNG/JPEG, 1 Mo) + 4 policies branding_*.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t10_bucket',
    (SELECT count(*) FROM storage.buckets
      WHERE id = 'branding' AND public
        AND file_size_limit = 1048576
        AND allowed_mime_types @> ARRAY['image/png','image/jpeg']) = 1
    AND (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname IN ('branding_select','branding_insert','branding_update','branding_delete')) = 4);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t10_bucket', false);
END $$;

SELECT plan(10);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_columns'),      'T1: npwp/phone/logo_url/alert_email columns exist nullable');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_get_business'), 'T2: business category exposes the 6 identity keys');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_roundtrip'),    'T3: npwp/phone round-trip trims; blank normalizes to NULL');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_logo_url'),     'T4: logo_url requires https://');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_alert_email'),  'T5: alert_email validates format');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_validation'),   'T6: wrong type + overlength rejected');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_null_clears'),  'T7: explicit null clears the value');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t8_audit'),        'T8: set writes audit_logs setting.update with key/old/new');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t9_versioning'),   'T9: v1 dropped; v2 ACL excludes anon/PUBLIC');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t10_bucket'),      'T10: branding bucket public + 4 scoped policies');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
