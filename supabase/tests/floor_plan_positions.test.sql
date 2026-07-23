-- supabase/tests/floor_plan_positions.test.sql
-- ADR-006 déc. 9 (floor plan visuel, lot A) — set_table_position_v1 (_216) :
-- grille 12×8 par section, une table par cellule, NULL/NULL = non placée.
-- Validée sur V3 dev le 2026-07-24 (8/8).
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_auth UUID; v_sec UUID; v_t1 UUID; v_t2 UUID; v_row restaurant_tables;
BEGIN
  SELECT up.auth_user_id INTO v_auth FROM user_profiles up
  WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
    AND has_permission(up.auth_user_id, 'tables.update') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_sec FROM table_sections WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO restaurant_tables (name, seats, section_id) VALUES ('FPTEST-1', 4, v_sec) RETURNING id INTO v_t1;
  INSERT INTO restaurant_tables (name, seats, section_id) VALUES ('FPTEST-2', 2, v_sec) RETURNING id INTO v_t2;

  -- T1: placement valide, position relue sur la ligne retournée.
  v_row := set_table_position_v1(v_t1, 3, 2);
  INSERT INTO _r VALUES ('t1_place', v_row.grid_x = 3 AND v_row.grid_y = 2);

  -- T2: collision même cellule / même section -> cell_occupied.
  BEGIN
    PERFORM set_table_position_v1(v_t2, 3, 2);
    INSERT INTO _r VALUES ('t2_collision', false);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    INSERT INTO _r VALUES ('t2_collision', SQLERRM = 'cell_occupied');
  END;

  -- T3: hors bornes (grid_x 12) -> invalid_position.
  BEGIN
    PERFORM set_table_position_v1(v_t2, 12, 0);
    INSERT INTO _r VALUES ('t3_bounds', false);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    INSERT INTO _r VALUES ('t3_bounds', SQLERRM = 'invalid_position');
  END;

  -- T4: une seule coordonnée NULL -> invalid_position.
  BEGIN
    PERFORM set_table_position_v1(v_t2, 5, NULL);
    INSERT INTO _r VALUES ('t4_halfnull', false);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    INSERT INTO _r VALUES ('t4_halfnull', SQLERRM = 'invalid_position');
  END;

  -- T5: NULL/NULL = retirer du plan.
  v_row := set_table_position_v1(v_t1, NULL, NULL);
  INSERT INTO _r VALUES ('t5_unplace', v_row.grid_x IS NULL AND v_row.grid_y IS NULL);

  -- T6: audit restaurant_table.moved écrit.
  INSERT INTO _r SELECT 't6_audit', EXISTS (
    SELECT 1 FROM audit_logs WHERE action = 'restaurant_table.moved' AND entity_id = v_t1);

  -- T7: sans tables.update -> P0003.
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  BEGIN
    PERFORM set_table_position_v1(v_t1, 1, 1);
    INSERT INTO _r VALUES ('t7_perm', false);
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    INSERT INTO _r VALUES ('t7_perm', true);
  END;

  -- T8: ACL — anon sans EXECUTE (defense-in-depth _216).
  INSERT INTO _r VALUES ('t8_acl',
    NOT has_function_privilege('anon', 'public.set_table_position_v1(uuid,int,int)', 'EXECUTE'));
END $$;

SELECT plan(8);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_place'),     'T1: valid placement persists and returns the row');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_collision'), 'T2: same cell same section rejected (cell_occupied)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_bounds'),    'T3: out-of-grid position rejected (invalid_position)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_halfnull'),  'T4: half-NULL position rejected (invalid_position)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_unplace'),   'T5: NULL/NULL unplaces the table');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_audit'),     'T6: restaurant_table.moved audit row written');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_perm'),      'T7: without tables.update -> P0003');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t8_acl'),       'T8: anon has no EXECUTE on set_table_position_v1');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
