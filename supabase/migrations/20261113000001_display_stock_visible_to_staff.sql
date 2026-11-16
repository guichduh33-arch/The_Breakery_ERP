-- Stock vitrine visible du personnel de salle (demande de Mamat du 2026-11-13).
--
-- La migration 20261105000001 réservait au propriétaire le stock théorique ;
-- get_operational_products_v2 masquait aussi, par le même interrupteur, le
-- compteur de vitrine (display_stock.quantity). Serveurs et caissiers ne
-- voyaient plus combien de pièces restent en vitrine. Arbitrage de Mamat :
-- le compteur de vitrine redevient visible de tout le personnel autorisé, en
-- connaissance de cause (le comptage de fin de journée n'est plus strictement
-- à l'aveugle). Le stock théorique (current_stock) reste réservé au propriétaire.
--
-- Corps de départ : pg_get_functiondef live de get_operational_products_v2,
-- identique en dev et en production le 2026-11-13. Seule la branche
-- display_stock change.
--
-- Exception assumée à la règle « créer _vN+1 et DROP l'ancienne » : les
-- caisses et tablettes de la boutique sont servies en LAN et appellent _v2
-- jusqu'à leur prochaine reconstruction. La _v2 devient un simple relais vers
-- la _v3, au contrat de retour inchangé, pour que la boutique reçoive la
-- correction sans attendre. Elle sera supprimée quand aucun terminal
-- installé ne l'appellera plus.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION public.get_operational_products_v3()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_visible boolean;
BEGIN
 IF NOT is_authenticated() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 v_visible:=public.can_view_stock_v1();
 RETURN COALESCE((SELECT jsonb_agg(
   (to_jsonb(p)-'current_stock')||jsonb_build_object(
    'current_stock',CASE WHEN v_visible THEN p.current_stock ELSE NULL END,
    'categories',CASE WHEN c.id IS NOT NULL THEN to_jsonb(c) ELSE NULL END,
    'display_stock',CASE WHEN ds.product_id IS NULL THEN NULL ELSE
       jsonb_build_object('quantity',ds.quantity) END,
    'is_sellable',CASE WHEN NOT COALESCE(p.track_inventory,true) THEN true
       ELSE COALESCE(ds.quantity,p.current_stock,0)>0 END,
    'has_variants',EXISTS(SELECT 1 FROM products v WHERE v.parent_product_id=p.id
        AND v.is_active AND v.deleted_at IS NULL))
   ORDER BY p.name,p.id)
 FROM products p LEFT JOIN categories c ON c.id=p.category_id
 LEFT JOIN display_stock ds ON ds.product_id=p.id
 WHERE p.deleted_at IS NULL AND
   (NOT has_permission(auth.uid(),'inventory.production.kitchen')
     OR has_permission(auth.uid(),'products.read') OR has_permission(auth.uid(),'inventory.read'))),'[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.get_operational_products_v3() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_products_v3() TO authenticated, service_role;

-- Relais de compatibilité pour les terminaux LAN non reconstruits.
CREATE OR REPLACE FUNCTION public.get_operational_products_v2()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT public.get_operational_products_v3()
$function$;

REVOKE ALL ON FUNCTION public.get_operational_products_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_products_v2() TO authenticated, service_role;
COMMENT ON FUNCTION public.get_operational_products_v2() IS
 'Deprecated relay to get_operational_products_v3 for LAN terminals not yet rebuilt. Drop once no installed terminal calls it.';
