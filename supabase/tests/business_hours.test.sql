-- supabase/tests/business_hours.test.sql
-- ADR-006 déc. 9 — business hours (migrations _217-_219) :
--   set_setting_v9 'business_hours' (validation forme + bornes),
--   get_settings_by_category_v7('business') (readback),
--   get_off_hours_sales_v1 (paiements hors créneau, jour fermé, jour absent).
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
     AND has_permission(up.auth_user_id, 'reports.audit.read')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  PERFORM set_config('bh.admin', v_auth::text, true);
END $$;

-- T1: set valide (mon ouvert, tue fermé, autres jours absents) -> readback.
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_setting_v9('business_hours',
    '{"mon": {"open": "07:00", "close": "22:00"}, "tue": null}'::jsonb, 'business');
  v := get_settings_by_category_v7('business')->'settings'->'business_hours';
  INSERT INTO _r VALUES ('t1_set_readback',
    v = '{"mon": {"open": "07:00", "close": "22:00"}, "tue": null}'::jsonb);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_set_readback', false);
END $$;

-- T2: clé de jour inconnue rejetée.
DO $$ BEGIN
  PERFORM set_setting_v9('business_hours', '{"monday": {"open": "07:00", "close": "22:00"}}'::jsonb, 'business');
  INSERT INTO _r VALUES ('t2_unknown_day', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t2_unknown_day', SQLERRM = 'setting_value_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_unknown_day', false);
END $$;

-- T3: format non-HH:MM rejeté.
DO $$ BEGIN
  PERFORM set_setting_v9('business_hours', '{"mon": {"open": "7h00", "close": "22:00"}}'::jsonb, 'business');
  INSERT INTO _r VALUES ('t3_bad_format', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t3_bad_format', SQLERRM = 'setting_value_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_bad_format', false);
END $$;

-- T4: open >= close rejeté.
DO $$ BEGIN
  PERFORM set_setting_v9('business_hours', '{"mon": {"open": "22:00", "close": "07:00"}}'::jsonb, 'business');
  INSERT INTO _r VALUES ('t4_inverted', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t4_inverted', SQLERRM = 'setting_value_invalid');
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_inverted', false);
END $$;

-- T5: valeur de jour ni null ni {open, close} rejetée.
DO $$ DECLARE v_ok BOOLEAN := true; BEGIN
  BEGIN
    PERFORM set_setting_v9('business_hours', '{"mon": 5}'::jsonb, 'business');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM set_setting_v9('business_hours', '{"mon": {"open": "07:00"}}'::jsonb, 'business');
    v_ok := false;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  INSERT INTO _r VALUES ('t5_bad_shape', v_ok);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_bad_shape', false);
END $$;

-- ── Rapport hors-horaire : fixture 4 paiements (lun 23:30 / lun 12:00 /
-- mar 10:00 fermé / mer 10:00 non configuré), heure LOCALE du tz live. ──────
SET LOCAL session_replication_role = replica;  -- coupe les triggers JE de vente
DO $$
DECLARE
  v_tz  TEXT;
  v_ord UUID;
  v_res JSONB;
  v_row JSONB;
BEGIN
  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz FROM business_config WHERE id = 1;

  INSERT INTO orders (order_number, status, subtotal, tax_amount, total, created_via)
  -- created_via 'tablet' : 'pos' exige un session_id (orders_session_id_required_for_pos).
  VALUES ('BH-TEST-1', 'paid', 400, 0, 400, 'tablet') RETURNING id INTO v_ord;
  INSERT INTO order_payments (order_id, method, amount, paid_at) VALUES
    (v_ord, 'cash', 100, ('2026-06-01 23:30:00'::timestamp AT TIME ZONE v_tz)),  -- lun après 22:00
    (v_ord, 'cash', 50,  ('2026-06-01 12:00:00'::timestamp AT TIME ZONE v_tz)),  -- lun en horaire
    (v_ord, 'qris', 200, ('2026-06-02 10:00:00'::timestamp AT TIME ZONE v_tz)),  -- mar fermé
    (v_ord, 'card', 75,  ('2026-06-03 10:00:00'::timestamp AT TIME ZONE v_tz));  -- mer non configuré

  v_res := get_off_hours_sales_v1('2026-06-01', '2026-06-03');

  -- T6: résumé = 2 paiements marqués (lun 23:30 + mar), 1 commande, 300 au total.
  INSERT INTO _r VALUES ('t6_summary',
    (v_res->'summary'->>'payment_count')::int = 2
    AND (v_res->'summary'->>'order_count')::int = 1
    AND (v_res->'summary'->>'total_amount')::numeric = 300);

  -- T7: la ligne du lundi porte le créneau 07:00-22:00.
  SELECT e INTO v_row FROM jsonb_array_elements(v_res->'rows') e
   WHERE e->>'day_key' = 'mon';
  INSERT INTO _r VALUES ('t7_mon_window',
    v_row IS NOT NULL
    AND (v_row->>'amount')::numeric = 100
    AND v_row->>'window_open' = '07:00'
    AND v_row->>'window_close' = '22:00'
    AND v_row->>'order_number' = 'BH-TEST-1');

  -- T8: la ligne du mardi (jour fermé) a un créneau NULL.
  SELECT e INTO v_row FROM jsonb_array_elements(v_res->'rows') e
   WHERE e->>'day_key' = 'tue';
  INSERT INTO _r VALUES ('t8_closed_day',
    v_row IS NOT NULL
    AND (v_row->>'amount')::numeric = 200
    AND v_row->>'window_open' IS NULL
    AND v_row->>'window_close' IS NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_summary', false) ON CONFLICT (name) DO NOTHING;
  INSERT INTO _r VALUES ('t7_mon_window', false) ON CONFLICT (name) DO NOTHING;
  INSERT INTO _r VALUES ('t8_closed_day', false) ON CONFLICT (name) DO NOTHING;
END $$;

-- T9: sans reports.audit.read (sub = UUID inconnu) -> 42501.
DO $$ DECLARE v_rand UUID := gen_random_uuid(); BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_rand::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rand)::text, true);
  BEGIN
    PERFORM get_off_hours_sales_v1('2026-06-01', '2026-06-03');
    INSERT INTO _r VALUES ('t9_perm', false);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    INSERT INTO _r VALUES ('t9_perm', true);
  WHEN OTHERS THEN
    INSERT INTO _r VALUES ('t9_perm', false);
  END;
  PERFORM set_config('request.jwt.claim.sub', current_setting('bh.admin'), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('bh.admin')::uuid)::text, true);
END $$;

-- T10: ACL — anon n'a EXECUTE sur aucune des 3 fonctions.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t10_acl_anon',
    NOT has_function_privilege('anon', 'public.set_setting_v9(text,jsonb,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.get_settings_by_category_v7(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.get_off_hours_sales_v1(text,text)', 'EXECUTE'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t10_acl_anon', false);
END $$;

SELECT plan(10);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_set_readback'), 'T1: business_hours set + readback via category business');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_unknown_day'),  'T2: unknown day key rejected (22023)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_bad_format'),   'T3: non-HH:MM time rejected (22023)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_inverted'),     'T4: open >= close rejected (22023)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_bad_shape'),    'T5: day value must be null or {open, close} (22023)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_summary'),      'T6: off-hours summary = 2 payments / 1 order / 300');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_mon_window'),   'T7: monday row carries its 07:00-22:00 window');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t8_closed_day'),   'T8: closed-day row (tue) has NULL window');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t9_perm'),         'T9: without reports.audit.read -> 42501');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t10_acl_anon'),    'T10: anon has no EXECUTE on the 3 functions');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
