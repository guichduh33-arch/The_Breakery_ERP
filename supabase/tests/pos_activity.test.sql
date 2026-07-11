-- pgTAP — get_pos_activity_v1 (Reports POS refonte, Lot G).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- Verifies: permission gate, date-range guards, envelope shape/timezone, that
-- every event is a 'sale', the events array length respects the 500 cap, and
-- the cross-report reconciliation — total_events equals the Overview order
-- count exactly (shared order scope).

BEGIN;
SELECT plan(9);

-- ── Gate: anon (no auth.uid()) is denied ──────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_activity_v1('2026-05-01','2026-07-11') $$,
  '42501', NULL,
  'anon / no-perm caller is denied (reports.sales.read)'
);

-- ── Impersonate an owner holding reports.sales.read ───────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
SET LOCAL role authenticated;

-- ── Date-range guards ─────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_activity_v1(NULL, '2026-07-11') $$, 'P0001', NULL,
  'NULL start date raises P0001');
SELECT throws_ok(
  $$ SELECT get_pos_activity_v1('2026-07-11','2026-05-01') $$, 'P0001', NULL,
  'start > end raises invalid_date_range');

-- ── Envelope shape + timezone ─────────────────────────────────────────────
WITH r AS (SELECT get_pos_activity_v1('2026-05-01','2026-07-11') AS j)
SELECT ok((SELECT j ? 'timezone' AND j ? 'total_events' AND j ? 'truncated' AND j ? 'events' FROM r),
          'envelope exposes timezone/total_events/truncated/events');
WITH r AS (SELECT get_pos_activity_v1('2026-05-01','2026-07-11') AS j)
SELECT is((SELECT j->>'timezone' FROM r), 'Asia/Makassar',
          'timezone is the business tz (WITA)');

-- ── Every event is a 'sale' with a reference ──────────────────────────────
WITH r AS (SELECT get_pos_activity_v1('2026-05-01','2026-07-11') AS j)
SELECT ok(
  (SELECT COALESCE(bool_and(e->>'kind' = 'sale' AND (e ? 'reference')), true)
     FROM r, jsonb_array_elements(j->'events') e),
  'every event is kind=sale and carries a reference');

-- ── Events array length respects the 500 cap ──────────────────────────────
WITH r AS (SELECT get_pos_activity_v1('2026-05-01','2026-07-11') AS j)
SELECT ok(
  jsonb_array_length((SELECT j->'events' FROM r)) <= 500,
  'events array never exceeds the 500 cap');

-- ── Events length = LEAST(total_events, 500) ──────────────────────────────
WITH r AS (SELECT get_pos_activity_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  jsonb_array_length((SELECT j->'events' FROM r)),
  LEAST((SELECT (j->>'total_events')::int FROM r), 500),
  'events array length = min(total_events, 500)');

-- ── Cross-report reconciliation: total_events = Overview order count ───────
WITH act AS (SELECT get_pos_activity_v1('2026-05-01','2026-07-11') AS j),
ov  AS (SELECT get_pos_sales_overview_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  (SELECT (j->>'total_events')::int FROM act),
  (SELECT (j->>'orders')::int FROM ov),
  'total_events reconciles exactly with the Overview order count');

SELECT * FROM finish();
ROLLBACK;
