-- supabase/tests/adr022_tolerate_unsellable.test.sql
--
-- ADR-022 déc. 3 — `p_tolerate_unsellable`. Deux chemins voient le refus de
-- vendabilité arriver trop tard : le rejeu hors-ligne (la marchandise est
-- partie, l'argent est encaissé) et l'appel d'appoint qui pousse les dernières
-- lignes du panier au moment du checkout. Le drapeau leur ouvre la porte.
--
-- Ce fichier prouve les trois propriétés qui font qu'un tel drapeau reste
-- gouvernable et non un trou :
--   1. AVEC le drapeau, la vente passe sur un produit devenu non vendable ;
--   2. SANS le drapeau, la MÊME vente est refusée — la tolérance n'est jamais
--      le défaut ;
--   3. la tolérance laisse une trace : `audit_logs` / `order.sellability_tolerated`.
--
-- Les deux portes qui portent le drapeau sont couvertes (`fire_counter_order_v7`,
-- `create_tablet_order_v9`). `add_order_item_v5` n'en a pas : elle n'est ni
-- rejouée hors-ligne ni appelée en finalisation.
--
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

DO $fixture$
DECLARE
  v_fire_auth UUID; v_fire_prof UUID;
  v_tab_auth  UUID; v_tab_prof  UUID;
  v_cat UUID; v_sess UUID; v_prod UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_fire_auth, v_fire_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create') LIMIT 1;
  IF v_fire_auth IS NULL THEN RAISE EXCEPTION 'fixture: aucun profil pos.sale.create'; END IF;

  SELECT up.auth_user_id, up.id INTO v_tab_auth, v_tab_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'sales.create') LIMIT 1;
  IF v_tab_auth IS NULL THEN RAISE EXCEPTION 'fixture: aucun profil sales.create'; END IF;

  INSERT INTO categories (name, slug, category_type, dispatch_station, is_active)
    VALUES ('ADR022 Tolerance', 'adr022-tolerance', 'finished', 'kitchen', true)
    RETURNING id INTO v_cat;

  -- Le produit du panier a ete desactive entre la prise de commande hors-ligne
  -- et le rejeu : il existe toujours (l'INSERT des RPC le lit), il n'est plus
  -- vendable. C'est exactement la situation que la dec. 3 vise.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item)
    VALUES ('A22T-INACT', 'adr022 tolerance desactive', v_cat, 20000, 100, 'pcs', 1,
            'finished', false, false, false)
    RETURNING id INTO v_prod;

  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_fire_prof, closing_cash=0
   WHERE opened_by = v_fire_prof AND status='open';
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_fire_prof, 0, 'open') RETURNING id INTO v_sess;

  PERFORM set_config('a22t.fire_auth', v_fire_auth::text, true);
  PERFORM set_config('a22t.tab_auth',  v_tab_auth::text,  true);
  PERFORM set_config('a22t.tab_prof',  v_tab_prof::text,  true);
  PERFORM set_config('a22t.sess',      v_sess::text,      true);
  PERFORM set_config('a22t.prod',      v_prod::text,      true);
END $fixture$;

CREATE OR REPLACE FUNCTION pg_temp.a22t_item() RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_array(jsonb_build_object(
    'product_id', current_setting('a22t.prod')::uuid, 'quantity', 1,
    'unit_price', 20000, 'modifiers', '[]'::jsonb));
$$;

-- ===========================================================================
-- PORTE COMPTOIR — fire_counter_order_v7
-- ===========================================================================
DO $t1$ DECLARE v_env JSONB; v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22t.fire_auth'), true);
  BEGIN
    v_env := fire_counter_order_v7(
      p_client_uuid := gen_random_uuid(),
      p_session_id  := current_setting('a22t.sess')::uuid,
      p_items       := pg_temp.a22t_item(),
      p_order_type  := 'take_out'::order_type,
      p_tolerate_unsellable := true);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22t.fire_order', COALESCE(v_env->>'order_id', ''), true);
  PERFORM set_config('a22t.t1', (v_msg = '' AND (v_env->>'order_id') IS NOT NULL)::text, true);
  PERFORM set_config('a22t.t1msg', v_msg, true);
END $t1$;
SELECT ok(current_setting('a22t.t1')::boolean,
  'T1 fire: p_tolerate_unsellable=true fait passer un produit devenu non vendable - recu: '
  || current_setting('a22t.t1msg'));

SELECT is(
  (SELECT count(*)::int FROM order_items
    WHERE order_id = current_setting('a22t.fire_order')::uuid
      AND product_id = current_setting('a22t.prod')::uuid),
  1, 'T2 fire: la tolerance produit une vraie ligne, pas un no-op silencieux');

SELECT ok(
  EXISTS (SELECT 1 FROM audit_logs
           WHERE action = 'order.sellability_tolerated'
             AND entity_type = 'orders'
             AND entity_id = current_setting('a22t.fire_order')::uuid
             AND (metadata->>'tolerate_unsellable')::boolean = true),
  'T3 fire: la tolerance laisse une trace audit_logs order.sellability_tolerated');

DO $t4$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22t.fire_auth'), true);
  BEGIN
    PERFORM fire_counter_order_v7(
      p_client_uuid := gen_random_uuid(),
      p_session_id  := current_setting('a22t.sess')::uuid,
      p_items       := pg_temp.a22t_item(),
      p_order_type  := 'take_out'::order_type);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22t.t4', (v_msg ILIKE '%product_inactive%')::text, true);
  PERFORM set_config('a22t.t4msg', v_msg, true);
END $t4$;
SELECT ok(current_setting('a22t.t4')::boolean,
  'T4 fire: SANS le drapeau le meme appel est refuse - la tolerance n''est pas le defaut - recu: '
  || current_setting('a22t.t4msg'));

-- ===========================================================================
-- PORTE SALLE — create_tablet_order_v9
-- ===========================================================================
DO $t5$ DECLARE v_oid UUID; v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22t.tab_auth'), true);
  BEGIN
    v_oid := create_tablet_order_v9(
      p_client_uuid  := gen_random_uuid(),
      p_waiter_id    := current_setting('a22t.tab_prof')::uuid,
      p_table_number := '',
      p_order_type   := 'take_out'::order_type,
      p_items        := pg_temp.a22t_item(),
      p_tolerate_unsellable := true);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22t.tab_order', COALESCE(v_oid::text, ''), true);
  PERFORM set_config('a22t.t5', (v_msg = '' AND v_oid IS NOT NULL)::text, true);
  PERFORM set_config('a22t.t5msg', v_msg, true);
END $t5$;
SELECT ok(current_setting('a22t.t5')::boolean,
  'T5 tablet: p_tolerate_unsellable=true fait passer un produit devenu non vendable - recu: '
  || current_setting('a22t.t5msg'));

SELECT is(
  (SELECT count(*)::int FROM order_items
    WHERE order_id = current_setting('a22t.tab_order')::uuid
      AND product_id = current_setting('a22t.prod')::uuid),
  1, 'T6 tablet: la tolerance produit une vraie ligne, pas un no-op silencieux');

SELECT ok(
  EXISTS (SELECT 1 FROM audit_logs
           WHERE action = 'order.sellability_tolerated'
             AND entity_type = 'orders'
             AND entity_id = current_setting('a22t.tab_order')::uuid
             AND (metadata->>'tolerate_unsellable')::boolean = true),
  'T7 tablet: la tolerance laisse une trace audit_logs order.sellability_tolerated');

DO $t8$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22t.tab_auth'), true);
  BEGIN
    PERFORM create_tablet_order_v9(
      p_client_uuid  := gen_random_uuid(),
      p_waiter_id    := current_setting('a22t.tab_prof')::uuid,
      p_table_number := '',
      p_order_type   := 'take_out'::order_type,
      p_items        := pg_temp.a22t_item());
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22t.t8', (v_msg ILIKE '%product_inactive%')::text, true);
  PERFORM set_config('a22t.t8msg', v_msg, true);
END $t8$;
SELECT ok(current_setting('a22t.t8')::boolean,
  'T8 tablet: SANS le drapeau le meme appel est refuse - la tolerance n''est pas le defaut - recu: '
  || current_setting('a22t.t8msg'));

SELECT * FROM finish();
ROLLBACK;
