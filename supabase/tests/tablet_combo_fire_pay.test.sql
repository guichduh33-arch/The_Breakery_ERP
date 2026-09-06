-- supabase/tests/tablet_combo_fire_pay.test.sql
--
-- Audit lot 1 du 2026-08-31, P0 n°6 (docs/audits/2026-08-31-audit-pos-flow.md)
-- — lot D du plan validé par Mamat le 2026-09-05.
--
-- `create_tablet_order_v8` valide les composants d'un combo mais ne persiste
-- ni `combo_components` ni `modifier_ingredients_deducted`, et prend
-- `unit_price` tel quel du client. Le déstockage a lieu au paiement
-- (`pay_existing_order_v19`), qui lit exactement ces deux colonnes : NULL →
-- zéro mouvement de stock sur les composants d'un combo envoyé par la
-- tablette. `create_tablet_order_v9` (attendue, PAS ENCORE LIVRÉE au moment où
-- ce fichier est écrit) corrige les trois axes : prix résolu serveur
-- (`_resolve_combo_price_v1`), `combo_components` persisté,
-- `modifier_ingredients_deducted` résolu (`_resolve_combo_modifier_ingredients_v1`),
-- plus le rattrapage `p_tolerate_unsellable` sur l'échec de résolution de prix.
--
-- Ce fichier est écrit AVANT la migration v9 : il est ROUGE contre le corps
-- actuel (v9 n'existe pas — `function does not exist`). Il est destiné à être
-- rejoué par l'orchestrateur une fois v9 livrée. Les DO blocks qui appellent
-- create_tablet_order_v9 / pickup_tablet_order / pay_existing_order_v19
-- capturent l'exception dans un GUC pour que le fichier aille jusqu'à
-- `finish()` même si une étape casse — diagnostic complet en un seul passage,
-- pas un abort de transaction à la première ligne qui manque.
--
-- Fixture : profil unique porteur de `sales.create` ET `payments.process`
-- (miroir combo_fire_pay.test.sql : un seul acteur fire+paie). Combo
-- `…cd001` (combo_base_price 40000), composants Regular `…fd001` (surcharge
-- 0, défaut), Large `…fd002` (surcharge 8000), Water `…fd003` (surcharge 0,
-- défaut) — groupes Size/Drink (single, requis, min1/max1). Un produit hors
-- combo `…fd099` sert de composant INVALIDE (jamais ajouté à
-- combo_group_options). Un ingrédient `…fd010` (Ice Cubes) est rattaché à un
-- modificateur "Temp/Iced" sur le composant Large (price_adjustment 0,
-- ingredients_to_deduct 5 pcs) pour exercer réellement
-- _resolve_combo_modifier_ingredients_v1 (pas seulement affirmer IS NULL).
--
-- category_id réutilisé : '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a' (même
-- catégorie que combo_fire_pay.test.sql / combo_server_pricing.test.sql —
-- déjà résolue pour dispatch_stations par les RPCs de commande).
--
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(16);

-- ===========================================================================
-- Fixture
-- ===========================================================================
DO $fixture$
DECLARE
  v_actor_uid  UUID;
  v_actor_pid  UUID;
  v_sess       UUID := gen_random_uuid();
  v_cat        UUID := '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a';
BEGIN
  SELECT up.auth_user_id, up.id INTO v_actor_uid, v_actor_pid
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'sales.create')
     AND has_permission(up.auth_user_id, 'payments.process')
   LIMIT 1;
  IF v_actor_uid IS NULL THEN
    RAISE EXCEPTION 'fixture: aucun profil avec sales.create ET payments.process';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor_uid)::text, true);

  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_actor_pid, closing_cash=0
   WHERE opened_by = v_actor_pid AND status='open';
  INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
    VALUES (v_sess, v_actor_pid, 0, 'open');

  INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, combo_base_price) VALUES
    ('00000000-0000-0000-0000-0000000cd001','TCFP-CB',  'TCFP Combo',    v_cat, 0,     'combo',    0,   false, 40000),
    ('00000000-0000-0000-0000-0000000fd001','TCFP-F1',  'TCFP Regular',  v_cat, 15000, 'finished', 100, true,  NULL),
    ('00000000-0000-0000-0000-0000000fd002','TCFP-F2',  'TCFP Large',    v_cat, 15000, 'finished', 100, true,  NULL),
    ('00000000-0000-0000-0000-0000000fd003','TCFP-F3',  'TCFP Water',    v_cat, 10000, 'finished', 100, true,  NULL),
    ('00000000-0000-0000-0000-0000000fd099','TCFP-F99', 'TCFP Outsider', v_cat, 5000,  'finished', 50,  true,  NULL),
    ('00000000-0000-0000-0000-0000000fd010','TCFP-ICE', 'TCFP Ice Cubes',v_cat, 1000,  'finished', 50,  true,  NULL);

  -- Size (single, requis, min1/max1) : Regular surcharge 0 (défaut), Large surcharge 8000.
  -- Drink (single, requis, min1/max1) : Water surcharge 0 (défaut).
  INSERT INTO combo_groups (id, combo_product_id, name, group_type, is_required, min_select, max_select, sort_order) VALUES
    ('00000000-0000-0000-0000-0000000c1001','00000000-0000-0000-0000-0000000cd001','Size', 'single',true,1,1,0),
    ('00000000-0000-0000-0000-0000000c1002','00000000-0000-0000-0000-0000000cd001','Drink','single',true,1,1,1);
  INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default, sort_order) VALUES
    ('00000000-0000-0000-0000-0000000c1001','00000000-0000-0000-0000-0000000fd001',0,   true,  0),
    ('00000000-0000-0000-0000-0000000c1001','00000000-0000-0000-0000-0000000fd002',8000,false, 1),
    ('00000000-0000-0000-0000-0000000c1002','00000000-0000-0000-0000-0000000fd003',0,   true,  0);
  -- `…fd099` n'est délibérément AJOUTÉ à AUCUN groupe : composant invalide pour T6/T7.

  -- Modificateur du COMPOSANT Large (ADR-017 : résolu contre le composant,
  -- jamais contre le combo). group_required=false pour rester un fixture
  -- simple (pas de garde ADR-017 D2 "réponse requise" à satisfaire ici).
  INSERT INTO product_modifiers (
    product_id, group_name, group_required, group_type, option_label,
    price_adjustment, is_default, is_active, ingredients_to_deduct
  ) VALUES (
    '00000000-0000-0000-0000-0000000fd002', 'Temp', false, 'single_select', 'Iced',
    0, false, true,
    jsonb_build_array(jsonb_build_object(
      'product_id', '00000000-0000-0000-0000-0000000fd010', 'qty', 5, 'unit', 'pcs'))
  );

  PERFORM set_config('tcfp.actor_uid', v_actor_uid::text, false);
  PERFORM set_config('tcfp.actor_pid', v_actor_pid::text, false);
  PERFORM set_config('tcfp.sess',      v_sess::text,      false);
END $fixture$;

-- ===========================================================================
-- T1-T5 — chemin nominal : create_tablet_order_v9 -> pickup_tablet_order ->
-- pay_existing_order_v19. Un combo Large+Water avec le composant Large portant
-- un modificateur Iced rattaché à un ingrédient.
-- ===========================================================================
DO $happy$
DECLARE
  v_order_id UUID;
  v_msg      TEXT := '';
  v_items    JSONB := jsonb_build_array(jsonb_build_object(
    'product_id', '00000000-0000-0000-0000-0000000cd001',
    'quantity', 1,
    'unit_price', 40000,
    'modifiers', jsonb_build_array(
      jsonb_build_object('group_name','Size','option_label','Large','price_adjustment',8000),
      jsonb_build_object('group_name','Drink','option_label','Water','price_adjustment',0)
    ),
    'combo_components', jsonb_build_array(
      jsonb_build_object('product_id','00000000-0000-0000-0000-0000000fd002','quantity',1,
        'modifiers', jsonb_build_array(
          jsonb_build_object('group_name','Temp','option_label','Iced','price_adjustment',0))),
      jsonb_build_object('product_id','00000000-0000-0000-0000-0000000fd003','quantity',1)
    )
  ));
BEGIN
  BEGIN
    v_order_id := create_tablet_order_v9(
      p_client_uuid  := '00000000-0000-0000-0000-0000000ca001'::uuid,
      p_waiter_id    := current_setting('tcfp.actor_pid')::uuid,
      p_table_number := '',
      p_order_type   := 'take_out'::order_type,
      p_items        := v_items,
      p_source_code  := 'T1'
    );
    PERFORM pickup_tablet_order(v_order_id, current_setting('tcfp.sess')::uuid);
    PERFORM pay_existing_order_v19(
      p_order_id := v_order_id,
      p_payment  := '{"method":"cash","amount":48000,"cash_received":48000,"change_given":0}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM set_config('tcfp.order1',      COALESCE(v_order_id::text, '00000000-0000-0000-0000-000000000000'), false);
  PERFORM set_config('tcfp.order1_pass', (v_order_id IS NOT NULL AND v_msg = '')::text, false);
  PERFORM set_config('tcfp.order1_msg',  v_msg, false);
END $happy$;

SELECT ok(
  current_setting('tcfp.order1_pass')::boolean
  AND (SELECT combo_components IS NOT NULL FROM order_items
        WHERE order_id = current_setting('tcfp.order1')::uuid
          AND product_id = '00000000-0000-0000-0000-0000000cd001'),
  'T1: create_tablet_order_v9 persiste combo_components (NULL sous v8, le P0) - recu: ' || current_setting('tcfp.order1_msg'));

SELECT is(
  (SELECT unit_price::int FROM order_items
    WHERE order_id = current_setting('tcfp.order1')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000cd001'),
  48000, 'T2a: unit_price resolu serveur = base 40000 + surcharge Large 8000 (pas le prix client seul)');

SELECT is(
  (SELECT line_total::int FROM order_items
    WHERE order_id = current_setting('tcfp.order1')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000cd001'),
  48000, 'T2b: line_total = unit_price resolu x quantite');

-- Decision 4 du lot D : les modificateurs de LIGNE d'un combo gardent leurs
-- libelles (trace cuisine) mais leur price_adjustment est force a 0 — la
-- surcharge Large est deja dans le prix resolu, jamais comptee deux fois.
SELECT ok(
  (SELECT jsonb_array_length(modifiers) = 2
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(modifiers) m
         WHERE (m->>'price_adjustment')::numeric <> 0)
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(modifiers) m
         WHERE m->>'option_label' = 'Large')
     FROM order_items
    WHERE order_id = current_setting('tcfp.order1')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000cd001'),
  'T2c: les modificateurs de ligne du combo gardent leurs libelles avec price_adjustment 0 (pas de double comptage de la surcharge)');

SELECT ok(
  (SELECT jsonb_array_length(modifier_ingredients_deducted) = 1
     AND (modifier_ingredients_deducted->0->>'product_id') = '00000000-0000-0000-0000-0000000fd010'
     AND (modifier_ingredients_deducted->0->>'qty_base')::numeric = 5
   FROM order_items
    WHERE order_id = current_setting('tcfp.order1')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000cd001'),
  'T3: modifier_ingredients_deducted resout l''ingredient du modificateur Iced du COMPOSANT Large (NULL sous v8, le P0)');

SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fd002'), 99,
  'T4a: composant Large deduit -1 au paiement (100 sous v8, le P0 — modifier_ingredients_deducted/combo_components NULL)');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fd003'), 99,
  'T4b: composant Water deduit -1 au paiement');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fd010'), 45,
  'T4c: ingredient Ice Cubes du modificateur de composant deduit -5 au paiement');

SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000cd001'), 0,
  'T5a: le produit combo lui-meme reste a 0 (stock virtuel, jamais deduit)');
SELECT is(
  (SELECT count(*)::int FROM stock_movements
    WHERE product_id = '00000000-0000-0000-0000-0000000cd001'
      AND reference_id = current_setting('tcfp.order1')::uuid),
  0, 'T5b: aucun stock_movements sur le produit combo pour cette commande');

-- ===========================================================================
-- T6 — composant invalide (jamais ajoute a un groupe), p_tolerate_unsellable
-- par defaut (false) -> refus check_violation.
-- ===========================================================================
SELECT throws_ok(
  $q$ SELECT create_tablet_order_v9(
        p_client_uuid  := '00000000-0000-0000-0000-0000000ca006'::uuid,
        p_waiter_id    := current_setting('tcfp.actor_pid')::uuid,
        p_table_number := '',
        p_order_type   := 'take_out'::order_type,
        p_items        := jsonb_build_array(jsonb_build_object(
          'product_id','00000000-0000-0000-0000-0000000cd001','quantity',1,'unit_price',40000,
          'modifiers','[]'::jsonb,
          'combo_components', jsonb_build_array(
            jsonb_build_object('product_id','00000000-0000-0000-0000-0000000fd099','quantity',1))))
      ) $q$,
  '23514', NULL,
  'T6: composant hors groupes -> combo_invalid_component (check_violation), p_tolerate_unsellable=false');

-- ===========================================================================
-- T7 — meme composant invalide, p_tolerate_unsellable=true : _resolve_combo_price_v1
-- est rattrape, le prix client est conserve, et l'evenement laisse une trace.
-- ===========================================================================
DO $tolerate$
DECLARE
  v_order_id UUID;
  v_msg      TEXT := '';
BEGIN
  BEGIN
    v_order_id := create_tablet_order_v9(
      p_client_uuid  := '00000000-0000-0000-0000-0000000ca007'::uuid,
      p_waiter_id    := current_setting('tcfp.actor_pid')::uuid,
      p_table_number := '',
      p_order_type   := 'take_out'::order_type,
      p_items        := jsonb_build_array(jsonb_build_object(
        'product_id','00000000-0000-0000-0000-0000000cd001','quantity',1,'unit_price',40000,
        'modifiers','[]'::jsonb,
        'combo_components', jsonb_build_array(
          jsonb_build_object('product_id','00000000-0000-0000-0000-0000000fd099','quantity',1)))),
      p_tolerate_unsellable := true
    );
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM set_config('tcfp.order7',      COALESCE(v_order_id::text, '00000000-0000-0000-0000-000000000000'), false);
  PERFORM set_config('tcfp.order7_pass', (v_order_id IS NOT NULL AND v_msg = '')::text, false);
  PERFORM set_config('tcfp.order7_msg',  v_msg, false);
END $tolerate$;

SELECT ok(current_setting('tcfp.order7_pass')::boolean,
  'T7a: p_tolerate_unsellable=true rattrape l''echec de _resolve_combo_price_v1 - recu: ' || current_setting('tcfp.order7_msg'));

SELECT is(
  (SELECT unit_price::int FROM order_items
    WHERE order_id = current_setting('tcfp.order7')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000cd001'),
  40000, 'T7b: prix client (40000) conserve quand la resolution serveur est rattrapee');

SELECT ok(
  EXISTS (SELECT 1 FROM audit_logs
           WHERE action = 'order.combo_price_tolerated'
             AND entity_type = 'orders'
             AND entity_id = current_setting('tcfp.order7')::uuid
             AND (metadata->>'product_id') = '00000000-0000-0000-0000-0000000cd001'
             AND (metadata->>'client_uuid') = '00000000-0000-0000-0000-0000000ca007'
             AND (metadata->>'rpc_version') = 'tablet_v9'),
  'T7c: audit_logs order.combo_price_tolerated trace la tolerance (product_id, client_uuid, rpc_version tablet_v9)');

-- ===========================================================================
-- T8/T9 — versionnage monotone + defense-in-depth anon.
-- ===========================================================================
SELECT hasnt_function('public', 'create_tablet_order_v8',
  'T8: create_tablet_order_v8 est droppee (versionnage monotone)');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.create_tablet_order_v9(uuid,uuid,text,order_type,jsonb,text,uuid,boolean,text)', 'EXECUTE'),
  'T9: anon n''a pas EXECUTE sur create_tablet_order_v9');

SELECT * FROM finish();
ROLLBACK;
