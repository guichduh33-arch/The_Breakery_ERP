-- supabase/tests/close_shift_note_enforced.test.sql
-- S60 (12 D1.4) — note d'écart obligatoire enforced serveur.
-- S66 (12 D2.1) — repointée close_shift_v3 -> v4 ; la variance de fixture passe
-- de 100 000/500 000 (20 % — franchirait AUSSI le seuil PIN v4 de 2 %) à
-- 100 000/10 000 000 (1 %) pour rester dans la bande « note seule » : au-dessus
-- du seuil note abs (50 000), sous les seuils PIN (200 000 abs / 2 %). Le gate
-- PIN a sa propre suite (close_shift_pin_gate.test.sql).
--   T1a : close_shift_v5(uuid,numeric,text,uuid,uuid,text) exists
--   T1b : close_shift_v3 dropped (bump v3 -> v4)
--   T2  : over-note-threshold variance (100000 >= abs 50000, 1% < 2% PIN), no note -> variance_note_required (P0001)
--   T3  : same close WITH a note -> succeeds (no PIN needed below PIN thresholds)
--   T3b : session closed + variance JE (shift_close) emitted
--   T4  : zero-variance close, no note -> succeeds (note not required)
--   T5  : replay on an already-closed session -> idempotent_replay=true, guard bypassed
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- ===========================================================================
-- Fixtures : caller EMP003 (shift.close) ; une session par propriétaire
-- distinct (exclusion one_open_session_per_user), le propriétaire de la
-- session 2 est un profil libre choisi dynamiquement (S66) ; opening_cash figé
-- (no cash sales attached -> expected == opening).
-- Pattern lifted from combo_sale.test.sql / discount_auth_nonce.test.sql.
-- ===========================================================================
DO $fixture$
DECLARE
  v_mgr_auth UUID; v_mgr_prof UUID;
  v_s2_owner UUID;
BEGIN
  SELECT auth_user_id, id INTO v_mgr_auth, v_mgr_prof
    FROM user_profiles WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  IF v_mgr_prof IS NULL THEN RAISE EXCEPTION 'fixture: EMP003 profile not found'; END IF;

  -- S66 : propriétaire de la session 2 choisi dynamiquement — n'importe quel
  -- profil actif SANS session ouverte (la base dev vivante peut en avoir :
  -- EMP000 en avait une le 2026-07-07, exclusion one_open_session_per_user).
  SELECT up.id INTO v_s2_owner
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.id <> v_mgr_prof
     AND NOT EXISTS (SELECT 1 FROM pos_sessions ps
                      WHERE ps.opened_by = up.id AND ps.status = 'open')
   LIMIT 1;
  IF v_s2_owner IS NULL THEN RAISE EXCEPTION 'fixture: no free profile for session 2'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_mgr_auth::text, true);

  -- Session 1 (EMP003): opening 10 000 000 — the T2/T3 variance of +100 000 is
  -- 1 % : above the note threshold, below the S66 PIN thresholds (200k / 2 %).
  INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('60c50001-0000-0000-0000-000000000001', v_mgr_prof, 10000000, 'open');

  -- Session 2 (profil libre): opening 300000 — used for the zero-variance close (T4).
  INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('60c50001-0000-0000-0000-000000000002', v_s2_owner, 300000, 'open');
END $fixture$;

-- ===========================================================================
-- T1 — v5 exists, v4 dropped.
-- ===========================================================================
SELECT has_function('public', 'close_shift_v5', ARRAY['uuid', 'numeric', 'text', 'uuid', 'uuid', 'text', 'numeric', 'numeric', 'jsonb'],
  'T1a: close_shift_v5(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb) exists');
SELECT hasnt_function('public', 'close_shift_v4', ARRAY['uuid', 'numeric', 'text', 'uuid', 'uuid', 'text'],
  'T1b: close_shift_v4 dropped (bump v4 -> v5)');

-- ===========================================================================
-- T2 — over-threshold variance (600000 - 500000 = 100000 >= abs 50000), no
-- note -> variance_note_required (P0001). No side effect: session stays open.
-- ===========================================================================
SELECT throws_ok(
  $$SELECT close_shift_v5('60c50001-0000-0000-0000-000000000001'::uuid, 10100000, NULL, NULL)$$,
  'P0001', NULL,
  'T2: over-threshold variance with no note -> variance_note_required (P0001)'
);

-- ===========================================================================
-- T3 — same close, WITH a note -> succeeds.
-- ===========================================================================
SELECT lives_ok(
  format($$SELECT close_shift_v5('60c50001-0000-0000-0000-000000000001'::uuid, 10100000, %L, NULL)$$,
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
  $$SELECT close_shift_v5('60c50001-0000-0000-0000-000000000002'::uuid, 300000, NULL, NULL)$$,
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
    v_res := close_shift_v5('60c50001-0000-0000-0000-000000000001'::uuid, 10100000, NULL, NULL);
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
