-- supabase/tests/held_orders.test.sql
--
-- L'ADR-022 déc. 4 a supprimé la voie brouillon : `hold_order_v1` et
-- `restore_held_order_v1`, qui fabriquaient une commande `draft` à partir du
-- panier local, n'existent plus. Ce fichier couvre désormais le SEUL hold
-- restant, celui de la commande déjà tirée en cuisine —
-- hold_fired_order → reopen_held_order ; abandon réservé aux lignes non verrouillées.
--
-- Le fixture monte la commande par la vraie porte (`fire_counter_order_v10`) et
-- non par INSERT brut : c'est la seule façon de voir ce que la caisse écrit
-- réellement (lignes verrouillées, envoyées en cuisine, total laissé à 0 par le
-- fire — c'est le hold qui le renseigne pour la liste des additions).
--
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

-- ===========================================================================
-- Fixture : acteur réel, session ouverte, commande comptoir tirée.
-- ===========================================================================
DO $fixture$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID; v_prod UUID; v_env JSONB;
BEGIN
  -- discard_held_order résout le profil acteur via `_current_profile_id()`
  -- (lot actor_id transverse du 2026-09-06 ; la v1 écrivait `auth.uid()` dans
  -- `audit_logs.actor_id` et exigeait un compte seed). Le fixture garde un compte
  -- seed (id = auth_user_id) par simplicité, la contrainte n'existe plus ; la preuve
  -- sur un profil id <> auth_user_id vit dans actor_profile_transverse.test.sql.
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

  v_env := fire_counter_order_v10(
    p_client_uuid := gen_random_uuid(),
    p_session_id  := v_sess,
    p_items       := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 2, 'unit_price', 25000, 'modifiers', '[]'::jsonb)),
    p_order_type  := 'take_out'::order_type);

  PERFORM set_config('ho.expected_total', (SELECT (retail_price * 2)::text FROM products WHERE id = v_prod), true);
  PERFORM set_config('ho.order', (v_env->>'order_id'), false);
  PERFORM set_config('ho.prof',  v_prof::text, false);
END $fixture$;

-- ===========================================================================
-- HOLD — parquer la commande tirée
-- ===========================================================================
DO $hold$
BEGIN
  PERFORM hold_fired_order_v3(current_setting('ho.order')::uuid);
END $hold$;

SELECT ok(
  (SELECT is_held FROM orders WHERE id = current_setting('ho.order')::uuid),
  'T1: hold_fired_order_v3 pose is_held=true sur la commande tiree');

SELECT ok(
  (SELECT o.subtotal = current_setting('ho.expected_total')::numeric AND o.total = current_setting('ho.expected_total')::numeric
     FROM orders o WHERE o.id = current_setting('ho.order')::uuid)
  AND (SELECT o.total FROM orders o WHERE o.id = current_setting('ho.order')::uuid)
      = (SELECT COALESCE(SUM(oi.line_total), 0) FROM order_items oi
          WHERE oi.order_id = current_setting('ho.order')::uuid),
  'T2: le hold recalcule subtotal=total=SUM(line_total) au prix serveur (le fire laissait 0)');

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
  v_res := reopen_held_order_v5(current_setting('ho.order')::uuid);
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

SELECT lives_ok(
  $q$ SELECT reopen_held_order_v5(current_setting('ho.order')::uuid) $q$,
  'T6: une commande caisse deja ouverte reste recuperable');

-- ===========================================================================
-- DISCARD — rejeter l'addition, sous condition de motif
-- ===========================================================================
SELECT throws_ok(
  $q$ SELECT discard_held_order_v3(current_setting('ho.order')::uuid, 'court') $q$,
  'P0001', NULL,
  'T7: un motif de moins de 10 caracteres est refuse (reason_too_short)');

SELECT ok(
  EXISTS (SELECT 1 FROM orders WHERE id = current_setting('ho.order')::uuid),
  'T8: le refus de motif ne supprime rien');

SELECT throws_ok(
  $q$ SELECT discard_held_order_v3(current_setting('ho.order')::uuid, 'client parti sans commander') $q$,
  '23514', 'locked_order_requires_cancellation',
  'une commande envoyee exige le flux annulation protege');

SELECT ok(
  EXISTS (SELECT 1 FROM orders WHERE id = current_setting('ho.order')::uuid)
  AND EXISTS (SELECT 1 FROM order_items WHERE order_id = current_setting('ho.order')::uuid),
  'T9: le refus conserve la commande et ses lignes');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM audit_logs
           WHERE action = 'order.held_discarded'
             AND entity_id = current_setting('ho.order')::uuid
             AND metadata->>'reason' = 'client parti sans commander'),
  'T10: le refus ne declare aucun abandon reussi');

UPDATE order_items SET is_cancelled = true, cancelled_at = now(),
  cancelled_reason = 'fixture already cancelled', cancelled_by = current_setting('ho.prof')::uuid
WHERE order_id = current_setting('ho.order')::uuid;
SELECT throws_ok(
  $q$ SELECT discard_held_order_v3(current_setting('ho.order')::uuid, 'ligne deja annulee') $q$,
  '23514', 'locked_order_requires_cancellation',
  'une ligne verrouillee deja annulee reste protegee');

DO $unlocked$
DECLARE v_id uuid;
BEGIN
  INSERT INTO orders (order_number, session_id, order_type, status, subtotal, tax_amount, total, served_by, created_via)
  SELECT 'T-UNLOCKED-' || gen_random_uuid()::text, session_id, order_type, 'draft', 0, 0, 0, served_by, 'pos'
  FROM orders WHERE id = current_setting('ho.order')::uuid
  RETURNING id INTO v_id;
  PERFORM set_config('ho.unlocked', v_id::text, true);
END $unlocked$;
SELECT lives_ok(
  $q$ SELECT discard_held_order_v3(current_setting('ho.unlocked')::uuid, 'brouillon non envoye') $q$,
  'une commande sans ligne verrouillee reste abandonnable');
SELECT ok(NOT EXISTS (SELECT 1 FROM orders WHERE id = current_setting('ho.unlocked')::uuid),
  'la commande non verrouillee est supprimee');
SELECT ok(EXISTS (SELECT 1 FROM audit_logs WHERE action = 'order.held_discarded'
  AND entity_id = current_setting('ho.unlocked')::uuid AND actor_id = current_setting('ho.prof')::uuid),
  'abandon non verrouille audite avec le profil acteur');
SELECT ok(to_regprocedure('public.discard_held_order_v2(uuid,text)') IS NULL, 'ancienne porte supprimee');

-- ===========================================================================
-- Defense in depth — anon sur aucune des trois portes
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon', 'public.hold_fired_order_v3(uuid,uuid)', 'EXECUTE'),
  'T11: anon n''a pas EXECUTE sur hold_fired_order_v3');

SELECT ok(
  NOT has_function_privilege('anon', 'public.reopen_held_order_v5(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.discard_held_order_v3(uuid, text)', 'EXECUTE'),
  'T12: anon n''a pas EXECUTE sur les portes reprise et abandon');

SELECT * FROM finish();
ROLLBACK;
