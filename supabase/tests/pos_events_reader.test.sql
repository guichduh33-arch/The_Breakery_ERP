-- pgTAP — S72 Lot 4 : get_pos_events_v1 (audit-journal reader).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- Verifies: auth gate, date guards, invalid cursor, page shape, type/order
-- filters, keyset pagination (no overlap, next_cursor lifecycle), page-1
-- facets vs cursor-page sentinel.

BEGIN;
SELECT plan(13);

-- Gate: anon (no auth.uid()) is denied.
SELECT throws_ok(
  $$ SELECT get_pos_events_v1('2026-07-11','2026-07-11') $$, '42501', NULL,
  'anon / no-auth caller is denied');

-- Impersonate the owner (ADMIN — has reports.audit.read).
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);

-- Guards.
SELECT throws_ok(
  $$ SELECT get_pos_events_v1(NULL,'2026-07-11') $$, 'P0001', NULL,
  'null start date rejected');
SELECT throws_ok(
  $$ SELECT get_pos_events_v1('2026-07-12','2026-07-11') $$, 'P0001', NULL,
  'inverted date range rejected');
SELECT throws_ok(
  $$ SELECT get_pos_events_v1('2026-07-11','2026-07-11', NULL,NULL,NULL,NULL, 10, 'garbage-cursor') $$,
  'P0001', NULL, 'malformed cursor rejected');

-- Seed 3 events on one device (WITA morning of 2026-07-11).
SELECT record_pos_events_v1('tap-device-lot4-01', $J$[
  {"client_event_id":"aaaa1111-0000-0000-0000-000000000001","event_type":"order_opened","occurred_at":"2026-07-11T09:00:00+08","actor_id":"00000000-0000-0000-0000-000000000001","order_id":"bbbb2222-0000-0000-0000-000000000001","order_number_snap":"#0101"},
  {"client_event_id":"aaaa1111-0000-0000-0000-000000000002","event_type":"item_added","occurred_at":"2026-07-11T09:00:05+08","actor_id":"00000000-0000-0000-0000-000000000001","order_id":"bbbb2222-0000-0000-0000-000000000001","payload":{"name":"Croissant"}},
  {"client_event_id":"aaaa1111-0000-0000-0000-000000000003","event_type":"cash_drawer_opened","occurred_at":"2026-07-11T09:10:00+08","actor_id":"00000000-0000-0000-0000-000000000001","payload":{"trigger":"manual"}}
]$J$::jsonb);

-- Full page: 3 events newest-first, true total, no next cursor.
SELECT is(
  (get_pos_events_v1('2026-07-11','2026-07-11')->>'total_count')::int >= 3, true,
  'page 1 reports the true total (>= 3 seeded)');
SELECT is(
  (get_pos_events_v1('2026-07-11','2026-07-11',
     ARRAY['order_opened','item_added','cash_drawer_opened'], NULL,NULL,NULL)
   ->'events'->0->>'event_type'),
  'cash_drawer_opened', 'events are newest-first');

-- Type filter.
SELECT is(
  jsonb_array_length(get_pos_events_v1('2026-07-11','2026-07-11',
     ARRAY['cash_drawer_opened'], NULL,NULL,NULL)->'events'),
  1, 'type filter narrows to the drawer event');

-- Order filter.
SELECT is(
  jsonb_array_length(get_pos_events_v1('2026-07-11','2026-07-11',
     NULL, NULL, NULL, 'bbbb2222-0000-0000-0000-000000000001')->'events'),
  2, 'order filter returns the 2 ticket events');

-- Keyset pagination: limit 2 (of >= 3) → next_cursor; page 2 has no overlap.
CREATE TEMP TABLE _p1 ON COMMIT DROP AS
  SELECT get_pos_events_v1('2026-07-11','2026-07-11',
    ARRAY['order_opened','item_added','cash_drawer_opened'], NULL,NULL,NULL, 2, NULL) AS r;
SELECT is(jsonb_array_length((SELECT r FROM _p1)->'events'), 2, 'limit caps page 1 at 2 events');
SELECT isnt((SELECT r FROM _p1)->>'next_cursor', NULL, 'page 1 exposes a next_cursor');

CREATE TEMP TABLE _p2 ON COMMIT DROP AS
  SELECT get_pos_events_v1('2026-07-11','2026-07-11',
    ARRAY['order_opened','item_added','cash_drawer_opened'], NULL,NULL,NULL, 2,
    (SELECT r->>'next_cursor' FROM _p1)) AS r;
SELECT is(
  (SELECT COUNT(*)::int FROM jsonb_array_elements((SELECT r FROM _p1)->'events') a
     JOIN jsonb_array_elements((SELECT r FROM _p2)->'events') b
       ON a->>'id' = b->>'id'),
  0, 'page 2 does not overlap page 1 (keyset)');
SELECT is((SELECT (r->>'total_count')::int FROM _p2), -1,
  'cursor page skips the total scan (-1 sentinel)');

-- Facets: page 1 exposes the seeded device.
SELECT is(
  (SELECT COUNT(*)::int FROM jsonb_array_elements((SELECT r FROM _p1)->'devices') d
    WHERE d->>'label' LIKE 'Unregistered tap-devi%') >= 1,
  true, 'page-1 facets include the auto-provisioned device');

SELECT * FROM finish();
ROLLBACK;
