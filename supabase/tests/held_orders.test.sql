-- Session 35 — F-003 Held orders DB-backed — pgTAP (16/16).
-- Run via cloud MCP execute_sql inside this BEGIN..ROLLBACK envelope (Docker retired).
-- Fixtures: seeded CASHIER (…002, has pos.sale.create, NOT orders.void),
--           seeded MANAGER (…004, has orders.void), product Croissant.
-- auth.uid() is simulated via request.jwt.claims GUC ({"sub": <auth_user_id>}).
BEGIN;
SELECT plan(16);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002"}', true);
CREATE TEMP TABLE _t (k text PRIMARY KEY, v uuid);

INSERT INTO _t VALUES ('oid1', public.hold_order_v1(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '{"order_type":"dine_in","items":[{"product_id":"949d6c70-0a5f-49e1-8053-75b10b06f1ba","quantity":2,"unit_price":25000,"modifiers":[]}]}'::jsonb,
  'T-7', 'extra hot please'));
INSERT INTO _t VALUES ('oid2', public.hold_order_v1(
  '22222222-2222-4222-8222-222222222222'::uuid,
  '{"order_type":"take_out","items":[{"product_id":"949d6c70-0a5f-49e1-8053-75b10b06f1ba","quantity":1,"unit_price":18000,"modifiers":[]}]}'::jsonb,
  NULL, NULL));

SELECT isnt((SELECT v FROM _t WHERE k='oid1'), NULL, 'T1 hold returns order id');
SELECT is((SELECT status::text FROM orders WHERE id=(SELECT v FROM _t WHERE k='oid1')), 'draft', 'T2 status=draft');
SELECT ok((SELECT is_held FROM orders WHERE id=(SELECT v FROM _t WHERE k='oid1')), 'T2b is_held=true');
SELECT is((SELECT notes FROM orders WHERE id=(SELECT v FROM _t WHERE k='oid1')), 'extra hot please', 'T2c notes persisted');
SELECT is(public.hold_order_v1('11111111-1111-4111-8111-111111111111'::uuid,
  '{"order_type":"dine_in","items":[{"product_id":"949d6c70-0a5f-49e1-8053-75b10b06f1ba","quantity":2,"unit_price":25000,"modifiers":[]}]}'::jsonb,'T-7',NULL),
  (SELECT v FROM _t WHERE k='oid1'), 'T3 idempotent replay');
SELECT is((SELECT count(*) FROM held_order_idempotency_keys WHERE client_uuid='11111111-1111-4111-8111-111111111111'), 1::bigint, 'T3b one idem row');
SELECT is((SELECT line_total FROM order_items WHERE order_id=(SELECT v FROM _t WHERE k='oid1')), 50000::numeric, 'T4 line_total round_idr');
SELECT is((SELECT total FROM orders WHERE id=(SELECT v FROM _t WHERE k='oid1')), 50000::numeric, 'T4b total=sum lines');
SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE action='order.held' AND entity_id=(SELECT v FROM _t WHERE k='oid1')), 'T5 audit logged');

-- perm gate: unknown uid (no profile) cannot hold
SELECT set_config('request.jwt.claims', '{"sub":"99999999-9999-4999-8999-999999999999"}', true);
SELECT throws_ok($$ SELECT public.hold_order_v1('33333333-3333-4333-8333-333333333333'::uuid,
  '{"order_type":"dine_in","items":[{"product_id":"949d6c70-0a5f-49e1-8053-75b10b06f1ba","quantity":1,"unit_price":1000,"modifiers":[]}]}'::jsonb,NULL,NULL) $$,
  'P0003', NULL, 'T6 perm gate P0003');

-- restore (cashier) returns items + deletes the held draft
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002"}', true);
SELECT is(jsonb_array_length((public.restore_held_order_v1((SELECT v FROM _t WHERE k='oid1'))->'items')), 1, 'T7 restore returns items');
SELECT ok(NOT EXISTS(SELECT 1 FROM orders WHERE id=(SELECT v FROM _t WHERE k='oid1')), 'T7b restore deletes draft');
SELECT throws_ok($$ SELECT public.restore_held_order_v1('44444444-4444-4444-8444-444444444444'::uuid) $$,
  'P0002', NULL, 'T8 restore unknown P0002');

-- discard (manager): reason validation + happy path
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004"}', true);
SELECT throws_ok($$ SELECT public.discard_held_order_v1((SELECT v FROM _t WHERE k='oid2'), 'short') $$,
  'P0001', NULL, 'T9 discard short reason P0001');
SELECT lives_ok($$ SELECT public.discard_held_order_v1((SELECT v FROM _t WHERE k='oid2'), 'customer left the queue') $$,
  'T10 discard valid reason ok');

SELECT is(has_function_privilege('anon','public.hold_order_v1(uuid,jsonb,text,text)','EXECUTE'), false, 'T11 anon revoked');

SELECT * FROM finish();
ROLLBACK;
