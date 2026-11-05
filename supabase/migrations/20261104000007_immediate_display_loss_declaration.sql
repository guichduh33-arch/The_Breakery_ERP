-- Décision de Mamat : perte retirée immédiatement de la vitrine, global après validation Owner distinct.
ALTER TABLE public.stock_declarations ADD COLUMN display_withdrawal_applied boolean NOT NULL DEFAULT false
CHECK(NOT display_withdrawal_applied OR operation='display_waste');
-- Les anciennes approbations ont déjà diminué la vitrine ; les anciennes attentes restent à traiter.
UPDATE public.stock_declarations SET display_withdrawal_applied=true WHERE operation='display_waste' AND status='approved';

CREATE FUNCTION public.submit_stock_declaration_v2(p_operation text, p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_profile uuid; v_permission text; v_saved stock_declarations%ROWTYPE; v_id uuid; v_baseline numeric; v_display_movement uuid; v_constraint text;
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
v_saved.product_id IS DISTINCT FROM p_product_id OR v_saved.quantity<>p_quantity OR v_saved.reason<>btrim(p_reason)
THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
RETURN jsonb_build_object('declaration_id',v_saved.id,'status',v_saved.status,'display_withdrawal_applied',v_saved.display_withdrawal_applied,'idempotent_replay',true);
END IF;
SELECT current_stock INTO v_baseline FROM products WHERE id=p_product_id AND deleted_at IS NULL
AND (p_operation NOT LIKE 'display_%' OR is_display_item) FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;
IF p_operation LIKE 'display_%' THEN
SELECT quantity INTO v_baseline FROM display_stock WHERE product_id=p_product_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'display_stock_not_found'; END IF;
END IF;
IF p_operation='display_waste' AND v_baseline<p_quantity THEN
RAISE EXCEPTION 'insufficient_display_stock';
END IF;
INSERT INTO stock_declarations(operation,product_id,quantity,baseline_quantity,reason,declared_by,idempotency_key,display_withdrawal_applied)
VALUES(p_operation,p_product_id,p_quantity,v_baseline,btrim(p_reason),v_profile,p_idempotency_key,p_operation='display_waste') RETURNING id INTO v_id;
IF p_operation='display_waste' THEN
INSERT INTO display_movements(product_id,movement_type,quantity,reason,created_by,idempotency_key,reference_type,reference_id)
VALUES(p_product_id,'waste',-p_quantity,btrim(p_reason),v_profile,v_id,'stock_declaration',v_id)
RETURNING id INTO v_display_movement;
UPDATE display_stock SET quantity=quantity-p_quantity,updated_at=now() WHERE product_id=p_product_id;
INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
VALUES(v_profile,'display.waste','display_movement',v_display_movement,
jsonb_build_object('declaration_id',v_id,'declared_by',v_profile),
jsonb_build_object('product_id',p_product_id,'quantity',-p_quantity,'reason',btrim(p_reason)));
END IF;
INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
VALUES(v_profile,'stock.declaration_submitted','stock_declarations',v_id,
jsonb_build_object('operation',p_operation),jsonb_build_object('product_id',p_product_id,'quantity',p_quantity,'reason',btrim(p_reason)));
RETURN jsonb_build_object('declaration_id',v_id,'status','pending','display_withdrawal_applied',p_operation='display_waste','idempotent_replay',false);
EXCEPTION WHEN unique_violation THEN
GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
IF v_constraint<>'stock_declarations_idempotency_key_key' THEN RAISE; END IF;
SELECT * INTO v_saved FROM stock_declarations WHERE idempotency_key=p_idempotency_key;
IF NOT FOUND OR v_saved.declared_by IS DISTINCT FROM v_profile OR v_saved.operation IS DISTINCT FROM p_operation
OR v_saved.product_id IS DISTINCT FROM p_product_id OR v_saved.quantity IS DISTINCT FROM p_quantity
OR v_saved.reason IS DISTINCT FROM btrim(p_reason) THEN
RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
END IF;
RETURN jsonb_build_object('declaration_id',v_saved.id,'status',v_saved.status,'display_withdrawal_applied',v_saved.display_withdrawal_applied,'idempotent_replay',true);
END $function$;

CREATE FUNCTION public.approve_stock_declaration_v3(p_declaration_id uuid)
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
IF v_decl.operation='display_waste' AND v_decl.display_withdrawal_applied THEN
v_delta:=-v_decl.quantity;
ELSIF v_decl.operation LIKE 'display_%' THEN
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
v_result:=record_stock_movement_v1(p_product_id:=v_decl.product_id,
p_movement_type:=CASE WHEN v_decl.operation IN ('waste','display_waste') THEN 'waste'::movement_type ELSE 'adjustment'::movement_type END,
p_quantity:=v_delta,p_reason:=v_decl.reason,p_unit:=v_unit,p_idempotency_key:=v_decl.id,
p_metadata:=jsonb_build_object('reference_type','stock_declaration','reference_id',v_decl.id,
'declared_by',v_decl.declared_by,'approved_by',v_profile),
p_allow_negative:=v_decl.operation='display_waste');
END IF;
IF v_decl.operation LIKE 'display_%' AND v_delta<>0
AND NOT (v_decl.operation='display_waste' AND v_decl.display_withdrawal_applied) THEN
INSERT INTO display_movements(product_id,movement_type,quantity,reason,created_by,idempotency_key,reference_type,reference_id)
VALUES(v_decl.product_id,CASE WHEN v_decl.operation='display_waste' THEN 'waste'::display_movement_type ELSE 'adjustment'::display_movement_type END,
v_delta,v_decl.reason,v_profile,v_decl.id,'stock_declaration',v_decl.id) RETURNING id INTO v_display_movement;
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
UPDATE stock_declarations SET status='approved',reviewed_by=v_profile,reviewed_at=now(),result=v_result,
display_withdrawal_applied=(display_withdrawal_applied OR operation='display_waste') WHERE id=v_decl.id;
INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
VALUES(v_profile,'stock.declaration_approved','stock_declarations',v_decl.id,
jsonb_build_object('declared_by',v_decl.declared_by),v_result);
RETURN v_result;
END $function$;

CREATE FUNCTION public.adjust_stock_v4(p_product_id uuid, p_new_qty numeric, p_reason text, p_idempotency_key uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT submit_stock_declaration_v2('adjust',p_product_id,p_new_qty,p_reason,p_idempotency_key)
$function$;
DROP FUNCTION public.adjust_stock_v3(uuid,numeric,text,uuid);

CREATE FUNCTION public.waste_stock_v4(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT submit_stock_declaration_v2('waste',p_product_id,p_quantity,p_reason,p_idempotency_key)
$function$;
DROP FUNCTION public.waste_stock_v3(uuid,numeric,text,uuid);

CREATE FUNCTION public.waste_display_stock_v4(p_product_id uuid, p_quantity numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT submit_stock_declaration_v2('display_waste',p_product_id,p_quantity,p_reason,p_idempotency_key)
$function$;
DROP FUNCTION public.waste_display_stock_v3(uuid,numeric,text,uuid);
DROP FUNCTION public.submit_stock_declaration_v1(text,uuid,numeric,text,uuid);
DROP FUNCTION public.approve_stock_declaration_v2(uuid);
REVOKE ALL ON FUNCTION public.submit_stock_declaration_v2(text,uuid,numeric,text,uuid),
public.approve_stock_declaration_v3(uuid),
public.adjust_stock_v4(uuid,numeric,text,uuid),
public.waste_stock_v4(uuid,numeric,text,uuid),
public.waste_display_stock_v4(uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_stock_declaration_v2(text,uuid,numeric,text,uuid),
public.approve_stock_declaration_v3(uuid),
public.adjust_stock_v4(uuid,numeric,text,uuid),
public.waste_stock_v4(uuid,numeric,text,uuid),
public.waste_display_stock_v4(uuid,numeric,text,uuid) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
