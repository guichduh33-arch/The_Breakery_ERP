-- supabase/tests/send_items_anon_revoke.test.sql
-- F-008 regression guard — anon must never regain EXECUTE on send_items_to_kitchen,
-- authenticated is also denied. Run via MCP execute_sql wrapped in BEGIN; … ROLLBACK;
-- (Docker retired). See migration 20260620000017.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions;
SELECT plan(2);

-- T1: anon must NOT have EXECUTE.
SELECT is(
  has_function_privilege('anon', 'public.send_items_to_kitchen(uuid[])', 'EXECUTE'),
  false,
  'T1 anon cannot EXECUTE send_items_to_kitchen'
);

-- T2: authenticated cannot execute the legacy kitchen entrypoint.
SELECT is(
  has_function_privilege('authenticated', 'public.send_items_to_kitchen(uuid[])', 'EXECUTE'),
  false,
  'T2 authenticated cannot EXECUTE send_items_to_kitchen'
);

SELECT * FROM finish();
ROLLBACK;
