-- supabase/tests/adr012_d1_combo_component_parent.test.sql
-- ADR-012 déc. 1 — le refus des produits-parents s'étend aux composants de combo.
--
-- Money-path (complete_order_with_payment_v24) :
--   T1 : combo dont un composant est un produit-PARENT → refus 'product_is_parent'
--   T2 : le même combo en ligne cadeau (is_promo_gift) → refusé AUSSI, et par la
--        garde parent, pas par le contrôle de promotion. La garde vit dans la
--        boucle des composants, qui tourne toujours ; le résolveur de prix, lui,
--        est sauté pour une ligne cadeau. T2 est ce qui prouve ce choix.
--   T3 : le même combo avec la VARIANTE au lieu du parent → vente OK (pas de
--        sur-blocage).
-- Catalogue (upsert_combo_v2) :
--   T4 : enregistrer un parent comme option de combo → refus 'combo_option_is_parent'
--   T5 : les mêmes groupes avec la variante → combo créé
-- Schéma :
--   T6 : products.combo_available_from / _to n'existent plus (ADR-007 déc. 3)
--
-- Harnais s44 (jwt-claims + fixtures rollback). Exécuter via MCP execute_sql
-- ou runner API (BEGIN..ROLLBACK inclus).
BEGIN;
SELECT plan(6);

DO $$
DECLARE v_auth UUID; v_prof UUID; v_sess UUID; v_cat UUID;
        v_parent UUID; v_variant UUID; v_drink UUID; v_combo UUID; v_grp UUID;
BEGIN
  -- Un seul acteur pour les deux volets : il lui faut pos.sale.create (vente)
  -- ET combos.create (upsert). Sélection dynamique — aucun UUID en dur.
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
     AND has_permission(up.auth_user_id, 'combos.create')
   LIMIT 1;
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'fixture: aucun user_profiles avec pos.sale.create ET combos.create';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_sess FROM pos_sessions
    WHERE status = 'open' AND opened_by = v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status)
      VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  SELECT category_id INTO v_cat FROM products
    WHERE deleted_at IS NULL AND category_id IS NOT NULL LIMIT 1;

  -- Le parent : aucune variante encore, il devient parent à l'insertion de v_variant.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item)
    VALUES ('A12D1-PARENT', 'adr012 d1 parent', v_cat, 15000, 100, 'pcs', 1,
            'finished', true, false, false)
    RETURNING id INTO v_parent;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item,
                        parent_product_id, variant_label, variant_axis)
    VALUES ('A12D1-VAR', 'adr012 d1 variante', v_cat, 15000, 100, 'pcs', 1,
            'finished', true, false, false, v_parent, 'Nature', 'flavor')
    RETURNING id INTO v_variant;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item)
    VALUES ('A12D1-DRINK', 'adr012 d1 boisson', v_cat, 10000, 100, 'pcs', 1,
            'finished', true, false, false)
    RETURNING id INTO v_drink;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active, track_inventory, is_display_item,
                        combo_base_price)
    VALUES ('A12D1-COMBO', 'adr012 d1 combo', v_cat, 0, 0, 'pcs', 0,
            'combo', true, false, false, 40000)
    RETURNING id INTO v_combo;

  -- Configuration fautive posée DIRECTEMENT en table : c'est exactement ce que
  -- la base contient si le combo a été enregistré avant upsert_combo_v2, et ce
  -- que la garde money-path doit rattraper. Le parent ET la variante sont
  -- options du même groupe, pour que T1 et T3 ne diffèrent que d'un id.
  INSERT INTO combo_groups (combo_product_id, name, group_type, is_required,
                            min_select, max_select, sort_order)
    VALUES (v_combo, 'Choix', 'single', true, 1, 1, 0)
    RETURNING id INTO v_grp;
  INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default, sort_order)
    VALUES (v_grp, v_parent,  0, true,  0),
           (v_grp, v_variant, 0, false, 1);

  PERFORM set_config('a12d1.sess',    v_sess::text,    true);
  PERFORM set_config('a12d1.parent',  v_parent::text,  true);
  PERFORM set_config('a12d1.variant', v_variant::text, true);
  PERFORM set_config('a12d1.drink',   v_drink::text,   true);
  PERFORM set_config('a12d1.combo',   v_combo::text,   true);
  PERFORM set_config('a12d1.cat',     v_cat::text,     true);
END $$;

-- T1 : composant parent → product_is_parent.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM complete_order_with_payment_v24(
      p_session_id := current_setting('a12d1.sess')::uuid, p_order_type := 'take_out',
      p_items := jsonb_build_array(jsonb_build_object(
        'product_id', current_setting('a12d1.combo')::uuid, 'quantity', 1,
        'unit_price', 40000, 'modifiers', '[]'::jsonb,
        'combo_components', jsonb_build_array(jsonb_build_object(
          'product_id', current_setting('a12d1.parent')::uuid, 'quantity', 1)))),
      p_payment := jsonb_build_object('method','cash','amount',40000,'cash_received',40000,'change_given',0));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a12d1.t1', (v_msg ILIKE '%product_is_parent%')::text, true);
  PERFORM set_config('a12d1.t1msg', v_msg, true);
END $$;
SELECT ok(current_setting('a12d1.t1')::boolean,
  'T1 composant de combo produit-parent refuse (product_is_parent) — recu: ' || current_setting('a12d1.t1msg'));

-- T2 : ligne cadeau, composant parent. Le contrôle de promotion cadeau vit en
-- aval de la boucle des composants : si la garde parent ne couvrait pas les
-- cadeaux, le message reçu serait celui de la promotion, pas product_is_parent.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM complete_order_with_payment_v24(
      p_session_id := current_setting('a12d1.sess')::uuid, p_order_type := 'take_out',
      p_items := jsonb_build_array(jsonb_build_object(
        'product_id', current_setting('a12d1.combo')::uuid, 'quantity', 1,
        'unit_price', 0, 'modifiers', '[]'::jsonb, 'is_promo_gift', true,
        'combo_components', jsonb_build_array(jsonb_build_object(
          'product_id', current_setting('a12d1.parent')::uuid, 'quantity', 1)))),
      p_payment := jsonb_build_object('method','cash','amount',0,'cash_received',0,'change_given',0));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a12d1.t2', (v_msg ILIKE '%product_is_parent%')::text, true);
  PERFORM set_config('a12d1.t2msg', v_msg, true);
END $$;
SELECT ok(current_setting('a12d1.t2')::boolean,
  'T2 combo cadeau a composant parent refuse par la garde parent — recu: ' || current_setting('a12d1.t2msg'));

-- T3 : la variante à la place du parent → vente OK (la garde ne sur-bloque pas).
DO $$ DECLARE v_env JSONB;
BEGIN
  v_env := complete_order_with_payment_v24(
    p_session_id := current_setting('a12d1.sess')::uuid, p_order_type := 'take_out',
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('a12d1.combo')::uuid, 'quantity', 1,
      'unit_price', 40000, 'modifiers', '[]'::jsonb,
      'combo_components', jsonb_build_array(jsonb_build_object(
        'product_id', current_setting('a12d1.variant')::uuid, 'quantity', 1)))),
    p_payment := jsonb_build_object('method','cash','amount',40000,'cash_received',40000,'change_given',0));
  PERFORM set_config('a12d1.t3',
    ((SELECT status FROM orders WHERE id = (v_env->>'order_id')::uuid) = 'paid')::text, true);
END $$;
SELECT ok(current_setting('a12d1.t3')::boolean, 'T3 combo a composant variante se vend');

-- T4 : upsert_combo_v2 refuse un parent comme option.
DO $$ DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM upsert_combo_v2(jsonb_build_object(
      'combo_product_id', NULL,
      'name', 'adr012 d1 upsert refuse',
      'category_id', current_setting('a12d1.cat'),
      'base_price', 30000,
      'display_order', 0,
      'is_active', true,
      'visible_on_pos', true,
      'groups', jsonb_build_array(jsonb_build_object(
        'name', 'Choix', 'group_type', 'single', 'is_required', true,
        'min_select', 1, 'max_select', 1, 'sort_order', 0,
        'options', jsonb_build_array(jsonb_build_object(
          'component_product_id', current_setting('a12d1.parent'),
          'surcharge', 0, 'is_default', true, 'sort_order', 0))))), NULL);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  PERFORM set_config('a12d1.t4', (v_msg ILIKE '%combo_option_is_parent%')::text, true);
  PERFORM set_config('a12d1.t4msg', v_msg, true);
END $$;
SELECT ok(current_setting('a12d1.t4')::boolean,
  'T4 upsert_combo_v2 refuse un parent en option (combo_option_is_parent) — recu: ' || current_setting('a12d1.t4msg'));

-- T5 : les mêmes groupes avec la variante → combo créé (le refus ne sur-bloque pas).
DO $$ DECLARE v_res JSONB;
BEGIN
  v_res := upsert_combo_v2(jsonb_build_object(
    'combo_product_id', NULL,
    'name', 'adr012 d1 upsert sain',
    'category_id', current_setting('a12d1.cat'),
    'base_price', 30000,
    'display_order', 0,
    'is_active', true,
    'visible_on_pos', true,
    'groups', jsonb_build_array(jsonb_build_object(
      'name', 'Choix', 'group_type', 'single', 'is_required', true,
      'min_select', 1, 'max_select', 1, 'sort_order', 0,
      'options', jsonb_build_array(jsonb_build_object(
        'component_product_id', current_setting('a12d1.variant'),
        'surcharge', 0, 'is_default', true, 'sort_order', 0))))), NULL);
  PERFORM set_config('a12d1.t5',
    (EXISTS (SELECT 1 FROM combo_groups
              WHERE combo_product_id = (v_res->>'combo_product_id')::uuid))::text, true);
END $$;
SELECT ok(current_setting('a12d1.t5')::boolean, 'T5 upsert_combo_v2 enregistre un combo a options saines');

-- T6 : la fenêtre horaire dépréciée (ADR-007 déc. 3) n'existe plus en colonne.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'products'
                 AND column_name IN ('combo_available_from', 'combo_available_to')),
  'T6 products.combo_available_from/_to droppees');

SELECT * FROM finish();
ROLLBACK;
