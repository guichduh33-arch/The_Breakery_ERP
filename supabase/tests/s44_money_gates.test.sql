-- supabase/tests/s44_money_gates.test.sql
-- S44 Wave A (amorce) — money-path hardening gates. Complété en Wave B
-- (complete_order_with_payment_v12 / pay_existing_order_v8 / fire_counter_order_v2).
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK). Pattern jwt-claims S37/S43
-- (counter_fire) : caller = un VRAI user_profiles, auth.uid() simulé via
-- request.jwt.claims.
BEGIN;
SELECT plan(5);

-- Fixture : caller authentifié (les helpers Wave A sont IMMUTABLE et n'exigent
-- pas de perm, mais on garde l'en-tête standard pour les assertions Wave B).
DO $$
DECLARE
  v_auth UUID;
BEGIN
  SELECT up.auth_user_id INTO v_auth
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'fixture: no user_profiles row with pos.sale.create';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
END $$;

-- T1-T5 : get_loyalty_multiplier (migration 20260628000010) pinne le miroir SQL
-- de packages/domain/src/loyalty/tiers.ts (sync test : tiers-multipliers.test.ts).
SELECT is(get_loyalty_multiplier(0),    1.0::numeric, 'T1 bronze floor');
SELECT is(get_loyalty_multiplier(499),  1.0::numeric, 'T2 bronze ceiling');
SELECT is(get_loyalty_multiplier(500),  1.05::numeric, 'T3 silver boundary');
SELECT is(get_loyalty_multiplier(2000), 1.1::numeric, 'T4 gold boundary');
SELECT is(get_loyalty_multiplier(5000), 1.2::numeric, 'T5 platinum boundary');

SELECT * FROM finish();
ROLLBACK;
