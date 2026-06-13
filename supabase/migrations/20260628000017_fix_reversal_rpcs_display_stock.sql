-- 20260628000017_fix_reversal_rpcs_display_stock.sql
-- Session 44 / Wave D / P1-C : la vente (v11/v12/v8) décrémente display_stock
-- pour les is_display_item — le reversal doit le rétablir, sinon dérive
-- permanente du compteur vitrine (pilote le sold-out S43). void_order_rpc_v2 et
-- refund_order_rpc_v3 restauraient current_stock mais pas display_stock.
-- cancel_order_item_rpc_v2 NON affecté (annulation pré-paiement, aucune déduction).
-- Pattern corrective S38 (pg_get_functiondef + replace, signatures inchangées,
-- ACL conservées). movement_type 'adjustment' (l'enum display_movement_type
-- n'a pas de valeur reversal dédiée : stock_in/sale/return_to_kitchen/waste/adjustment).

DO $mig$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.void_order_rpc_v2'::regproc);
  v_def := replace(
    v_def,
    E'    UPDATE products SET\n      current_stock = current_stock + v_item.quantity,\n      updated_at    = now()\n    WHERE id = v_item.product_id;',
    E'    UPDATE products SET\n      current_stock = current_stock + v_item.quantity,\n      updated_at    = now()\n    WHERE id = v_item.product_id;\n    -- S44 P1-C : restaure le compteur vitrine si is_display_item.\n    IF (SELECT is_display_item FROM products WHERE id = v_item.product_id) THEN\n      INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)\n        VALUES (v_item.product_id, ''adjustment'', v_item.quantity, ''Order voided — display restore'', ''order'', p_order_id, v_profile_id);\n      UPDATE display_stock SET quantity = quantity + v_item.quantity, updated_at = now() WHERE product_id = v_item.product_id;\n    END IF;'
  );
  IF v_def NOT LIKE '%display_movements%' THEN
    RAISE EXCEPTION 'void_order_rpc_v2 anchor not matched';
  END IF;
  EXECUTE v_def;
END $mig$;

DO $mig$
DECLARE v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.refund_order_rpc_v3'::regproc);
  v_def := replace(
    v_def,
    E'    UPDATE products SET\n      current_stock = current_stock + v_qty_req,\n      updated_at    = now()\n    WHERE id = v_product_id;',
    E'    UPDATE products SET\n      current_stock = current_stock + v_qty_req,\n      updated_at    = now()\n    WHERE id = v_product_id;\n    -- S44 P1-C : restaure le compteur vitrine si is_display_item.\n    IF (SELECT is_display_item FROM products WHERE id = v_product_id) THEN\n      INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)\n        VALUES (v_product_id, ''adjustment'', v_qty_req, ''Order refunded — display restore'', ''order'', p_order_id, v_profile_id);\n      UPDATE display_stock SET quantity = quantity + v_qty_req, updated_at = now() WHERE product_id = v_product_id;\n    END IF;'
  );
  IF v_def NOT LIKE '%display_movements%' THEN
    RAISE EXCEPTION 'refund_order_rpc_v3 anchor not matched';
  END IF;
  EXECUTE v_def;
END $mig$;
