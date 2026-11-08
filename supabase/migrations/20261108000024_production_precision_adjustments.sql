-- Correctif de précision des consommations de production, 8 novembre 2026.
-- Source live production V3 capturée avant édition ; ce fichier appartient au
-- paquet atomique 20261108000020.. : ne pas appliquer ses parties séparément.

DO $batch_guard$ BEGIN
  IF current_setting('breakery.production_precision_batch', true) IS DISTINCT FROM 'started' THEN
    RAISE EXCEPTION 'production_precision_atomic_batch_required';
  END IF;
END $batch_guard$;

CREATE OR REPLACE FUNCTION stock_private.adjust_stock_v2(p_product_id uuid, p_new_qty numeric, p_reason text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current NUMERIC;
  v_delta   NUMERIC;
  v_existing_mvt UUID;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.adjust') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_new_qty < 0 THEN
    RAISE EXCEPTION 'negative_qty_not_allowed';
  END IF;

  -- Idempotency replay: if a movement with this key exists, return it as-is.
  -- Done BEFORE the FOR UPDATE lock so retries are cheap and don't contend
  -- with a concurrent transaction touching the same product row.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_mvt
      FROM stock_movements
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT current_stock INTO v_current FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object(
        'movement_id',       v_existing_mvt,
        'product_id',        p_product_id,
        'new_current_stock', v_current,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  v_delta := p_new_qty - v_current;
  IF v_delta = 0 THEN
    -- No-op when the stock already matches the target. Idempotency_key is
    -- NOT persisted in this case — a subsequent retry with the same key will
    -- still resolve to noop (because no row was inserted).
    RETURN jsonb_build_object(
      'movement_id',       NULL,
      'product_id',        p_product_id,
      'new_current_stock', v_current,
      'noop',              true
    );
  END IF;

  RETURN record_stock_movement_v2(
    p_product_id      := p_product_id,
    p_movement_type   := 'adjustment',
    p_quantity        := v_delta,
    p_reason          := p_reason,
    p_idempotency_key := p_idempotency_key
  );
END $function$;
ALTER FUNCTION stock_private.adjust_stock_v2(uuid, numeric, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION stock_private.adjust_stock_v2(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION stock_private.adjust_stock_v2(uuid, numeric, text, uuid) TO postgres;
COMMENT ON FUNCTION stock_private.adjust_stock_v2(uuid, numeric, text, uuid) IS NULL;
DROP FUNCTION stock_private.adjust_stock_v1(uuid, numeric, text, uuid);

CREATE OR REPLACE FUNCTION stock_private.waste_stock_v2(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current NUMERIC;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.waste') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_current < p_quantity THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
  END IF;

  RETURN record_stock_movement_v2(
    p_product_id      := p_product_id,
    p_movement_type   := 'waste',
    p_quantity        := -p_quantity,  -- negate (caller supplies positive qty)
    p_reason          := p_reason,
    p_idempotency_key := p_idempotency_key
  );
END $function$;
ALTER FUNCTION stock_private.waste_stock_v2(uuid, numeric, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION stock_private.waste_stock_v2(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION stock_private.waste_stock_v2(uuid, numeric, text, uuid) TO postgres;
COMMENT ON FUNCTION stock_private.waste_stock_v2(uuid, numeric, text, uuid) IS NULL;
DROP FUNCTION stock_private.waste_stock_v1(uuid, numeric, text, uuid);

CREATE OR REPLACE FUNCTION stock_private.record_incoming_stock_v3(p_product_id uuid, p_quantity numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_supplier_code TEXT;
  v_reason TEXT := p_reason;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.receive') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  -- Supplier is OPTIONAL on this RPC (free-form receipt). When provided it
  -- must point to an active, non-deleted supplier; otherwise we mirror the
  -- receive_stock_v1 contract and reject with supplier_not_found_or_inactive.
  IF p_supplier_id IS NOT NULL THEN
    SELECT code INTO v_supplier_code FROM suppliers
     WHERE id = p_supplier_id AND is_active = true AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'supplier_not_found_or_inactive' USING ERRCODE='P0002';
    END IF;
  END IF;

  IF v_reason IS NULL OR length(trim(v_reason)) < 3 THEN
    v_reason := CASE
      WHEN p_supplier_id IS NULL THEN 'Stock receipt'
      ELSE 'Receipt from ' || v_supplier_code
    END;
  END IF;

  RETURN record_stock_movement_v2(
    p_product_id      := p_product_id,
    p_movement_type   := 'incoming',
    p_quantity        := p_quantity,
    p_reason          := v_reason,
    p_unit_cost       := p_unit_cost,
    p_supplier_id     := p_supplier_id,
    p_idempotency_key := p_idempotency_key
  );
END $function$;
ALTER FUNCTION stock_private.record_incoming_stock_v3(uuid, numeric, uuid, numeric, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION stock_private.record_incoming_stock_v3(uuid, numeric, uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION stock_private.record_incoming_stock_v3(uuid, numeric, uuid, numeric, text, uuid) TO postgres;
COMMENT ON FUNCTION stock_private.record_incoming_stock_v3(uuid, numeric, uuid, numeric, text, uuid) IS NULL;
DROP FUNCTION stock_private.record_incoming_stock_v1(uuid, numeric, uuid, numeric, text, uuid);

CREATE OR REPLACE FUNCTION stock_private.record_incoming_stock_v4(p_product_id uuid, p_quantity numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT stock_private.mutate('incoming',p_product_id,p_quantity,p_reason,p_supplier_id,p_unit_cost,p_idempotency_key)
$function$;
ALTER FUNCTION stock_private.record_incoming_stock_v4(uuid, numeric, uuid, numeric, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION stock_private.record_incoming_stock_v4(uuid, numeric, uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION stock_private.record_incoming_stock_v4(uuid, numeric, uuid, numeric, text, uuid) TO postgres;
COMMENT ON FUNCTION stock_private.record_incoming_stock_v4(uuid, numeric, uuid, numeric, text, uuid) IS NULL;
DROP FUNCTION stock_private.record_incoming_stock_v2(uuid, numeric, uuid, numeric, text, uuid);

CREATE OR REPLACE FUNCTION stock_private.mutate(p_operation text, p_product_id uuid, p_quantity numeric, p_reason text, p_supplier_id uuid, p_unit_cost numeric, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_permission text;
  v_request jsonb;
  v_saved stock_private.mutation_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  v_permission := CASE p_operation
    WHEN 'adjust' THEN 'inventory.adjust' WHEN 'waste' THEN 'inventory.waste'
    WHEN 'incoming' THEN 'inventory.receive' END;
  IF v_permission IS NULL OR NOT public.has_permission(auth.uid(), v_permission) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL OR p_quantity IS NULL
     OR p_quantity::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
  END IF;
  IF abs(p_quantity) > 9999999.999 OR round(p_quantity, 3) <> p_quantity THEN
    RAISE EXCEPTION 'invalid_quantity_precision' USING ERRCODE = '22023';
  END IF;
  IF p_operation IN ('adjust','waste') AND (p_reason IS NULL OR length(trim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'invalid_cost' USING ERRCODE = '22023';
  END IF;
  -- Le motif fait partie de l'intention : changer les parametres exige une nouvelle cle.
  v_request := jsonb_build_object('product_id', p_product_id, 'quantity', p_quantity,
    'reason', p_reason, 'supplier_id', p_supplier_id, 'unit_cost', p_unit_cost);
  IF p_idempotency_key IS NOT NULL THEN
    -- Verrou AVANT lecture du registre et des produits. Une collision de hash ne fait
    -- que serialiser deux cles differentes ; l'identite repose sur la PK UUID.
    PERFORM pg_advisory_xact_lock(hashtextextended('stock-mutation:' || p_idempotency_key::text, 0));
    SELECT * INTO v_saved FROM stock_private.mutation_requests
      WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_saved.actor_uid <> auth.uid() OR v_saved.operation <> p_operation
         OR v_saved.request <> v_request THEN
        RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
      END IF;
      RETURN v_saved.result || jsonb_build_object('idempotent_replay', true);
    END IF;
    -- Une ancienne cle sans requete durable ne prouve pas les parametres initiaux :
    -- refuser explicitement au lieu de re-jouer une autre operation silencieusement.
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE idempotency_key = p_idempotency_key) THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- Rejeu resolu avant cet etat mutable : un produit supprime apres une operation
  -- reussie ne doit pas transformer sa confirmation en erreur.
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_result := CASE p_operation
    WHEN 'adjust' THEN stock_private.adjust_stock_v2(p_product_id,p_quantity,p_reason,p_idempotency_key)
    WHEN 'waste' THEN stock_private.waste_stock_v2(p_product_id,p_quantity,p_reason,p_idempotency_key)
    WHEN 'incoming' THEN stock_private.record_incoming_stock_v3(
      p_product_id,p_quantity,p_supplier_id,p_unit_cost,p_reason,p_idempotency_key)
  END;
  v_result := v_result || jsonb_build_object('idempotent_replay', false);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO stock_private.mutation_requests(idempotency_key,actor_uid,operation,request,result)
      VALUES (p_idempotency_key,auth.uid(),p_operation,v_request,v_result);
  END IF;
  RETURN v_result;
END $function$;
ALTER FUNCTION stock_private.mutate(text, uuid, numeric, text, uuid, numeric, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION stock_private.mutate(text, uuid, numeric, text, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION stock_private.mutate(text, uuid, numeric, text, uuid, numeric, uuid) TO postgres;
COMMENT ON FUNCTION stock_private.mutate(text, uuid, numeric, text, uuid, numeric, uuid) IS NULL;

CREATE OR REPLACE FUNCTION public.record_incoming_stock_v6(p_product_id uuid, p_quantity numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_day date;
BEGIN
 v_result:=stock_private.record_incoming_stock_v4(p_product_id,p_quantity,p_supplier_id,p_unit_cost,p_reason,p_idempotency_key);
 IF p_idempotency_key IS NOT NULL THEN
  SELECT created_at::date INTO v_day FROM stock_private.mutation_requests
  WHERE idempotency_key=p_idempotency_key AND actor_uid=auth.uid() AND operation='incoming';
 ELSE v_day:=current_date; END IF;
 RETURN stock_private.mask_stock_payload_for_day_v2(v_result,v_day);
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
 AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$;
ALTER FUNCTION public.record_incoming_stock_v6(uuid, numeric, uuid, numeric, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_incoming_stock_v6(uuid, numeric, uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_incoming_stock_v6(uuid, numeric, uuid, numeric, text, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.record_incoming_stock_v6(uuid, numeric, uuid, numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_incoming_stock_v6(uuid, numeric, uuid, numeric, text, uuid) TO authenticated;
COMMENT ON FUNCTION public.record_incoming_stock_v6(uuid, numeric, uuid, numeric, text, uuid) IS NULL;
DROP FUNCTION public.record_incoming_stock_v5(uuid, numeric, uuid, numeric, text, uuid);

CREATE OR REPLACE FUNCTION public.approve_stock_declaration_v4(p_declaration_id uuid)
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
v_result:=record_stock_movement_v2(p_product_id:=v_decl.product_id,
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
ALTER FUNCTION public.approve_stock_declaration_v4(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_stock_declaration_v4(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_stock_declaration_v4(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.approve_stock_declaration_v4(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_stock_declaration_v4(uuid) TO service_role;
COMMENT ON FUNCTION public.approve_stock_declaration_v4(uuid) IS NULL;
DROP FUNCTION public.approve_stock_declaration_v3(uuid);
