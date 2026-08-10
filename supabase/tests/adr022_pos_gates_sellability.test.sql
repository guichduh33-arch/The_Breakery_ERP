-- supabase/tests/adr022_pos_gates_sellability.test.sql
--
-- ADR-022 déc. 1 — la définition de « vendable » est unique et opposable aux
-- TROIS portes de vente, plus seulement au money-path. Avant, fire_counter_order
-- et create_tablet_order ne vérifiaient que l'existence du produit, et
-- add_order_item ne regardait que `is_active` : un produit soft-deleted ou un
-- produit-parent d'un groupe de variantes entrait dans une commande par ces
-- chemins alors que l'encaissement les refusait.
--
-- Ce fichier oppose les quatre refus à chaque porte, ET prouve à chaque fois
-- qu'une variante saine passe : une garde qui sur-bloque est un bug, pas une
-- sécurité.
--
-- Les trois portes n'exigent PAS la même permission — `pos.sale.create` pour le
-- comptoir, `sales.create` pour la salle, `orders.edit_open` pour l'édition BO.
-- Chaque acteur est donc sélectionné sur SA permission : mélanger les trois
-- ferait passer un refus de permission pour un refus de vendabilité.
--
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- ===========================================================================
-- Fixtures — catalogue dédié, monté en transaction (aucune dépendance aux
-- données de dev, qui bougent).
--   A22-PARENT  : devient parent à l'insertion de A22-VAR
--   A22-VAR     : variante active du parent — le cas SAIN
--   A22-DEL     : soft-deleted
--   A22-INACT   : is_active = false
--   A22-COMBO   : combo hôte, sain, dont on passe le PARENT en composant
-- ===========================================================================
DO $fixture$
DECLARE
  v_fire_auth UUID; v_fire_prof UUID;
  v_tab_auth  UUID; v_tab_prof  UUID;
  v_edit_auth UUID; v_edit_prof UUID;
  v_cat UUID; v_sess UUID; v_order UUID;
  v_parent UUID; v_var UUID; v_del UUID; v_inact UUID; v_combo UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_fire_auth, v_fire_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND up.id = up.auth_user_id
     AND has_permission(up.auth_user_id, 'pos.sale.create') LIMIT 1;
  IF v_fire_auth IS NULL THEN RAISE EXCEPTION 'fixture: aucun profil pos.sale.create'; END IF;

  SELECT up.auth_user_id, up.id INTO v_tab_auth, v_tab_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND up.id = up.auth_user_id
     AND has_permission(up.auth_user_id, 'sales.create') LIMIT 1;
  IF v_tab_auth IS NULL THEN RAISE EXCEPTION 'fixture: aucun profil sales.create'; END IF;

  -- add_order_item_v5 écrit `audit_logs.actor_id = auth.uid()` sur une colonne
  -- qui référence user_profiles(id) : l'acteur doit avoir id = auth_user_id.
  SELECT up.auth_user_id, up.id INTO v_edit_auth, v_edit_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND up.id = up.auth_user_id
     AND has_permission(up.auth_user_id, 'orders.edit_open') LIMIT 1;
  IF v_edit_auth IS NULL THEN RAISE EXCEPTION 'fixture: aucun profil orders.edit_open'; END IF;

  INSERT INTO categories (name, slug, category_type, dispatch_station, is_active)
    VALUES ('ADR022 Gates', 'adr022-gates', 'finished', 'kitchen', true)
    RETURNING id INTO v_cat;

  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item)
    VALUES ('A22-PARENT', 'adr022 parent', v_cat, 20000, 100, 'pcs', 1,
            'finished', true, false, false)
    RETURNING id INTO v_parent;
  -- products_variant_xor : parent_product_id, variant_label ET variant_axis
  -- ensemble ou aucun. variant_axis est l'enum variant_axis_type.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item,
                        parent_product_id, variant_label, variant_axis)
    VALUES ('A22-VAR', 'adr022 variante', v_cat, 20000, 100, 'pcs', 1,
            'finished', true, false, false, v_parent, 'Nature', 'flavor')
    RETURNING id INTO v_var;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item,
                        deleted_at)
    VALUES ('A22-DEL', 'adr022 supprime', v_cat, 20000, 100, 'pcs', 1,
            'finished', true, false, false, now())
    RETURNING id INTO v_del;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item)
    VALUES ('A22-INACT', 'adr022 desactive', v_cat, 20000, 100, 'pcs', 1,
            'finished', false, false, false)
    RETURNING id INTO v_inact;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item,
                        combo_base_price)
    VALUES ('A22-COMBO', 'adr022 combo hote', v_cat, 0, 0, 'pcs', 0,
            'combo', true, false, false, 50000)
    RETURNING id INTO v_combo;

  -- Session pour la porte comptoir (EXCLUDE one_open_session_per_user).
  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_fire_prof, closing_cash=0
   WHERE opened_by = v_fire_prof AND status='open';
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_fire_prof, 0, 'open') RETURNING id INTO v_sess;

  -- Commande ouverte pour la porte d'édition back-office.
  INSERT INTO orders (order_number, session_id, served_by, order_type, status,
                      subtotal, tax_amount, total)
    VALUES ('T-A22G-' || gen_random_uuid()::text, v_sess, v_edit_prof, 'dine_in', 'draft', 0, 0, 0)
    RETURNING id INTO v_order;

  PERFORM set_config('a22g.fire_auth', v_fire_auth::text, true);
  PERFORM set_config('a22g.tab_auth',  v_tab_auth::text,  true);
  PERFORM set_config('a22g.tab_prof',  v_tab_prof::text,  true);
  PERFORM set_config('a22g.edit_auth', v_edit_auth::text, true);
  PERFORM set_config('a22g.sess',      v_sess::text,      true);
  PERFORM set_config('a22g.order',     v_order::text,     true);
  PERFORM set_config('a22g.parent',    v_parent::text,    true);
  PERFORM set_config('a22g.var',       v_var::text,       true);
  PERFORM set_config('a22g.del',       v_del::text,       true);
  PERFORM set_config('a22g.inact',     v_inact::text,     true);
  PERFORM set_config('a22g.combo',     v_combo::text,     true);
END $fixture$;

-- Fabrique un item JSONB pour un produit donné (les trois portes lisent la même
-- forme de ligne).
CREATE OR REPLACE FUNCTION pg_temp.a22g_item(p_product UUID, p_components JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    CASE WHEN p_components IS NULL
      THEN jsonb_build_object('product_id', p_product, 'quantity', 1,
                              'unit_price', 20000, 'modifiers', '[]'::jsonb)
      ELSE jsonb_build_object('product_id', p_product, 'quantity', 1,
                              'unit_price', 50000, 'modifiers', '[]'::jsonb,
                              'combo_components', p_components)
    END);
$$;

-- ===========================================================================
-- PORTE COMPTOIR — fire_counter_order_v6 (pos.sale.create)
-- ===========================================================================
DO $t1$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.fire_auth'), true);
  BEGIN
    PERFORM fire_counter_order_v6(
      p_client_uuid := gen_random_uuid(), p_session_id := current_setting('a22g.sess')::uuid,
      p_items := pg_temp.a22g_item(current_setting('a22g.parent')::uuid),
      p_order_type := 'take_out'::order_type);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t1', (v_msg ILIKE '%product_is_parent%')::text, true);
  PERFORM set_config('a22g.t1msg', v_msg, true);
END $t1$;
SELECT ok(current_setting('a22g.t1')::boolean,
  'T1 fire: produit-parent refuse (product_is_parent) - recu: ' || current_setting('a22g.t1msg'));

DO $t2$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.fire_auth'), true);
  BEGIN
    PERFORM fire_counter_order_v6(
      p_client_uuid := gen_random_uuid(), p_session_id := current_setting('a22g.sess')::uuid,
      p_items := pg_temp.a22g_item(current_setting('a22g.combo')::uuid,
        jsonb_build_array(jsonb_build_object('product_id', current_setting('a22g.parent')::uuid, 'quantity', 1))),
      p_order_type := 'take_out'::order_type);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t2', (v_msg ILIKE '%product_is_parent%' AND v_msg ILIKE '%composant de combo%')::text, true);
  PERFORM set_config('a22g.t2msg', v_msg, true);
END $t2$;
SELECT ok(current_setting('a22g.t2')::boolean,
  'T2 fire: composant de combo parent refuse - recu: ' || current_setting('a22g.t2msg'));

DO $t3$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.fire_auth'), true);
  BEGIN
    PERFORM fire_counter_order_v6(
      p_client_uuid := gen_random_uuid(), p_session_id := current_setting('a22g.sess')::uuid,
      p_items := pg_temp.a22g_item(current_setting('a22g.del')::uuid),
      p_order_type := 'take_out'::order_type);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t3', (v_msg ILIKE '%Product not found%')::text, true);
  PERFORM set_config('a22g.t3msg', v_msg, true);
END $t3$;
SELECT ok(current_setting('a22g.t3')::boolean,
  'T3 fire: produit soft-deleted traite comme introuvable - recu: ' || current_setting('a22g.t3msg'));

DO $t4$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.fire_auth'), true);
  BEGIN
    PERFORM fire_counter_order_v6(
      p_client_uuid := gen_random_uuid(), p_session_id := current_setting('a22g.sess')::uuid,
      p_items := pg_temp.a22g_item(current_setting('a22g.inact')::uuid),
      p_order_type := 'take_out'::order_type);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t4', (v_msg ILIKE '%product_inactive%')::text, true);
  PERFORM set_config('a22g.t4msg', v_msg, true);
END $t4$;
SELECT ok(current_setting('a22g.t4')::boolean,
  'T4 fire: produit desactive refuse (product_inactive) - recu: ' || current_setting('a22g.t4msg'));

DO $t5$ DECLARE v_env JSONB; v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.fire_auth'), true);
  BEGIN
    v_env := fire_counter_order_v6(
      p_client_uuid := gen_random_uuid(), p_session_id := current_setting('a22g.sess')::uuid,
      p_items := pg_temp.a22g_item(current_setting('a22g.var')::uuid),
      p_order_type := 'take_out'::order_type);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t5',
    (v_msg = '' AND (v_env->>'order_id') IS NOT NULL
     AND (SELECT count(*) FROM order_items WHERE order_id = (v_env->>'order_id')::uuid) = 1)::text, true);
  PERFORM set_config('a22g.t5msg', v_msg, true);
END $t5$;
SELECT ok(current_setting('a22g.t5')::boolean,
  'T5 fire: la variante SAINE passe (pas de sur-blocage) - recu: ' || current_setting('a22g.t5msg'));

-- ===========================================================================
-- PORTE SALLE — create_tablet_order_v6 (sales.create)
-- ===========================================================================
DO $t6$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.tab_auth'), true);
  BEGIN
    PERFORM create_tablet_order_v6(
      gen_random_uuid(), current_setting('a22g.tab_prof')::uuid, '', 'take_out'::order_type,
      pg_temp.a22g_item(current_setting('a22g.parent')::uuid));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t6', (v_msg ILIKE '%product_is_parent%')::text, true);
  PERFORM set_config('a22g.t6msg', v_msg, true);
END $t6$;
SELECT ok(current_setting('a22g.t6')::boolean,
  'T6 tablet: produit-parent refuse (product_is_parent) - recu: ' || current_setting('a22g.t6msg'));

DO $t7$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.tab_auth'), true);
  BEGIN
    PERFORM create_tablet_order_v6(
      gen_random_uuid(), current_setting('a22g.tab_prof')::uuid, '', 'take_out'::order_type,
      pg_temp.a22g_item(current_setting('a22g.combo')::uuid,
        jsonb_build_array(jsonb_build_object('product_id', current_setting('a22g.parent')::uuid, 'quantity', 1))));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t7', (v_msg ILIKE '%product_is_parent%' AND v_msg ILIKE '%composant de combo%')::text, true);
  PERFORM set_config('a22g.t7msg', v_msg, true);
END $t7$;
SELECT ok(current_setting('a22g.t7')::boolean,
  'T7 tablet: composant de combo parent refuse - recu: ' || current_setting('a22g.t7msg'));

DO $t8$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.tab_auth'), true);
  BEGIN
    PERFORM create_tablet_order_v6(
      gen_random_uuid(), current_setting('a22g.tab_prof')::uuid, '', 'take_out'::order_type,
      pg_temp.a22g_item(current_setting('a22g.del')::uuid));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t8', (v_msg ILIKE '%not found%')::text, true);
  PERFORM set_config('a22g.t8msg', v_msg, true);
END $t8$;
SELECT ok(current_setting('a22g.t8')::boolean,
  'T8 tablet: produit soft-deleted traite comme introuvable - recu: ' || current_setting('a22g.t8msg'));

DO $t9$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.tab_auth'), true);
  BEGIN
    PERFORM create_tablet_order_v6(
      gen_random_uuid(), current_setting('a22g.tab_prof')::uuid, '', 'take_out'::order_type,
      pg_temp.a22g_item(current_setting('a22g.inact')::uuid));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t9', (v_msg ILIKE '%product_inactive%')::text, true);
  PERFORM set_config('a22g.t9msg', v_msg, true);
END $t9$;
SELECT ok(current_setting('a22g.t9')::boolean,
  'T9 tablet: produit desactive refuse (product_inactive) - recu: ' || current_setting('a22g.t9msg'));

DO $t10$ DECLARE v_oid UUID; v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.tab_auth'), true);
  BEGIN
    v_oid := create_tablet_order_v6(
      gen_random_uuid(), current_setting('a22g.tab_prof')::uuid, '', 'take_out'::order_type,
      pg_temp.a22g_item(current_setting('a22g.var')::uuid));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t10',
    (v_msg = '' AND v_oid IS NOT NULL
     AND (SELECT count(*) FROM order_items WHERE order_id = v_oid) = 1)::text, true);
  PERFORM set_config('a22g.t10msg', v_msg, true);
END $t10$;
SELECT ok(current_setting('a22g.t10')::boolean,
  'T10 tablet: la variante SAINE passe (pas de sur-blocage) - recu: ' || current_setting('a22g.t10msg'));

-- ===========================================================================
-- PORTE EDITION BACK-OFFICE — add_order_item_v5 (orders.edit_open)
-- Pas de volet « composant de combo » : cette porte refuse les combos en bloc
-- (23514, couvert par order_edit_items.test.sql).
-- ===========================================================================
DO $t11$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.edit_auth'), true);
  BEGIN
    PERFORM add_order_item_v5(current_setting('a22g.order')::uuid,
      current_setting('a22g.parent')::uuid, 1, '[]'::jsonb, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t11', (v_msg ILIKE '%product_is_parent%')::text, true);
  PERFORM set_config('a22g.t11msg', v_msg, true);
END $t11$;
SELECT ok(current_setting('a22g.t11')::boolean,
  'T11 add_order_item: produit-parent refuse (product_is_parent) - recu: ' || current_setting('a22g.t11msg'));

DO $t12$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.edit_auth'), true);
  BEGIN
    PERFORM add_order_item_v5(current_setting('a22g.order')::uuid,
      current_setting('a22g.del')::uuid, 1, '[]'::jsonb, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t12', (v_msg ILIKE '%Product not found%')::text, true);
  PERFORM set_config('a22g.t12msg', v_msg, true);
END $t12$;
SELECT ok(current_setting('a22g.t12')::boolean,
  'T12 add_order_item: produit soft-deleted refuse — v4 le laissait passer - recu: ' || current_setting('a22g.t12msg'));

DO $t13$ DECLARE v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.edit_auth'), true);
  BEGIN
    PERFORM add_order_item_v5(current_setting('a22g.order')::uuid,
      current_setting('a22g.inact')::uuid, 1, '[]'::jsonb, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t13', (v_msg ILIKE '%product_inactive%')::text, true);
  PERFORM set_config('a22g.t13msg', v_msg, true);
END $t13$;
SELECT ok(current_setting('a22g.t13')::boolean,
  'T13 add_order_item: produit desactive refuse (product_inactive) - recu: ' || current_setting('a22g.t13msg'));

DO $t14$ DECLARE v_res JSONB; v_msg TEXT := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('a22g.edit_auth'), true);
  BEGIN
    v_res := add_order_item_v5(current_setting('a22g.order')::uuid,
      current_setting('a22g.var')::uuid, 1, '[]'::jsonb, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a22g.t14',
    (v_msg = '' AND (v_res->>'order_item_id') IS NOT NULL)::text, true);
  PERFORM set_config('a22g.t14msg', v_msg, true);
END $t14$;
SELECT ok(current_setting('a22g.t14')::boolean,
  'T14 add_order_item: la variante SAINE passe (pas de sur-blocage) - recu: ' || current_setting('a22g.t14msg'));

SELECT * FROM finish();
ROLLBACK;
