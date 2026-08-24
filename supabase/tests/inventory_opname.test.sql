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
--   T_OPN_10 — finalize_opname_v3 status guard rejects bad statuses (no perm
--             needed since we test the schema-level state machine).
--   T_OPN_11 — opname_in + opname_out enum values present.
--   T_OPN_12 — ADR-027 : view_section_stock_details est droppée.
--   T_OPN_13 — get_low_stock_v2 + get_reorder_suggestions_v1 + get_product_dashboard_v3
--             execute without crash for an admin user.
--   T_OPN_14 — ADR-027 : add_opname_item_v2 charge l'attendu depuis
--             products.current_stock quand p_expected_qty est NULL.
--   T_OPN_15 — ADR-027 : finalize_opname_v3 émet opname_in/out SANS section
--             (from/to_section_id NULL) et corrige products.current_stock.
--
-- ADR-027 (2026-08-16) : create_opname_v1/add_opname_item_v1/finalize_opname_v1
-- droppées au profit de create_opname_v2/add_opname_item_v2/finalize_opname_v3
-- (plus d'argument section). view_section_stock_details droppée.
-- get_low_stock_v1 -> get_low_stock_v2 ; get_product_dashboard_v2 -> _v3.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(16);

-- T_OPN_01 — tables + sequence
SELECT is(
  (SELECT COUNT(*)::INT FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('inventory_counts','inventory_count_items')),
  2,
  'T_OPN_01: inventory_counts + inventory_count_items tables exist'
);

-- T_OPN_02 — RPCs exist (ADR-027 : create/add_item/finalize en _v2)
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc
    WHERE proname IN (
      'create_opname_v2','add_opname_item_v2','set_opname_count_v1',
      'validate_opname_v1','finalize_opname_v3','cancel_opname_v1',
      'next_count_number'
    )),
  7,
  'T_OPN_02: 6 opname RPCs (3 v2 + 3 v1) + next_count_number exist'
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

-- T_OPN_09 — grants SUPER_ADMIN, la seule ligne que l'éditeur ADR-031 verrouille.
-- Les grants des autres rôles sont de la donnée éditable à chaud depuis
-- /settings/roles : les affirmer ici casserait la CI à chaque réglage réel.
SELECT is(
  (SELECT COUNT(*)::INT FROM role_permissions
    WHERE role_code = 'SUPER_ADMIN' AND is_granted
      AND permission_code IN ('inventory.opname.create','inventory.opname.finalize')),
  2,
  'T_OPN_09: opname permissions granted to SUPER_ADMIN (editor-locked row)'
);

-- T_OPN_10 — finalize_opname_v3 status guard — call as anonymous (should raise forbidden)
SELECT throws_ok(
  $$SELECT finalize_opname_v3(gen_random_uuid())$$,
  'P0003',
  NULL,
  'T_OPN_10: finalize_opname_v3 forbids anonymous callers'
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

-- T_OPN_12 — ADR-027 : view_section_stock_details est droppée (cache par
-- section supprimé, mono-section).
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='view_section_stock_details'
  ),
  'T_OPN_12: view_section_stock_details is dropped (ADR-027, mono-section)'
);

-- T_OPN_13 — query RPCs exist (ADR-027 : get_low_stock_v2, dashboard v3)
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_proc
    WHERE proname IN (
      'get_stock_movements_v1','get_movement_aggregates_v2',
      'get_low_stock_v2','get_reorder_suggestions_v1','get_product_dashboard_v3'
    )),
  5,
  'T_OPN_13: 5 query RPCs (movements/aggregates/low_stock_v2/reorder/dashboard_v3) exist'
);

-- ---------------------------------------------------------------------------
-- Fixtures + auth-spoofing helper for T_OPN_14 / T_OPN_15 (mirrors the
-- pattern documented in inventory.test.sql — pgTAP ok() must be invoked via
-- SELECT, so DO blocks stash their boolean result in a GUC).
-- ---------------------------------------------------------------------------
DO $bootstrap$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles WHERE employee_code = 'EMP000';
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found — run pnpm db:reset first';
  END IF;
  PERFORM set_config('breakery.opn_admin_uid', v_admin_uid::text, false);
END $bootstrap$;

CREATE OR REPLACE FUNCTION pg_temp.set_jwt_uid(p_uid UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.set_jwt_uid(UUID) TO PUBLIC;

DO $$
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.opn_admin_uid')::uuid);
END $$;

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES (
  '99999999-00e0-00e0-00e0-111111111111'::uuid,
  'PGTAP-OPN-1', 'pgTAP Opname Product 1',
  (SELECT id FROM categories LIMIT 1),
  10000, 42.500, 0
) ON CONFLICT (id) DO UPDATE SET current_stock = 42.500;

-- =========================================================================
-- T_OPN_14 — ADR-027 : add_opname_item_v2(p_expected_qty := NULL) charge
-- l'attendu depuis products.current_stock (42.500 pour la fixture ci-dessus).
-- =========================================================================
DO $t_opn_14$
DECLARE
  v_count   JSONB;
  v_count_id UUID;
  v_item    JSONB;
  v_expected_returned NUMERIC;
  v_expected_stored    NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.opn_admin_uid')::uuid);

  SELECT create_opname_v2('T_OPN_14 fixture') INTO v_count;
  v_count_id := (v_count->>'count_id')::uuid;
  PERFORM set_config('breakery.opn14_count_id', v_count_id::text, false);

  SELECT add_opname_item_v2(
    v_count_id, '99999999-00e0-00e0-00e0-111111111111'::uuid, NULL, 'T_OPN_14'
  ) INTO v_item;

  v_expected_returned := (v_item->>'expected_qty')::numeric;
  SELECT expected_qty INTO v_expected_stored
    FROM inventory_count_items
   WHERE count_id = v_count_id
     AND product_id = '99999999-00e0-00e0-00e0-111111111111'::uuid;

  PERFORM set_config('breakery.t_opn_14_pass',
    (v_expected_returned = 42.500 AND v_expected_stored = 42.500)::text, false);
END $t_opn_14$;
SELECT ok(current_setting('breakery.t_opn_14_pass')::boolean,
  'T_OPN_14: add_opname_item_v2(p_expected_qty=NULL) defaults expected_qty to products.current_stock (42.500)');

-- =========================================================================
-- T_OPN_15 — ADR-027 : finalize_opname_v3 émet opname_in/out avec sections
-- NULL et corrige products.current_stock. Compte à 50.000 (variance +7.500
-- sur l'attendu 42.500 chargé en T_OPN_14) -> mouvement opname_in +7.500.
-- =========================================================================
DO $t_opn_15$
DECLARE
  v_count_id UUID := current_setting('breakery.opn14_count_id')::uuid;
  v_item_id  UUID;
  v_finalize JSONB;
  v_mvt_id   UUID;
  v_mvt_type movement_type;
  v_mvt_qty  NUMERIC;
  v_mvt_from UUID;
  v_mvt_to   UUID;
  v_new_stock NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.opn_admin_uid')::uuid);

  SELECT id INTO v_item_id FROM inventory_count_items
   WHERE count_id = v_count_id
     AND product_id = '99999999-00e0-00e0-00e0-111111111111'::uuid;

  PERFORM set_opname_count_v1(v_item_id, 50.000, 'T_OPN_15 counted');
  PERFORM validate_opname_v1(v_count_id);

  SELECT finalize_opname_v3(v_count_id) INTO v_finalize;

  SELECT id, movement_type, quantity, from_section_id, to_section_id
    INTO v_mvt_id, v_mvt_type, v_mvt_qty, v_mvt_from, v_mvt_to
    FROM stock_movements
   WHERE reference_type = 'opname' AND reference_id = v_count_id
   ORDER BY created_at DESC LIMIT 1;

  SELECT current_stock INTO v_new_stock FROM products
   WHERE id = '99999999-00e0-00e0-00e0-111111111111'::uuid;

  PERFORM set_config('breakery.t_opn_15_pass',
    CASE WHEN
      v_finalize->>'status' = 'finalized'
      AND v_mvt_type = 'opname_in'::movement_type
      AND v_mvt_qty = 7.500
      AND v_mvt_from IS NULL
      AND v_mvt_to IS NULL
      AND v_new_stock = 50.000
    THEN 'true' ELSE 'false' END, false);
END $t_opn_15$;
SELECT ok(current_setting('breakery.t_opn_15_pass')::boolean,
  'T_OPN_15: finalize_opname_v3 emits opname_in +7.500 with from/to_section_id NULL and sets products.current_stock=50.000');


-- =========================================================================
-- T_OPN_16 — la révélation n'est pas contournable. finalize_opname_v3 refuse
-- le statut `counting` : le seul chemin depuis le comptage est
-- validate_opname_v1, qui fige la saisie et découvre les écarts. v2
-- l'acceptait, ce qui rendait l'écriture comptable définitive postable sans
-- que personne ait vu les écarts validés.
-- =========================================================================
DO $t_opn_16$
DECLARE
  v_count    JSONB;
  v_count_id UUID;
  v_item     JSONB;
  v_item_id  UUID;
  v_status   TEXT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.opn_admin_uid')::uuid);

  SELECT create_opname_v2('T_OPN_16 fixture') INTO v_count;
  v_count_id := (v_count->>'count_id')::uuid;

  SELECT add_opname_item_v2(
    v_count_id, '99999999-00e0-00e0-00e0-111111111111'::uuid, 10.000, 'T_OPN_16'
  ) INTO v_item;
  SELECT id INTO v_item_id FROM inventory_count_items
   WHERE count_id = v_count_id
     AND product_id = '99999999-00e0-00e0-00e0-111111111111'::uuid;

  -- Toutes les lignes sont comptées : `missing_counts` ne peut pas masquer
  -- la garde de statut qu'on veut prouver.
  PERFORM set_opname_count_v1(v_item_id, 12.000, 'T_OPN_16 counted');

  SELECT status INTO v_status FROM inventory_counts WHERE id = v_count_id;
  IF v_status <> 'counting' THEN
    RAISE EXCEPTION 'T_OPN_16 fixture attendait counting, a obtenu %', v_status;
  END IF;

  PERFORM set_config('breakery.opn16_count_id', v_count_id::text, false);
END $t_opn_16$;
SELECT throws_ok(
  format($q$SELECT finalize_opname_v3(%L::uuid)$q$,
         current_setting('breakery.opn16_count_id')),
  'P0001',
  'finalize_not_allowed_in_status',
  'T_OPN_16: finalize_opname_v3 refuses status counting — reveal is not skippable'
);
SELECT * FROM finish();

ROLLBACK;
