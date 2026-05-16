-- Session 16 / Phase 1.A — pgTAP nightly smoke probe.
-- Trivial select to validate that the workflow runner can connect to V3 dev
-- and execute SQL with the BEGIN/ROLLBACK envelope. NOT a substantive test ;
-- the substantive coverage is the rest of the supabase/tests/*.test.sql files.

BEGIN;
SELECT plan(1);

SELECT ok(1 = 1, 'pgTAP runner is alive');

SELECT * FROM finish();
ROLLBACK;
