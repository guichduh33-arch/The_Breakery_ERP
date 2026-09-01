-- Helper de RESTITUTION de stock, miroir de `_record_sale_stock_v1`.
--
-- Pourquoi : `_record_sale_stock_v1` ne sait que RETIRER — il refuse
-- `p_quantity <= 0` et ecrit toujours `-p_quantity`. Les deux RPC de retour
-- (void / refund) recopiaient donc, SIX fois, le meme triplet
-- `INSERT stock_movements` + `UPDATE products` + `UPDATE display_stock`.
-- Ce helper porte ce triplet une seule fois, pour que la correction de la
-- branche recette (migrations suivantes) ne soit ecrite qu'une fois par RPC.
--
-- Il ne porte AUCUNE decision metier : il ecrit ce qu'on lui donne. Le choix
-- de RENDRE le produit fini ou de rendre sa recette appartient a l'appelant.
--
-- Comportement copie a l'identique des blocs remplaces, y compris leurs
-- asymetries assumees :
--   * `stock_movements` porte la reference de l'appelant (`orders` pour le
--     void, `refunds` pour le refund) ;
--   * `display_movements` porte TOUJOURS ('order', id de la commande) — d'ou
--     le parametre `p_display_reference_id` distinct ;
--   * `display_movements.movement_type` est 'adjustment', pas le type du
--     mouvement de stock (l'enum `display_movement_type` ne connait pas
--     'sale_void') ;
--   * un produit vitrine sans ligne `display_stock` ne leve PAS : l'UPDATE ne
--     touche aucune ligne, en silence. C'est le comportement actuel ; la vente
--     garantit deja l'existence de la ligne (`_record_sale_stock_v1` leve si
--     elle manque), donc une restitution en trouve toujours une.

CREATE OR REPLACE FUNCTION public._restore_sale_stock_v1(
  p_product_id            uuid,
  p_quantity              numeric,
  p_reference_id          uuid,
  p_created_by            uuid,
  p_reason                text,
  p_movement_type         movement_type DEFAULT 'sale_void'::movement_type,
  p_reference_type        text          DEFAULT 'orders'::text,
  p_unit                  text          DEFAULT NULL::text,
  p_display_reference_id  uuid          DEFAULT NULL::uuid
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_display boolean;
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

  IF v_is_display THEN
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
$function$;

COMMENT ON FUNCTION public._restore_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, uuid) IS
  'Restitution de stock (void / refund). Miroir de _record_sale_stock_v1, qui ne sait que retirer. Helper interne : aucun appel direct depuis le client.';

-- Grants : helper INTERNE, appele uniquement depuis des RPC SECURITY DEFINER.
-- Paire REVOKE (anon herite EXECUTE via PUBLIC) puis GRANT explicite au SEUL
-- service_role — miroir exact des grants live de `_record_sale_stock_v1` et de
-- `_resolve_recipe_consumption_v1` (`{postgres=X, service_role=X}`, releve le
-- 2026-09-01). `authenticated` n'y figure pas et ne doit pas y figurer.
REVOKE ALL ON FUNCTION public._restore_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._restore_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._restore_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._restore_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
