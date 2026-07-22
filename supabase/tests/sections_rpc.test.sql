-- supabase/tests/sections_rpc.test.sql
-- ADR-007 déc. 5 — pgTAP suite for upsert_section_v1 / delete_section_v1
-- (migration _206).
--
-- Coverage (7 asserts) :
--   T1  ADMIN create : row créée, code uppercasé
--   T2  ADMIN update : name muté, code IMMUABLE (payload code ignoré)
--   T3  CASHIER → 42501 permission_denied
--   T4  kind invalide → 22023
--   T5  delete : soft-delete (deleted_at posé, is_active=false)
--   T6  update d'une section supprimée → P0002
--   T7  policies d'écriture directe droppées (perm_write_insert/update absents)
--
-- Run via MCP execute_sql wrap BEGIN/ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- Fixtures.
DO $$
DECLARE
  v_admin_uid UUID;
  v_cashier_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
   WHERE employee_code = 'EMP000' LIMIT 1;
  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles
   WHERE role_code = 'CASHIER' AND deleted_at IS NULL LIMIT 1;
  IF v_admin_uid IS NULL OR v_cashier_uid IS NULL THEN
    RAISE EXCEPTION 'fixture missing';
  END IF;
  PERFORM set_config('breakery.t206_admin_uid', v_admin_uid::TEXT, false);
  PERFORM set_config('breakery.t206_cashier_uid', v_cashier_uid::TEXT, false);
END $$;

-- T1 : create.
DO $t1$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.t206_admin_uid'),
                       'role', 'authenticated')::TEXT, true);
  v_result := upsert_section_v1(jsonb_build_object(
    'code', 'pgtap_t206', 'name', 'pgTAP T206', 'kind', 'production',
    'is_active', true, 'display_order', 990));
  PERFORM set_config('breakery.t206_section_id', v_result->>'id', false);
  PERFORM set_config('breakery.t206_t1_code', v_result->>'code', false);
END $t1$;

SELECT is(
  current_setting('breakery.t206_t1_code'),
  'PGTAP_T206',
  'T1 create : row créée, code uppercasé'
);

-- T2 : update — name muté, code payload ignoré (immuable).
DO $t2$
DECLARE
  v_result JSONB;
BEGIN
  v_result := upsert_section_v1(jsonb_build_object(
    'id', current_setting('breakery.t206_section_id'),
    'code', 'HACKED_CODE', 'name', 'pgTAP T206 renamed', 'kind', 'sales',
    'is_active', false, 'display_order', 991));
  PERFORM set_config('breakery.t206_t2_name', v_result->>'name', false);
  PERFORM set_config('breakery.t206_t2_code', v_result->>'code', false);
END $t2$;

SELECT ok(
  current_setting('breakery.t206_t2_name') = 'pgTAP T206 renamed'
  AND current_setting('breakery.t206_t2_code') = 'PGTAP_T206',
  'T2 update : name muté, code immuable (payload ignoré)'
);

-- T3 : CASHIER → 42501.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.t206_cashier_uid'),
                       'role', 'authenticated')::TEXT, true);
END $$;

SELECT throws_ok(
  $q$SELECT upsert_section_v1('{"code":"NOPE","name":"nope","kind":"sales"}'::JSONB)$q$,
  '42501',
  'permission_denied',
  'T3 CASHIER cannot upsert a section (42501)'
);

-- T4 : kind invalide (repasse ADMIN).
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.t206_admin_uid'),
                       'role', 'authenticated')::TEXT, true);
END $$;

SELECT throws_ok(
  $q$SELECT upsert_section_v1('{"code":"BAD","name":"bad","kind":"spaceship"}'::JSONB)$q$,
  '22023',
  'invalid_kind',
  'T4 invalid kind raises 22023'
);

-- T5 : delete soft.
DO $t5$
DECLARE
  v_result JSONB;
BEGIN
  v_result := delete_section_v1(current_setting('breakery.t206_section_id')::UUID);
  PERFORM set_config('breakery.t206_t5_state',
    (SELECT (deleted_at IS NOT NULL AND is_active = false)::TEXT
       FROM sections WHERE id = current_setting('breakery.t206_section_id')::UUID),
    false);
END $t5$;

SELECT ok(
  current_setting('breakery.t206_t5_state')::BOOLEAN,
  'T5 delete : deleted_at posé + is_active=false (soft)'
);

-- T6 : update d'une section supprimée → P0002.
SELECT throws_ok(
  format($q$SELECT upsert_section_v1(jsonb_build_object(
    'id', %L, 'name', 'ghost', 'kind', 'sales'))$q$,
    current_setting('breakery.t206_section_id')),
  'P0002',
  'section_not_found',
  'T6 update on a deleted section raises P0002'
);

-- T7 : les policies d'écriture directe sont droppées.
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_policies
    WHERE tablename = 'sections'
      AND policyname IN ('perm_write_insert', 'perm_write_update')),
  0,
  'T7 direct-write policies dropped (RPC = unique chemin d''écriture)'
);

SELECT * FROM finish();
ROLLBACK;
