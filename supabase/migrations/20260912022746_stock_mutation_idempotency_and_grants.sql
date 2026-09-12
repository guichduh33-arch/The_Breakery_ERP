-- Audit stock : chemins directs fermes et rejeu durable des mutations manuelles.
-- Corps metier copies depuis pg_get_functiondef sur V3 dev le 2026-09-12.
-- Les helpers prives conservent les validations, le ledger et les effets comptables.
REVOKE UPDATE (current_stock, unit) ON public.products FROM PUBLIC, anon, authenticated;
-- Le catalogue cree deja ses produits par RPC ; le stock initial reste a zero.
REVOKE INSERT ON public.products FROM PUBLIC, anon, authenticated;
DROP POLICY auth_read ON public.inventory_counts;
CREATE POLICY perm_read ON public.inventory_counts FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'inventory.read'));
DROP POLICY auth_read ON public.inventory_count_items;
CREATE POLICY perm_read ON public.inventory_count_items FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'inventory.read'));

CREATE SCHEMA IF NOT EXISTS stock_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA stock_private FROM PUBLIC, anon, authenticated;
CREATE TABLE stock_private.mutation_requests (
  idempotency_key uuid PRIMARY KEY,
  actor_uid uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('adjust','waste','incoming')),
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE stock_private.mutation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stock_private.mutation_requests FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA stock_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE OR REPLACE FUNCTION stock_private.adjust_stock_v1(p_product_id uuid, p_new_qty numeric, p_reason text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current DECIMAL(10,3);
  v_delta   DECIMAL(10,3);
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

  RETURN record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'adjustment',
    p_quantity        := v_delta,
    p_reason          := p_reason,
    p_idempotency_key := p_idempotency_key
  );
END $function$
;
CREATE OR REPLACE FUNCTION stock_private.record_incoming_stock_v1(p_product_id uuid, p_quantity numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
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

  RETURN record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'incoming',
    p_quantity        := p_quantity,
    p_reason          := v_reason,
    p_unit_cost       := p_unit_cost,
    p_supplier_id     := p_supplier_id,
    p_idempotency_key := p_idempotency_key
  );
END $function$
;
CREATE OR REPLACE FUNCTION stock_private.waste_stock_v1(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current DECIMAL(10,3);
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

  RETURN record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'waste',
    p_quantity        := -p_quantity,  -- negate (caller supplies positive qty)
    p_reason          := p_reason,
    p_idempotency_key := p_idempotency_key
  );
END $function$
;

CREATE FUNCTION stock_private.mutate(
  p_operation text, p_product_id uuid, p_quantity numeric, p_reason text,
  p_supplier_id uuid, p_unit_cost numeric, p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
END $$;

CREATE FUNCTION public.adjust_stock_v2(p_product_id uuid,p_new_qty numeric,p_reason text,
  p_idempotency_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT stock_private.mutate('adjust',p_product_id,p_new_qty,p_reason,NULL,NULL,p_idempotency_key)
$$;
CREATE FUNCTION public.waste_stock_v2(p_product_id uuid,p_quantity numeric,p_reason text,
  p_idempotency_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT stock_private.mutate('waste',p_product_id,p_quantity,p_reason,NULL,NULL,p_idempotency_key)
$$;
CREATE FUNCTION public.record_incoming_stock_v2(p_product_id uuid,p_quantity numeric,
  p_supplier_id uuid DEFAULT NULL,p_unit_cost numeric DEFAULT NULL,p_reason text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT stock_private.mutate('incoming',p_product_id,p_quantity,p_reason,p_supplier_id,p_unit_cost,p_idempotency_key)
$$;
DROP FUNCTION public.adjust_stock_v1(uuid,numeric,text,uuid);
DROP FUNCTION public.waste_stock_v1(uuid,numeric,text,uuid);
DROP FUNCTION public.record_incoming_stock_v1(uuid,numeric,uuid,numeric,text,uuid);
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA stock_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_stock_v2(uuid,numeric,text,uuid),
  public.waste_stock_v2(uuid,numeric,text,uuid),
  public.record_incoming_stock_v2(uuid,numeric,uuid,numeric,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_v2(uuid,numeric,text,uuid),
  public.waste_stock_v2(uuid,numeric,text,uuid),
  public.record_incoming_stock_v2(uuid,numeric,uuid,numeric,text,uuid) TO authenticated;
