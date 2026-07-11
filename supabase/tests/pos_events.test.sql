-- pgTAP — S72 Lot 1 : pos_events write-path (record_pos_events_v1 + append-only).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- Verifies: auth gate, batch ingest, device auto-provision, offline idempotence
-- (replay = 0 inserted), no double-insert, synced_by authority, append-only
-- (UPDATE/DELETE rejected), and manager device registration.

BEGIN;
SELECT plan(9);

-- Gate: anon (no auth.uid()) is denied.
SELECT throws_ok(
  $$ SELECT record_pos_events_v1('devtoken-abcdef01','[]'::jsonb) $$, '42501', NULL,
  'anon / no-auth caller is denied');

-- Impersonate an owner.
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);

-- First ingest inserts both events.
SELECT is(
  (record_pos_events_v1('devtoken-abcdef01', $J$[
    {"client_event_id":"11111111-1111-1111-1111-111111111111","event_type":"order_opened","occurred_at":"2026-07-11T10:00:00+08","actor_id":"00000000-0000-0000-0000-000000000001","order_id":"22222222-2222-2222-2222-222222222222","order_number_snap":"#0003"},
    {"client_event_id":"33333333-3333-3333-3333-333333333333","event_type":"item_added","occurred_at":"2026-07-11T10:00:05+08","actor_id":"00000000-0000-0000-0000-000000000001","order_id":"22222222-2222-2222-2222-222222222222","payload":{"product":"Croissant","qty":2}}
  ]$J$::jsonb)->>'inserted')::int, 2, 'first ingest inserts 2 events');

-- Device auto-provisioned as unknown / unregistered.
SELECT is(
  (SELECT kind||'/'||is_registered::text FROM pos_devices WHERE device_token='devtoken-abcdef01'),
  'unknown/false', 'device auto-provisioned (unknown, unregistered)');

-- Replay of the same client_event_ids is idempotent.
SELECT is(
  (record_pos_events_v1('devtoken-abcdef01', $J$[
    {"client_event_id":"11111111-1111-1111-1111-111111111111","event_type":"order_opened","occurred_at":"2026-07-11T10:00:00+08"},
    {"client_event_id":"33333333-3333-3333-3333-333333333333","event_type":"item_added","occurred_at":"2026-07-11T10:00:05+08"}
  ]$J$::jsonb)->>'duplicates')::int, 2, 'replay is idempotent (2 duplicates, 0 inserted)');

-- No double-insert: exactly 2 rows persist.
SELECT is(
  (SELECT count(*)::int FROM pos_events WHERE order_id='22222222-2222-2222-2222-222222222222'),
  2, 'no double-insert on replay');

-- synced_by is the authenticated caller (server-authoritative).
SELECT is(
  (SELECT DISTINCT synced_by::text FROM pos_events WHERE order_id='22222222-2222-2222-2222-222222222222'),
  '00000000-0000-0000-0000-000000000001', 'synced_by = authenticated caller');

-- Append-only: UPDATE and DELETE are rejected.
SELECT throws_ok(
  $$ UPDATE pos_events SET reason='x' WHERE client_event_id='11111111-1111-1111-1111-111111111111' $$,
  '0A000', NULL, 'UPDATE is blocked (append-only)');
SELECT throws_ok(
  $$ DELETE FROM pos_events WHERE client_event_id='11111111-1111-1111-1111-111111111111' $$,
  '0A000', NULL, 'DELETE is blocked (append-only)');

-- Manager registration names the terminal (mutation then read = separate stmts).
SELECT register_pos_device_v1('devtoken-abcdef01','Caisse 1','counter');
SELECT is(
  (SELECT kind||'/'||is_registered::text FROM pos_devices WHERE device_token='devtoken-abcdef01'),
  'counter/true', 'register_pos_device_v1 marks the device registered');

SELECT * FROM finish();
ROLLBACK;
