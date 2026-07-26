-- ADR-013 Lot 3 (D15/M3) -- _record_sale_stock_v1 : search_path durci.
-- Helper interne non versionne (_v1 fige) : CREATE OR REPLACE sans bump,
-- precedent 20260710000107. Corps = pg_get_functiondef LIVE (dump 2026-07-26),
-- SEUL changement : SET search_path = public, pg_temp (CREATE OR REPLACE
-- reecrit les attributs SET -- le durcissement DOIT etre dans la definition).
-- [types-noop] : signature inchangee, aucun impact types generes.
CREATE OR REPLACE FUNCTION public._record_sale_stock_v1(p_product_id uuid, p_quantity numeric, p_reference_id uuid, p_created_by uuid, p_reason text, p_movement_type movement_type DEFAULT 'sale'::movement_type, p_reference_type text DEFAULT 'orders'::text, p_unit text DEFAULT NULL::text, p_allow_negative boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_display boolean;
  v_track      boolean;
  v_current    numeric;
  v_unit       text;
  v_name       text;
  v_disp_qty   numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid sale quantity % for product %', p_quantity, p_product_id;
  END IF;

  SELECT is_display_item, COALESCE(track_inventory, true), current_stock, COALESCE(p_unit, unit, 'pcs'), name
    INTO v_is_display, v_track, v_current, v_unit, v_name
    FROM products WHERE id = p_product_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  IF v_is_display THEN
    SELECT quantity INTO v_disp_qty FROM display_stock WHERE product_id = p_product_id;
    -- S61 F-2 : garde inconditionnelle (plus de NOT p_allow_negative) + ERRCODE P0002
    IF COALESCE(v_disp_qty, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient display stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_disp_qty, 0)
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF v_track THEN
    IF NOT p_allow_negative AND COALESCE(v_current, 0) < p_quantity THEN
      -- S61 F-2 : ERRCODE P0002 (l'EF process-payment mappe P0002 -> insufficient_stock 409)
      RAISE EXCEPTION 'Insufficient stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_current, 0)
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
  ) VALUES (
    p_product_id, p_movement_type, -p_quantity, v_unit, p_reference_type, p_reference_id, p_created_by
  );

  UPDATE products
    SET current_stock = current_stock - p_quantity, updated_at = now()
    WHERE id = p_product_id;

  IF v_is_display THEN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_product_id, p_movement_type::text::display_movement_type, -p_quantity, p_reason, 'order', p_reference_id, p_created_by
    );
    UPDATE display_stock
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE product_id = p_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No display_stock row for display product % — run add_display_stock_v1 first', p_product_id;
    END IF;
  END IF;
END;
$function$;

-- ACL re-assertion (le rejeu doit etre auto-suffisant) : helper interne,
-- aucun GRANT -- appele uniquement depuis les RPC SECURITY DEFINER (owner).
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(p_product_id uuid, p_quantity numeric, p_reference_id uuid, p_created_by uuid, p_reason text, p_movement_type movement_type, p_reference_type text, p_unit text, p_allow_negative boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(p_product_id uuid, p_quantity numeric, p_reference_id uuid, p_created_by uuid, p_reason text, p_movement_type movement_type, p_reference_type text, p_unit text, p_allow_negative boolean) FROM anon;
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(p_product_id uuid, p_quantity numeric, p_reference_id uuid, p_created_by uuid, p_reason text, p_movement_type movement_type, p_reference_type text, p_unit text, p_allow_negative boolean) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

