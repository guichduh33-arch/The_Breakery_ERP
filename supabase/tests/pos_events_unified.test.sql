-- pgTAP — S72 Lot 5 : get_pos_events_v1 unified stream (source unique).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- The reader merges client gestures (pos_events) with server outcomes derived
-- at read time from the money tables. Verifies:
--   * RECONCILIATION — derived sale_completed count == Overview order count
--     (shared canonical scope, the "source unique" invariant),
--   * server rows carry payload.source='server' + the Server device label,
--   * an un-synced pos_session surfaces as a derived session_opened /
--     session_closed (with the counted cash), attributed to opened_by/closed_by,
--   * DEDUP — a session whose terminal DID sync its own session_opened is not
--     duplicated by the derivation (the client row wins),
--   * the device filter excludes deviceless server-derived rows.
-- NB: seeded sessions are pre-closed — the one_open_session_per_user exclusion
-- constraint forbids a second open drawer for the owner.
-- The Lot 4 suite (pos_events_reader.test.sql) re-ran green post-_158: the
-- client-stream behaviour (filters, keyset, facets) is unchanged.

BEGIN;
SELECT plan(8);

SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);

-- 1) Source-unique reconciliation (live data, wide range).
SELECT is(
  (get_pos_events_v1('2026-05-01','2026-07-11', ARRAY['sale_completed'], NULL,NULL,NULL)->>'total_count')::int,
  (get_pos_sales_overview_v1('2026-05-01','2026-07-11')->>'orders')::int,
  'derived sale_completed count reconciles exactly with the Overview order count');

-- 2) Derived sales carry the server source marker + an order ref.
SELECT ok(
  (SELECT bool_and(e->'payload'->>'source' = 'server' AND (e->>'order_id') IS NOT NULL)
     FROM jsonb_array_elements(
       get_pos_events_v1('2026-05-01','2026-07-11', ARRAY['sale_completed'], NULL,NULL,NULL, 50)->'events') e),
  'derived sale rows are payload.source=server with an order id');

-- Session A: server-only (no client event), pre-closed.
INSERT INTO pos_sessions (id, opened_by, opening_cash, opened_at, closed_at, closed_by, closing_cash, status)
VALUES ('cccc3333-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000001',
        500000, '2026-07-11T07:00:00+08', '2026-07-11T15:00:00+08',
        '00000000-0000-0000-0000-000000000001', 750000, 'closed');

-- 3) Un-synced session surfaces as a server-derived session_opened.
SELECT is(
  (SELECT e->'payload'->>'source'
     FROM jsonb_array_elements(get_pos_events_v1('2026-07-11','2026-07-11',
            ARRAY['session_opened'], NULL,NULL,NULL)->'events') e
    WHERE e->>'session_id' = 'cccc3333-0000-0000-0000-00000000000a'),
  'server', 'un-synced session surfaces as a server-derived session_opened');

-- Session B: pre-closed + its terminal synced a client session_opened.
INSERT INTO pos_sessions (id, opened_by, opening_cash, opened_at, closed_at, closed_by, closing_cash, status)
VALUES ('cccc3333-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000001',
        400000, '2026-07-11T07:30:00+08', '2026-07-11T14:00:00+08',
        '00000000-0000-0000-0000-000000000001', 600000, 'closed');
SELECT record_pos_events_v1('tap-device-lot5-01', $J$[
  {"client_event_id":"dddd4444-0000-0000-0000-000000000001","event_type":"session_opened","occurred_at":"2026-07-11T07:30:02+08","actor_id":"00000000-0000-0000-0000-000000000001","session_id":"cccc3333-0000-0000-0000-00000000000b","amount":400000}
]$J$::jsonb);

-- 4) Dedup: exactly ONE session_opened row for session B — the client's.
SELECT is(
  (SELECT COUNT(*)::int
     FROM jsonb_array_elements(get_pos_events_v1('2026-07-11','2026-07-11',
            ARRAY['session_opened'], NULL,NULL,NULL)->'events') e
    WHERE e->>'session_id' = 'cccc3333-0000-0000-0000-00000000000b'),
  1, 'client-synced session is NOT duplicated by the server derivation');
SELECT is(
  (SELECT COALESCE(e->'payload'->>'source','client')
     FROM jsonb_array_elements(get_pos_events_v1('2026-07-11','2026-07-11',
            ARRAY['session_opened'], NULL,NULL,NULL)->'events') e
    WHERE e->>'session_id' = 'cccc3333-0000-0000-0000-00000000000b'),
  'client', 'the surviving session_opened row is the client one');

-- 5) session_closed derived with the counted closing cash as amount.
SELECT is(
  (SELECT (e->>'amount')::numeric
     FROM jsonb_array_elements(get_pos_events_v1('2026-07-11','2026-07-11',
            ARRAY['session_closed'], NULL,NULL,NULL)->'events') e
    WHERE e->>'session_id' = 'cccc3333-0000-0000-0000-00000000000a'),
  750000::numeric, 'closing surfaces as a server-derived session_closed with the counted cash');

-- 6) Device filter excludes deviceless server-derived rows.
SELECT is(
  (SELECT COUNT(*)::int
     FROM jsonb_array_elements(get_pos_events_v1('2026-07-11','2026-07-11',
            ARRAY['session_opened','session_closed','sale_completed'],
            (SELECT id FROM pos_devices WHERE device_token='tap-device-lot5-01'),
            NULL,NULL)->'events') e
    WHERE e->'payload'->>'source' = 'server'),
  0, 'filtering by a device excludes deviceless server-derived rows');

-- 7) Server rows are labelled for the UI.
SELECT is(
  (SELECT e->>'device_label'
     FROM jsonb_array_elements(get_pos_events_v1('2026-07-11','2026-07-11',
            ARRAY['session_closed'], NULL,NULL,NULL)->'events') e
    WHERE e->>'session_id' = 'cccc3333-0000-0000-0000-00000000000a'),
  'Server (money-path)', 'server-derived rows carry the Server device label');

SELECT * FROM finish();
ROLLBACK;
