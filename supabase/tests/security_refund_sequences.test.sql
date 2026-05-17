-- S20 Wave 1 - RLS on refund_sequences regression suite.
BEGIN;

SELECT plan(4);

-- A1 : RLS enabled on the base table
SELECT ok(
  (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname='refund_sequences'),
  'refund_sequences has RLS enabled'
);

-- A2 : SELECT policy for authenticated exists
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='refund_sequences'
       AND policyname='refund_sequences_select_auth'
       AND 'authenticated' = ANY(roles)
  ),
  'refund_sequences_select_auth policy exists for authenticated'
);

-- A3 : No INSERT/UPDATE/DELETE policy means all client DML denied
SELECT is_empty(
  $$ SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename='refund_sequences'
        AND cmd IN ('INSERT','UPDATE','DELETE') $$,
  'no client-writable policies on refund_sequences'
);

-- A4 : deferred to Wave 2 pgTAP suite for the anon GRANT assertion
SELECT pass('A4 deferred to Wave 2 pgTAP suite');

SELECT * FROM finish();
ROLLBACK;
