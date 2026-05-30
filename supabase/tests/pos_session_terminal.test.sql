-- supabase/tests/pos_session_terminal.test.sql
-- Session 33 / Wave 4.3 — terminal_id FK + nullability on pos_sessions.
-- Runs via MCP execute_sql with BEGIN ... ROLLBACK envelope.
--
-- Coverage (3 cases):
--   T1  insert pos_session WITH terminal_id → row has terminal_id set
--   T2  insert pos_session WITHOUT terminal_id → NULL allowed
--   T3  insert with unknown terminal_id (UUID not in lan_devices) → 23503 FK
--
-- pos_sessions has exclusion constraint one_open_session_per_user, so
-- between tests we close the prior session before opening the next.

BEGIN;
SELECT plan(3);

DO $$
DECLARE
  v_cashier  UUID := (SELECT id FROM user_profiles WHERE role_code='CASHIER' LIMIT 1);
  v_terminal UUID := (SELECT id FROM lan_devices WHERE device_type='pos' AND is_active=true LIMIT 1);
  v_session1 UUID;
  v_session2 UUID;
BEGIN
  -- Close any pre-existing open session for this cashier to avoid exclusion conflict
  UPDATE pos_sessions SET status='closed', closed_at=now()
  WHERE opened_by=v_cashier AND status='open';

  -- T1 setup
  INSERT INTO pos_sessions (opened_by, opening_cash, terminal_id)
  VALUES (v_cashier, 100000, v_terminal) RETURNING id INTO v_session1;
  PERFORM set_config('breakery.t1_session', v_session1::text, true);
  -- Close T1 before opening T2 (exclusion constraint)
  UPDATE pos_sessions SET status='closed', closed_at=now() WHERE id=v_session1;

  -- T2 setup
  INSERT INTO pos_sessions (opened_by, opening_cash)
  VALUES (v_cashier, 100000) RETURNING id INTO v_session2;
  PERFORM set_config('breakery.t2_session', v_session2::text, true);
  UPDATE pos_sessions SET status='closed', closed_at=now() WHERE id=v_session2;
END $$;

-- T1 — terminal_id set
SELECT ok(
  (SELECT terminal_id IS NOT NULL FROM pos_sessions WHERE id = current_setting('breakery.t1_session')::uuid),
  'T1: pos_session created with terminal_id set'
);

-- T2 — terminal_id NULL allowed
SELECT ok(
  (SELECT terminal_id IS NULL FROM pos_sessions WHERE id = current_setting('breakery.t2_session')::uuid),
  'T2: pos_session terminal_id NULL when not provided'
);

-- T3 — unknown terminal_id → 23503 FK violation
SELECT throws_ok(
  $$ INSERT INTO pos_sessions (opened_by, opening_cash, terminal_id)
     VALUES ((SELECT id FROM user_profiles WHERE role_code='CASHIER' LIMIT 1),
             100000,
             '00000000-0000-0000-0000-000000000000') $$,
  '23503',
  NULL,
  'T3: unknown terminal_id raises 23503 FK violation'
);

SELECT * FROM finish();
ROLLBACK;
