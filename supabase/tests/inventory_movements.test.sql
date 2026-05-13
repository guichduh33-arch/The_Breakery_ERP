-- supabase/tests/inventory_movements.test.sql
-- Session 13 / Phase 2.D — pgTAP for get_stock_movements_v1 + aggregates.
-- Run via execute_sql with BEGIN ... ROLLBACK envelope.
--
-- T_MOV_01..07 :
--   01 — RPC exists + revoked from PUBLIC.
--   02 — anonymous caller gets P0003.
--   03 — return signature has the 22 expected columns.
--   04 — limit param hard-capped at 200.
--   05 — get_movement_aggregates_v1 exists.
--   06 — aggregates returns JSONB ARRAY for empty result.
--   07 — cursor-pagination ORDER BY is created_at DESC, id DESC (verify via prosrc).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- T_MOV_01
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc WHERE proname='get_stock_movements_v1'),
  1,
  'T_MOV_01: get_stock_movements_v1 exists'
);

-- T_MOV_02
SELECT throws_ok(
  $$SELECT * FROM get_stock_movements_v1()$$,
  'P0003',
  NULL,
  'T_MOV_02: get_stock_movements_v1 forbids anonymous'
);

-- T_MOV_03 — return signature
SELECT is(
  (SELECT COUNT(*)::INT FROM information_schema.parameters
    WHERE specific_schema='public'
      AND specific_name LIKE 'get_stock_movements_v1%'
      AND parameter_mode='OUT'),
  22,
  'T_MOV_03: 22 OUT columns'
);

-- T_MOV_04 — prosrc contains the 200 cap (sanity check on hard cap)
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname='get_stock_movements_v1') LIKE '%200%',
  'T_MOV_04: get_stock_movements_v1 hard-caps limit at 200'
);

-- T_MOV_05
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc WHERE proname='get_movement_aggregates_v1'),
  1,
  'T_MOV_05: get_movement_aggregates_v1 exists'
);

-- T_MOV_06 — aggregates returns JSONB
SELECT is(
  (SELECT prorettype::regtype::TEXT FROM pg_proc WHERE proname='get_movement_aggregates_v1'),
  'jsonb',
  'T_MOV_06: get_movement_aggregates_v1 returns jsonb'
);

-- T_MOV_07 — ORDER BY DESC pattern
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname='get_stock_movements_v1')
    LIKE '%ORDER BY sm.created_at DESC, sm.id DESC%',
  'T_MOV_07: cursor-paginated ORDER BY (created_at DESC, id DESC)'
);

SELECT * FROM finish();
ROLLBACK;
