-- supabase/tests/adr023_vitrine_reglages.test.sql
-- ADR-023 — l'écriture et la lecture des réglages de vitrine.
-- Ce que ce test tient : la sélection ne peut contenir que des produits qui
-- existent (un id mort ne se verrait nulle part, il serait tu en silence), elle
-- reste bornée et ordonnée, l'interrupteur est typé, la catégorie
-- customer_display rend bien les quatre clés, et les versions remplacées ont
-- disparu.
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- ── Seed : impersonation d'un porteur de settings.update ────────────────────
DO $$
DECLARE v_auth UUID;
BEGIN
  SELECT up.auth_user_id INTO v_auth
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'settings.update')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
END $$;

-- T1: une sélection de produits réels est acceptée, dans l'ordre donné.
DO $$
DECLARE v_a UUID; v_b UUID; v_after JSONB;
BEGIN
  SELECT id INTO v_a FROM products WHERE deleted_at IS NULL ORDER BY name LIMIT 1;
  SELECT id INTO v_b FROM products WHERE deleted_at IS NULL AND id <> v_a ORDER BY name DESC LIMIT 1;
  PERFORM set_setting_v13('display_showcase_product_ids',
                          jsonb_build_array(v_b::text, v_a::text), 'customer_display');
  SELECT display_showcase_product_ids INTO v_after FROM business_config WHERE id = 1;
  INSERT INTO _r VALUES ('t1_selection_acceptee_ordre_conserve',
    v_after = jsonb_build_array(v_b::text, v_a::text));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_selection_acceptee_ordre_conserve', false);
END $$;

-- T2: l'écriture est auditée comme les autres réglages (old/new).
INSERT INTO _r
SELECT 't2_audit_ecrit', EXISTS (
  SELECT 1 FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'display_showcase_product_ids'
     AND metadata ? 'old' AND metadata ? 'new'
);

-- T3: un id qui ne désigne aucun produit est refusé.
DO $$ BEGIN
  PERFORM set_setting_v13('display_showcase_product_ids',
    '["99999999-9999-4999-8999-999999999999"]'::jsonb, 'customer_display');
  INSERT INTO _r VALUES ('t3_id_inconnu_refuse', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t3_id_inconnu_refuse', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_id_inconnu_refuse', false);
END $$;

-- T4: au-delà de douze, refus — la vitrine tient en quatre pages de trois.
DO $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_agg(id::text) INTO v FROM (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 13) s;
  PERFORM set_setting_v13('display_showcase_product_ids', v, 'customer_display');
  INSERT INTO _r VALUES ('t4_plafond_douze', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t4_plafond_douze', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_plafond_douze', false);
END $$;

-- T5: ce qui n'est pas un tableau n'est pas une sélection.
DO $$ BEGIN
  PERFORM set_setting_v13('display_showcase_product_ids', '"un-seul-id"'::jsonb, 'customer_display');
  INSERT INTO _r VALUES ('t5_non_tableau_refuse', false);
EXCEPTION WHEN SQLSTATE '22023' THEN
  INSERT INTO _r VALUES ('t5_non_tableau_refuse', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_non_tableau_refuse', false);
END $$;

-- T6: l'interrupteur est un booléen, et il s'écrit.
DO $$
DECLARE v_after BOOLEAN;
BEGIN
  PERFORM set_setting_v13('display_show_ready_orders', 'true'::jsonb, 'customer_display');
  SELECT display_show_ready_orders INTO v_after FROM business_config WHERE id = 1;
  BEGIN
    PERFORM set_setting_v13('display_show_ready_orders', '"yes"'::jsonb, 'customer_display');
    INSERT INTO _r VALUES ('t6_interrupteur', false);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    INSERT INTO _r VALUES ('t6_interrupteur', v_after IS TRUE);
  END;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_interrupteur', false);
END $$;

-- T7: la catégorie customer_display rend les quatre clés.
DO $$
DECLARE v JSONB;
BEGIN
  v := get_settings_by_category_v10('customer_display')->'settings';
  INSERT INTO _r VALUES ('t7_categorie_rend_les_4_cles',
    v ? 'display_footer_message' AND v ? 'display_slogan'
    AND v ? 'display_showcase_product_ids' AND v ? 'display_show_ready_orders');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_categorie_rend_les_4_cles', false);
END $$;

-- T8: anon reste dehors, authenticated garde la porte (defense-in-depth).
INSERT INTO _r
SELECT 't8_grants', (
  NOT has_function_privilege('anon', 'public.set_setting_v13(text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_settings_by_category_v10(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.set_setting_v13(text,jsonb,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_settings_by_category_v10(text)', 'EXECUTE')
);

-- T9: les versions remplacées ont disparu — pas deux portes pour un réglage.
INSERT INTO _r
SELECT 't9_anciennes_versions_droppees', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('set_setting_v12', 'get_settings_by_category_v9')
);

SELECT name, pass FROM _r ORDER BY name;

ROLLBACK;
