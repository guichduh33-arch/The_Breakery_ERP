-- supabase/tests/counter_combo_server_price.test.sql
--
-- Audit lot 1 du 2026-08-31, volet « prix » du P0 n°6
-- (docs/audits/2026-08-31-audit-pos-flow.md) — décision 6 de Mamat du
-- 2026-09-05 : `fire_counter_order` price les combos serveur, dans un lot
-- séparé après le lot tablette, avec sa conception de replay dégradé.
--
-- `fire_counter_order_v7` prenait `unit_price` tel quel du client et ne
-- consultait jamais `_resolve_combo_price_v1` : ni les groupes de composants,
-- ni les surcharges, ni les ajustements des modificateurs de composants
-- (ADR-017) n'étaient exigés serveur. Sonde enregistrée sur le corps live de v7
-- le 2026-09-06 (transaction annulée), même fixture que ci-dessous :
-- unit_price 40000, line_total 48000 (l'ajustement Iced +2000 du composant est
-- perdu alors que la caisse facture 50000), composant hors de tout groupe
-- accepté, `pay_existing_order_v20(cash 50000)` refusé (« Sum of tender
-- amounts (50000.00) != order total (48000.00) »).
--
-- Ce fichier est écrit AVANT la migration v8 : il est ROUGE contre le corps
-- actuel (v8 n'existe pas). Les DO blocks capturent l'exception dans un GUC
-- pour que le fichier aille jusqu'à `finish()` — diagnostic complet en un
-- passage.
--
-- Fixture : profil unique porteur de `pos.sale.create` ET `payments.process`
-- (miroir combo_fire_pay.test.sql : un seul acteur fire+paie). Combo `…e5001`
-- (combo_base_price 40000), composants Regular `…e5f01` (surcharge 0, défaut),
-- Large `…e5f02` (surcharge 8000), Water `…e5f03` (surcharge 0, défaut) —
-- groupes Size/Drink (single, requis, min1/max1). `…e5f99` n'est ajouté à
-- AUCUN groupe : composant invalide. Modificateur Temp/Iced sur le composant
-- Large : price_adjustment 2000 (pour que le prix résolu diffère de base +
-- surcharge) et ingrédient `…e5f10` (Ice) 5 pcs pour exercer
-- _resolve_combo_modifier_ingredients_v1.
--
-- Format wire du COMPTOIR (useFireToStations / ComboConfigModal.onConfirm) :
-- `unit_price` = base, surcharges d'options dans `modifiers[].price_adjustment`,
-- modificateurs de composants dans `combo_components[].modifiers`. La caisse
-- facture `lineUnitEach` = 40000 + 8000 + 0 + 2000 = 50000.
--
-- category_id réutilisé : '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a' (même
-- catégorie que combo_fire_pay.test.sql / tablet_combo_fire_pay.test.sql).
--
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

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
     AND has_permission(up.auth_user_id, 'pos.sale.create')
     AND has_permission(up.auth_user_id, 'payments.process')
   LIMIT 1;
  IF v_actor_uid IS NULL THEN
    RAISE EXCEPTION 'fixture: aucun profil avec pos.sale.create ET payments.process';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor_uid)::text, true);

  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_actor_pid, closing_cash=0
   WHERE opened_by = v_actor_pid AND status='open';
  INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
    VALUES (v_sess, v_actor_pid, 0, 'open');

  INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, combo_base_price) VALUES
    ('00000000-0000-0000-0000-0000000e5001','CCSP-CB',  'CCSP Combo',    v_cat, 0,     'combo',    0,   false, 40000),
    ('00000000-0000-0000-0000-0000000e5f01','CCSP-F1',  'CCSP Regular',  v_cat, 15000, 'finished', 100, true,  NULL),
    ('00000000-0000-0000-0000-0000000e5f02','CCSP-F2',  'CCSP Large',    v_cat, 15000, 'finished', 100, true,  NULL),
    ('00000000-0000-0000-0000-0000000e5f03','CCSP-F3',  'CCSP Water',    v_cat, 10000, 'finished', 100, true,  NULL),
    ('00000000-0000-0000-0000-0000000e5f99','CCSP-F99', 'CCSP Outsider', v_cat, 5000,  'finished', 50,  true,  NULL),
    ('00000000-0000-0000-0000-0000000e5f10','CCSP-ICE', 'CCSP Ice Cubes',v_cat, 1000,  'finished', 50,  true,  NULL);

  -- Size (single, requis, min1/max1) : Regular surcharge 0 (défaut), Large surcharge 8000.
  -- Drink (single, requis, min1/max1) : Water surcharge 0 (défaut).
  INSERT INTO combo_groups (id, combo_product_id, name, group_type, is_required, min_select, max_select, sort_order) VALUES
    ('00000000-0000-0000-0000-0000000e5a01','00000000-0000-0000-0000-0000000e5001','Size', 'single',true,1,1,0),
    ('00000000-0000-0000-0000-0000000e5a02','00000000-0000-0000-0000-0000000e5001','Drink','single',true,1,1,1);
  INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default, sort_order) VALUES
    ('00000000-0000-0000-0000-0000000e5a01','00000000-0000-0000-0000-0000000e5f01',0,   true,  0),
    ('00000000-0000-0000-0000-0000000e5a01','00000000-0000-0000-0000-0000000e5f02',8000,false, 1),
    ('00000000-0000-0000-0000-0000000e5a02','00000000-0000-0000-0000-0000000e5f03',0,   true,  0);
  -- `…e5f99` n'est délibérément AJOUTÉ à AUCUN groupe : composant invalide (T6/T8).

  -- Modificateur du COMPOSANT Large (ADR-017 : résolu contre le composant,
  -- jamais contre le combo). price_adjustment 2000 : c'est lui que v7 perdait.
  INSERT INTO product_modifiers (
    product_id, group_name, group_required, group_type, option_label,
    price_adjustment, is_default, is_active, ingredients_to_deduct
  ) VALUES (
    '00000000-0000-0000-0000-0000000e5f02', 'Temp', false, 'single_select', 'Iced',
    2000, false, true,
    jsonb_build_array(jsonb_build_object(
      'product_id', '00000000-0000-0000-0000-0000000e5f10', 'qty', 5, 'unit', 'pcs'))
  );

  PERFORM set_config('ccsp.actor_uid', v_actor_uid::text, false);
  PERFORM set_config('ccsp.actor_pid', v_actor_pid::text, false);
  PERFORM set_config('ccsp.sess',      v_sess::text,      false);
END $fixture$;

-- Ligne combo telle que la caisse l'envoie : base en unit_price, surcharge
-- Large dans les modificateurs de ligne, Iced sur le composant Large.
CREATE OR REPLACE FUNCTION pg_temp.ccsp_combo_line() RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(jsonb_build_object(
    'product_id', '00000000-0000-0000-0000-0000000e5001',
    'quantity', 1,
    'unit_price', 40000,
    'modifiers', jsonb_build_array(
      jsonb_build_object('group_name','Size','option_label','Large','price_adjustment',8000),
      jsonb_build_object('group_name','Drink','option_label','Water','price_adjustment',0)
    ),
    'combo_components', jsonb_build_array(
      jsonb_build_object('product_id','00000000-0000-0000-0000-0000000e5f02','quantity',1,
        'modifiers', jsonb_build_array(
          jsonb_build_object('group_name','Temp','option_label','Iced','price_adjustment',2000))),
      jsonb_build_object('product_id','00000000-0000-0000-0000-0000000e5f03','quantity',1)
    )
  ));
$$;

-- ===========================================================================
-- T1-T3 — fire en ligne : le prix est résolu serveur, les colonnes de
-- déstockage sont persistées.
-- ===========================================================================
DO $fire$
DECLARE
  r     JSONB;
  v_msg TEXT := '';
BEGIN
  BEGIN
    r := fire_counter_order_v8(
      p_client_uuid := '00000000-0000-0000-0000-0000000e5c01'::uuid,
      p_session_id  := current_setting('ccsp.sess')::uuid,
      p_items       := pg_temp.ccsp_combo_line(),
      p_order_type  := 'take_out'::order_type
    );
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM set_config('ccsp.order1',      COALESCE(r->>'order_id', '00000000-0000-0000-0000-000000000000'), false);
  PERFORM set_config('ccsp.order1_pass', ((r->>'order_id') IS NOT NULL AND v_msg = '')::text, false);
  PERFORM set_config('ccsp.order1_msg',  v_msg, false);
END $fire$;

SELECT ok(
  current_setting('ccsp.order1_pass')::boolean
  AND (SELECT combo_components IS NOT NULL FROM order_items
        WHERE order_id = current_setting('ccsp.order1')::uuid
          AND product_id = '00000000-0000-0000-0000-0000000e5001'),
  'T1: fire_counter_order_v8 accepte un combo valide et persiste combo_components - recu: ' || current_setting('ccsp.order1_msg'));

SELECT is(
  (SELECT unit_price::int FROM order_items
    WHERE order_id = current_setting('ccsp.order1')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000e5001'),
  50000, 'T2a: unit_price resolu serveur = base 40000 + surcharge Large 8000 + Iced 2000 (40000 sous v7, le prix client)');

SELECT is(
  (SELECT line_total::int FROM order_items
    WHERE order_id = current_setting('ccsp.order1')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000e5001'),
  50000, 'T2b: line_total = prix resolu x quantite = ce que la caisse facture (48000 sous v7 : l''ajustement du composant etait perdu)');

-- Miroir de _resolve_line_price_v2 (p_combo) : les modificateurs de LIGNE
-- gardent leurs libelles (trace cuisine) mais price_adjustment est force a 0 —
-- la surcharge Large est deja dans le prix resolu, jamais comptee deux fois.
SELECT ok(
  (SELECT jsonb_array_length(modifiers) = 2
      AND modifiers_total = 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(modifiers) m
         WHERE (m->>'price_adjustment')::numeric <> 0)
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(modifiers) m
         WHERE m->>'option_label' = 'Large')
     FROM order_items
    WHERE order_id = current_setting('ccsp.order1')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000e5001'),
  'T2c: les modificateurs de ligne du combo gardent leurs libelles avec price_adjustment 0 et modifiers_total 0 (8000 sous v7)');

SELECT ok(
  (SELECT jsonb_array_length(modifier_ingredients_deducted) = 1
     AND (modifier_ingredients_deducted->0->>'product_id') = '00000000-0000-0000-0000-0000000e5f10'
     AND (modifier_ingredients_deducted->0->>'qty_base')::numeric = 5
   FROM order_items
    WHERE order_id = current_setting('ccsp.order1')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000e5001'),
  'T3: modifier_ingredients_deducted resout l''ingredient du modificateur Iced du COMPOSANT Large (inchange depuis v7)');

-- ===========================================================================
-- T4-T5 — le paiement au montant affiche par la caisse (50000) passe, et
-- destocke composants + ingredient du modificateur de composant.
-- ===========================================================================
DO $pay$
DECLARE v_msg TEXT := '';
BEGIN
  BEGIN
    PERFORM pay_existing_order_v20(
      p_order_id := current_setting('ccsp.order1')::uuid,
      p_payment  := '{"method":"cash","amount":50000,"cash_received":50000,"change_given":0}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM set_config('ccsp.pay1_pass', (v_msg = '')::text, false);
  PERFORM set_config('ccsp.pay1_msg',  v_msg, false);
END $pay$;

SELECT ok(current_setting('ccsp.pay1_pass')::boolean,
  'T4: pay_existing_order_v20(cash 50000) accepte le montant facture par la caisse (refuse sous v7 : total 48000) - recu: ' || current_setting('ccsp.pay1_msg'));

SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000e5f02'), 99,
  'T5a: composant Large deduit -1 au paiement');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000e5f03'), 99,
  'T5b: composant Water deduit -1 au paiement');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000e5f10'), 45,
  'T5c: ingredient Ice Cubes du modificateur de composant deduit -5 au paiement');
SELECT is(
  (SELECT count(*)::int FROM stock_movements
    WHERE product_id = '00000000-0000-0000-0000-0000000e5001'
      AND reference_id = current_setting('ccsp.order1')::uuid),
  0, 'T5d: aucun stock_movements sur le produit combo lui-meme (stock virtuel)');

-- ===========================================================================
-- T6/T7 — en ligne (p_tolerate_unsellable par defaut), la resolution serveur
-- refuse : composant hors groupes, groupe requis sans reponse. Sous v7 les
-- deux passaient en silence.
-- ===========================================================================
SELECT throws_ok(
  $q$ SELECT fire_counter_order_v8(
        p_client_uuid := '00000000-0000-0000-0000-0000000e5c06'::uuid,
        p_session_id  := current_setting('ccsp.sess')::uuid,
        p_items       := jsonb_build_array(jsonb_build_object(
          'product_id','00000000-0000-0000-0000-0000000e5001','quantity',1,'unit_price',40000,
          'modifiers','[]'::jsonb,
          'combo_components', jsonb_build_array(
            jsonb_build_object('product_id','00000000-0000-0000-0000-0000000e5f99','quantity',1)))),
        p_order_type  := 'take_out'::order_type
      ) $q$,
  '23514', NULL,
  'T6: composant hors groupes -> combo_invalid_component (check_violation), p_tolerate_unsellable=false');

SELECT throws_ok(
  $q$ SELECT fire_counter_order_v8(
        p_client_uuid := '00000000-0000-0000-0000-0000000e5c07'::uuid,
        p_session_id  := current_setting('ccsp.sess')::uuid,
        p_items       := jsonb_build_array(jsonb_build_object(
          'product_id','00000000-0000-0000-0000-0000000e5001','quantity',1,'unit_price',40000,
          'modifiers','[]'::jsonb,
          'combo_components', jsonb_build_array(
            jsonb_build_object('product_id','00000000-0000-0000-0000-0000000e5f02','quantity',1)))),
        p_order_type  := 'take_out'::order_type
      ) $q$,
  '23514', NULL,
  'T7: groupe requis Drink sans reponse -> combo_group_violation (check_violation)');

-- ===========================================================================
-- T8 — replay degrade : meme composant invalide, p_tolerate_unsellable=true.
-- L'echec de _resolve_combo_price_v1 est rattrape et la ligne est facturee ce
-- que la caisse a facture : unit_price client 40000 + surcharge de ligne 8000
-- + ajustement du modificateur de composant 2000 = 50000 (lineUnitEach) —
-- l'encaissement en file porte exactement ce montant.
-- ===========================================================================
DO $tolerate$
DECLARE
  r     JSONB;
  v_msg TEXT := '';
BEGIN
  BEGIN
    r := fire_counter_order_v8(
      p_client_uuid := '00000000-0000-0000-0000-0000000e5c08'::uuid,
      p_session_id  := current_setting('ccsp.sess')::uuid,
      p_items       := jsonb_build_array(jsonb_build_object(
        'product_id','00000000-0000-0000-0000-0000000e5001','quantity',1,'unit_price',40000,
        'modifiers', jsonb_build_array(
          jsonb_build_object('group_name','Size','option_label','Large','price_adjustment',8000)),
        'combo_components', jsonb_build_array(
          jsonb_build_object('product_id','00000000-0000-0000-0000-0000000e5f99','quantity',1,
            'modifiers', jsonb_build_array(
              jsonb_build_object('group_name','Temp','option_label','Iced','price_adjustment',2000)))))),
      p_order_type  := 'take_out'::order_type,
      p_tolerate_unsellable := true
    );
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM set_config('ccsp.order8',      COALESCE(r->>'order_id', '00000000-0000-0000-0000-000000000000'), false);
  PERFORM set_config('ccsp.order8_pass', ((r->>'order_id') IS NOT NULL AND v_msg = '')::text, false);
  PERFORM set_config('ccsp.order8_msg',  v_msg, false);
END $tolerate$;

SELECT ok(current_setting('ccsp.order8_pass')::boolean,
  'T8a: p_tolerate_unsellable=true rattrape l''echec de _resolve_combo_price_v1 - recu: ' || current_setting('ccsp.order8_msg'));

SELECT ok(
  (SELECT unit_price = 50000 AND line_total = 50000 AND modifiers_total = 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(modifiers) m
         WHERE (m->>'price_adjustment')::numeric <> 0)
     FROM order_items
    WHERE order_id = current_setting('ccsp.order8')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000e5001'),
  'T8b: replay degrade facture ce que la caisse a facture (40000 + 8000 + 2000 = 50000), modificateurs de ligne neutralises');

SELECT ok(
  EXISTS (SELECT 1 FROM audit_logs
           WHERE action = 'order.combo_price_tolerated'
             AND entity_type = 'orders'
             AND entity_id = current_setting('ccsp.order8')::uuid
             AND (metadata->>'product_id') = '00000000-0000-0000-0000-0000000e5001'
             AND (metadata->>'client_uuid') = '00000000-0000-0000-0000-0000000e5c08'
             AND (metadata->>'rpc_version') = 'fire_v8'
             AND (metadata->>'client_unit_price')::numeric = 40000
             AND (metadata->>'tolerated_unit_price')::numeric = 50000
             AND (metadata->>'sqlstate') = '23514'),
  'T8c: audit_logs order.combo_price_tolerated trace la tolerance (product_id, client_uuid, rpc_version fire_v8, prix client et tolere, sqlstate)');

-- ===========================================================================
-- T9 — garde de non-regression : une ligne NON combo garde le prix client et
-- ses modificateurs de ligne payants (le pricing serveur des lignes simples
-- n'est pas dans ce lot).
-- ===========================================================================
DO $plain$
DECLARE
  r     JSONB;
  v_msg TEXT := '';
BEGIN
  BEGIN
    r := fire_counter_order_v8(
      p_client_uuid := '00000000-0000-0000-0000-0000000e5c09'::uuid,
      p_session_id  := current_setting('ccsp.sess')::uuid,
      p_items       := jsonb_build_array(jsonb_build_object(
        'product_id','00000000-0000-0000-0000-0000000e5f01','quantity',2,'unit_price',15000,
        'modifiers', jsonb_build_array(
          jsonb_build_object('group_name','Extra','option_label','Cheese','price_adjustment',1000)))),
      p_order_type  := 'take_out'::order_type
    );
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM set_config('ccsp.order9',      COALESCE(r->>'order_id', '00000000-0000-0000-0000-000000000000'), false);
  PERFORM set_config('ccsp.order9_msg',  v_msg, false);
END $plain$;

SELECT ok(
  (SELECT unit_price = 15000 AND modifiers_total = 2000 AND line_total = 32000
      AND combo_components IS NULL
     FROM order_items
    WHERE order_id = current_setting('ccsp.order9')::uuid
      AND product_id = '00000000-0000-0000-0000-0000000e5f01'),
  'T9: ligne non combo inchangee — prix client 15000, modificateur +1000 x 2, line_total 32000 - recu: ' || current_setting('ccsp.order9_msg'));

-- ===========================================================================
-- T10/T11 — versionnage monotone + defense-in-depth anon.
-- ===========================================================================
SELECT hasnt_function('public', 'fire_counter_order_v7',
  'T10: fire_counter_order_v7 est droppee (versionnage monotone)');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.fire_counter_order_v8(uuid,uuid,jsonb,uuid,text,order_type,uuid,boolean,text)', 'EXECUTE'),
  'T11: anon n''a pas EXECUTE sur fire_counter_order_v8');

SELECT * FROM finish();
ROLLBACK;
