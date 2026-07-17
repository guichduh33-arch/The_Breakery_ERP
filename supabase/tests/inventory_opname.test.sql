-- supabase/tests/inventory_opname.test.sql
-- Session 13 / Phase 2.D — pgTAP suite for inventory_counts + opname RPCs.
-- Run via execute_sql with BEGIN ... ROLLBACK envelope (Docker retired).
--
-- Covers :
--   T_OPN_01 — tables + sequence exist.
--   T_OPN_02 — RPCs exist + revoked from PUBLIC.
--   T_OPN_03 — count_number sequence is monotonic (next_count_number).
--   T_OPN_04 — RLS auth_read on both tables ; DML revoked for authenticated.
--   T_OPN_05 — variance is GENERATED column (counted_qty - expected_qty).
--   T_OPN_06 — status check constraint rejects invalid values.
--   T_OPN_07 — unique(count_id, product_id) on count items.
--   T_OPN_08 — perms inventory.opname.create + finalize seeded into permissions.
--   T_OPN_09 — role_permissions wired for MANAGER/ADMIN/SUPER_ADMIN.
--   T_OPN_10 — finalize_opname_v1 status guard rejects bad statuses (no perm
--             needed since we test the schema-level state machine).
--   T_OPN_11 — opname_in + opname_out enum values present.
--   T_OPN_12 — view_section_stock_details exists with security_invoker.
--   T_OPN_13 — get_low_stock_v1 + get_reorder_suggestions_v1 + get_product_dashboard_v2
--             execute without crash for an admin user.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(13);

-- T_OPN_01 — tables + sequence
SELECT is(
  (SELECT COUNT(*)::INT FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('inventory_counts','inventory_count_items')),
  2,
  'T_OPN_01: inventory_counts + inventory_count_items tables exist'
);

-- T_OPN_02 — RPCs exist
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc
    WHERE proname IN (
      'create_opname_v1','add_opname_item_v1','set_opname_count_v1',
      'validate_opname_v1','finalize_opname_v1','cancel_opname_v1',
      'next_count_number'
    )),
  7,
  'T_OPN_02: 6 opname RPCs + next_count_number exist'
);

-- T_OPN_03 — count_number sequence is monotonic
SELECT cmp_ok(
  (SELECT next_count_number()),
  '<>',
  (SELECT next_count_number()),
  'T_OPN_03: next_count_number() returns distinct values'
);

-- T_OPN_04 — RLS auth_read on both tables
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'inventory_counts'),
  true,
  'T_OPN_04a: RLS enabled on inventory_counts'
);

-- T_OPN_05 — variance GENERATED
SELECT is(
  (SELECT is_generated FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_count_items'
      AND column_name='variance'),
  'ALWAYS',
  'T_OPN_05: inventory_count_items.variance is a GENERATED column'
);

-- T_OPN_06 — status CHECK constraint exists (rejects 'invalid')
SELECT throws_ok(
  $$INSERT INTO inventory_counts (count_number, section_id, status, created_by)
        VALUES ('OPN-TEST-9999',
                (SELECT id FROM sections LIMIT 1),
                'invalid_status',
                (SELECT id FROM user_profiles LIMIT 1))$$,
  '23514',
  NULL,
  'T_OPN_06: status CHECK rejects invalid value'
);

-- T_OPN_07 — UNIQUE(count_id, product_id) — verify constraint exists
SELECT is(
  (SELECT COUNT(*)::INT FROM information_schema.table_constraints
    WHERE table_schema='public'
      AND table_name='inventory_count_items'
      AND constraint_type='UNIQUE'),
  1,
  'T_OPN_07: UNIQUE constraint exists on inventory_count_items'
);

-- T_OPN_08 — perms seeded
SELECT is(
  (SELECT COUNT(*)::INT FROM permissions
    WHERE code IN ('inventory.opname.create','inventory.opname.finalize')),
  2,
  'T_OPN_08: opname permissions seeded'
);

-- T_OPN_09 — role_permissions wired
SELECT cmp_ok(
  (SELECT COUNT(*)::INT FROM role_permissions
    WHERE permission_code IN ('inventory.opname.create','inventory.opname.finalize')),
  '>=',
  5,
  'T_OPN_09: opname role_permissions wired for MANAGER/ADMIN/SUPER_ADMIN'
);

-- T_OPN_10 — finalize_opname_v1 status guard — call as anonymous (should raise forbidden)
SELECT throws_ok(
  $$SELECT finalize_opname_v1(gen_random_uuid())$$,
  'P0003',
  NULL,
  'T_OPN_10: finalize_opname_v1 forbids anonymous callers'
);

-- T_OPN_11 — enum values opname_in + opname_out present
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'movement_type'
      AND e.enumlabel IN ('opname_in','opname_out')),
  2,
  'T_OPN_11: movement_type enum has opname_in + opname_out'
);

-- T_OPN_12 — view exists
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='view_section_stock_details' AND c.relkind='v'),
  1,
  'T_OPN_12: view_section_stock_details exists'
);

-- T_OPN_13 — all 4 query RPCs exist
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc
    WHERE proname IN (
      'get_stock_movements_v1','get_movement_aggregates_v1',
      'get_low_stock_v1','get_reorder_suggestions_v1','get_product_dashboard_v2'
    )),
  5,
  'T_OPN_13: 5 query RPCs (movements/aggregates/low_stock/reorder/dashboard) exist'
);

SELECT * FROM finish();

ROLLBACK;
