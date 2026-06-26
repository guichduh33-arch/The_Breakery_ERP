-- supabase/tests/reopen_held_order_v1.test.sql
BEGIN;
SELECT plan(3);

SELECT has_function(
  'public', 'reopen_held_order_v1', ARRAY['uuid'],
  'reopen_held_order_v1(uuid) exists');

SELECT is(
  has_function_privilege('anon', 'public.reopen_held_order_v1(uuid)', 'EXECUTE'),
  false, 'anon cannot EXECUTE reopen_held_order_v1');

SELECT is(
  has_function_privilege('authenticated', 'public.reopen_held_order_v1(uuid)', 'EXECUTE'),
  true, 'authenticated can EXECUTE reopen_held_order_v1');

SELECT * FROM finish();
ROLLBACK;
