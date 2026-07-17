-- supabase/tests/set_setting_v3_tax_switch_gate.test.sql
-- Lot 6b (migration 20260717000179) — la bascule du réglage `tax_inclusive`
-- est refusée tant que des commandes ouvertes (draft/pending_payment)
-- existent ; un write no-op reste permis ; b2b_pending n'entre pas dans le
-- gate (hors champ PBJT). Versioning : set_setting_v2 droppée, v3 ACL sans
-- anon/PUBLIC.
--
-- Toutes les écritures (bascule comprise) sont faites DANS la transaction et
-- annulées par le ROLLBACK. Run via MCP execute_sql (BEGIN..ROLLBACK porté
-- par ce fichier ; pattern temp-table, cf. settings_business_identity.test.sql).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

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

-- Point de départ déterministe : mode inclusif.
UPDATE business_config SET tax_inclusive = true WHERE id = 1;

-- T1: v2 droppée ; v3 existe avec ACL sans anon ni PUBLIC.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t1_versioning',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'set_setting_v2') = 0
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'set_setting_v3'
        AND p.proacl::text NOT LIKE '%anon%'
        AND p.proacl::text NOT LIKE '{=X%') = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_versioning', false);
END $$;

-- Seed d'une commande ouverte (draft) — pattern recalc_order_totals_mode_aware.
DO $$
DECLARE
  v_cashier UUID := (SELECT id FROM user_profiles WHERE role_code='CASHIER' LIMIT 1);
  v_session UUID;
BEGIN
  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_cashier, closing_cash=0
   WHERE opened_by = v_cashier AND status='open';
  INSERT INTO pos_sessions (opened_by, opening_cash)
  VALUES (v_cashier, 100000) RETURNING id INTO v_session;
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total)
  VALUES ('T-ORD-GATE-' || gen_random_uuid()::text, v_session, v_cashier, 'dine_in', 'draft', 0, 0, 0);
END $$;

-- T2: avec une commande draft ouverte, le flip true -> false est refusé
--     (P0001 tax_mode_switch_blocked) et le mode reste inchangé.
DO $$ DECLARE v_ok BOOLEAN := false; BEGIN
  BEGIN
    PERFORM set_setting_v3('tax_inclusive', 'false'::jsonb, 'tax');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := SQLERRM = 'tax_mode_switch_blocked';
  END;
  INSERT INTO _r VALUES ('t2_flip_blocked',
    v_ok AND (SELECT tax_inclusive FROM business_config WHERE id = 1) = true);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_flip_blocked', false);
END $$;

-- T3: le write no-op (même valeur) reste permis malgré la commande ouverte.
DO $$ BEGIN
  PERFORM set_setting_v3('tax_inclusive', 'true'::jsonb, 'tax');
  INSERT INTO _r VALUES ('t3_noop_allowed',
    (SELECT tax_inclusive FROM business_config WHERE id = 1) = true);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_noop_allowed', false);
END $$;

-- T4: une fois toutes les commandes ouvertes soldées (voided en test), le
--     flip passe et le mode change réellement. Une b2b_pending restante ne
--     bloque pas (hors champ PBJT).
DO $$
DECLARE
  v_voider UUID := (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1);
BEGIN
  -- chk_orders_void_consistency exige les métadonnées de void.
  UPDATE orders
     SET status = 'voided', voided_at = now(), voided_by = v_voider,
         void_reason = 'test — settle open orders for tax switch'
   WHERE status IN ('draft', 'pending_payment');
  PERFORM set_setting_v3('tax_inclusive', 'false'::jsonb, 'tax');
  INSERT INTO _r VALUES ('t4_flip_allowed',
    (SELECT tax_inclusive FROM business_config WHERE id = 1) = false);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_flip_allowed', false);
END $$;

-- T5: le flip réussi a écrit une ligne audit_logs setting.update old/new.
-- Test d'existence : dans une même transaction, created_at (now()) est
-- identique pour toutes les lignes — un ORDER BY serait ambigu entre la
-- ligne du no-op (T3, old=new=true) et celle du flip (T4).
DO $$ BEGIN
  INSERT INTO _r VALUES ('t5_audit',
    EXISTS (SELECT 1 FROM audit_logs
      WHERE action = 'setting.update'
        AND metadata->>'key' = 'tax_inclusive'
        AND metadata->>'old' = 'true'
        AND metadata->>'new' = 'false'
        AND metadata->>'category' = 'tax'
        AND created_at = now()));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_audit', false);
END $$;

SELECT plan(5);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_versioning'),  'T1: set_setting_v2 dropped; v3 ACL excludes anon/PUBLIC');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_flip_blocked'),'T2: flip refused while a draft order is open (tax_mode_switch_blocked)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_noop_allowed'),'T3: same-value write allowed despite open orders');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_flip_allowed'),'T4: flip succeeds once open orders are settled');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_audit'),       'T5: successful flip audit-logged with old/new');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
