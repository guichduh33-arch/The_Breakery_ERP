-- Déclarations sans effet sur le stock ; approbation indépendante du propriétaire.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE FUNCTION public.is_business_owner_v1() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM user_profiles WHERE auth_user_id=auth.uid()
   AND deleted_at IS NULL AND is_active AND role_code='SUPER_ADMIN')
$$;
REVOKE ALL ON FUNCTION public.is_business_owner_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_business_owner_v1() TO authenticated,service_role;

CREATE TABLE public.stock_declarations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation text NOT NULL CHECK(operation IN ('adjust','waste','display_adjust','display_waste')),
 product_id uuid NOT NULL REFERENCES public.products(id),
 quantity numeric(10,3) NOT NULL CHECK(quantity>=0),
 baseline_quantity numeric(10,3) NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>=3),
 declared_by uuid NOT NULL REFERENCES public.user_profiles(id),
 declared_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by uuid REFERENCES public.user_profiles(id),
 reviewed_at timestamptz,
 rejection_reason text,
 result jsonb,
 CHECK(reviewed_by IS NULL OR reviewed_by<>declared_by)
);
ALTER TABLE public.stock_declarations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_declarations FROM PUBLIC,anon,authenticated;
-- Les résultats d'approbation contiennent le stock théorique : lecture via RPC masquée.

CREATE FUNCTION public.submit_stock_declaration_v1(p_operation text,p_product_id uuid,
 p_quantity numeric,p_reason text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_profile uuid; v_permission text; v_saved stock_declarations%ROWTYPE; v_id uuid; v_baseline numeric;
BEGIN
 v_profile:=get_current_profile_id();
 v_permission:=CASE p_operation WHEN 'adjust' THEN 'inventory.adjust'
   WHEN 'waste' THEN 'inventory.waste' WHEN 'display_adjust' THEN 'display.manage'
   WHEN 'display_waste' THEN 'display.manage' END;
 IF v_profile IS NULL OR v_permission IS NULL OR NOT has_permission(auth.uid(),v_permission)
 THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023'; END IF;
 IF p_quantity IS NULL OR p_quantity::text IN ('NaN','Infinity','-Infinity')
   OR p_quantity<0 OR p_quantity>9999999.999 OR p_quantity<>round(p_quantity,3)
   OR (p_operation IN ('waste','display_waste') AND p_quantity=0)
 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE='22023'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'reason_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-declaration:'||p_idempotency_key::text,0));
 SELECT * INTO v_saved FROM stock_declarations WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
   IF v_saved.declared_by<>v_profile OR v_saved.operation<>p_operation OR
      v_saved.product_id<>p_product_id OR v_saved.quantity<>p_quantity OR v_saved.reason<>btrim(p_reason)
   THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('declaration_id',v_saved.id,'status',v_saved.status,'idempotent_replay',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND deleted_at IS NULL
   AND (p_operation NOT LIKE 'display_%' OR is_display_item))
 THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;
 SELECT current_stock INTO v_baseline FROM products WHERE id=p_product_id FOR UPDATE;
 IF p_operation LIKE 'display_%' THEN
   SELECT quantity INTO v_baseline FROM display_stock WHERE product_id=p_product_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'display_stock_not_found'; END IF;
 END IF;
 INSERT INTO stock_declarations(operation,product_id,quantity,baseline_quantity,reason,declared_by,idempotency_key)
 VALUES(p_operation,p_product_id,p_quantity,v_baseline,btrim(p_reason),v_profile,p_idempotency_key) RETURNING id INTO v_id;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_profile,'stock.declaration_submitted','stock_declarations',v_id,
   jsonb_build_object('operation',p_operation),jsonb_build_object('product_id',p_product_id,'quantity',p_quantity,'reason',btrim(p_reason)));
 RETURN jsonb_build_object('declaration_id',v_id,'status','pending','idempotent_replay',false);
END $$;

CREATE FUNCTION public.approve_stock_declaration_v1(p_declaration_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_profile uuid; v_decl stock_declarations%ROWTYPE; v_current numeric;
 v_display numeric; v_delta numeric; v_unit text; v_result jsonb:='{}'; v_display_movement uuid;
BEGIN
 IF NOT is_business_owner_v1() THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='P0003'; END IF;
 v_profile:=get_current_profile_id();
 SELECT * INTO v_decl FROM stock_declarations WHERE id=p_declaration_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'declaration_not_found' USING ERRCODE='P0002'; END IF;
 IF v_decl.declared_by=v_profile THEN RAISE EXCEPTION 'independent_approver_required' USING ERRCODE='P0003'; END IF;
 IF v_decl.status='approved' THEN RETURN v_decl.result||jsonb_build_object('idempotent_replay',true); END IF;
 IF v_decl.status<>'pending' THEN RAISE EXCEPTION 'declaration_not_pending'; END IF;
 SELECT current_stock,COALESCE(unit,'pcs') INTO v_current,v_unit FROM products
 WHERE id=v_decl.product_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;
 IF v_decl.operation LIKE 'display_%' THEN
   SELECT quantity INTO v_display FROM display_stock WHERE product_id=v_decl.product_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'display_stock_not_found' USING ERRCODE='P0002'; END IF;
   v_delta:=CASE WHEN v_decl.operation='display_adjust' THEN v_decl.quantity-v_display ELSE -v_decl.quantity END;
   IF v_display+v_delta<0 THEN RAISE EXCEPTION 'insufficient_display_stock'; END IF;
 ELSE
   v_delta:=CASE WHEN v_decl.operation='adjust' THEN v_decl.quantity-v_current ELSE -v_decl.quantity END;
 END IF;
 IF (v_decl.operation='adjust' AND v_current IS DISTINCT FROM v_decl.baseline_quantity)
   OR (v_decl.operation='display_adjust' AND v_display IS DISTINCT FROM v_decl.baseline_quantity)
 THEN RAISE EXCEPTION 'stale_stock_declaration'; END IF;
 IF v_delta<>0 AND v_decl.operation<>'display_adjust' THEN
   -- La primitive établit ledger, stock global et audit en une écriture.
   v_result:=record_stock_movement_v1(p_product_id:=v_decl.product_id,
     p_movement_type:=CASE WHEN v_decl.operation IN ('waste','display_waste') THEN 'waste'::movement_type ELSE 'adjustment'::movement_type END,
     p_quantity:=v_delta,p_reason:=v_decl.reason,p_unit:=v_unit,p_idempotency_key:=v_decl.id,
     p_metadata:=jsonb_build_object('reference_type','stock_declaration','reference_id',v_decl.id,
       'declared_by',v_decl.declared_by,'approved_by',v_profile));
 END IF;
 IF v_decl.operation LIKE 'display_%' AND v_delta<>0 THEN
   INSERT INTO display_movements(product_id,movement_type,quantity,reason,created_by,idempotency_key)
   VALUES(v_decl.product_id,CASE WHEN v_decl.operation='display_waste' THEN 'waste'::display_movement_type ELSE 'adjustment'::display_movement_type END,
     v_delta,v_decl.reason,v_profile,v_decl.id) RETURNING id INTO v_display_movement;
   UPDATE display_stock SET quantity=quantity+v_delta,updated_at=now() WHERE product_id=v_decl.product_id;
   INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
   VALUES(v_profile,CASE WHEN v_decl.operation='display_waste' THEN 'display.waste' ELSE 'display.adjust' END,
     'display_movement',v_display_movement,
     jsonb_build_object('declaration_id',v_decl.id,'declared_by',v_decl.declared_by),
     jsonb_build_object('product_id',v_decl.product_id,'quantity',v_delta,'reason',v_decl.reason));
 END IF;
 v_result:=v_result||jsonb_build_object('declaration_id',v_decl.id,'status','approved',
   'new_current_stock',(SELECT current_stock FROM products WHERE id=v_decl.product_id),
   'new_display_stock',CASE WHEN v_decl.operation LIKE 'display_%' THEN
     (SELECT quantity FROM display_stock WHERE product_id=v_decl.product_id) ELSE NULL END,
   'idempotent_replay',false);
 UPDATE stock_declarations SET status='approved',reviewed_by=v_profile,reviewed_at=now(),result=v_result WHERE id=v_decl.id;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_profile,'stock.declaration_approved','stock_declarations',v_decl.id,
   jsonb_build_object('declared_by',v_decl.declared_by),v_result);
 RETURN v_result;
END $$;

CREATE FUNCTION public.reject_stock_declaration_v1(p_declaration_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_profile uuid; v_decl stock_declarations%ROWTYPE;
BEGIN
 IF NOT is_business_owner_v1() THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='P0003'; END IF;
 v_profile:=get_current_profile_id();
 IF p_reason IS NULL OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'reason_required'; END IF;
 SELECT * INTO v_decl FROM stock_declarations WHERE id=p_declaration_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'declaration_not_found' USING ERRCODE='P0002'; END IF;
 IF v_decl.declared_by=v_profile THEN RAISE EXCEPTION 'independent_approver_required' USING ERRCODE='P0003'; END IF;
 IF v_decl.status='rejected' AND v_decl.rejection_reason=btrim(p_reason) THEN
   RETURN jsonb_build_object('declaration_id',v_decl.id,'status','rejected','idempotent_replay',true);
 END IF;
 IF v_decl.status<>'pending' THEN RAISE EXCEPTION 'declaration_not_pending'; END IF;
 UPDATE stock_declarations SET status='rejected',reviewed_by=v_profile,reviewed_at=now(),
   rejection_reason=btrim(p_reason) WHERE id=v_decl.id;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_profile,'stock.declaration_rejected','stock_declarations',v_decl.id,
   jsonb_build_object('declared_by',v_decl.declared_by),jsonb_build_object('reason',btrim(p_reason)));
 RETURN jsonb_build_object('declaration_id',v_decl.id,'status','rejected','idempotent_replay',false);
END $$;

CREATE FUNCTION public.get_stock_declarations_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_profile uuid; v_owner boolean;
BEGIN
 v_profile:=get_current_profile_id(); v_owner:=is_business_owner_v1();
 IF v_profile IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(
   (to_jsonb(d)-'result'-'baseline_quantity')||jsonb_build_object('product_name',p.name,'product_sku',p.sku,'unit',p.unit,
    'declared_by_name',u.full_name,'reviewed_by_name',r.full_name)
   ORDER BY d.declared_at DESC)
 FROM stock_declarations d JOIN products p ON p.id=d.product_id
 JOIN user_profiles u ON u.id=d.declared_by LEFT JOIN user_profiles r ON r.id=d.reviewed_by
 WHERE v_owner OR d.declared_by=v_profile),'[]'::jsonb);
END $$;

-- Les anciens chemins immédiats disparaissent atomiquement.
DROP FUNCTION public.adjust_stock_v2(uuid,numeric,text,uuid);
DROP FUNCTION public.waste_stock_v2(uuid,numeric,text,uuid);
DROP FUNCTION public.adjust_display_stock_v2(uuid,numeric,text,uuid);
DROP FUNCTION public.waste_display_stock_v2(uuid,numeric,text,uuid);
CREATE FUNCTION public.adjust_stock_v3(p_product_id uuid,p_new_qty numeric,p_reason text,p_idempotency_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT submit_stock_declaration_v1('adjust',p_product_id,p_new_qty,p_reason,p_idempotency_key)
$$;
CREATE FUNCTION public.waste_stock_v3(p_product_id uuid,p_quantity numeric,p_reason text,p_idempotency_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT submit_stock_declaration_v1('waste',p_product_id,p_quantity,p_reason,p_idempotency_key)
$$;
CREATE FUNCTION public.adjust_display_stock_v3(p_product_id uuid,p_new_qty numeric,p_reason text,p_idempotency_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT submit_stock_declaration_v1('display_adjust',p_product_id,p_new_qty,p_reason,p_idempotency_key)
$$;
CREATE FUNCTION public.waste_display_stock_v3(p_product_id uuid,p_quantity numeric,p_reason text DEFAULT NULL,p_idempotency_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT submit_stock_declaration_v1('display_waste',p_product_id,p_quantity,p_reason,p_idempotency_key)
$$;

DO $grants$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('submit_stock_declaration_v1','approve_stock_declaration_v1',
 'reject_stock_declaration_v1','get_stock_declarations_v1','adjust_stock_v3','waste_stock_v3',
 'adjust_display_stock_v3','waste_display_stock_v3') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.signature);
 END LOOP;
END $grants$;

