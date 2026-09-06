-- supabase/tests/security_gates_fail_closed.test.sql
--
-- Audit lot 1 — P1 sécurité n°4, n°5 et n°6 (2026-09-06).
--
-- Ce que ce fichier prouve :
--   1. Les trois RPC dont le grant `authenticated` était RÉSIDUEL sont fermées.
--      Le contrôle porte sur PUBLIC autant que sur `authenticated` : `anon`
--      hérite EXECUTE par PUBLIC, un REVOKE sur le seul rôle ne prouve rien.
--   2. `retry_sale_journal_entry_v5` est fail-closed — elle REFUSE quand il n'y
--      a pas d'acteur, là où la v4 se taisait et exécutait.
--   3. Elle interroge `has_permission` avec un `auth.uid()`, pas un
--      `user_profiles.id` — sinon tout compte créé par le back-office est refusé.
--   4. Plus aucune ligne d'audit ne porte `entity_type = 'products'`.
--
-- Enveloppe BEGIN/ROLLBACK — exécuté via MCP `execute_sql`.
-- Verdict fiable : lire `SELECT num_failed()`, pas la dernière ligne affichée.

BEGIN;
SELECT plan(15);

-- ------------------------------------------------------------------ 1. ACL

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.enqueue_notification_v2(text,text,jsonb,text,timestamptz,uuid)', 'EXECUTE'),
  'enqueue_notification_v2 : authenticated n a plus EXECUTE');
SELECT ok(
  NOT has_function_privilege('public',
    'public.enqueue_notification_v2(text,text,jsonb,text,timestamptz,uuid)', 'EXECUTE'),
  'enqueue_notification_v2 : PUBLIC n a plus EXECUTE (anon herite par la)');
SELECT ok(
  has_function_privilege('service_role',
    'public.enqueue_notification_v2(text,text,jsonb,text,timestamptz,uuid)', 'EXECUTE'),
  'enqueue_notification_v2 : le chemin machine (service_role) reste ouvert');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.recompute_recipe_cost_v3(uuid,numeric)', 'EXECUTE'),
  'recompute_recipe_cost_v3 : authenticated n a plus EXECUTE');
SELECT ok(
  NOT has_function_privilege('public',
    'public.recompute_recipe_cost_v3(uuid,numeric)', 'EXECUTE'),
  'recompute_recipe_cost_v3 : PUBLIC n a plus EXECUTE');
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.recompute_all_recipe_costs_v3(numeric)', 'EXECUTE'),
  'recompute_all_recipe_costs_v3 : authenticated n a plus EXECUTE');
SELECT ok(
  has_function_privilege('service_role',
    'public.recompute_all_recipe_costs_v3(numeric)', 'EXECUTE'),
  'recompute_all_recipe_costs_v3 : le cron (service_role) reste servi');

-- ------------------------------------------------- 2. bumps et anciens corps

SELECT hasnt_function('public', 'recompute_recipe_cost_v2', ARRAY['uuid','numeric'],
  'recompute_recipe_cost_v2 est droppee');
SELECT hasnt_function('public', 'retry_sale_journal_entry_v4', ARRAY['uuid'],
  'retry_sale_journal_entry_v4 est droppee');
SELECT hasnt_function('public', 'upsert_combo_v2', ARRAY['jsonb','uuid'],
  'upsert_combo_v2 est droppee');

-- --------------------------------------------------- 3. le cron suit le bump

SELECT is(
  (SELECT count(*)::int FROM cron.job
    WHERE jobname = 'recompute-recipe-costs-daily'
      AND command LIKE '%recompute_all_recipe_costs_v3%'),
  1,
  'le cron quotidien appelle bien la v3');

-- -------------------------------- 4. fail-closed : pas d acteur, pas d entree

-- Sans JWT, auth.uid() est NULL. La v4 sautait la garde entiere et executait ;
-- la v5 doit refuser. Contre-controle positif : la commande visee existe, sinon
-- un refus ne prouverait rien (le test pourrait echouer sur order_not_found).
SELECT throws_ok(
  $$ SELECT public.retry_sale_journal_entry_v5(
       (SELECT id FROM orders WHERE status IN ('paid','completed')
          AND is_historical_import IS NOT TRUE LIMIT 1)) $$,
  'P0003',
  NULL,
  'retry_sale_journal_entry_v5 refuse un appel sans acteur (P0003)');

-- CONTRÔLE POSITIF — sans lui, le refus ci-dessus ne prouverait rien : la RPC
-- pourrait refuser tout le monde. Avec un acteur qui DÉTIENT la permission, la
-- garde doit être FRANCHIE, et l'échec venir d'un motif métier. C'est aussi ce
-- qui prouve le second défaut corrigé : `has_permission` reçoit maintenant un
-- auth.uid(), donc un compte réel n'est plus refusé à tort.
DO $$
DECLARE v_auth UUID; v_msg TEXT;
BEGIN
  SELECT auth_user_id INTO v_auth FROM user_profiles
   WHERE role_code = 'SUPER_ADMIN' AND auth_user_id IS NOT NULL AND deleted_at IS NULL
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  BEGIN
    PERFORM public.retry_sale_journal_entry_v5('00000000-0000-0000-0000-0000000000ff'::uuid);
    v_msg := 'aucune exception';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM set_config('sgfc.msg', v_msg, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

SELECT ok(
  current_setting('sgfc.msg') LIKE 'order_not_found%',
  'controle positif : un acteur autorise franchit la garde (recu: '
    || current_setting('sgfc.msg') || ')');

-- --------------------------- 5. has_permission recoit un uid, pas un profil

-- Le corps live ne doit plus contenir `has_permission(v_profile_id`.
SELECT ok(
  pg_get_functiondef('public.retry_sale_journal_entry_v5(uuid)'::regprocedure)
    !~ 'has_permission\s*\(\s*v_profile_id',
  'retry v5 n interroge plus has_permission avec un user_profiles.id');

-- ------------------------------------------- 6. plus aucun pluriel en audit

SELECT is(
  (SELECT count(*)::int FROM audit_logs WHERE entity_type = 'products'),
  0,
  'aucune ligne audit_logs ne porte entity_type = products');

SELECT * FROM finish();
ROLLBACK;
