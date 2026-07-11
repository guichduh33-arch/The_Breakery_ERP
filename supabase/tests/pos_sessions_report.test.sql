-- pgTAP — get_pos_sessions_report_v1 (Reports POS refonte, Lot D).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- Verifies: permission gate, date-range guards, envelope shape/timezone, the
-- lifecycle count (one row per session, open vs closed reconciles with the
-- summary), the frozen 3-way reconciliation surfaced from shift.close audit
-- metadata, and that an OPEN session exposes null reconciliation volets.

BEGIN;
SELECT plan(10);

-- ── Gate: anon (no auth.uid()) is denied ──────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_sessions_report_v1('2026-05-01','2026-07-11') $$,
  '42501', NULL,
  'anon / no-perm caller is denied (reports.sales.read)'
);

-- ── Impersonate an owner holding reports.sales.read ───────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
SET LOCAL role authenticated;

-- ── Date-range guards ─────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_sessions_report_v1(NULL, '2026-07-11') $$, 'P0001', NULL,
  'NULL start date raises P0001');
SELECT throws_ok(
  $$ SELECT get_pos_sessions_report_v1('2026-07-11','2026-05-01') $$, 'P0001', NULL,
  'start > end raises invalid_date_range');

-- ── Envelope shape + timezone ─────────────────────────────────────────────
WITH r AS (SELECT get_pos_sessions_report_v1('2026-05-01','2026-07-11') AS j)
SELECT ok((SELECT j ? 'timezone' AND j ? 'summary' AND j ? 'sessions' FROM r),
          'envelope exposes timezone/summary/sessions');
WITH r AS (SELECT get_pos_sessions_report_v1('2026-05-01','2026-07-11') AS j)
SELECT is((SELECT j->>'timezone' FROM r), 'Asia/Makassar',
          'timezone is the business tz (WITA)');

-- ── Lifecycle count: one row per session, open+closed = total ─────────────
WITH r AS (SELECT get_pos_sessions_report_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  (SELECT jsonb_array_length(j->'sessions') FROM r),
  (SELECT (j->'summary'->>'total_sessions')::int FROM r),
  'sessions array length equals summary.total_sessions (one row per drawer)');
WITH r AS (SELECT get_pos_sessions_report_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  (SELECT (j->'summary'->>'open_count')::int + (j->'summary'->>'closed_count')::int FROM r),
  (SELECT (j->'summary'->>'total_sessions')::int FROM r),
  'open_count + closed_count reconciles with total (resolves the "N ≠ M" bug)');

-- ── total_sessions matches an independent recompute over the WITA window ──
WITH tz AS (SELECT COALESCE(MAX(timezone),'Asia/Makassar') v FROM business_config WHERE id=1),
scoped AS (
  SELECT ps.id FROM pos_sessions ps
   WHERE ((ps.opened_at AT TIME ZONE (SELECT v FROM tz))::date) BETWEEN '2026-05-01' AND '2026-07-11'
),
got AS (SELECT get_pos_sessions_report_v1('2026-05-01','2026-07-11') AS j)
SELECT is((SELECT (j->'summary'->>'total_sessions')::int FROM got),
          (SELECT COUNT(*)::int FROM scoped),
          'summary.total_sessions matches the scoped session count');

-- ── A closed session with a shift.close audit exposes a frozen cash variance
WITH r AS (SELECT get_pos_sessions_report_v1('2026-05-01','2026-07-11') AS j)
SELECT ok(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements((SELECT j->'sessions' FROM r)) s
     WHERE s->>'status' = 'closed'
       AND (s->'cash'->>'variance') IS NOT NULL
  ),
  'at least one closed session surfaces a non-null cash variance');

-- ── OPEN sessions expose null reconciliation volets (pending close) ───────
WITH r AS (SELECT get_pos_sessions_report_v1('2026-05-01','2026-07-11') AS j)
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements((SELECT j->'sessions' FROM r)) s
     WHERE s->>'status' = 'open'
       AND (s->'cash'->'variance') <> 'null'::jsonb
  ),
  'open sessions never carry a cash variance (reconciliation pending)');

SELECT * FROM finish();
ROLLBACK;
