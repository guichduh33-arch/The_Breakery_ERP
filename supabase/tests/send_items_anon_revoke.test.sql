-- supabase/tests/send_items_anon_revoke.test.sql
-- F-008 regression guard — anon must never regain EXECUTE on send_items_to_kitchen,
-- while authenticated keeps it. Run via MCP execute_sql wrapped in BEGIN; … ROLLBACK;
-- (Docker retired). See migration 20260620000017.
BEGIN;
SELECT plan(2);

-- T1: anon must NOT have EXECUTE.
SELECT is(
  has_function_privilege('anon', 'public.send_items_to_kitchen(uuid[])', 'EXECUTE'),
  false,
  'T1 anon cannot EXECUTE send_items_to_kitchen'
);

-- T2: authenticated keeps EXECUTE.
SELECT is(
  has_function_privilege('authenticated', 'public.send_items_to_kitchen(uuid[])', 'EXECUTE'),
  true,
  'T2 authenticated retains EXECUTE'
);

SELECT * FROM finish();
ROLLBACK;
