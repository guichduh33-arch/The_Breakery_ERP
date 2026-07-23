-- supabase/tests/close_shift_v8_closed_by_profile.test.sql
-- S72 — POS audit P0 regression: close_shift wrote auth.uid() into the
-- pos_sessions.closed_by and audit_logs.actor_id FK columns (both -> user_profiles.id).
-- For any employee created via the real hiring chain (create_user_v1), profile.id
-- <> auth_user_id, so the write raised foreign_key_violation and the whole close
-- rolled back — the cashier could not close their drawer. The two SEED accounts have
-- id == auth_user_id, which masked the bug (no prior test exercised this path).
--
-- This test builds a create_user_v1-style user (id <> auth_user_id) inside the
-- transaction and closes a balanced shift.
--   T1 : id <> auth_user_id can close (previously foreign_key_violation)
--   T2 : closed_by = user_profiles.id (not auth_user_id)
--   T3 : z_report draft created (transaction reached the end)
--   T4 : zreport.draft_created audit actor_id = profile id (the 2nd FK write)
--   T5 : close_shift_v5 dropped (monotonic versioning)
-- Run via MCP execute_sql (BEGIN/ROLLBACK included).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

-- Fixture: a user whose profile id differs from its auth_user_id (the real
-- create_user_v1 shape), granted shift.close via an override, owning one open
-- balanced session (opening = counted = 500 000 -> variance 0, no note/PIN/JE).
DO $fixture$
DECLARE
  v_auth UUID := 'a5720000-0000-0000-0000-0000000000a1';
  v_prof UUID := 'b5720000-0000-0000-0000-0000000000b1';  -- deliberately <> v_auth
BEGIN
  INSERT INTO auth.users (id) VALUES (v_auth);
  INSERT INTO user_profiles (id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash)
    VALUES (v_prof, v_auth, 'CASHIER', 'S72 P0 Test', 'S72P0TEST', TRUE, crypt('123456', gen_salt('bf')));
  INSERT INTO user_permission_overrides (user_profile_id, permission_code, is_granted, reason)
    VALUES (v_prof, 'shift.close', TRUE, 'S72 P0 pgTAP fixture');
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, TRUE);
  INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
    VALUES ('c5720000-0000-0000-0000-0000000000c1', v_prof, 500000, 'open');
END $fixture$;

SELECT lives_ok(
  $$SELECT close_shift_v8('c5720000-0000-0000-0000-0000000000c1'::uuid, 500000)$$,
  'T1: user with profile.id <> auth_user_id can close shift (P0 regression)'
);

SELECT is(
  (SELECT closed_by FROM pos_sessions WHERE id='c5720000-0000-0000-0000-0000000000c1'),
  'b5720000-0000-0000-0000-0000000000b1'::uuid,
  'T2: closed_by = user_profiles.id (not auth_user_id)'
);

SELECT ok(
  EXISTS(SELECT 1 FROM z_reports WHERE shift_id='c5720000-0000-0000-0000-0000000000c1' AND status='draft'),
  'T3: z_report draft created'
);

SELECT is(
  (SELECT actor_id FROM audit_logs
    WHERE entity_type='z_report' AND action='zreport.draft_created'
      AND metadata->>'shift_id'='c5720000-0000-0000-0000-0000000000c1'),
  'b5720000-0000-0000-0000-0000000000b1'::uuid,
  'T4: zreport.draft_created audit actor_id = profile id (2nd fix)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='close_shift_v5'),
  0,
  'T5: close_shift_v5 dropped'
);

SELECT * FROM finish();
ROLLBACK;
