-- Le verrou commence à l'activation ; l'historique antérieur conserve ses droits.
CREATE TABLE public.business_day_visibility_config (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 activated_on date NOT NULL DEFAULT current_date
);
INSERT INTO public.business_day_visibility_config(id) VALUES(true);
ALTER TABLE public.business_day_visibility_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_day_visibility_config FROM PUBLIC,anon,authenticated;

CREATE TABLE public.business_day_releases (
 day date PRIMARY KEY,
 count_id uuid NOT NULL REFERENCES public.inventory_counts(id),
 released_by uuid NOT NULL REFERENCES public.user_profiles(id),
 released_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.business_day_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_day_releases FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.can_view_business_day_v1(p_day date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND (is_business_owner_v1()
   OR p_day<(SELECT activated_on FROM business_day_visibility_config WHERE id)
   OR EXISTS(SELECT 1 FROM business_day_releases WHERE day=p_day))
$$;
REVOKE ALL ON FUNCTION public.can_view_business_day_v1(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_business_day_v1(date) TO authenticated,service_role;

CREATE FUNCTION public.assert_business_days_visible_v1(p_start date,p_end date) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_activation date;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 IF is_business_owner_v1() THEN RETURN; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start>p_end THEN
   RAISE EXCEPTION 'invalid_date_range' USING ERRCODE='22023';
 END IF;
 SELECT activated_on INTO v_activation FROM business_day_visibility_config WHERE id;
 IF p_end>=GREATEST(p_start,v_activation) AND
   (SELECT count(*) FROM business_day_releases r
      WHERE r.day BETWEEN GREATEST(p_start,v_activation) AND p_end)
      <> (p_end-GREATEST(p_start,v_activation)+1)
 THEN RAISE EXCEPTION 'business_day_not_released' USING ERRCODE='P0003'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_business_days_visible_v1(date,date) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_business_day_visibility_v1(p_day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_release business_day_releases%ROWTYPE;
BEGIN
 IF get_current_profile_id() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 SELECT * INTO v_release FROM business_day_releases WHERE day=p_day;
 RETURN jsonb_build_object('day',p_day,'released',v_release.day IS NOT NULL,
   'can_view_sales',can_view_business_day_v1(p_day),'is_owner',is_business_owner_v1(),
   'activated_on',(SELECT activated_on FROM business_day_visibility_config WHERE id),
   'released_at',v_release.released_at,'count_id',v_release.count_id);
END $$;

CREATE FUNCTION public.release_business_day_v1(p_day date,p_count_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_profile uuid; v_count inventory_counts%ROWTYPE; v_existing business_day_releases%ROWTYPE;
BEGIN
 IF NOT is_business_owner_v1() THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='P0003'; END IF;
 IF p_day IS NULL OR p_day>current_date THEN RAISE EXCEPTION 'invalid_business_day' USING ERRCODE='22023'; END IF;
 v_profile:=get_current_profile_id();
 PERFORM pg_advisory_xact_lock(hashtextextended('business-day:registers',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('business-day:'||p_day::text,0));
 SELECT * INTO v_existing FROM business_day_releases WHERE day=p_day;
 IF FOUND THEN
   IF v_existing.count_id<>p_count_id THEN RAISE EXCEPTION 'release_count_conflict' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('day',p_day,'released',true,'idempotent_replay',true);
 END IF;
 -- Une caisse ouverte, même de la veille, interdit toute libération.
 IF EXISTS(SELECT 1 FROM pos_sessions WHERE status='open') THEN
   RAISE EXCEPTION 'registers_still_open';
 END IF;
 SELECT * INTO v_count FROM inventory_counts WHERE id=p_count_id FOR UPDATE;
 IF NOT FOUND OR v_count.status<>'finalized' OR v_count.business_day IS DISTINCT FROM p_day
    OR v_count.finalized_at::date<p_day
    OR v_count.finalized_by IS DISTINCT FROM v_profile
 THEN RAISE EXCEPTION 'owner_validated_count_required'; END IF;
 IF EXISTS(SELECT 1 FROM stock_declarations WHERE status='pending' AND declared_at::date<=p_day) THEN
   RAISE EXCEPTION 'pending_stock_declarations';
 END IF;
 INSERT INTO business_day_releases(day,count_id,released_by) VALUES(p_day,p_count_id,v_profile);
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_profile,'business_day.released','inventory_counts',p_count_id,
   jsonb_build_object('day',p_day),jsonb_build_object('released',true));
 RETURN jsonb_build_object('day',p_day,'released',true,'idempotent_replay',false);
END $$;

-- Toute nouvelle activité rouvre le verrou, y compris une vente offline tardive.
CREATE FUNCTION public.invalidate_business_day_release_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_day date; v_profile uuid; v_release business_day_releases%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='orders' THEN
   v_day:=COALESCE(NEW.paid_at,NEW.created_at)::date;
 ELSIF TG_TABLE_NAME='pos_sessions' THEN
   IF NEW.status<>'open' THEN RETURN NEW; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('business-day:registers',0));
   v_day:=current_date;
 ELSIF TG_TABLE_NAME='inventory_counts' THEN
   v_day:=COALESCE(NEW.business_day,current_date);
 ELSE
   v_day:=current_date;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('business-day:'||v_day::text,0));
 DELETE FROM business_day_releases WHERE day=v_day RETURNING * INTO v_release;
 IF FOUND THEN
   v_profile:=get_current_profile_id();
   INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
   VALUES(v_profile,'business_day.release_invalidated','inventory_counts',v_release.count_id,
     jsonb_build_object('day',v_day,'source',TG_TABLE_NAME),jsonb_build_object('released',false));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER confidentiality_activity_orders AFTER INSERT OR UPDATE OF paid_at,status,total
 ON public.orders FOR EACH ROW EXECUTE FUNCTION public.invalidate_business_day_release_v1();
CREATE TRIGGER confidentiality_activity_sessions AFTER INSERT OR UPDATE OF status
 ON public.pos_sessions FOR EACH ROW EXECUTE FUNCTION public.invalidate_business_day_release_v1();
CREATE TRIGGER confidentiality_activity_counts AFTER INSERT ON public.inventory_counts
 FOR EACH ROW EXECUTE FUNCTION public.invalidate_business_day_release_v1();

CREATE FUNCTION public.can_view_order_v1(p_order_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM orders o WHERE o.id=p_order_id AND
   (o.status::text IN ('draft','pending_payment','b2b_pending')
    OR (o.status::text='paid' AND EXISTS(SELECT 1 FROM order_items oi
      WHERE oi.order_id=o.id AND NOT COALESCE(oi.is_cancelled,false)
      AND oi.served_at IS NULL AND oi.kitchen_status IN ('pending','preparing','ready')
      AND COALESCE(oi.dispatch_station,'none')<>'none'))
    OR can_view_business_day_v1(COALESCE(o.paid_at,o.created_at)::date)))
$$;
REVOKE ALL ON FUNCTION public.can_view_order_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_order_v1(uuid) TO authenticated,service_role;

CREATE POLICY confidentiality_finished_orders ON public.orders AS RESTRICTIVE FOR SELECT TO authenticated
 USING(can_view_order_v1(id));
CREATE POLICY confidentiality_order_items ON public.order_items AS RESTRICTIVE FOR SELECT TO authenticated
 USING(can_view_order_v1(order_id));
CREATE POLICY confidentiality_stock_movements ON public.stock_movements AS RESTRICTIVE FOR SELECT TO authenticated
 USING(can_view_business_day_v1(created_at::date));
CREATE POLICY confidentiality_display_movements ON public.display_movements AS RESTRICTIVE FOR SELECT TO authenticated
 USING(can_view_business_day_v1(created_at::date));
CREATE POLICY confidentiality_audit_logs ON public.audit_logs AS RESTRICTIVE FOR SELECT TO authenticated
 USING(can_view_business_day_v1(created_at::date));
-- Les références catalogue restent lisibles ; le stock exact passe par la RPC masquée.
REVOKE SELECT ON public.products FROM PUBLIC,anon,authenticated;
DO $columns$
DECLARE v_columns text;
BEGIN
 SELECT string_agg(quote_ident(attname),', ' ORDER BY attnum) INTO v_columns
 FROM pg_attribute WHERE attrelid='public.products'::regclass AND attnum>0
 AND NOT attisdropped AND attname<>'current_stock';
 EXECUTE format('GRANT SELECT (%s) ON public.products TO authenticated',v_columns);
END $columns$;
-- Realtime n'applique pas les privilèges colonne. Les topics d'invalidation restent actifs.
ALTER PUBLICATION supabase_realtime DROP TABLE public.products;
CREATE POLICY confidentiality_display_stock ON public.display_stock AS RESTRICTIVE FOR SELECT TO authenticated
 USING(can_view_business_day_v1(current_date));
CREATE POLICY confidentiality_zreports ON public.z_reports AS RESTRICTIVE FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM pos_sessions s WHERE s.id=shift_id
   AND can_view_business_day_v1(s.opened_at::date)));

-- Les vues historiques à propriétaire privilégié ne doivent pas contourner les policies.
ALTER VIEW public.view_product_recipes SET(security_invoker=true);
ALTER VIEW public.view_recipe_products SET(security_invoker=true);
ALTER VIEW public.v_product_available_stock SET(security_invoker=true);
ALTER VIEW public.view_b2b_invoices SET(security_invoker=true);

CREATE FUNCTION public.get_operational_products_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_visible boolean;
BEGIN
 IF NOT is_authenticated() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 v_visible:=can_view_business_day_v1(current_date);
 RETURN COALESCE((SELECT jsonb_agg(
   (to_jsonb(p)-'current_stock')||jsonb_build_object(
    'current_stock',CASE WHEN v_visible THEN p.current_stock ELSE NULL END,
    'categories',CASE WHEN c.id IS NOT NULL THEN to_jsonb(c) ELSE NULL END,
    'display_stock',CASE WHEN ds.product_id IS NULL THEN NULL ELSE
       jsonb_build_object('quantity',CASE WHEN v_visible THEN ds.quantity ELSE NULL END) END,
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
END $$;

REVOKE ALL ON FUNCTION public.invalidate_business_day_release_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_business_day_visibility_v1(date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.release_business_day_v1(date,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_operational_products_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_business_day_visibility_v1(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_business_day_v1(date,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_operational_products_v1() TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Signaux sans contenu métier : un verrou rétabli doit effacer les anciennes données UI.
CREATE TRIGGER confidentiality_catalog_changes AFTER INSERT OR UPDATE ON public.products
 FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('catalog');
CREATE TRIGGER confidentiality_release_catalog AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON public.business_day_releases FOR EACH STATEMENT
 EXECUTE FUNCTION public.signal_ui_invalidation_v1('catalog');
CREATE TRIGGER confidentiality_release_orders AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON public.business_day_releases FOR EACH STATEMENT
 EXECUTE FUNCTION public.signal_ui_invalidation_v1('orders');

