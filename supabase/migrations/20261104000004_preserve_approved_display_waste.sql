-- Corps live dev lu le 31 octobre 2026 ; préserver la perte vitrine même si le global devient négatif.
CREATE OR REPLACE FUNCTION public.approve_stock_declaration_v2(p_declaration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
       'declared_by',v_decl.declared_by,'approved_by',v_profile),
     p_allow_negative:=v_decl.operation='display_waste');
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
END $function$;
DROP FUNCTION public.approve_stock_declaration_v1(uuid);
REVOKE ALL ON FUNCTION public.approve_stock_declaration_v2(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_stock_declaration_v2(uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
