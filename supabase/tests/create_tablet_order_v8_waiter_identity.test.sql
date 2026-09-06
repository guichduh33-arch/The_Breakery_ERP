-- supabase/tests/create_tablet_order_v8_waiter_identity.test.sql
--
-- Audit POS Waiter du 2026-08-22, lot C (b) — l'identité du serveur.
--
-- Ce que ce filet tient : `create_tablet_order_v7` écrivait `p_waiter_id` tel
-- quel dans `orders.waiter_id` sans jamais vérifier que ce profil était celui
-- de l'appelant. Tout porteur de `sales.create` pouvait donc attribuer une
-- commande à un autre serveur — traçabilité, imputation du service, pourboires.
--
-- T5 est le test qui compte deux fois. Il n'assert pas seulement le REFUS, il
-- assert le CODE du refus. `offlineReplay.ts` (ADR-018) traite `23514`
-- (`check_violation`) comme définitif — quarantaine, le drain continue — et
-- tout code hors de sa liste comme transitoire — le drain S'ARRÊTE. Le terminal
-- de salle est partagé : une intention hors-ligne de la serveuse A rejouée sous
-- la session de B doit partir en quarantaine, jamais bloquer la file derrière
-- elle. Changer ce code pour un `P0003` d'apparence plus juste rendrait le
-- refus bloquant. Le test existe pour que ce changement soit rouge.

BEGIN;
SELECT plan(9);

DO $$
DECLARE
  v_prof_a UUID;
  v_auth_a UUID;
  v_prof_b UUID;
  v_prod   UUID;
BEGIN
  -- Appelant : un profil VIVANT porteur de `sales.create`.
  SELECT up.id, up.auth_user_id INTO v_prof_a, v_auth_a
    FROM user_profiles up
    WHERE up.auth_user_id IS NOT NULL
      AND up.deleted_at IS NULL
      AND has_permission(up.auth_user_id, 'sales.create')
    LIMIT 1;
  IF v_prof_a IS NULL THEN
    RAISE EXCEPTION 'fixture: aucun user_profiles vivant avec sales.create';
  END IF;

  -- Victime de l'usurpation : n'importe quel AUTRE profil vivant.
  SELECT up.id INTO v_prof_b
    FROM user_profiles up
    WHERE up.deleted_at IS NULL AND up.id <> v_prof_a
    LIMIT 1;
  IF v_prof_b IS NULL THEN
    RAISE EXCEPTION 'fixture: il faut un second user_profiles vivant';
  END IF;

  SELECT id INTO v_prod FROM products WHERE is_active LIMIT 1;
  IF v_prod IS NULL THEN
    RAISE EXCEPTION 'fixture: aucun produit actif';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_auth_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth_a)::text, true);

  PERFORM set_config('wid.prof_a', v_prof_a::text, true);
  PERFORM set_config('wid.prof_b', v_prof_b::text, true);
  PERFORM set_config('wid.prod',   v_prod::text,   true);
END $$;

-- T1 — l'ancienne porte est murée. Une _vN publiée ne s'édite pas : elle se
-- remplace, et l'ancienne disparaît dans la MÊME migration.
SELECT is_empty(
  $$ SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_tablet_order_v7' $$,
  'T1 — create_tablet_order_v7 est droppée'
);

-- T2 — la v8 existe.
SELECT isnt_empty(
  $$ SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_tablet_order_v9' $$,
  'T2 — create_tablet_order_v9 existe'
);

-- T3 — SECURITY DEFINER : les écritures de commande passent par la RPC, jamais
-- par un INSERT direct depuis l'application.
SELECT is(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_tablet_order_v9'),
  true,
  'T3 — create_tablet_order_v9 est SECURITY DEFINER'
);

-- T4 — anon n'a aucun EXECUTE. anon hérite EXECUTE via PUBLIC : un REVOKE
-- FROM anon seul ne suffirait pas, les deux doivent être absents de l'ACL.
-- Un grant à PUBLIC s'écrit sans bénéficiaire : `=X/postgres`.
SELECT is(
  (SELECT count(*)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     unnest(coalesce(p.proacl, '{}'::aclitem[])) AS acl
    WHERE n.nspname = 'public' AND p.proname = 'create_tablet_order_v9'
      AND (acl::text LIKE 'anon=%' OR acl::text LIKE '=%')),
  0::bigint,
  'T4 — ni anon ni PUBLIC ne portent EXECUTE sur la v8'
);

-- T5 — le POS appelle la RPC avec le JWT du serveur : sans `authenticated`,
-- toute la prise de commande en salle tombe en permission denied.
SELECT is(
  (SELECT count(*)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     unnest(coalesce(p.proacl, '{}'::aclitem[])) AS acl
    WHERE n.nspname = 'public' AND p.proname = 'create_tablet_order_v9'
      AND acl::text LIKE 'authenticated=X%'),
  1::bigint,
  'T5 — authenticated porte EXECUTE sur la v8'
);

-- T6 — LE test du lot. Créer au nom d'un autre serveur est refusé.
SELECT throws_ok(
  format(
    $$ SELECT create_tablet_order_v9(
         gen_random_uuid(), %L::uuid, '99', 'dine_in'::order_type,
         jsonb_build_array(jsonb_build_object(
           'product_id', %L, 'quantity', 1, 'unit_price', 10000)),
         NULL, NULL, true, 'T1') $$,
    current_setting('wid.prof_b'), current_setting('wid.prod')
  ),
  '23514',
  NULL,
  'T6 — un serveur ne peut pas créer une commande au nom d''un autre'
);

-- T7 — et le refus porte le code qui QUARANTAINE au rejeu, pas celui qui
-- bloque le drain. Voir l'en-tête de ce fichier : c'est la moitié utile de T6.
SELECT throws_ok(
  format(
    $$ SELECT create_tablet_order_v9(
         gen_random_uuid(), %L::uuid, '99', 'dine_in'::order_type,
         jsonb_build_array(jsonb_build_object(
           'product_id', %L, 'quantity', 1, 'unit_price', 10000)),
         NULL, NULL, true, 'T1') $$,
    current_setting('wid.prof_b'), current_setting('wid.prod')
  ),
  '23514',
  'waiter_id_must_match_caller',
  'T7 — le message nomme la cause, et le SQLSTATE est celui des codes définitifs d''ADR-018'
);

-- Les deux créations qui doivent RÉUSSIR se font dans un bloc, pas dans le
-- prédicat d'un SELECT : `WHERE o.id = create_tablet_order_v9(…)` ferait
-- évaluer la fonction une fois PAR LIGNE de `orders`. Le test échouait sur sa
-- propre construction, pas sur la RPC.
DO $$
DECLARE
  v_o1 UUID;
  v_o2 UUID;
BEGIN
  v_o1 := create_tablet_order_v9(
    gen_random_uuid(), current_setting('wid.prof_a')::uuid, '99',
    'dine_in'::order_type,
    jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('wid.prod')::uuid,
      'quantity', 1, 'unit_price', 10000)),
    NULL, NULL, true, 'T1');

  v_o2 := create_tablet_order_v9(
    gen_random_uuid(), NULL, '99', 'dine_in'::order_type,
    jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('wid.prod')::uuid,
      'quantity', 1, 'unit_price', 10000)),
    NULL, NULL, true, 'T1');

  PERFORM set_config('wid.o1', v_o1::text, true);
  PERFORM set_config('wid.o2', v_o2::text, true);
END $$;

-- T8 — l'appelant qui se désigne lui-même passe, et la commande lui est bien
-- imputée.
SELECT is(
  (SELECT o.waiter_id FROM orders o WHERE o.id = current_setting('wid.o1')::uuid),
  current_setting('wid.prof_a')::uuid,
  'T8 — le serveur qui se désigne lui-même crée, et waiter_id est le sien'
);

-- T9 — `p_waiter_id` NULL est résolu vers l'appelant. Ce cas ne peut désigner
-- personne d'autre que lui : le refuser bloquerait un rejeu hors-ligne sans
-- rien protéger.
SELECT is(
  (SELECT o.waiter_id FROM orders o WHERE o.id = current_setting('wid.o2')::uuid),
  current_setting('wid.prof_a')::uuid,
  'T9 — p_waiter_id NULL est imputé à l''appelant'
);

SELECT * FROM finish();
ROLLBACK;
