-- supabase/tests/payment_methods_config.test.sql
-- S64 — enabled_payment_methods (migration 20260710000115) : validation
-- set_setting_v8, lecture get_settings_by_category_v6('payments'), audit, ACLs.
-- Repointée 2026-07-23 (lot B ADR-006 déc. 9) : v1→v6/v4 + T12 e-wallets ;
-- lot C : v6→v7 / v4→v5 + T13/T14 payment_method_fees (frais informatifs).
-- Run via MCP execute_sql / API-from-file (BEGIN..ROLLBACK envelope carried by this file).
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
  PERFORM set_config('s64.admin', v_auth::text, true);
END $$;

-- T1: défaut post-_115 = les 6 méthodes canoniques, lisibles via la catégorie 'payments'.
DO $$ DECLARE v JSONB; BEGIN
  v := get_settings_by_category_v6('payments')->'settings'->'enabled_payment_methods';
  INSERT INTO _r VALUES ('t1_default',
    jsonb_typeof(v) = 'array'
    AND v @> '["cash","card","qris","edc","transfer","store_credit"]'::jsonb
    AND jsonb_array_length(v) = 6);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_default', false);
END $$;

-- T2: set d'un sous-ensemble valide -> relecture à l'identique.
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v8('enabled_payment_methods', '["cash","qris"]'::jsonb, 'payments');
  v := get_settings_by_category_v6('payments')->'settings'->'enabled_payment_methods';
  INSERT INTO _r VALUES ('t2_set_valid', v = '["cash","qris"]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_set_valid', false);
END $$;

-- T3: array vide rejeté (on ne peut pas tout désactiver).
DO $$ BEGIN
  PERFORM set_setting_v8('enabled_payment_methods', '[]'::jsonb, 'payments');
  INSERT INTO _r VALUES ('t3_empty', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t3_empty', SQLERRM = 'setting_value_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_empty', false);
END $$;

-- T4: méthode inconnue rejetée.
DO $$ BEGIN
  PERFORM set_setting_v8('enabled_payment_methods', '["cash","bitcoin"]'::jsonb, 'payments');
  INSERT INTO _r VALUES ('t4_unknown', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t4_unknown', SQLERRM = 'setting_value_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_unknown', false);
END $$;

-- T5: non-array rejeté (setting_type_invalid).
DO $$ BEGIN
  PERFORM set_setting_v8('enabled_payment_methods', '"cash"'::jsonb, 'payments');
  INSERT INTO _r VALUES ('t5_nonarray', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t5_nonarray', SQLERRM = 'setting_type_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_nonarray', false);
END $$;

-- T6: doublon rejeté.
DO $$ BEGIN
  PERFORM set_setting_v8('enabled_payment_methods', '["cash","cash"]'::jsonb, 'payments');
  INSERT INTO _r VALUES ('t6_duplicate', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t6_duplicate', SQLERRM = 'setting_value_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_duplicate', false);
END $$;

-- T7: élément non-string rejeté.
DO $$ BEGIN
  PERFORM set_setting_v8('enabled_payment_methods', '[1]'::jsonb, 'payments');
  INSERT INTO _r VALUES ('t7_nonstring', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t7_nonstring', SQLERRM = 'setting_value_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_nonstring', false);
END $$;

-- T8: le set T2 a écrit une ligne audit_logs avec key + old/new.
DO $$ DECLARE v_md JSONB; BEGIN
  SELECT metadata INTO v_md
    FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'enabled_payment_methods'
   ORDER BY created_at DESC
   LIMIT 1;
  INSERT INTO _r VALUES ('t8_audit',
    v_md IS NOT NULL
    AND v_md->'new' = '["cash","qris"]'::jsonb
    AND jsonb_typeof(v_md->'old') = 'array'
    AND v_md->>'category' = 'payments');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t8_audit', false);
END $$;

-- T9: sans settings.update (sub = UUID inconnu, has_permission=false) -> 42501.
DO $$ DECLARE v_rand UUID := gen_random_uuid(); BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_rand::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rand)::text, true);
  BEGIN
    PERFORM set_setting_v8('enabled_payment_methods', '["cash"]'::jsonb, 'payments');
    INSERT INTO _r VALUES ('t9_perm', false);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    INSERT INTO _r VALUES ('t9_perm', SQLERRM = 'permission_denied');
  WHEN OTHERS THEN
    INSERT INTO _r VALUES ('t9_perm', false);
  END;
  -- restaure l'admin pour la suite
  PERFORM set_config('request.jwt.claim.sub', current_setting('s64.admin'), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('s64.admin')::uuid)::text, true);
END $$;

-- T10: ACL — anon n'a pas EXECUTE sur les 2 RPCs settings (S20).
DO $$ BEGIN
  INSERT INTO _r VALUES ('t10_acl_anon',
    NOT has_function_privilege('anon', 'public.set_setting_v8(text,jsonb,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.get_settings_by_category_v6(text)', 'EXECUTE'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t10_acl_anon', false);
END $$;

-- T12 (lot B, ADR-006 déc. 9): les e-wallets gopay/ovo/dana passent
-- l'allowlist v6 et se relisent à l'identique (ordre compris).
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v8('enabled_payment_methods', '["cash","gopay","ovo","dana"]'::jsonb, 'payments');
  v := get_settings_by_category_v6('payments')->'settings'->'enabled_payment_methods';
  INSERT INTO _r VALUES ('t12_ewallets', v = '["cash","gopay","ovo","dana"]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t12_ewallets', false);
END $$;

-- T13 (lot C, ADR-006 déc. 9): payment_method_fees — objet {méthode: %} accepté,
-- relu via la catégorie payments.
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v8('payment_method_fees', '{"qris": 0.7, "gopay": 2}'::jsonb, 'payments');
  v := get_settings_by_category_v6('payments')->'settings'->'payment_method_fees';
  INSERT INTO _r VALUES ('t13_fees', v = '{"qris": 0.7, "gopay": 2}'::jsonb);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t13_fees', false);
END $$;

-- T14 (lot C): rejets — clé inconnue, valeur non numérique, hors [0,100].
DO $$ DECLARE v_ok BOOLEAN := true; BEGIN
  BEGIN
    PERFORM set_setting_v8('payment_method_fees', '{"bitcoin": 1}'::jsonb, 'payments');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM set_setting_v8('payment_method_fees', '{"qris": "0.7"}'::jsonb, 'payments');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM set_setting_v8('payment_method_fees', '{"qris": 101}'::jsonb, 'payments');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  INSERT INTO _r VALUES ('t14_fees_invalid', v_ok);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t14_fees_invalid', false);
END $$;

-- T11: CHECK table — un UPDATE direct à [] échoue même en bypass RPC (23514).
DO $$ BEGIN
  UPDATE business_config SET enabled_payment_methods = '[]'::jsonb WHERE id = 1;
  INSERT INTO _r VALUES ('t11_check', false);
EXCEPTION WHEN SQLSTATE '23514' THEN
  INSERT INTO _r VALUES ('t11_check', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t11_check', false);
END $$;

SELECT plan(14);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_default'),   'T1: default = the 6 canonical methods via category payments');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_set_valid'), 'T2: valid subset persists and reads back identically');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_empty'),     'T3: empty array rejected (setting_value_invalid)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_unknown'),   'T4: unknown method rejected (setting_value_invalid)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_nonarray'),  'T5: non-array rejected (setting_type_invalid)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_duplicate'), 'T6: duplicate method rejected (setting_value_invalid)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_nonstring'), 'T7: non-string element rejected (setting_value_invalid)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t8_audit'),     'T8: set writes audit_logs setting.update with key/old/new');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t9_perm'),      'T9: without settings.update -> 42501 permission_denied');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t10_acl_anon'), 'T10: anon has no EXECUTE on the settings RPCs (S20)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t11_check'),    'T11: table CHECK blocks direct UPDATE to empty array (23514)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t12_ewallets'), 'T12: gopay/ovo/dana accepted by the v7 allowlist and read back in order');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t13_fees'),     'T13: payment_method_fees accepted and read back via category payments (lot C)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t14_fees_invalid'), 'T14: payment_method_fees rejects unknown key, non-number, out-of-range (22023)');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
