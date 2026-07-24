-- 20260724000216_floor_plan_grid_positions.sql
-- ADR-006 déc. 9 (floor plan visuel, lot A) — positions de tables sur une
-- grille par section (arbitrage Mamat 2026-07-24 : grille avec snap, 12×8).
-- grid_x ∈ [0,11], grid_y ∈ [0,7], NULL/NULL = table non placée (rendue en
-- flux comme aujourd'hui). Écritures via set_table_position_v1 uniquement
-- (restaurant_tables est RPC-only depuis _161).

ALTER TABLE public.restaurant_tables
  ADD COLUMN grid_x INTEGER,
  ADD COLUMN grid_y INTEGER;

-- Les deux coordonnées vont ensemble, et restent dans la grille 12×8.
ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT restaurant_tables_grid_pos_valid CHECK (
    ((grid_x IS NULL) = (grid_y IS NULL))
    AND (grid_x IS NULL OR (grid_x >= 0 AND grid_x <= 11 AND grid_y >= 0 AND grid_y <= 7))
  );

-- Une table par cellule et par section. NULLS NOT DISTINCT : deux tables du
-- bucket legacy (section_id NULL) entrent aussi en collision. Les tables
-- inactives GARDENT leur cellule (réactivation sans surprise) ; seules les
-- soft-deleted la libèrent.
CREATE UNIQUE INDEX restaurant_tables_grid_cell_unique
  ON public.restaurant_tables (section_id, grid_x, grid_y) NULLS NOT DISTINCT
  WHERE grid_x IS NOT NULL AND deleted_at IS NULL;

-- RPC dédiée au drag & drop : ne touche que la position (pas name/seats),
-- même conventions que le CRUD _161 (P0003 permission, P0002 not found,
-- P0001 domaine, audit_logs, RETURNS row).
CREATE FUNCTION public.set_table_position_v1(p_id uuid, p_grid_x int, p_grid_y int)
RETURNS restaurant_tables LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_old restaurant_tables; v_row restaurant_tables;
BEGIN
  IF NOT has_permission(v_uid, 'tables.update') THEN
    RAISE EXCEPTION 'permission_denied: tables.update' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_old FROM restaurant_tables WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002'; END IF;
  IF (p_grid_x IS NULL) <> (p_grid_y IS NULL) THEN
    RAISE EXCEPTION 'invalid_position' USING ERRCODE = 'P0001';
  END IF;
  IF p_grid_x IS NOT NULL AND (p_grid_x < 0 OR p_grid_x > 11 OR p_grid_y < 0 OR p_grid_y > 7) THEN
    RAISE EXCEPTION 'invalid_position' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    UPDATE restaurant_tables SET grid_x = p_grid_x, grid_y = p_grid_y, updated_at = now()
    WHERE id = p_id RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'cell_occupied' USING ERRCODE = 'P0001';
  END;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'restaurant_table.moved', 'restaurant_tables', p_id,
          jsonb_build_object(
            'name',   v_old.name,
            'before', jsonb_build_object('grid_x', v_old.grid_x, 'grid_y', v_old.grid_y),
            'after',  jsonb_build_object('grid_x', p_grid_x, 'grid_y', p_grid_y)));
  RETURN v_row;
END $$;

-- Grants — miroir _161 (defense-in-depth anon).
REVOKE ALL ON FUNCTION public.set_table_position_v1(uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_table_position_v1(uuid, int, int) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_table_position_v1(uuid, int, int) TO authenticated;

COMMENT ON FUNCTION public.set_table_position_v1(uuid, int, int) IS
  'Floor plan visual editor (ADR-006 dec. 9, lot A): move a table on its '
  'section 12x8 grid (NULL/NULL = unplaced). Gate tables.update, one table '
  'per cell (cell_occupied), audited restaurant_table.moved.';
