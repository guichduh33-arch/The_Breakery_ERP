-- S1-15 : aucun mouvement de rattrapage sans commande native à reprendre.
-- Préflight production du 2026-11-20 : 85 natives livrées ; 192 imports financiers
-- sans retrait daté, tous exclus. Les quantités et écritures existantes restent intactes.
LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
 IF EXISTS (SELECT 1 FROM public.orders WHERE order_type='b2b'
  AND status<>'voided' AND b2b_delivered_at IS NULL
  AND financial_import_document_id IS NULL) THEN
  RAISE EXCEPTION 'b2b_uncollected_native_orders_require_review';
 END IF;
 IF EXISTS (SELECT 1 FROM public.orders o JOIN public.stock_movements m
  ON m.reference_id=o.id AND m.reference_type='orders'
  WHERE o.order_type='b2b' AND o.status<>'voided'
  AND o.financial_import_document_id IS NULL AND m.movement_type IN ('sale','sale_void')
  GROUP BY o.id,m.product_id,m.unit HAVING sum(m.quantity)>0) THEN
  RAISE EXCEPTION 'b2b_legacy_stock_net_requires_review';
 END IF;
END $preflight$;

ALTER TABLE public.orders ADD COLUMN b2b_stock_consumed_at timestamptz;
COMMENT ON COLUMN public.orders.b2b_stock_consumed_at IS
 'Retrait dont le stock a été traité ; NULL avant retrait et pour les imports financiers. Les natives antérieures livrées sont initialisées sans nouveau mouvement.';

CREATE TABLE public.b2b_order_stock_consumptions (
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
 product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
 unit text NOT NULL,
 quantity numeric NOT NULL CHECK (quantity>0 AND quantity::text NOT IN ('NaN','Infinity','-Infinity')),
 inventory_tracked boolean NOT NULL,
 legacy boolean NOT NULL DEFAULT false,
 PRIMARY KEY (order_id,product_id,unit)
);
COMMENT ON TABLE public.b2b_order_stock_consumptions IS
 'Instantané interne des consommations B2B réellement écrites ; annulation indépendante des changements de recette. Aucun accès applicatif direct.';
ALTER TABLE public.b2b_order_stock_consumptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY pin_session_required ON public.b2b_order_stock_consumptions AS RESTRICTIVE
 FOR ALL TO authenticated USING (public.request_has_active_pin_session_v1())
 WITH CHECK (public.request_has_active_pin_session_v1());
REVOKE ALL ON public.b2b_order_stock_consumptions FROM PUBLIC,anon,authenticated;

-- Restituer la quantité nette du ledger, jamais recalculer les anciennes recettes.
INSERT INTO public.b2b_order_stock_consumptions(order_id,product_id,unit,quantity,inventory_tracked,legacy)
 SELECT o.id,m.product_id,m.unit,-sum(m.quantity),coalesce(p.track_inventory,true),true
 FROM public.orders o JOIN public.stock_movements m
 ON m.reference_id=o.id AND m.reference_type='orders'
 JOIN public.products p ON p.id=m.product_id
 WHERE o.order_type='b2b' AND o.status<>'voided' AND o.b2b_delivered_at IS NOT NULL
 AND o.financial_import_document_id IS NULL AND m.movement_type IN ('sale','sale_void')
 GROUP BY o.id,m.product_id,m.unit,p.track_inventory HAVING sum(m.quantity)<0;
UPDATE public.orders SET b2b_stock_consumed_at=b2b_delivered_at
 WHERE order_type='b2b' AND status<>'voided' AND b2b_delivered_at IS NOT NULL
 AND financial_import_document_id IS NULL;

-- Les RPC SECURITY DEFINER s'exécutent comme postgres ; un UPDATE direct ne peut
-- ni simuler un retrait, ni réinitialiser le marqueur pour redéduire le stock.
CREATE FUNCTION public._guard_b2b_stock_state_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
 IF current_user<>'postgres' AND (NEW.order_type='b2b' OR
   (TG_OP='UPDATE' AND OLD.order_type='b2b')) THEN
  IF TG_OP='INSERT' THEN
   RAISE EXCEPTION 'b2b_order_requires_rpc' USING ERRCODE='P0003';
  ELSIF NEW.b2b_stock_consumed_at IS DISTINCT FROM OLD.b2b_stock_consumed_at
     OR NEW.b2b_delivered_at IS DISTINCT FROM OLD.b2b_delivered_at
     OR NEW.order_type IS DISTINCT FROM OLD.order_type THEN
   RAISE EXCEPTION 'b2b_stock_state_requires_rpc' USING ERRCODE='P0003';
  END IF;
 END IF;
 RETURN NEW;
END $function$;
CREATE TRIGGER guard_b2b_stock_state BEFORE INSERT OR UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._guard_b2b_stock_state_v1();
REVOKE ALL ON FUNCTION public._guard_b2b_stock_state_v1() FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
