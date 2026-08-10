-- supabase/tests/held_orders.test.sql
--
-- L'ADR-022 déc. 4 a supprimé la voie brouillon : `hold_order_v1` et
-- `restore_held_order_v1`, qui fabriquaient une commande `draft` à partir du
-- panier local, n'existent plus. Ce fichier couvre désormais le SEUL hold
-- restant, celui de la commande déjà tirée en cuisine —
-- `hold_fired_order_v1` → `reopen_held_order_v1` → `discard_held_order_v1`.
--
-- Le fixture monte la commande par la vraie porte (`fire_counter_order_v6`) et
-- non par INSERT brut : c'est la seule façon de voir ce que la caisse écrit
-- réellement (lignes verrouillées, envoyées en cuisine, total laissé à 0 par le
-- fire — c'est le hold qui le renseigne pour la liste des additions).
--
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

-- ===========================================================================
-- Fixture : acteur réel, session ouverte, commande comptoir tirée.
-- ===========================================================================
DO $fixture$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID; v_prod UUID; v_env JSONB;
BEGIN
  -- `discard_held_order_v1` écrit `audit_logs.actor_id = auth.uid()` alors que
  -- la colonne référence `user_profiles(id)` : il faut un profil dont les deux
  -- identifiants coïncident (c'est le cas des comptes seed).
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND up.id = up.auth_user_id
     AND has_permission(up.auth_user_id, 'pos.sale.create')
     AND has_permission(up.auth_user_id, 'orders.void')
   LIMIT 1;
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'fixture: aucun profil portant pos.sale.create ET orders.void';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  -- ADR-022 dec. 1 : la garde de vendabilite est active sur cette RPC, le fixture doit choisir un produit vendable de facon deterministe.
  SELECT p.id INTO v_prod FROM products p
   WHERE p.deleted_at IS NULL AND p.parent_product_id IS NULL AND p.is_active = true
     AND p.product_type <> 'combo'
     AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id AND c.is_active AND c.deleted_at IS NULL)
   LIMIT 1;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'fixture: aucun produit vendable'; END IF;

  -- Clôture transactionnelle d'une session ouverte fuitée pour ce profil
  -- (one_open_session_per_user est un EXCLUDE réel) — annulée par le ROLLBACK.
  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_prof, closing_cash=0
   WHERE opened_by = v_prof AND status='open';
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;

  v_env := fire_counter_order_v6(
    p_client_uuid := gen_random_uuid(),
    p_session_id  := v_sess,
    p_items       := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 2, 'unit_price', 25000, 'modifiers', '[]'::jsonb)),
    p_order_type  := 'take_out'::order_type);

  PERFORM set_config('ho.order', (v_env->>'order_id'), false);
  PERFORM set_config('ho.prof',  v_prof::text, false);
END $fixture$;

-- ===========================================================================
-- HOLD — parquer la commande tirée
-- ===========================================================================
DO $hold$
BEGIN
  PERFORM hold_fired_order_v1(current_setting('ho.order')::uuid);
END $hold$;

SELECT ok(
  (SELECT is_held FROM orders WHERE id = current_setting('ho.order')::uuid),
  'T1: hold_fired_order_v1 pose is_held=true sur la commande tiree');

SELECT ok(
  (SELECT o.subtotal = 50000 AND o.total = 50000
     FROM orders o WHERE o.id = current_setting('ho.order')::uuid)
  AND (SELECT o.total FROM orders o WHERE o.id = current_setting('ho.order')::uuid)
      = (SELECT COALESCE(SUM(oi.line_total), 0) FROM order_items oi
          WHERE oi.order_id = current_setting('ho.order')::uuid),
  'T2: le hold recalcule subtotal=total=SUM(line_total)=50000 (le fire laissait 0)');

SELECT ok(
  EXISTS (SELECT 1 FROM audit_logs
           WHERE action = 'order.held' AND entity_type = 'orders'
             AND entity_id = current_setting('ho.order')::uuid),
  'T3: le hold laisse une trace audit_logs order.held');

-- ===========================================================================
-- REOPEN — reprendre l'addition sans la détruire
-- ===========================================================================
DO $reopen$
DECLARE v_res JSONB;
BEGIN
  v_res := reopen_held_order_v1(current_setting('ho.order')::uuid);
  PERFORM set_config('ho.reopen', v_res::text, false);
END $reopen$;

SELECT ok(
  jsonb_array_length((current_setting('ho.reopen')::jsonb)->'items') = 1
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements((current_setting('ho.reopen')::jsonb)->'items') it
     WHERE (it->>'is_locked')::boolean IS DISTINCT FROM true),
  'T4: la reouverture rend les lignes VERROUILLEES (is_locked=true sur chacune)');

SELECT ok(
  (SELECT NOT is_held AND status = 'pending_payment'
     FROM orders o WHERE o.id = current_setting('ho.order')::uuid),
  'T5: la reouverture reclame la commande (is_held=false) sans la supprimer');

SELECT throws_ok(
  $q$ SELECT reopen_held_order_v1(current_setting('ho.order')::uuid) $q$,
  'P0002', NULL,
  'T6: une 2e reouverture leve P0002 (deja ouverte sur un autre poste)');

-- ===========================================================================
-- DISCARD — rejeter l'addition, sous condition de motif
-- ===========================================================================
SELECT throws_ok(
  $q$ SELECT discard_held_order_v1(current_setting('ho.order')::uuid, 'court') $q$,
  'P0001', NULL,
  'T7: un motif de moins de 10 caracteres est refuse (reason_too_short)');

SELECT ok(
  EXISTS (SELECT 1 FROM orders WHERE id = current_setting('ho.order')::uuid),
  'T8: le refus de motif ne supprime rien');

DO $discard$
BEGIN
  PERFORM discard_held_order_v1(current_setting('ho.order')::uuid,
                                'client parti sans commander');
END $discard$;

SELECT ok(
  NOT EXISTS (SELECT 1 FROM orders WHERE id = current_setting('ho.order')::uuid)
  AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = current_setting('ho.order')::uuid),
  'T9: un motif valide supprime la commande et ses lignes');

SELECT ok(
  EXISTS (SELECT 1 FROM audit_logs
           WHERE action = 'order.held_discarded'
             AND entity_id = current_setting('ho.order')::uuid
             AND metadata->>'reason' = 'client parti sans commander'),
  'T10: le rejet laisse une trace audit_logs avec le motif');

-- ===========================================================================
-- Defense in depth — anon sur aucune des trois portes
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon', 'public.hold_fired_order_v1(uuid)', 'EXECUTE'),
  'T11: anon n''a pas EXECUTE sur hold_fired_order_v1');

SELECT ok(
  NOT has_function_privilege('anon', 'public.reopen_held_order_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.discard_held_order_v1(uuid, text)', 'EXECUTE'),
  'T12: anon n''a pas EXECUTE sur reopen_held_order_v1 ni discard_held_order_v1');

SELECT * FROM finish();
ROLLBACK;
