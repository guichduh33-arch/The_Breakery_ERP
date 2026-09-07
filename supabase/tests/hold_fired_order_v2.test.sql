-- supabase/tests/hold_fired_order_v2.test.sql
BEGIN;
SELECT plan(3);

SELECT has_function(
  'public', 'hold_fired_order_v2', ARRAY['uuid'],
  'hold_fired_order_v2(uuid) exists');

SELECT is(
  has_function_privilege('anon', 'public.hold_fired_order_v2(uuid)', 'EXECUTE'),
  false, 'anon cannot EXECUTE hold_fired_order_v2');

SELECT is(
  has_function_privilege('authenticated', 'public.hold_fired_order_v2(uuid)', 'EXECUTE'),
  true, 'authenticated can EXECUTE hold_fired_order_v2');

SELECT * FROM finish();
ROLLBACK;
