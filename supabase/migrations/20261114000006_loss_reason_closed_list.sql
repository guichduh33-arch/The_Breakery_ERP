-- S1-18 (2/2) — le motif d'une perte de stock ou de vitrine vient d'une liste fermée.
--
-- Décision de Mamat (04_QUESTIONS_CLARIFICATION, S07, lot 7) et du 2026-11-14 :
-- les pertes de stock et de vitrine portent un motif du type `waste_reason`
-- (étendu par le fichier précédent). Les pertes passées gardent leur texte ;
-- leur motif reste NULL, ce qui se lit « non précisé ». Aucune ligne existante
-- n'est réécrite.
--
-- Toutes les pertes de stock et de vitrine passent par `stock_declarations`.
-- Le motif y est donc exigé à l'entrée :
--   - `submit_stock_declaration_v3` remplace `_v2` (nouvel argument
--     `p_waste_reason`) ;
--   - `waste_stock_v5` et `waste_display_stock_v5` remplacent les `_v4`
--     (le texte libre devient un motif et une note facultative) ;
--   - `stock_private.submit_day_waste_v2` remplace `_v1` ;
--   - `submit_display_day_closing_v2` remplace `_v1` (chaque ligne porte un
--     motif de la liste et une note facultative).
-- `adjust_stock_v4` garde son nom, sa signature et son comportement : seul
-- l'appel interne suit le changement de nom de la fonction qu'il enveloppe.
--
-- Règle du texte : la colonne `reason` reste remplie partout (elle alimente le
-- mouvement de stock, qui l'exige). Elle reçoit la note si elle existe, sinon
-- le motif. Le motif `other` exige une note d'au moins trois caractères.
--
-- Corps partis des définitions live du 2026-11-14 (dev et production égaux
-- après normalisation des retours chariot).

-- ---------------------------------------------------------------------------
-- 1. Stockage du motif
-- ---------------------------------------------------------------------------

ALTER TABLE public.stock_declarations
  ADD COLUMN waste_reason public.waste_reason;

ALTER TABLE public.stock_declarations
  ADD CONSTRAINT stock_declarations_waste_reason_scope_check
  CHECK (waste_reason IS NULL OR operation IN ('waste', 'display_waste'));

COMMENT ON COLUMN public.stock_declarations.waste_reason IS
  'Motif de perte de la liste fermée (S1-18). NULL = non précisé : perte déclarée avant la liste fermée, ou déclaration qui n''est pas une perte.';

ALTER TABLE public.display_day_closing_items
  ADD COLUMN waste_reason_code public.waste_reason;

ALTER TABLE public.display_day_closing_items
  ADD CONSTRAINT display_day_closing_items_waste_reason_code_check
  CHECK (waste_reason_code IS NULL OR waste_qty > 0);

COMMENT ON COLUMN public.display_day_closing_items.waste_reason_code IS
  'Motif de perte de la liste fermée (S1-18). NULL = non précisé : comptage saisi avant la liste fermée, ou ligne sans perte. Le texte reste dans waste_reason.';

-- ---------------------------------------------------------------------------
-- 2. Déclaration de stock : le motif est exigé pour une perte
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.submit_stock_declaration_v3(
  p_operation text,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_idempotency_key uuid,
  p_waste_reason public.waste_reason DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_profile uuid; v_permission text; v_saved stock_declarations%ROWTYPE; v_id uuid; v_baseline numeric; v_display_movement uuid; v_constraint text;
v_is_waste boolean; v_note text; v_reason text;
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
v_is_waste:=p_operation IN ('waste','display_waste');
v_note:=NULLIF(btrim(coalesce(p_reason,'')),'');
IF v_is_waste THEN
-- Perte : le motif vient de la liste fermée ; la note est facultative, sauf pour `other`.
IF p_waste_reason IS NULL THEN RAISE EXCEPTION 'waste_reason_required' USING ERRCODE='22023'; END IF;
IF (v_note IS NULL AND p_waste_reason='other') OR (v_note IS NOT NULL AND length(v_note)<3)
THEN RAISE EXCEPTION 'reason_required'; END IF;
v_reason:=COALESCE(v_note,p_waste_reason::text);
ELSE
IF p_waste_reason IS NOT NULL THEN RAISE EXCEPTION 'waste_reason_not_allowed' USING ERRCODE='22023'; END IF;
IF v_note IS NULL OR length(v_note)<3 THEN RAISE EXCEPTION 'reason_required'; END IF;
v_reason:=v_note;
END IF;
PERFORM pg_advisory_xact_lock(hashtextextended('stock-declaration:'||p_idempotency_key::text,0));
SELECT * INTO v_saved FROM stock_declarations WHERE idempotency_key=p_idempotency_key;
IF FOUND THEN
IF v_saved.declared_by<>v_profile OR v_saved.operation<>p_operation OR
v_saved.product_id IS DISTINCT FROM p_product_id OR v_saved.quantity<>p_quantity OR v_saved.reason<>v_reason
OR v_saved.waste_reason IS DISTINCT FROM p_waste_reason
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
INSERT INTO stock_declarations(operation,product_id,quantity,baseline_quantity,reason,waste_reason,declared_by,idempotency_key,display_withdrawal_applied)
VALUES(p_operation,p_product_id,p_quantity,v_baseline,v_reason,p_waste_reason,v_profile,p_idempotency_key,p_operation='display_waste') RETURNING id INTO v_id;
IF p_operation='display_waste' THEN
INSERT INTO display_movements(product_id,movement_type,quantity,reason,created_by,idempotency_key,reference_type,reference_id)
VALUES(p_product_id,'waste',-p_quantity,v_reason,v_profile,v_id,'stock_declaration',v_id)
RETURNING id INTO v_display_movement;
UPDATE display_stock SET quantity=quantity-p_quantity,updated_at=now() WHERE product_id=p_product_id;
INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
VALUES(v_profile,'display.waste','display_movement',v_display_movement,
jsonb_build_object('declaration_id',v_id,'declared_by',v_profile),
jsonb_build_object('product_id',p_product_id,'quantity',-p_quantity,'reason',v_reason,'waste_reason',p_waste_reason));
END IF;
INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
VALUES(v_profile,'stock.declaration_submitted','stock_declarations',v_id,
jsonb_build_object('operation',p_operation),
jsonb_build_object('product_id',p_product_id,'quantity',p_quantity,'reason',v_reason)
||CASE WHEN v_is_waste THEN jsonb_build_object('waste_reason',p_waste_reason) ELSE '{}'::jsonb END);
RETURN jsonb_build_object('declaration_id',v_id,'status','pending','display_withdrawal_applied',p_operation='display_waste','idempotent_replay',false);
EXCEPTION WHEN unique_violation THEN
GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
IF v_constraint<>'stock_declarations_idempotency_key_key' THEN RAISE; END IF;
SELECT * INTO v_saved FROM stock_declarations WHERE idempotency_key=p_idempotency_key;
IF NOT FOUND OR v_saved.declared_by IS DISTINCT FROM v_profile OR v_saved.operation IS DISTINCT FROM p_operation
OR v_saved.product_id IS DISTINCT FROM p_product_id OR v_saved.quantity IS DISTINCT FROM p_quantity
OR v_saved.reason IS DISTINCT FROM v_reason OR v_saved.waste_reason IS DISTINCT FROM p_waste_reason THEN
RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
END IF;
RETURN jsonb_build_object('declaration_id',v_saved.id,'status',v_saved.status,'display_withdrawal_applied',v_saved.display_withdrawal_applied,'idempotent_replay',true);
END $function$;

REVOKE EXECUTE ON FUNCTION public.submit_stock_declaration_v3(text, uuid, numeric, text, uuid, public.waste_reason) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_stock_declaration_v3(text, uuid, numeric, text, uuid, public.waste_reason) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_stock_declaration_v3(text, uuid, numeric, text, uuid, public.waste_reason) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Enveloppes
-- ---------------------------------------------------------------------------

-- Même nom, même signature, même comportement : seul l'appel interne change.
CREATE OR REPLACE FUNCTION public.adjust_stock_v4(p_product_id uuid, p_new_qty numeric, p_reason text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT submit_stock_declaration_v3('adjust',p_product_id,p_new_qty,p_reason,p_idempotency_key)
$function$;

CREATE FUNCTION public.waste_stock_v5(
  p_product_id uuid,
  p_quantity numeric,
  p_waste_reason public.waste_reason,
  p_note text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT submit_stock_declaration_v3('waste',p_product_id,p_quantity,p_note,p_idempotency_key,p_waste_reason)
$function$;

CREATE FUNCTION public.waste_display_stock_v5(
  p_product_id uuid,
  p_quantity numeric,
  p_waste_reason public.waste_reason,
  p_note text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT submit_stock_declaration_v3('display_waste',p_product_id,p_quantity,p_note,p_idempotency_key,p_waste_reason)
$function$;

REVOKE EXECUTE ON FUNCTION public.waste_stock_v5(uuid, numeric, public.waste_reason, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.waste_stock_v5(uuid, numeric, public.waste_reason, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.waste_stock_v5(uuid, numeric, public.waste_reason, text, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.waste_display_stock_v5(uuid, numeric, public.waste_reason, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.waste_display_stock_v5(uuid, numeric, public.waste_reason, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.waste_display_stock_v5(uuid, numeric, public.waste_reason, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Comptage de vitrine du jour
-- ---------------------------------------------------------------------------

CREATE FUNCTION stock_private.submit_day_waste_v2(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_key uuid,
  p_waste_reason public.waste_reason
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=public.get_current_profile_id(); v_expected numeric; v_id uuid; v_movement uuid;
BEGIN
 IF p_waste_reason IS NULL THEN RAISE EXCEPTION 'waste_reason_required' USING ERRCODE='22023'; END IF;
 SELECT quantity INTO v_expected FROM public.display_stock WHERE product_id=p_product_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'display_stock_not_found' USING ERRCODE='P0002'; END IF;
 IF v_expected<p_quantity THEN RAISE EXCEPTION 'insufficient_display_stock' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.stock_declarations(operation,product_id,quantity,baseline_quantity,reason,waste_reason,declared_by,
  idempotency_key,display_withdrawal_applied)
 VALUES('display_waste',p_product_id,p_quantity,v_expected,p_reason,p_waste_reason,v_actor,p_key,true) RETURNING id INTO v_id;
 INSERT INTO public.display_movements(product_id,movement_type,quantity,reason,created_by,idempotency_key,
  reference_type,reference_id)
 VALUES(p_product_id,'waste',-p_quantity,p_reason,v_actor,v_id,'stock_declaration',v_id) RETURNING id INTO v_movement;
 UPDATE public.display_stock SET quantity=quantity-p_quantity,updated_at=now() WHERE product_id=p_product_id;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload) VALUES
 (v_actor,'display.waste','display_movement',v_movement,
  jsonb_build_object('declaration_id',v_id,'declared_by',v_actor),
  jsonb_build_object('product_id',p_product_id,'quantity',-p_quantity,'reason',p_reason,'waste_reason',p_waste_reason)),
 (v_actor,'stock.declaration_submitted','stock_declarations',v_id,
  jsonb_build_object('operation','display_waste'),
  jsonb_build_object('product_id',p_product_id,'quantity',p_quantity,'reason',p_reason,'waste_reason',p_waste_reason));
 RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION stock_private.submit_day_waste_v2(uuid, numeric, text, uuid, public.waste_reason) FROM PUBLIC;
REVOKE ALL ON FUNCTION stock_private.submit_day_waste_v2(uuid, numeric, text, uuid, public.waste_reason) FROM anon, authenticated, service_role;

CREATE FUNCTION public.submit_display_day_closing_v2(p_business_day date, p_items jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=public.get_current_profile_id(); v_saved public.display_day_closings%ROWTYPE;
 v_request jsonb; v_items jsonb; v_line record; v_id uuid; v_expected numeric; v_declaration uuid; v_basis text;
 v_text text;
BEGIN
 IF v_actor IS NULL OR NOT public.request_has_active_pin_session_v1()
  OR NOT public.has_permission(auth.uid(),'display.count') THEN
  RAISE EXCEPTION 'permission_denied: display.count' USING ERRCODE='P0003'; END IF;
 IF p_idempotency_key IS NULL OR p_business_day IS NULL THEN
  RAISE EXCEPTION 'closing_identity_required' USING ERRCODE='22023'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'display_items_required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x)<>'object') THEN
  RAISE EXCEPTION 'invalid_display_item' USING ERRCODE='22023'; END IF;
 -- Le motif d'une perte vient de la liste fermée ; la note est facultative, sauf pour `other`.
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items)
  x(product_id uuid,remaining_qty numeric,waste_qty numeric,waste_reason text,waste_note text)
  WHERE product_id IS NULL OR remaining_qty IS NULL OR waste_qty IS NULL
   OR remaining_qty::text IN('NaN','Infinity','-Infinity') OR waste_qty::text IN('NaN','Infinity','-Infinity')
   OR remaining_qty<0 OR waste_qty<0 OR remaining_qty>9999999.999 OR waste_qty>9999999.999
   OR remaining_qty<>round(remaining_qty,3) OR waste_qty<>round(waste_qty,3)
   OR (waste_qty>0 AND (waste_reason IS NULL OR NOT EXISTS(
     SELECT 1 FROM unnest(enum_range(NULL::public.waste_reason)) r WHERE r::text=waste_reason)))
   OR (waste_qty>0 AND waste_reason='other' AND length(btrim(coalesce(waste_note,'')))<3)
   OR (waste_qty>0 AND btrim(coalesce(waste_note,''))<>'' AND length(btrim(waste_note))<3)
   OR length(coalesce(waste_note,''))>2000)
 OR EXISTS(SELECT product_id FROM jsonb_to_recordset(p_items) x(product_id uuid) GROUP BY product_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'invalid_display_quantity_or_reason' USING ERRCODE='22023'; END IF;
 SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'remaining_qty',remaining_qty,
  'waste_qty',waste_qty,'waste_reason',CASE WHEN waste_qty>0 THEN waste_reason END,
  'waste_note',CASE WHEN waste_qty>0 THEN NULLIF(btrim(coalesce(waste_note,'')),'') END) ORDER BY product_id)
 INTO v_items FROM jsonb_to_recordset(p_items)
  x(product_id uuid,remaining_qty numeric,waste_qty numeric,waste_reason text,waste_note text);
 v_request:=jsonb_build_object('business_day',p_business_day,'items',v_items);
 PERFORM pg_advisory_xact_lock(hashtextextended('display-day-key:'||p_idempotency_key::text,0));
 SELECT * INTO v_saved FROM public.display_day_closings WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_saved.recorded_by<>v_actor OR v_saved.request<>v_request THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('closing_id',v_saved.id,'business_day',v_saved.business_day,
   'revision',v_saved.revision,'idempotent_replay',true);
 END IF;
 IF p_business_day NOT BETWEEN current_date-1 AND current_date THEN
  RAISE EXCEPTION 'invalid_business_day' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('display-day:'||p_business_day::text,0));
 IF EXISTS(SELECT 1 FROM public.display_day_closings WHERE business_day=p_business_day) THEN
  RAISE EXCEPTION 'display_day_already_submitted' USING ERRCODE='23505'; END IF;
 -- Verrouillage déterministe de tout le lot, avant le premier retrait vitrine.
 PERFORM p.id FROM public.products p JOIN jsonb_to_recordset(v_items) x(product_id uuid) ON x.product_id=p.id
  WHERE p.is_display_item AND p.deleted_at IS NULL ORDER BY p.id FOR UPDATE OF p;
 IF (SELECT count(*) FROM public.products p JOIN jsonb_to_recordset(v_items) x(product_id uuid) ON x.product_id=p.id
  WHERE p.is_display_item AND p.deleted_at IS NULL)<>jsonb_array_length(v_items) THEN
  RAISE EXCEPTION 'not_a_display_item' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.display_day_closings(business_day,revision,recorded_by,idempotency_key,request)
 VALUES(p_business_day,1,v_actor,p_idempotency_key,v_request) RETURNING id INTO v_id;
 FOR v_line IN SELECT * FROM jsonb_to_recordset(v_items)
  x(product_id uuid,remaining_qty numeric,waste_qty numeric,waste_reason public.waste_reason,waste_note text) ORDER BY product_id LOOP
  v_declaration:=NULL; v_text:=NULL;
  IF v_line.waste_qty>0 THEN
   v_text:=COALESCE(v_line.waste_note,v_line.waste_reason::text);
   v_declaration:=stock_private.submit_day_waste_v2(v_line.product_id,v_line.waste_qty,v_text,
    md5('display-day:'||p_idempotency_key::text||':'||v_line.product_id::text)::uuid,v_line.waste_reason);
  END IF;
  SELECT r.reference_basis,r.expected_qty INTO v_basis,v_expected
  FROM stock_private.display_day_reference_v1(v_line.product_id,p_business_day,v_declaration) r;
  INSERT INTO public.display_day_closing_items(closing_id,product_id,remaining_qty,waste_qty,waste_reason,
   waste_reason_code,reference_basis,expected_qty,waste_declaration_id)
  VALUES(v_id,v_line.product_id,v_line.remaining_qty,v_line.waste_qty,v_text,
   v_line.waste_reason,v_basis,v_expected,v_declaration);
 END LOOP;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_actor,'display.day_count_submitted','display_day_closings',v_id,
  jsonb_build_object('business_day',p_business_day,'revision',1),jsonb_build_object('items',v_items));
 RETURN jsonb_build_object('closing_id',v_id,'business_day',p_business_day,'revision',1,'idempotent_replay',false);
END $function$;

REVOKE EXECUTE ON FUNCTION public.submit_display_day_closing_v2(date, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_display_day_closing_v2(date, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_display_day_closing_v2(date, jsonb, uuid) TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. Retrait des versions remplacées
-- ---------------------------------------------------------------------------

DROP FUNCTION public.waste_stock_v4(uuid, numeric, text, uuid);
DROP FUNCTION public.waste_display_stock_v4(uuid, numeric, text, uuid);
DROP FUNCTION public.submit_stock_declaration_v2(text, uuid, numeric, text, uuid);
DROP FUNCTION public.submit_display_day_closing_v1(date, jsonb, uuid);
DROP FUNCTION stock_private.submit_day_waste_v1(uuid, numeric, text, uuid);
