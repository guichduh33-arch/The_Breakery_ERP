-- Décision 2026-11-21 : ajouter des points fidélité exige un nonce PIN manager
-- (scope loyalty_points_grant) ; retirer des points ne change pas.
-- Toute la recette (nonces, clients, audits) est annulée par le ROLLBACK.
BEGIN;
\ir helpers/pin_session.sql
SELECT plan(25);

CREATE FUNCTION pg_temp.mint(p_manager uuid, p_scope text DEFAULT 'loyalty_points_grant',
  p_ttl interval DEFAULT '60 seconds') RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.discount_authorizations(manager_profile_id, scope, expires_at)
  VALUES (p_manager, p_scope, now() + p_ttl) RETURNING id $$;

DO $$
DECLARE v_actor uuid; v_profile uuid; v_customer uuid; v_category uuid;
        v_weak_auth uuid := gen_random_uuid(); v_weak_profile uuid := gen_random_uuid();
BEGIN
  SELECT auth_user_id, id INTO STRICT v_actor, v_profile FROM public.user_profiles
  WHERE deleted_at IS NULL AND is_active
    AND public.has_permission(auth_user_id, 'loyalty.adjust')
  ORDER BY employee_code LIMIT 1;

  -- Manager sans loyalty.adjust (override refusé) : son nonce doit être rejeté.
  INSERT INTO auth.users(id, email) VALUES (v_weak_auth, v_weak_auth || '@loyalty-grant.invalid');
  INSERT INTO public.user_profiles(id, auth_user_id, employee_code, full_name, pin_hash, role_code, is_active)
  VALUES (v_weak_profile, v_weak_auth, 'LGW-' || v_weak_profile, 'Weak manager fixture', 'invalid-test-hash', 'ADMIN', true);
  INSERT INTO public.user_permission_overrides(user_profile_id, permission_code, is_granted, reason)
  VALUES (v_weak_profile, 'loyalty.adjust', false, 'Loyalty grant PIN regression');

  PERFORM pg_temp.authenticate_pin(v_actor);
  INSERT INTO public.customer_categories(name, slug)
    VALUES ('Loyalty grant PIN fixture', 'loyalty-grant-pin-' || gen_random_uuid()) RETURNING id INTO v_category;
  INSERT INTO public.customers(name, customer_type, category_id, loyalty_points, lifetime_points)
    VALUES ('Loyalty grant PIN fixture', 'retail', v_category, 100, 100) RETURNING id INTO v_customer;
  PERFORM set_config('lg.customer', v_customer::text, true);
  PERFORM set_config('lg.profile', v_profile::text, true);
  PERFORM set_config('lg.weak', v_weak_profile::text, true);
  PERFORM set_config('lg.key', gen_random_uuid()::text, true);
  PERFORM set_config('lg.nonce', pg_temp.mint(v_profile)::text, true);
END $$;

SELECT ok(to_regprocedure('public.adjust_loyalty_points_v3(uuid,integer,text,uuid)') IS NULL,
  'v3 signature removed');
SELECT ok(to_regprocedure('public.adjust_loyalty_points_v4(uuid,integer,text,uuid,uuid)') IS NOT NULL,
  'v4 signature exists');
SELECT ok(NOT has_function_privilege('anon', 'public.adjust_loyalty_points_v4(uuid,integer,text,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.adjust_loyalty_points_v4(uuid,integer,text,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.adjust_loyalty_points_v4(uuid,integer,text,uuid,uuid)', 'EXECUTE'),
  'v4 is closed to anon/PUBLIC and open to authenticated');

-- Refus d'un crédit sans autorisation valide.
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  10, 'credit without nonce', gen_random_uuid()) $q$, 'P0003', NULL, 'credit without authorization is refused');
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  10, 'credit with unknown nonce', gen_random_uuid(), gen_random_uuid()) $q$, 'P0003', NULL,
  'credit with an unknown nonce is refused');
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  10, 'credit with wrong scope', gen_random_uuid(),
  pg_temp.mint(current_setting('lg.profile')::uuid, 'store_credit_grant')) $q$, 'P0003', NULL,
  'a nonce of another scope is refused');
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  10, 'credit with expired nonce', gen_random_uuid(),
  pg_temp.mint(current_setting('lg.profile')::uuid, 'loyalty_points_grant', '-1 second')) $q$, 'P0003', NULL,
  'an expired nonce is refused');
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  10, 'credit by weak manager', gen_random_uuid(),
  pg_temp.mint(current_setting('lg.weak')::uuid)) $q$, 'P0003', NULL,
  'a nonce minted for a manager without loyalty.adjust is refused');
SELECT is((SELECT loyalty_points FROM public.customers WHERE id = current_setting('lg.customer')::uuid), 100,
  'refused credits leave the balance untouched');

-- Une erreur tardive annule aussi la consommation du nonce.
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v4(gen_random_uuid(),
  10, 'credit on missing customer', gen_random_uuid(), current_setting('lg.nonce')::uuid) $q$,
  'P0001', 'customer_deleted', 'valid nonce on a missing customer is refused');
SELECT ok((SELECT consumed_at IS NULL FROM public.discount_authorizations WHERE id = current_setting('lg.nonce')::uuid),
  'a failed credit does not burn the nonce');

-- Succès, nonce consommé, trace d'audit.
SELECT set_config('lg.result', public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  50, 'Goodwill credit', current_setting('lg.key')::uuid, current_setting('lg.nonce')::uuid)::text, true);
SELECT is((current_setting('lg.result')::jsonb->>'new_balance')::int, 150, 'authorized credit adds the points');
SELECT is((SELECT lifetime_points FROM public.customers WHERE id = current_setting('lg.customer')::uuid), 150,
  'authorized credit raises lifetime points');
SELECT ok((SELECT consumed_at IS NOT NULL FROM public.discount_authorizations WHERE id = current_setting('lg.nonce')::uuid),
  'the nonce is consumed by the credit');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_logs
  WHERE action = 'loyalty.adjust' AND entity_id = current_setting('lg.customer')::uuid
    AND actor_id = current_setting('lg.profile')::uuid
    AND metadata->>'loyalty_txn_id' = current_setting('lg.result')::jsonb->>'txn_id'
    AND metadata->>'authorization_id' = current_setting('lg.nonce')
    AND metadata->>'manager_profile_id' = current_setting('lg.profile')
    AND metadata->>'rpc_version' = 'v4'
    AND (payload->>'delta')::int = 50),
  'audit metadata records the authorizing manager and nonce, payload keeps the diff');

-- Réutilisation et rejeu.
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  50, 'Goodwill credit again', gen_random_uuid(), current_setting('lg.nonce')::uuid) $q$, 'P0003', NULL,
  'a consumed nonce cannot authorize a second credit');
SELECT is(public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  50, 'Goodwill credit', current_setting('lg.key')::uuid),
  current_setting('lg.result')::jsonb || '{"idempotent_replay":true}'::jsonb,
  'replay without a nonce returns the first result');
SELECT set_config('lg.nonce2', pg_temp.mint(current_setting('lg.profile')::uuid)::text, true);
SELECT is((public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  50, 'Goodwill credit', current_setting('lg.key')::uuid, current_setting('lg.nonce2')::uuid)->>'idempotent_replay')::boolean,
  true, 'replay with a fresh nonce is still a replay');
SELECT ok((SELECT consumed_at IS NULL FROM public.discount_authorizations WHERE id = current_setting('lg.nonce2')::uuid),
  'a replay never consumes a nonce');
SELECT is((SELECT loyalty_points FROM public.customers WHERE id = current_setting('lg.customer')::uuid), 150,
  'replays do not add points again');
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  60, 'Goodwill credit', current_setting('lg.key')::uuid, current_setting('lg.nonce2')::uuid) $q$, 'P0012', 'idempotency_conflict',
  'the key cannot be reused with a different delta');

-- Un débit ne change pas : aucune autorisation requise, nonce ignoré.
SELECT is((public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  -10, 'Debit without nonce', gen_random_uuid())->>'new_balance')::int, 140,
  'debit works without any authorization');
SELECT is((public.adjust_loyalty_points_v4(current_setting('lg.customer')::uuid,
  -5, 'Debit ignoring a nonce', gen_random_uuid(), current_setting('lg.nonce2')::uuid)->>'new_balance')::int, 135,
  'debit ignores a supplied authorization');
SELECT ok((SELECT consumed_at IS NULL FROM public.discount_authorizations WHERE id = current_setting('lg.nonce2')::uuid),
  'a debit does not consume the nonce');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.audit_logs
  WHERE action = 'loyalty.adjust' AND entity_id = current_setting('lg.customer')::uuid
    AND (payload->>'delta')::int < 0 AND metadata->'authorization_id' IS NOT NULL),
  'debit audits carry no authorization');

SELECT * FROM finish();
ROLLBACK;
