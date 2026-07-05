-- S61 F-2 : contrat d'erreur des gardes d'insuffisance de _record_sale_stock_v1.
-- 1) garde display INCONDITIONNELLE (la CHECK display_stock_quantity_check interdit
--    le négatif quoi qu'il arrive — allow_negative_stock ne s'applique pas à la vitrine ;
--    avant : flag ON => CHECK brute 23514, classée check_violation 422 par l'EF)
-- 2) ERRCODE P0002 sur les 2 gardes (avant : P0001, que process-payment classe
--    en no_open_session — contresens caissier). L'EF mappe déjà P0002 -> insufficient_stock 409.
-- In-place depuis le corps live (DEV-S57-02), signature inchangée — les ACLs
-- (REVOKE anon/authenticated/PUBLIC de _073) survivent au CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public._record_sale_stock_v1(p_product_id uuid, p_quantity numeric, p_reference_id uuid, p_created_by uuid, p_reason text, p_movement_type movement_type DEFAULT 'sale'::movement_type, p_reference_type text DEFAULT 'orders'::text, p_unit text DEFAULT NULL::text, p_allow_negative boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

COMMENT ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) IS
  'S53 P1.4 internal sale-stock helper (EF-only, REVOKEd). S61 F-2: insufficiency guards raise P0002 (insufficient_stock contract); display guard unconditional — allow_negative_stock never applies to the display counter (CHECK >= 0).';
