-- supabase/tests/reopen_held_order_v1.test.sql
BEGIN;
SELECT plan(3);

SELECT has_function(
  'public', 'reopen_held_order_v5', ARRAY['uuid', 'uuid'],
  'reopen_held_order_v5(uuid,uuid) exists');

SELECT is(
  has_function_privilege('anon', 'public.reopen_held_order_v5(uuid,uuid)', 'EXECUTE'),
  false, 'anon cannot EXECUTE reopen_held_order_v5');

SELECT is(
  has_function_privilege('authenticated', 'public.reopen_held_order_v5(uuid,uuid)', 'EXECUTE'),
  true, 'authenticated can EXECUTE reopen_held_order_v5');

SELECT * FROM finish();
ROLLBACK;
