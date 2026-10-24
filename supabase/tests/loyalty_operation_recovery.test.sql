-- ADR-013 D6/D12/D13 et ADR-020 D6 : reprise liée et atomicité des ledgers.
BEGIN;
\ir helpers/pin_session.sql
SELECT plan(30);

DO $$
DECLARE v_actor uuid; v_customer uuid; v_category uuid;
BEGIN
  SELECT auth_user_id INTO STRICT v_actor FROM public.user_profiles
  WHERE deleted_at IS NULL AND is_active
    AND public.has_permission(auth_user_id, 'loyalty.adjust')
    AND public.has_permission(auth_user_id, 'customers.store_credit.convert')
  ORDER BY employee_code LIMIT 1;
  PERFORM pg_temp.authenticate_pin(v_actor);
  INSERT INTO public.customer_categories(name, slug)
    VALUES ('Loyalty recovery fixture', 'loyalty-recovery-' || gen_random_uuid()) RETURNING id INTO v_category;
  INSERT INTO public.customers(name, customer_type, category_id, loyalty_points, lifetime_points)
    VALUES ('Loyalty recovery fixture', 'retail', v_category, 2000, 2000) RETURNING id INTO v_customer;
  PERFORM set_config('lr.customer', v_customer::text, true);
  PERFORM set_config('lr.convert_key', gen_random_uuid()::text, true);
  PERFORM set_config('lr.adjust_key', gen_random_uuid()::text, true);
END $$;

SELECT ok(to_regprocedure('public.convert_loyalty_to_store_credit_v1(uuid,integer,uuid)') IS NULL,
  'old conversion signature removed');
SELECT ok(to_regprocedure('public.adjust_loyalty_points_v2(uuid,integer,text)') IS NULL,
  'old adjustment signature removed');
SELECT ok(NOT has_table_privilege('authenticated', 'public.loyalty_operation_results', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon', 'public.loyalty_operation_results', 'SELECT,INSERT,UPDATE,DELETE'),
  'result table is private');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.loyalty_operation_results'::regclass),
  'result table has RLS');
SELECT ok(NOT has_function_privilege('authenticated', 'public._read_loyalty_operation_v1(text,uuid,uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._read_loyalty_operation_v1(text,uuid,uuid,uuid,jsonb)', 'EXECUTE'),
  'replay helper cannot be called by clients');
SELECT ok(NOT has_function_privilege('anon', 'public.convert_loyalty_to_store_credit_v2(uuid,integer,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.adjust_loyalty_points_v3(uuid,integer,text,uuid)', 'EXECUTE'),
  'anon cannot execute either mutation');

SELECT set_config('lr.conversion', public.convert_loyalty_to_store_credit_v2(
  current_setting('lr.customer')::uuid, 1000, current_setting('lr.convert_key')::uuid)::text, true);
SELECT is((SELECT loyalty_points FROM public.customers WHERE id = current_setting('lr.customer')::uuid), 1000,
  'conversion debits points once');
SELECT is((SELECT lifetime_points FROM public.customers WHERE id = current_setting('lr.customer')::uuid), 2000,
  'conversion preserves lifetime points');
SELECT is((SELECT store_credit_balance FROM public.customers WHERE id = current_setting('lr.customer')::uuid), 10000::numeric,
  'conversion credits store credit once');
SELECT is((SELECT count(*)::integer FROM public.loyalty_operation_results WHERE customer_id = current_setting('lr.customer')::uuid), 1,
  'one immutable confirmation is saved');
SELECT is(public.convert_loyalty_to_store_credit_v2(current_setting('lr.customer')::uuid, 1000,
  current_setting('lr.convert_key')::uuid), current_setting('lr.conversion')::jsonb || '{"idempotent_replay":true}'::jsonb,
  'replay returns the original conversion envelope');
SELECT is((SELECT count(*)::integer FROM public.loyalty_transactions WHERE customer_id = current_setting('lr.customer')::uuid), 1,
  'conversion replay adds no loyalty transaction');
SELECT throws_ok($q$ SELECT public.convert_loyalty_to_store_credit_v2(current_setting('lr.customer')::uuid,
  100, current_setting('lr.convert_key')::uuid) $q$, 'P0012', 'idempotency_conflict', 'changed points cannot reuse the key');
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v3(current_setting('lr.customer')::uuid,
  10, 'another operation', current_setting('lr.convert_key')::uuid) $q$, 'P0012', 'idempotency_conflict',
  'conversion key cannot become an adjustment');
SELECT throws_ok($q$ SELECT public.convert_loyalty_to_store_credit_v2(current_setting('lr.customer')::uuid,
  100, NULL) $q$, '23514', 'idempotency_key_required', 'conversion requires a durable key');
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v3(current_setting('lr.customer')::uuid,
  10, 'valid reason', NULL) $q$, '23514', 'idempotency_key_required', 'adjustment requires a durable key');

SELECT set_config('lr.adjustment', public.adjust_loyalty_points_v3(current_setting('lr.customer')::uuid,
  -1000, 'Correction with lost response', current_setting('lr.adjust_key')::uuid)::text, true);
SELECT is((SELECT loyalty_points FROM public.customers WHERE id = current_setting('lr.customer')::uuid), 0,
  'negative adjustment debits once');
SELECT is(public.adjust_loyalty_points_v3(current_setting('lr.customer')::uuid, -1000,
  'Correction with lost response', current_setting('lr.adjust_key')::uuid),
  current_setting('lr.adjustment')::jsonb || '{"idempotent_replay":true}'::jsonb,
  'adjustment replays even after the balance became insufficient');
SELECT is((SELECT lifetime_points FROM public.customers WHERE id = current_setting('lr.customer')::uuid), 2000,
  'negative adjustment and replay preserve lifetime points');
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v3(current_setting('lr.customer')::uuid,
  -1000, 'A different reason', current_setting('lr.adjust_key')::uuid) $q$, 'P0012', 'idempotency_conflict',
  'changed reason cannot reuse the key');

-- Simuler une conversion antérieure au nouveau journal, sous rollback seulement.
DELETE FROM public.loyalty_operation_results WHERE idempotency_key = current_setting('lr.convert_key')::uuid;
SELECT is(public.convert_loyalty_to_store_credit_v2(current_setting('lr.customer')::uuid, 1000,
  current_setting('lr.convert_key')::uuid), current_setting('lr.conversion')::jsonb || '{"idempotent_replay":true}'::jsonb,
  'legacy conversion replays from its original bound ledgers');
SELECT throws_ok($q$ SELECT public._read_loyalty_operation_v1('loyalty_conversion',
  current_setting('lr.convert_key')::uuid, gen_random_uuid(), current_setting('lr.customer')::uuid,
  '{"points":1000}') $q$, 'P0012', 'idempotency_conflict', 'legacy conversion cannot replay under another actor');

-- Une collision tardive doit annuler aussi le débit et les lignes précédentes.
CREATE FUNCTION pg_temp.fail_loyalty_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE unique_violation USING MESSAGE = 'forced late result collision'; END $$;
CREATE TRIGGER test_late_result_collision AFTER INSERT ON public.loyalty_operation_results
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_loyalty_result();
SELECT throws_ok($q$ SELECT public.adjust_loyalty_points_v3(current_setting('lr.customer')::uuid,
  100, 'Must be rolled back', gen_random_uuid()) $q$, '23505', 'forced late result collision',
  'late unique violation propagates instead of confirming unrelated data');
SELECT is((SELECT loyalty_points FROM public.customers WHERE id = current_setting('lr.customer')::uuid), 0,
  'late failure rolls back the adjustment balance');
SELECT is((SELECT count(*)::integer FROM public.loyalty_transactions WHERE customer_id = current_setting('lr.customer')::uuid), 2,
  'late failure rolls back the adjustment ledger');
SELECT is((SELECT count(*)::integer FROM public.audit_logs WHERE entity_id = current_setting('lr.customer')::uuid
  AND action = 'loyalty.adjust'), 1, 'late failure rolls back its audit too');

UPDATE public.customers SET loyalty_points = 200 WHERE id = current_setting('lr.customer')::uuid;
SELECT throws_ok($q$ SELECT public.convert_loyalty_to_store_credit_v2(current_setting('lr.customer')::uuid,
  100, gen_random_uuid()) $q$, '23505', 'forced late result collision',
  'late conversion collision propagates after all its writes have been rolled back');
SELECT is((SELECT loyalty_points FROM public.customers WHERE id = current_setting('lr.customer')::uuid), 200,
  'late conversion collision rolls back the points debit');
SELECT is((SELECT store_credit_balance FROM public.customers WHERE id = current_setting('lr.customer')::uuid), 10000::numeric,
  'late conversion collision rolls back the credit too');
SELECT is((SELECT count(*)::integer FROM public.journal_entries WHERE reference_type = 'store_credit_conversion'
  AND reference_id IN (SELECT id FROM public.customer_store_credit_ledger WHERE customer_id = current_setting('lr.customer')::uuid)),
  1, 'late conversion collision creates no second journal entry');

SELECT * FROM finish();
ROLLBACK;
