-- supabase/tests/hold_fired_order_v3.test.sql
BEGIN;
SELECT plan(3);

SELECT has_function(
  'public', 'hold_fired_order_v3', ARRAY['uuid', 'uuid'],
  'hold_fired_order_v3(uuid,uuid) exists');

SELECT is(
  has_function_privilege('anon', 'public.hold_fired_order_v3(uuid,uuid)', 'EXECUTE'),
  false, 'anon cannot EXECUTE hold_fired_order_v3');

SELECT is(
  has_function_privilege('authenticated', 'public.hold_fired_order_v3(uuid,uuid)', 'EXECUTE'),
  true, 'authenticated can EXECUTE hold_fired_order_v3');

SELECT * FROM finish();
ROLLBACK;
