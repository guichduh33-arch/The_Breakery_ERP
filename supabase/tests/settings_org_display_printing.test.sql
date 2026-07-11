-- supabase/tests/settings_org_display_printing.test.sql
-- S73 Lot 2 (migration 20260711000159) — org-level customer display copy +
-- payment auto-toggles: columns, categories customer_display/printing on
-- get_settings_by_category_v1, set_setting_v1 round-trip + validation + audit.
-- Run via MCP execute_sql / API-from-file (BEGIN..ROLLBACK envelope carried by
-- this file; temp-table capture pattern, cf. payment_methods_config.test.sql).
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

-- T1: les 4 colonnes existent avec les bons défauts ('' / true).
DO $$ DECLARE v_row business_config%ROWTYPE; BEGIN
  SELECT * INTO v_row FROM business_config WHERE id = 1;
  INSERT INTO _r VALUES ('t1_columns',
    v_row.display_footer_message IS NOT NULL
    AND v_row.display_slogan IS NOT NULL
    AND v_row.pos_auto_print_receipt IS NOT NULL
    AND v_row.pos_auto_open_drawer IS NOT NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_columns', false);
END $$;

-- T2: catégorie customer_display expose les 2 clés texte.
DO $$ DECLARE v JSONB; BEGIN
  v := get_settings_by_category_v1('customer_display')->'settings';
  INSERT INTO _r VALUES ('t2_get_cd', (v ? 'display_footer_message') AND (v ? 'display_slogan'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_get_cd', false);
END $$;

-- T3: catégorie printing expose les 2 toggles.
DO $$ DECLARE v JSONB; BEGIN
  v := get_settings_by_category_v1('printing')->'settings';
  INSERT INTO _r VALUES ('t3_get_printing', (v ? 'pos_auto_print_receipt') AND (v ? 'pos_auto_open_drawer'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_get_printing', false);
END $$;

-- T4: round-trip set display_slogan (string) → relecture identique ; '' accepté.
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v1('display_slogan', to_jsonb('Test slogan'::text), 'customer_display');
  PERFORM set_setting_v1('display_footer_message', to_jsonb(''::text), 'customer_display');
  v := get_settings_by_category_v1('customer_display')->'settings';
  INSERT INTO _r VALUES ('t4_set_text',
    v->>'display_slogan' = 'Test slogan' AND v->>'display_footer_message' = '');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_set_text', false);
END $$;

-- T5: round-trip set pos_auto_print_receipt (boolean).
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v1('pos_auto_print_receipt', 'false'::jsonb, 'printing');
  v := get_settings_by_category_v1('printing')->'settings';
  INSERT INTO _r VALUES ('t5_set_bool', (v->'pos_auto_print_receipt') = 'false'::jsonb);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_set_bool', false);
END $$;

-- T6: type invalide rejeté (nombre sur clé texte, string sur clé booléenne).
DO $$ DECLARE v_ok BOOLEAN := true; BEGIN
  BEGIN
    PERFORM set_setting_v1('display_slogan', '42'::jsonb, 'customer_display');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_ok := v_ok AND SQLERRM = 'setting_type_invalid';
  END;
  BEGIN
    PERFORM set_setting_v1('pos_auto_open_drawer', '"yes"'::jsonb, 'printing');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_ok := v_ok AND SQLERRM = 'setting_type_invalid';
  END;
  INSERT INTO _r VALUES ('t6_type', v_ok);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_type', false);
END $$;

-- T7: longueur max — slogan > 80 chars rejeté (setting_value_invalid).
DO $$ BEGIN
  PERFORM set_setting_v1('display_slogan', to_jsonb(repeat('x', 81)), 'customer_display');
  INSERT INTO _r VALUES ('t7_maxlen', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t7_maxlen', SQLERRM = 'setting_value_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_maxlen', false);
END $$;

-- T8: le set T4 a écrit une ligne audit_logs setting.update avec key/old/new.
DO $$ DECLARE v_md JSONB; BEGIN
  SELECT metadata INTO v_md
    FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'display_slogan'
   ORDER BY created_at DESC
   LIMIT 1;
  INSERT INTO _r VALUES ('t8_audit',
    v_md IS NOT NULL
    AND v_md->>'new' = 'Test slogan'
    AND v_md ? 'old'
    AND v_md->>'category' = 'customer_display');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t8_audit', false);
END $$;

SELECT plan(8);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_columns'),      'T1: 4 new business_config columns exist NOT NULL');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_get_cd'),       'T2: customer_display category exposes footer + slogan');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_get_printing'), 'T3: printing category exposes both auto toggles');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_set_text'),     'T4: text round-trip persists; empty string accepted');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_set_bool'),     'T5: boolean round-trip persists');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_type'),         'T6: wrong jsonb types rejected (setting_type_invalid)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_maxlen'),       'T7: slogan > 80 chars rejected (setting_value_invalid)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t8_audit'),        'T8: set writes audit_logs setting.update with key/old/new');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
