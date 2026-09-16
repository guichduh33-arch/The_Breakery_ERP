-- Validation des frontieres du helper prive, signatures publiques inchangees.
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
    WHEN 'adjust' THEN stock_private.adjust_stock_v1(p_product_id,p_quantity,p_reason,p_idempotency_key)
    WHEN 'waste' THEN stock_private.waste_stock_v1(p_product_id,p_quantity,p_reason,p_idempotency_key)
    WHEN 'incoming' THEN stock_private.record_incoming_stock_v1(
      p_product_id,p_quantity,p_supplier_id,p_unit_cost,p_reason,p_idempotency_key)
  END;
  v_result := v_result || jsonb_build_object('idempotent_replay', false);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO stock_private.mutation_requests(idempotency_key,actor_uid,operation,request,result)
      VALUES (p_idempotency_key,auth.uid(),p_operation,v_request,v_result);
  END IF;
  RETURN v_result;
END $function$
;
