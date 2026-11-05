-- supabase/tests/inventory_movements.test.sql
-- Session 13 / Phase 2.D — pgTAP for get_stock_movements_v3 + aggregates.
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

SELECT plan(9);

-- T_MOV_01
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc WHERE proname='get_stock_movements_v6'),
  1,
  'T_MOV_01: get_stock_movements_v6 exists'
);

-- T_MOV_02
SELECT throws_ok(
  $$SELECT get_stock_movements_v6(NULL,NULL)$$,
  'P0003',
  NULL,
  'T_MOV_02: get_stock_movements_v6 forbids anonymous'
);

-- T_MOV_03 — return signature
SELECT is(
  (SELECT prorettype::regtype::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_stock_movements_v6'),
  'jsonb',
  'T_MOV_03: public reader returns the JSON lines/cursor envelope'
);

-- T_MOV_04 — prosrc contains the 200 cap (sanity check on hard cap)
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname='get_stock_movements_v6') LIKE '%200%',
  'T_MOV_04: get_stock_movements_v6 hard-caps limit at 200'
);

-- T_MOV_05
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc WHERE proname='get_movement_aggregates_v5'),
  1,
  'T_MOV_05: get_movement_aggregates_v5 exists'
);

-- T_MOV_06 — aggregates returns JSONB
SELECT is(
  (SELECT prorettype::regtype::TEXT FROM pg_proc WHERE proname='get_movement_aggregates_v5'),
  'jsonb',
  'T_MOV_06: get_movement_aggregates_v5 returns jsonb'
);

-- T_MOV_05b — la v1 est droppee (versioning monotone, migration 20260805000001)
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc WHERE proname='get_movement_aggregates_v1'),
  0,
  'T_MOV_05b: get_movement_aggregates_v1 dropped'
);

-- T_MOV_06b — l agregat valorise au cout COURANT du produit, pas au unit_cost
-- stocke du mouvement : aligne sur get_stock_movement_ledger_v3, et immunise
-- le rapport contre une valeur historique aberrante (incident du 2026-07-13).
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname='get_movement_aggregates_v5') NOT LIKE '%sm.unit_cost%',
  'T_MOV_06b: get_movement_aggregates_v5 ne lit plus sm.unit_cost'
);

-- T_MOV_07 — ORDER BY DESC pattern
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname='get_stock_movements_v6')
    LIKE '%ORDER BY sm.created_at DESC, sm.id DESC%',
  'T_MOV_07: cursor-paginated ORDER BY (created_at DESC, id DESC)'
);

SELECT * FROM finish();
ROLLBACK;
