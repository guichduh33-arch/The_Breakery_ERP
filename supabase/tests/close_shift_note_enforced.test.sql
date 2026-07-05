-- supabase/tests/close_shift_note_enforced.test.sql
-- S60 (12 D1.4) — close_shift_v3 : note d'écart obligatoire enforced serveur.
--   T1a : close_shift_v3(uuid,numeric,text,uuid) exists
--   T1b : close_shift_v2 dropped (bump v2 -> v3)
--   T2  : over-threshold variance (100000 >= abs 50000), no note -> variance_note_required (P0001)
--   T3  : same close WITH a note -> succeeds
--   T3b : session closed + variance JE (shift_close) emitted
--   T4  : zero-variance close, no note -> succeeds (note not required)
--   T5  : replay on an already-closed session -> idempotent_replay=true, guard bypassed
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- ===========================================================================
-- Fixtures : two manager profiles (EMP003 + EMP000, both have shift.close) ;
-- one open pos_session per user (exclusion constraint one_open_session_per_user
-- forbids two open sessions for the same opened_by) with a fixed opening_cash
-- (no cash sales attached -> expected == opening).
-- Pattern lifted from combo_sale.test.sql / discount_auth_nonce.test.sql.
-- ===========================================================================
DO $fixture$
DECLARE
  v_mgr_auth UUID; v_mgr_prof UUID;
  v_mgr2_auth UUID; v_mgr2_prof UUID;
BEGIN
  SELECT auth_user_id, id INTO v_mgr_auth, v_mgr_prof
    FROM user_profiles WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  IF v_mgr_prof IS NULL THEN RAISE EXCEPTION 'fixture: EMP003 profile not found'; END IF;

  SELECT auth_user_id, id INTO v_mgr2_auth, v_mgr2_prof
    FROM user_profiles WHERE employee_code = 'EMP000' AND deleted_at IS NULL;
  IF v_mgr2_prof IS NULL THEN RAISE EXCEPTION 'fixture: EMP000 profile not found'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_mgr_auth::text, true);

  -- Session 1 (EMP003): opening 500000 — used for the over-threshold variance (T2/T3/T5).
  INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('60c50001-0000-0000-0000-000000000001', v_mgr_prof, 500000, 'open');

  -- Session 2 (EMP000): opening 300000 — used for the zero-variance close (T4).
  INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('60c50001-0000-0000-0000-000000000002', v_mgr2_prof, 300000, 'open');

  PERFORM set_config('shift60.mgr_auth', v_mgr_auth::text, true);
  PERFORM set_config('shift60.mgr2_auth', v_mgr2_auth::text, true);
END $fixture$;

-- ===========================================================================
-- T1 — v3 exists, v2 dropped.
-- ===========================================================================
SELECT has_function('public', 'close_shift_v3', ARRAY['uuid', 'numeric', 'text', 'uuid'],
  'T1a: close_shift_v3(uuid,numeric,text,uuid) exists');
SELECT hasnt_function('public', 'close_shift_v2', ARRAY['uuid', 'numeric', 'text', 'uuid'],
  'T1b: close_shift_v2 dropped (bump v2 -> v3)');

-- ===========================================================================
-- T2 — over-threshold variance (600000 - 500000 = 100000 >= abs 50000), no
-- note -> variance_note_required (P0001). No side effect: session stays open.
-- ===========================================================================
SELECT throws_ok(
  $$SELECT close_shift_v3('60c50001-0000-0000-0000-000000000001'::uuid, 600000, NULL, NULL)$$,
  'P0001', NULL,
  'T2: over-threshold variance with no note -> variance_note_required (P0001)'
);

-- ===========================================================================
-- T3 — same close, WITH a note -> succeeds.
-- ===========================================================================
SELECT lives_ok(
  format($$SELECT close_shift_v3('60c50001-0000-0000-0000-000000000001'::uuid, 600000, %L, NULL)$$,
    'till was over, cash from event'),
  'T3: over-threshold variance WITH a note -> succeeds'
);

-- T3b — session closed + variance JE (shift_close) actually emitted.
DO $t3b$
DECLARE v_status TEXT; v_je UUID;
BEGIN
  SELECT status::text INTO v_status FROM pos_sessions
    WHERE id = '60c50001-0000-0000-0000-000000000001';
  SELECT id INTO v_je FROM journal_entries
    WHERE reference_type = 'shift_close' AND reference_id = '60c50001-0000-0000-0000-000000000001';
  PERFORM set_config('shift60.t3b', (v_status = 'closed' AND v_je IS NOT NULL)::text, false);
END $t3b$;
SELECT ok(current_setting('shift60.t3b')::boolean,
  'T3b: session closed + variance JE (shift_close) emitted');

-- ===========================================================================
-- T4 — zero-variance close (counted == expected), no note -> succeeds.
-- ===========================================================================
SELECT lives_ok(
  $$SELECT close_shift_v3('60c50001-0000-0000-0000-000000000002'::uuid, 300000, NULL, NULL)$$,
  'T4: zero-variance close, no note -> succeeds (note not required)'
);

-- ===========================================================================
-- T5 — replay on the already-closed session 1 (T3) -> idempotent_replay=true,
-- returned BEFORE the guard runs (no note, no exception).
-- ===========================================================================
DO $t5$
DECLARE
  v_res JSONB;
  v_caught BOOLEAN := false;
BEGIN
  BEGIN
    v_res := close_shift_v3('60c50001-0000-0000-0000-000000000001'::uuid, 600000, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  PERFORM set_config('shift60.t5',
    (NOT v_caught AND v_res ->> 'idempotent_replay' = 'true' AND v_res ->> 'status' = 'closed')::text,
    false);
END $t5$;
SELECT ok(current_setting('shift60.t5')::boolean,
  'T5: replay on already-closed session -> idempotent_replay=true, guard bypassed, no exception');

SELECT * FROM finish();
ROLLBACK;
