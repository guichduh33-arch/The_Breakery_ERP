-- supabase/tests/adr022_paid_order_reaches_kds.test.sql
--
-- ADR-022 déc. 5 — une vente encaissée DIRECTEMENT (sans passer par le fire
-- comptoir) doit atteindre l'écran de cuisine. `complete_order_with_payment_v24`
-- insérait ses lignes sans `is_locked`, sans `kitchen_status` d'envoi et sans
-- `sent_to_kitchen_at`, et résolvait la station par un JOIN categories qui
-- ignorait l'override produit en laissant `dispatch_stations` NULL : la ligne
-- payée n'avait aucune chance de s'afficher, l'impression était le seul canal,
-- et si elle échouait il ne restait rien.
--
-- Le KDS filtre EXACTEMENT sur `is_locked = true` ET `dispatch_stations`
-- contenant sa station. Ce fichier oppose ce filtre au résultat réel de v25, sur
-- deux lignes de la même vente : l'une routée vers la cuisine, l'autre dont la
-- catégorie ne route nulle part.
--
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

DO $fixture$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID;
  v_cat_kit UUID; v_cat_none UUID;
  v_p_kit UUID; v_p_none UUID;
  v_items_total NUMERIC; v_total NUMERIC; v_env JSONB;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create') LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: aucun profil pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  -- Deux catégories : l'une route vers la cuisine, l'autre ne route nulle part.
  INSERT INTO categories (name, slug, category_type, dispatch_station, is_active)
    VALUES ('ADR022 KDS Kitchen', 'adr022-kds-kitchen', 'finished', 'kitchen', true)
    RETURNING id INTO v_cat_kit;
  INSERT INTO categories (name, slug, category_type, dispatch_station, is_active)
    VALUES ('ADR022 KDS None', 'adr022-kds-none', 'finished', 'none', true)
    RETURNING id INTO v_cat_none;

  -- track_inventory=false : ce test porte sur le routage cuisine, pas sur la
  -- garde de stock (dont la couverture vit dans sale_flag_aware_deduction).
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, deduct_stock, is_display_item)
    VALUES ('A22K-KIT', 'adr022 kds plat cuisine', v_cat_kit, 20000, 0, 'pcs', 1,
            'finished', true, false, false, false)
    RETURNING id INTO v_p_kit;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, deduct_stock, is_display_item)
    VALUES ('A22K-NONE', 'adr022 kds article non route', v_cat_none, 15000, 0, 'pcs', 1,
            'finished', true, false, false, false)
    RETURNING id INTO v_p_none;

  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_prof, closing_cash=0
   WHERE opened_by = v_prof AND status='open';
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;

  -- Isoler l'evaluation promo : v25 recalcule les promotions serveur et refuse
  -- un ecart. Annule par le ROLLBACK.
  UPDATE promotions SET is_active = false WHERE is_active = true;

  -- v25 RETARIFE serveur : le tender doit valoir le prix reel, pas celui que le
  -- client passe. On reproduit le pipeline canonique (items -> _pb1_split_v1).
  v_items_total := 20000 + 15000;
  SELECT s.total INTO v_total FROM _pb1_split_v1(v_items_total) s;

  v_env := complete_order_with_payment_v25(
    p_session_id := v_sess,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(
      jsonb_build_object('product_id', v_p_kit,  'quantity', 1, 'unit_price', 20000, 'modifiers', '[]'::jsonb),
      jsonb_build_object('product_id', v_p_none, 'quantity', 1, 'unit_price', 15000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',v_total,
                                    'cash_received',v_total,'change_given',0));

  PERFORM set_config('a22k.order',  (v_env->>'order_id'), true);
  PERFORM set_config('a22k.p_kit',  v_p_kit::text,  true);
  PERFORM set_config('a22k.p_none', v_p_none::text, true);
END $fixture$;

SELECT is(
  (SELECT status::text FROM orders WHERE id = current_setting('a22k.order')::uuid),
  'paid', 'T1: la vente directe est encaissee (status=paid)');

SELECT ok(
  (SELECT is_locked FROM order_items
    WHERE order_id = current_setting('a22k.order')::uuid
      AND product_id = current_setting('a22k.p_kit')::uuid),
  'T2: la ligne payee est VERROUILLEE (is_locked=true) - v24 la laissait a false');

SELECT ok(
  (SELECT sent_to_kitchen_at IS NOT NULL FROM order_items
    WHERE order_id = current_setting('a22k.order')::uuid
      AND product_id = current_setting('a22k.p_kit')::uuid),
  'T3: la ligne payee porte sent_to_kitchen_at');

SELECT is(
  (SELECT kitchen_status FROM order_items
    WHERE order_id = current_setting('a22k.order')::uuid
      AND product_id = current_setting('a22k.p_kit')::uuid),
  'pending', 'T4: la ligne payee entre en cuisine au statut pending');

SELECT ok(
  (SELECT dispatch_stations IS NOT NULL AND dispatch_stations @> ARRAY['kitchen']
     FROM order_items
    WHERE order_id = current_setting('a22k.order')::uuid
      AND product_id = current_setting('a22k.p_kit')::uuid),
  'T5: dispatch_stations est renseigne et porte la station reelle - v24 laissait NULL');

-- Le filtre EXACT du KDS, applique tel quel.
SELECT is(
  (SELECT count(*)::int FROM order_items
    WHERE order_id = current_setting('a22k.order')::uuid
      AND is_locked = true
      AND dispatch_stations @> ARRAY['kitchen']),
  1, 'T6: le filtre exact du KDS (is_locked + station) remonte la ligne cuisine');

SELECT ok(
  (SELECT cardinality(COALESCE(dispatch_stations, ARRAY[]::text[])) = 0
     FROM order_items
    WHERE order_id = current_setting('a22k.order')::uuid
      AND product_id = current_setting('a22k.p_none')::uuid)
  AND (SELECT count(*)::int FROM order_items
        WHERE order_id = current_setting('a22k.order')::uuid
          AND product_id = current_setting('a22k.p_none')::uuid
          AND is_locked = true
          AND (dispatch_stations && ARRAY['kitchen','barista'])) = 0,
  'T7: la ligne dont la categorie ne route nulle part n''apparait a aucune station de preparation');

SELECT ok(
  (SELECT is_locked AND sent_to_kitchen_at IS NOT NULL FROM order_items
    WHERE order_id = current_setting('a22k.order')::uuid
      AND product_id = current_setting('a22k.p_none')::uuid),
  'T8: cette ligne est pourtant verrouillee et envoyee - c''est le ROUTAGE qui l''exclut, pas le verrou');

SELECT * FROM finish();
ROLLBACK;
