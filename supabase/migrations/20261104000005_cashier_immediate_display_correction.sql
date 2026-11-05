-- Décision de Mamat : recomptage vitrine immédiat, sans correction du stock global.
-- Départs lus live : wrapper actuel et ancienne implémentation vitrine capturée avant remplacement.
INSERT INTO public.role_permissions(role_code,permission_code,is_granted)
VALUES('CASHIER','display.manage',true)
ON CONFLICT(role_code,permission_code) DO UPDATE SET is_granted=true;
ALTER TABLE stock_private.mutation_requests DROP CONSTRAINT mutation_requests_operation_check;
ALTER TABLE stock_private.mutation_requests ADD CONSTRAINT mutation_requests_operation_check
 CHECK(operation IN ('adjust','waste','incoming','display_adjust'));

CREATE FUNCTION public.adjust_display_stock_v4(p_product_id uuid,p_new_qty numeric,p_reason text,
 p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_profile uuid; v_request jsonb;
 v_saved stock_private.mutation_requests%ROWTYPE; v_result jsonb; v_replay boolean:=false;
 v_is_display boolean; v_current numeric(10,3); v_delta numeric(10,3);
 v_effect uuid:=gen_random_uuid(); v_constraint text;
BEGIN
 IF v_uid IS NULL OR NOT has_permission(v_uid,'display.manage') THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
 END IF;
 SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id=v_uid
   AND is_active AND deleted_at IS NULL;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023'; END IF;
 IF p_new_qty IS NULL OR p_new_qty::text IN ('NaN','Infinity','-Infinity') OR p_new_qty<0
    OR p_new_qty>9999999.999 OR p_new_qty<>round(p_new_qty,3) THEN
   RAISE EXCEPTION 'invalid_quantity' USING ERRCODE='22023';
 END IF;
 IF p_reason IS NULL OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'reason_required'; END IF;
 v_request:=jsonb_build_object('product_id',p_product_id,'quantity',p_new_qty,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-mutation:'||p_idempotency_key::text,0));
 SELECT * INTO v_saved FROM stock_private.mutation_requests WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
   IF v_saved.actor_uid<>v_uid OR v_saved.operation<>'display_adjust' OR v_saved.request<>v_request THEN
     RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
   END IF;
   v_result:=v_saved.result; v_replay:=true;
 ELSE
   -- Une ancienne clé sans intention durable ne prouve pas ses paramètres initiaux.
   IF EXISTS(SELECT 1 FROM display_movements WHERE idempotency_key=p_idempotency_key)
      OR EXISTS(SELECT 1 FROM stock_movements WHERE idempotency_key=p_idempotency_key)
      OR EXISTS(SELECT 1 FROM stock_declarations WHERE idempotency_key=p_idempotency_key) THEN
     RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
   END IF;
   SELECT is_display_item INTO v_is_display FROM products
    WHERE id=p_product_id AND deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;
   IF NOT v_is_display THEN RAISE EXCEPTION 'not_a_display_item' USING ERRCODE='P0002'; END IF;
   SELECT quantity INTO v_current FROM display_stock WHERE product_id=p_product_id FOR UPDATE;
   v_current:=COALESCE(v_current,0); v_delta:=p_new_qty-v_current;
   IF v_delta<>0 THEN
     INSERT INTO display_movements(id,product_id,movement_type,quantity,reason,created_by,idempotency_key)
     VALUES(v_effect,p_product_id,'adjustment',v_delta,btrim(p_reason),v_profile,p_idempotency_key);
     INSERT INTO display_stock(product_id,quantity,updated_at) VALUES(p_product_id,p_new_qty,now())
     ON CONFLICT(product_id) DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=EXCLUDED.updated_at;
   END IF;
   v_result:=jsonb_build_object('product_id',p_product_id,'effect_id',v_effect,
     'new_display_stock',p_new_qty,'noop',v_delta=0,
     'display_movement_id',CASE WHEN v_delta<>0 THEN v_effect ELSE NULL END);
   INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
   VALUES(v_profile,'display.adjust',CASE WHEN v_delta=0 THEN 'display_adjustment' ELSE 'display_movement' END,
     v_effect,jsonb_build_object('product_id',p_product_id,'previous_qty',v_current,'new_qty',p_new_qty,
       'delta',v_delta,'reason',btrim(p_reason),'idempotency_key',p_idempotency_key),v_result);
   INSERT INTO stock_private.mutation_requests(idempotency_key,actor_uid,operation,request,result)
   VALUES(p_idempotency_key,v_uid,'display_adjust',v_request,v_result);
 END IF;
 IF can_view_business_day_v1(current_date) THEN
   RETURN v_result||jsonb_build_object('idempotent_replay',v_replay);
 END IF;
 -- Même un no-op garde un identifiant opaque : aucune comparaison avec l'ancien stock ne fuit.
 RETURN jsonb_build_object('product_id',v_result->'product_id','effect_id',v_result->'effect_id',
   'new_display_stock',NULL,'idempotent_replay',v_replay);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
 IF v_constraint NOT IN ('display_movements_idempotency_key_key','mutation_requests_pkey') THEN RAISE; END IF;
 SELECT * INTO v_saved FROM stock_private.mutation_requests WHERE idempotency_key=p_idempotency_key;
 IF NOT FOUND OR v_saved.actor_uid<>v_uid OR v_saved.operation<>'display_adjust' OR v_saved.request<>v_request THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
 END IF;
 IF can_view_business_day_v1(current_date) THEN
   RETURN v_saved.result||jsonb_build_object('idempotent_replay',true);
 END IF;
 RETURN jsonb_build_object('product_id',v_saved.result->'product_id','effect_id',v_saved.result->'effect_id',
   'new_display_stock',NULL,'idempotent_replay',true);
END $function$;
DROP FUNCTION public.adjust_display_stock_v3(uuid,numeric,text,uuid);
REVOKE ALL ON FUNCTION public.adjust_display_stock_v4(uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.adjust_display_stock_v4(uuid,numeric,text,uuid) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Les changements de disponibilité doivent arriver même si les lignes chiffrées sont masquées.
CREATE TRIGGER confidentiality_display_catalog AFTER INSERT OR UPDATE OR DELETE ON public.display_stock
 FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('catalog');
