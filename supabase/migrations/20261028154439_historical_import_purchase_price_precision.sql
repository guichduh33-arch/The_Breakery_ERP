-- Accord Mamat : prix unitaire d'achat plus precis, montant facture toujours au centime.
-- Les valeurs existantes restent numeriquement identiques ; le subtotal genere garde
-- son type numeric(14,2) et son expression quantity * unit_cost.
LOCK TABLE public.purchase_order_items IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
 SELECT coalesce(jsonb_object_agg(id::text,jsonb_build_array(unit_cost,subtotal)),'{}') INTO v_before FROM public.purchase_order_items;
 -- DROP sans CASCADE : toute dependance inattendue arrete atomiquement la migration.
 ALTER TABLE public.purchase_order_items DROP COLUMN subtotal;
 ALTER TABLE public.purchase_order_items ALTER COLUMN unit_cost TYPE numeric USING unit_cost::numeric;
 ALTER TABLE public.purchase_order_items ADD COLUMN subtotal numeric(14,2) GENERATED ALWAYS AS (quantity*unit_cost) STORED;
 SELECT coalesce(jsonb_object_agg(id::text,jsonb_build_array(unit_cost,subtotal)),'{}') INTO v_after FROM public.purchase_order_items;
 IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'purchase_price_precision_changed_existing_amounts'; END IF;
END $$;
