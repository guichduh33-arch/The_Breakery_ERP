-- ADR-036 : le B2B ne lit ni ne modifie la vitrine.
-- Helpers internes, signature et appelants inchangés ; remplacement en place comme
-- la migration 20260908000007. Corps issus de pg_get_functiondef sur V3 dev le
-- 2026-11-02. Le contrôle prosrc refuse tout écrasement d'une évolution inconnue.
-- Aucun mouvement historique n'est réécrit ni compensé automatiquement.
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public._record_sale_stock_v1(uuid,numeric,uuid,uuid,text,movement_type,text,text,boolean)'::regprocedure)
      IS DISTINCT FROM '52a9cf30874c8157cf84eed4ce15e885'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public._restore_sale_stock_v1(uuid,numeric,uuid,uuid,text,movement_type,text,text,uuid)'::regprocedure)
      IS DISTINCT FROM 'e6b2b3b6fd66c3609ec0491b9bb0aefa' THEN
    RAISE EXCEPTION 'sale_stock_helper_drift: inspect live definitions before applying ADR-036';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public._record_sale_stock_v1(p_product_id uuid, p_quantity numeric, p_reference_id uuid, p_created_by uuid, p_reason text, p_movement_type movement_type DEFAULT 'sale'::movement_type, p_reference_type text DEFAULT 'orders'::text, p_unit text DEFAULT NULL::text, p_allow_negative boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_display boolean;
  v_is_b2b     boolean;
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

  -- Le canal vient de la commande persistée, jamais du motif ou d'un drapeau client.
  SELECT EXISTS (SELECT 1 FROM public.orders
    WHERE id = p_reference_id AND order_type = 'b2b') INTO v_is_b2b;

  IF v_is_display AND NOT v_is_b2b THEN
    SELECT quantity INTO v_disp_qty FROM display_stock WHERE product_id = p_product_id;
    -- S61 F-2 : garde inconditionnelle (plus de NOT p_allow_negative) + ERRCODE P0002
    IF COALESCE(v_disp_qty, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient display stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_disp_qty, 0)
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF v_track OR v_is_b2b THEN
    IF (v_is_b2b OR NOT p_allow_negative) AND COALESCE(v_current, 0) < p_quantity THEN
      -- S61 F-2 : ERRCODE P0002 (l EF process-payment mappe P0002 -> insufficient_stock 409)
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

  IF v_is_display AND NOT v_is_b2b THEN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_product_id, p_movement_type::text::display_movement_type, -p_quantity, p_reason, 'order', p_reference_id, p_created_by
    );
    UPDATE display_stock
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE product_id = p_product_id;
    IF NOT FOUND THEN
      -- 2026-09-08 : on cite la FAMILLE, jamais la version — la v1 a ete droppee (F4).
      RAISE EXCEPTION 'No display_stock row for display product % — run add_display_stock first', p_product_id;
    END IF;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._restore_sale_stock_v1(p_product_id uuid, p_quantity numeric, p_reference_id uuid, p_created_by uuid, p_reason text, p_movement_type movement_type DEFAULT 'sale_void'::movement_type, p_reference_type text DEFAULT 'orders'::text, p_unit text DEFAULT NULL::text, p_display_reference_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_display boolean;
  v_is_b2b     boolean;
  v_unit       text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid restore quantity % for product %', p_quantity, p_product_id;
  END IF;

  SELECT COALESCE(is_display_item, false), COALESCE(p_unit, unit, 'pcs')
    INTO v_is_display, v_unit
    FROM products WHERE id = p_product_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_unit, p_reference_type, p_reference_id, p_created_by
  );

  UPDATE products
    SET current_stock = current_stock + p_quantity, updated_at = now()
    WHERE id = p_product_id;

  SELECT EXISTS (SELECT 1 FROM public.orders
    WHERE id = COALESCE(p_display_reference_id, p_reference_id)
      AND order_type = 'b2b') INTO v_is_b2b;

  IF v_is_display AND NOT v_is_b2b THEN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_product_id, 'adjustment', p_quantity, p_reason, 'order',
      COALESCE(p_display_reference_id, p_reference_id), p_created_by
    );
    UPDATE display_stock
      SET quantity = quantity + p_quantity, updated_at = now()
      WHERE product_id = p_product_id;
  END IF;
END;
$function$
;

-- Helpers réservés aux RPC SECURITY DEFINER ; aucun nouvel accès client.
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(uuid,numeric,uuid,uuid,text,movement_type,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._record_sale_stock_v1(uuid,numeric,uuid,uuid,text,movement_type,text,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION public._restore_sale_stock_v1(uuid,numeric,uuid,uuid,text,movement_type,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._restore_sale_stock_v1(uuid,numeric,uuid,uuid,text,movement_type,text,text,uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
