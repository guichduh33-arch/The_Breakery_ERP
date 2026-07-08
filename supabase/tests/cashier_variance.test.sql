-- cashier_variance.test.sql — S70 fiche 12 D2.4.
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
-- Mirrors dashboard_overview.test.sql auth preamble + temp-table pass/fail capture.
--
-- DEV-S70-01: the dev DB is non-empty (real closed sessions in the CURRENT_DATE-30
-- window). Rather than delta-diff a structured per-cashier envelope, we seed into an
-- ISOLATED HISTORICAL WINDOW (2025-03, verified empty of closed sessions) so the
-- fixed-count assertions from the plan hold exactly.
--
-- Cashiers (existing seed profiles, reused as drawer owners):
--   A = 00000000-0000-0000-0000-000000000002 (Test Cashier)
--   B = 00000000-0000-0000-0000-000000000003 (Waiter Demo)
--   MANAGER (closes A3, ≠ A) = 00000000-0000-0000-0000-000000000004 (Manager Demo)
--   Acting reports.read user  = 00000000-0000-0000-0000-000000000001 (Mamat/Owner)
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_A     UUID := '00000000-0000-0000-0000-000000000002';
  v_B     UUID := '00000000-0000-0000-0000-000000000003';
  v_MGR   UUID := '00000000-0000-0000-0000-000000000004';
  v_ADMIN UUID := '00000000-0000-0000-0000-000000000001';
  v_s_a1 UUID; v_s_a2 UUID; v_s_a3 UUID; v_s_b1 UUID; v_s_out UUID;
  v_start DATE := DATE '2025-03-03';
  v_end   DATE := DATE '2025-03-31';
  v_res   JSONB;
  v_row     JSONB;
  v_dow2  JSONB;
  v_denied BOOLEAN;
BEGIN
  -- ── Seed sessions in the isolated window ──────────────────────────────
  -- A1: Tuesday 2025-03-04 10:00 local, cash -50000, counted_qris=100000, no card
  INSERT INTO pos_sessions (opened_by, closed_by, opening_cash, status, closed_at, variance_total, counted_qris, counted_card)
    VALUES (v_A, v_A, 0, 'closed', (TIMESTAMP '2025-03-04 10:00') AT TIME ZONE 'Asia/Makassar', -50000, 100000, NULL)
    RETURNING id INTO v_s_a1;
  -- A2: Tuesday 2025-03-11 10:00 local, cash -30000, no volet counted
  INSERT INTO pos_sessions (opened_by, closed_by, opening_cash, status, closed_at, variance_total, counted_qris, counted_card)
    VALUES (v_A, v_A, 0, 'closed', (TIMESTAMP '2025-03-11 10:00') AT TIME ZONE 'Asia/Makassar', -30000, NULL, NULL)
    RETURNING id INTO v_s_a2;
  -- A3: Wednesday 2025-03-05, cash +10000, CLOSED BY MANAGER (≠ A) → still attributed to A by opened_by
  INSERT INTO pos_sessions (opened_by, closed_by, opening_cash, status, closed_at, variance_total, counted_qris, counted_card)
    VALUES (v_A, v_MGR, 0, 'closed', (TIMESTAMP '2025-03-05 14:00') AT TIME ZONE 'Asia/Makassar', 10000, NULL, NULL)
    RETURNING id INTO v_s_a3;
  -- B1: Monday 2025-03-03, cash -5000
  INSERT INTO pos_sessions (opened_by, closed_by, opening_cash, status, closed_at, variance_total, counted_qris, counted_card)
    VALUES (v_B, v_B, 0, 'closed', (TIMESTAMP '2025-03-03 09:00') AT TIME ZONE 'Asia/Makassar', -5000, NULL, NULL)
    RETURNING id INTO v_s_b1;
  -- OUT: opened_by=A but closed 2025-01-01 (outside window) → must be excluded
  INSERT INTO pos_sessions (opened_by, closed_by, opening_cash, status, closed_at, variance_total, counted_qris, counted_card)
    VALUES (v_A, v_A, 0, 'closed', (TIMESTAMP '2025-01-01 10:00') AT TIME ZONE 'Asia/Makassar', -777000, NULL, NULL)
    RETURNING id INTO v_s_out;

  -- audit_logs 'shift.close' for A1 with QRIS variance metadata; NONE for A2/A3 (pre-S67 simulation).
  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
    VALUES ('shift.close', 'pos_sessions', v_s_a1,
            jsonb_build_object('variance_qris', -2000, 'variance_card', NULL, 'counted_qris', 100000), v_A);

  -- ── Act as reports.read user, call the RPC over the seeded window ──────
  PERFORM set_config('request.jwt.claim.sub', v_ADMIN::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ADMIN)::text, true);
  v_res := public.get_cashier_variance_v1(v_start, v_end);

  SELECT e INTO v_row FROM jsonb_array_elements(v_res->'cashiers') e
   WHERE e->>'cashier_id' = v_A::text;
  SELECT e INTO v_dow2 FROM jsonb_array_elements(v_row->'dow_cash') e
   WHERE e->>'dow' = '2';

  -- ── Assertions ────────────────────────────────────────────────────────
  INSERT INTO _r SELECT 'T01_cashiers_len_2',
    jsonb_array_length(v_res->'cashiers') = 2;
  INSERT INTO _r SELECT 'T02_A_first_biggest_short',
    (v_res->'cashiers'->0->>'cashier_id') = v_A::text;
  INSERT INTO _r SELECT 'T03_A_cash_total_variance_minus70k',
    (v_row->'cash'->>'total_variance')::numeric = -70000;
  INSERT INTO _r SELECT 'T04_A_cash_total_short_minus80k',
    (v_row->'cash'->>'total_short')::numeric = -80000;
  INSERT INTO _r SELECT 'T05_A_short2_over1',
    (v_row->'cash'->>'short_count')::int = 2 AND (v_row->'cash'->>'over_count')::int = 1;
  INSERT INTO _r SELECT 'T06_A_worst_minus50k',
    (v_row->'cash'->>'worst_variance')::numeric = -50000;
  INSERT INTO _r SELECT 'T07_A_sessions_3_by_opened_by',
    (v_row->>'sessions_count')::int = 3;
  INSERT INTO _r SELECT 'T08_A_qris_1_session_minus2k',
    (v_row->'qris'->>'counted_sessions')::int = 1 AND (v_row->'qris'->>'total_variance')::numeric = -2000;
  INSERT INTO _r SELECT 'T09_A_card_0_session_0',
    (v_row->'card'->>'counted_sessions')::int = 0 AND (v_row->'card'->>'total_variance')::numeric = 0;
  INSERT INTO _r SELECT 'T10_A_dow_tuesday_2sessions_minus80k',
    (v_dow2->>'sessions')::int = 2 AND (v_dow2->>'total_variance')::numeric = -80000;
  INSERT INTO _r SELECT 'T11_totals_4_sessions_short_minus85k',
    (v_res->'totals'->>'sessions_count')::int = 4
    AND (v_res->'totals'->'cash'->>'total_short')::numeric = -85000;

  -- T12: invalid_date_range (start > end) → P0001
  BEGIN
    PERFORM public.get_cashier_variance_v1(v_end, v_start);
    v_denied := false;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_denied := true;
  END;
  INSERT INTO _r SELECT 'T12_invalid_date_range_P0001', v_denied;

  -- T13: acting user WITHOUT reports.read → 42501
  PERFORM set_config('request.jwt.claim.sub', v_A::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_A)::text, true);
  BEGIN
    PERFORM public.get_cashier_variance_v1(v_start, v_end);
    v_denied := false;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  INSERT INTO _r SELECT 'T13_no_perm_42501', v_denied;

  -- T14: anon / no claims → auth.uid() NULL → 42501
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.get_cashier_variance_v1(v_start, v_end);
    v_denied := false;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  INSERT INTO _r SELECT 'T14_anon_42501', v_denied;
END $$;

SELECT name, pass FROM _r ORDER BY name;
-- Expected: 14 rows, pass = true everywhere.
ROLLBACK;
