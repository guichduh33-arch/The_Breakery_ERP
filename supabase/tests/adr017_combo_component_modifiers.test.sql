-- supabase/tests/adr017_combo_component_modifiers.test.sql
-- ADR-017 décision 3 — le prix d'un combo intègre les ajustements des
-- modificateurs de ses composants, résolus SERVEUR.
-- ADR-017 décision 2 (activée le 2026-07-31, migration 20260731000001) — un
-- groupe requis d'un composant retenu sans réponse est refusé.
--
-- Fixture autonome (aucune dépendance aux données de dev, qui bougent) :
--   combo A17-CB (base 50 000)
--     groupe « plate »  → composant A17-P (plat, sans modificateur)
--     groupe « drink »  → composant A17-D (boisson), surcharge d'option 5 000
--         product_modifiers scope PRODUIT   : Milk / Oat   = +10 000  (actif)
--                                             Milk / Fresh = 0        (actif)
--                                             Milk / Retire= +3 000   (INACTIF)
--         product_modifiers scope CATEGORIE : Cup / Large  = +2 000   (actif)
--
-- Le couple T5/T6 est le garde-fou du prix : un ajustement introuvable ou
-- inactif est un refus, jamais un silence à 0.
--
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID; v_cat UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no user_profiles row with pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;
  PERFORM set_config('a17.sess', v_sess::text, true);

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL ORDER BY id LIMIT 1;
  PERFORM set_config('a17.cat', v_cat::text, true);
END $$;

INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, combo_base_price, is_display_item)
VALUES
  ('00000000-0000-0000-0000-00000a17c0b1','A17-CB','A17 Combo', current_setting('a17.cat')::uuid, 0,     'combo',    0,   false, 50000, false),
  ('00000000-0000-0000-0000-00000a17f001','A17-P', 'A17 Plate', current_setting('a17.cat')::uuid, 20000, 'finished', 100, true,  NULL,  false),
  ('00000000-0000-0000-0000-00000a17f002','A17-D', 'A17 Drink', current_setting('a17.cat')::uuid, 30000, 'finished', 100, true,  NULL,  false),
  -- Ingrédient consommé par l'option « Oat » : c'est lui qui doit sortir du stock.
  -- product_type n'admet que 'finished' ou 'combo' ; une matière est un
  -- 'finished' suivi en stock, pas un type à part.
  ('00000000-0000-0000-0000-00000a17f003','A17-M', 'A17 Milk',  current_setting('a17.cat')::uuid, 0,     'finished', 5000,true,  NULL,  false);
UPDATE products SET unit = 'ml' WHERE id = '00000000-0000-0000-0000-00000a17f003';

INSERT INTO combo_groups (id, combo_product_id, name, group_type, is_required, min_select, max_select, sort_order) VALUES
  ('00000000-0000-0000-0000-00000a17e001','00000000-0000-0000-0000-00000a17c0b1','plate','single',true,1,1,0),
  ('00000000-0000-0000-0000-00000a17e002','00000000-0000-0000-0000-00000a17c0b1','drink','single',true,1,1,1);
INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default, sort_order) VALUES
  ('00000000-0000-0000-0000-00000a17e001','00000000-0000-0000-0000-00000a17f001',0,   true, 0),
  ('00000000-0000-0000-0000-00000a17e002','00000000-0000-0000-0000-00000a17f002',5000,true, 0);

-- Modificateurs DU COMPOSANT boisson : scope produit + un scope catégorie.
INSERT INTO product_modifiers (product_id, category_id, group_name, group_required, group_type, option_label, price_adjustment, is_active) VALUES
  ('00000000-0000-0000-0000-00000a17f002', NULL, 'Milk', true, 'single_select', 'Fresh',  0,     true),
  ('00000000-0000-0000-0000-00000a17f002', NULL, 'Milk', true, 'single_select', 'Oat',    10000, true),
  ('00000000-0000-0000-0000-00000a17f002', NULL, 'Milk', true, 'single_select', 'Retire', 3000,  false),
  (NULL, current_setting('a17.cat')::uuid,       'Cup',  false,'single_select', 'Large',  2000,  true);

-- D4 : « Oat » consomme 200 ml de A17 Milk. C'est cette sortie qui n'existait pas
-- quand la boisson était vendue dans un combo.
UPDATE product_modifiers
   SET ingredients_to_deduct = jsonb_build_array(
         jsonb_build_object('product_id','00000000-0000-0000-0000-00000a17f003','qty',200,'unit','ml'))
 WHERE product_id = '00000000-0000-0000-0000-00000a17f002'
   AND group_name = 'Milk' AND option_label = 'Oat';

-- Vente réelle : Oat (+10 000) sur la boisson d'un combo à 50 000 + 5 000 d'option.
DO $$
DECLARE v_env JSONB;
BEGIN
  v_env := complete_order_with_payment_v22(
    p_session_id := current_setting('a17.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := $items$[
      {"product_id":"00000000-0000-0000-0000-00000a17c0b1","quantity":1,"unit_price":50000,
       "modifiers":[{"group_name":"plate","option_label":"A17 Plate","price_adjustment":0},
                    {"group_name":"drink","option_label":"A17 Drink","price_adjustment":0}],
       "combo_components":[
         {"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
         {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
          "modifiers":[{"group_name":"Milk","option_label":"Oat"}]}]}
    ]$items$::jsonb,
    p_payment := '{"method":"cash","amount":65000,"cash_received":65000,"change_given":0}'::jsonb);
  PERFORM set_config('a17.order_id', v_env->>'order_id', false);
END $$;

SELECT plan(16);

-- D2 active : la boisson porte un groupe requis (Milk) — sans la clé, refus.
-- (Avant le 2026-07-31 ce même appel rendait 55000 : c'était l'état différé.)
SELECT throws_ok(
  $q$ SELECT _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1}]'::jsonb) $q$,
  '23514', NULL, 'T1 groupe requis sans cle modifiers -> refus (D2 active)');

SELECT is(
  _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[{"group_name":"Milk","option_label":"Fresh"}]}]'::jsonb),
  55000::numeric, 'T2 modificateur a 0 : prix inchange');

SELECT is(
  _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[{"group_name":"Milk","option_label":"Oat"}]}]'::jsonb),
  65000::numeric, 'T3 modificateur payant : 50000 + 5000 + 10000');

-- Le montant joint par le client n'est jamais retenu (doctrine money-path).
SELECT is(
  _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":999999}]}]'::jsonb),
  65000::numeric, 'T4 price_adjustment client falsifie ignore');

SELECT throws_ok(
  $q$ SELECT _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[{"group_name":"Milk","option_label":"Ghost"}]}]'::jsonb) $q$,
  '23514', NULL, 'T5 modificateur inconnu du composant -> check_violation');

SELECT throws_ok(
  $q$ SELECT _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[{"group_name":"Milk","option_label":"Retire"}]}]'::jsonb) $q$,
  '23514', NULL, 'T6 modificateur inactif -> check_violation (jamais un silence a 0)');

-- Le scope catégorie est résolu comme pour une ligne ordinaire.
-- (Milk répondu en plus : depuis D2 le groupe requis exige une réponse.)
SELECT is(
  _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[{"group_name":"Milk","option_label":"Fresh"},
                    {"group_name":"Cup","option_label":"Large"}]}]'::jsonb),
  57000::numeric, 'T7 modificateur de scope categorie resolu (+2000)');

-- Bout en bout : la vente facture bien le supplement.
SELECT is(
  (SELECT line_total::int FROM order_items WHERE order_id=current_setting('a17.order_id')::uuid),
  65000, 'T8 vente reelle : line_total inclut l''ajustement du composant');

SELECT is(
  (SELECT combo_components->1->'modifiers'->0->>'option_label'
     FROM order_items WHERE order_id=current_setting('a17.order_id')::uuid),
  'Oat', 'T9 le choix est persiste sur la composition de la ligne');

-- ── ADR-017 D4 : la matière sort vraiment du stock ────────────────────────────
SELECT is(
  (SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-00000a17f003'),
  4800, 'T10 les 200 ml de l''ingredient du modificateur sont deduits (5000 -> 4800)');

-- Le snapshot est ce que void_order, refund_order et pay_existing_order relisent
-- pour restituer : s'il est vide, la matière sort sans jamais revenir.
SELECT is(
  (SELECT jsonb_array_length(modifier_ingredients_deducted)
     FROM order_items WHERE order_id=current_setting('a17.order_id')::uuid),
  1, 'T11 le snapshot de restitution est renseigne sur une ligne combo');

SELECT is(
  (SELECT modifier_ingredients_deducted->0->>'option_label'
     FROM order_items WHERE order_id=current_setting('a17.order_id')::uuid),
  'Oat', 'T12 le snapshot nomme l''option qui a consomme la matiere');

-- ── ADR-017 D2 (activée 2026-07-31) : groupes requis exigés serveur ──────────
-- Une clé présente mais vide ne répond pas au groupe requis.
SELECT throws_ok(
  $q$ SELECT _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[]}]'::jsonb) $q$,
  '23514', NULL, 'T13 cle modifiers vide sur groupe requis -> refus');

-- Le composant SANS groupe requis (plate) passe toujours sans la clé :
-- la rétro-compatibilité ne meurt que pour les composants à groupe requis.
SELECT is(
  _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[{"group_name":"Milk","option_label":"Fresh"}]}]'::jsonb),
  55000::numeric, 'T14 composant sans groupe requis : toujours accepte sans cle');

-- Scope catégorie : un groupe requis hérité de la catégorie (fallback
-- mergeGroups) exige aussi une réponse…
UPDATE product_modifiers SET group_required = true
 WHERE category_id = current_setting('a17.cat')::uuid AND group_name = 'Cup';
SELECT throws_ok(
  $q$ SELECT _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[{"group_name":"Milk","option_label":"Fresh"}]}]'::jsonb) $q$,
  '23514', NULL, 'T15 groupe requis de scope categorie sans reponse -> refus');

-- …sauf si un groupe produit actif du même nom le recouvre (le scope produit
-- prime, exactement comme mergeGroups côté domaine).
INSERT INTO product_modifiers (product_id, category_id, group_name, group_required, group_type, option_label, price_adjustment, is_active) VALUES
  ('00000000-0000-0000-0000-00000a17f001', NULL, 'Cup', false, 'single_select', 'Standard', 0, true),
  ('00000000-0000-0000-0000-00000a17f002', NULL, 'Cup', false, 'single_select', 'Standard', 0, true);
SELECT is(
  _resolve_combo_price_v1('00000000-0000-0000-0000-00000a17c0b1',
    '[{"product_id":"00000000-0000-0000-0000-00000a17f001","quantity":1},
      {"product_id":"00000000-0000-0000-0000-00000a17f002","quantity":1,
       "modifiers":[{"group_name":"Milk","option_label":"Fresh"}]}]'::jsonb),
  55000::numeric, 'T16 groupe produit non requis recouvre le groupe categorie requis');

SELECT * FROM finish();
ROLLBACK;
