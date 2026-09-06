-- supabase/tests/tablet_append_to_order.test.sql
--
-- Ajout de lignes à une commande de salle déjà envoyée (décision propriétaire
-- 2026-08-01, ADR-010 D1). `create_tablet_order_v9` porte les deux gestes :
-- création (p_order_id NULL) et ajout (p_order_id renseigné).
--
-- Ce qui se joue ici :
--   - l'ajout ne doit atteindre QUE des commandes de salle encore ouvertes ;
--     une commande payée ou née au comptoir doit refuser, sinon on sert de la
--     marchandise qui ne sera jamais facturée ;
--   - le rejeu d'une même clé ne doit pas ajouter deux fois — un double appui
--     sur une tablette en salle est la norme, pas l'exception ;
--   - un produit disparu doit LEVER, pas s'évaporer : la v4 l'avalait en
--     silence et la serveuse croyait le plat parti en cuisine.

BEGIN;
SELECT plan(9);

DO $$
DECLARE
  v_prof UUID; v_auth UUID; v_tab UUID; v_pos UUID; v_paid UUID; v_p1 UUID; v_sess UUID;
BEGIN
  SELECT up.id, up.auth_user_id INTO v_prof, v_auth FROM user_profiles up
    WHERE up.auth_user_id IS NOT NULL AND has_permission(up.auth_user_id, 'sales.create') LIMIT 1;
  IF v_prof IS NULL THEN RAISE EXCEPTION 'fixture: no user_profiles row with sales.create'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  -- ADR-022 dec. 1 : la garde de vendabilite est active sur cette RPC, le fixture doit choisir un produit vendable de facon deterministe.
  SELECT p.id INTO v_p1 FROM products p
   WHERE p.deleted_at IS NULL AND p.parent_product_id IS NULL AND p.is_active = true
     AND p.product_type <> 'combo'
     AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id AND c.is_active AND c.deleted_at IS NULL)
   LIMIT 1;
  IF v_p1 IS NULL THEN RAISE EXCEPTION 'fixture: aucun produit vendable'; END IF;
  SELECT id INTO v_sess FROM pos_sessions WHERE status = 'open' LIMIT 1;

  INSERT INTO orders (order_number, order_type, status, created_via, table_number,
                      sent_to_kitchen_at, subtotal, tax_amount, total)
    VALUES ('#A001', 'dine_in', 'pending_payment', 'tablet', '7', now(), 0, 0, 0)
    RETURNING id INTO v_tab;

  INSERT INTO orders (order_number, order_type, status, created_via, table_number,
                      session_id, sent_to_kitchen_at, subtotal, tax_amount, total)
    VALUES ('#A002', 'dine_in', 'pending_payment', 'pos', '8', v_sess, now(), 0, 0, 0)
    RETURNING id INTO v_pos;

  -- Montant réel : une commande payée à zéro fait échouer l'écriture comptable
  -- (contrainte sur les lignes de journal) — c'est le fixture qui casserait,
  -- pas la RPC testée.
  INSERT INTO orders (order_number, order_type, status, created_via, table_number,
                      sent_to_kitchen_at, subtotal, tax_amount, total, served_by)
    VALUES ('#A003', 'dine_in', 'paid', 'tablet', '9', now(), 27000, 3000, 30000, v_prof)
    RETURNING id INTO v_paid;

  PERFORM set_config('a.tab',    v_tab::text,  true);
  PERFORM set_config('a.pos',    v_pos::text,  true);
  PERFORM set_config('a.paid',   v_paid::text, true);
  PERFORM set_config('a.prod',   v_p1::text,   true);
  PERFORM set_config('a.waiter', v_prof::text, true);
END $$;

-- T1/T2 — le geste nominal.
SELECT lives_ok(format(
  $q$ SELECT create_tablet_order_v9('11111111-1111-1111-1111-111111111111'::uuid, %L::uuid, '7', 'dine_in',
      jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1, 'unit_price', 30000, 'modifiers', '[]'::jsonb)),
      NULL, %L::uuid) $q$,
  current_setting('a.waiter'), current_setting('a.prod'), current_setting('a.tab')),
  'ajout accepte sur une commande de salle pending_payment');

SELECT is(
  (SELECT count(*)::int FROM order_items WHERE order_id = current_setting('a.tab')::uuid),
  1, 'la ligne est bien posee sur la commande visee');

-- T3/T4 — double appui en salle : le rejeu est un no-op.
SELECT lives_ok(format(
  $q$ SELECT create_tablet_order_v9('11111111-1111-1111-1111-111111111111'::uuid, %L::uuid, '7', 'dine_in',
      jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1, 'unit_price', 30000, 'modifiers', '[]'::jsonb)),
      NULL, %L::uuid) $q$,
  current_setting('a.waiter'), current_setting('a.prod'), current_setting('a.tab')),
  'rejeu avec la meme cle ne leve pas');

SELECT is(
  (SELECT count(*)::int FROM order_items WHERE order_id = current_setting('a.tab')::uuid),
  1, 'le rejeu n ajoute PAS une seconde fois');

-- T5 — tracabilite du geste (miroir de order.fire_appended au comptoir).
SELECT isnt_empty(format(
  $q$ SELECT 1 FROM audit_logs WHERE action = 'order.tablet_appended' AND entity_id = %L::uuid $q$,
  current_setting('a.tab')), 'l ajout laisse une ligne audit_logs');

-- T6/T7 — les deux refus qui protegent l argent.
SELECT throws_ok(format(
  $q$ SELECT create_tablet_order_v9('22222222-2222-2222-2222-222222222222'::uuid, %L::uuid, '9', 'dine_in',
      jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1, 'unit_price', 30000, 'modifiers', '[]'::jsonb)),
      NULL, %L::uuid) $q$,
  current_setting('a.waiter'), current_setting('a.prod'), current_setting('a.paid')),
  'P0002', NULL, 'refus d ajout sur une commande deja payee');

SELECT throws_ok(format(
  $q$ SELECT create_tablet_order_v9('33333333-3333-3333-3333-333333333333'::uuid, %L::uuid, '8', 'dine_in',
      jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1, 'unit_price', 30000, 'modifiers', '[]'::jsonb)),
      NULL, %L::uuid) $q$,
  current_setting('a.waiter'), current_setting('a.prod'), current_setting('a.pos')),
  'P0002', NULL, 'refus d ajout sur une commande du comptoir');

-- T8 — fin du skip silencieux herite de la v4.
SELECT throws_ok(format(
  $q$ SELECT create_tablet_order_v9('44444444-4444-4444-4444-444444444444'::uuid, %L::uuid, '7', 'dine_in',
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000000', 'quantity', 1, 'unit_price', 30000, 'modifiers', '[]'::jsonb)),
      NULL, %L::uuid) $q$,
  current_setting('a.waiter'), current_setting('a.tab')),
  'P0002', NULL, 'produit introuvable leve P0002 au lieu de disparaitre');

-- T9 — defense in depth.
SELECT ok(
  NOT has_function_privilege('anon', 'public.create_tablet_order_v9(uuid,uuid,text,order_type,jsonb,text,uuid,boolean,text)', 'EXECUTE'),
  'anon ne peut pas executer create_tablet_order_v9');

SELECT * FROM finish();
ROLLBACK;
