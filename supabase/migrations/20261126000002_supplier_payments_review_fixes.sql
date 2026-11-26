-- ADR-048 — corrections de revue de 20261126000001.
--
-- 1. Versionnement monotone : la migration précédente a remplacé en place le
--    corps de `_guard_po_payment_invoice_v1` (publié le 2026-11-16) pour laisser
--    passer les contre-passations. Le garde devient `_guard_po_payment_invoice_v2`
--    (même corps), le déclencheur y est rebranché et la v1 est supprimée.
-- 2. Rejeu concurrent du règlement groupé : `record_supplier_payment_v1`
--    décidait du rejeu AVANT de prendre les verrous. Un second appel de même
--    clé, bloqué derrière le premier, reprenait sans rejeu et levait
--    `po_nothing_due` alors que l'argent était enregistré une fois. La v2 refait
--    le contrôle de rejeu APRÈS les verrous. Corps repris de la v1 live.

-- ─── 1. Garde de facture : v2 ────────────────────────────────────────────────
CREATE FUNCTION public._guard_po_payment_invoice_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p public.purchase_orders%ROWTYPE;
BEGIN
 -- Une contre-passation ne réclame pas de facture : le paiement d'origine l'a
 -- déjà exigée, et la facture ne peut plus être retirée après paiement.
 IF NEW.reversal_of_id IS NOT NULL THEN RETURN NEW; END IF;
 SELECT * INTO p FROM public.purchase_orders WHERE id=NEW.purchase_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'po_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT p.invoice_exempt AND NOT public._payment_invoice_valid_v1(
   'purchase-invoices',p.invoice_path,'purchase-orders/'||p.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_payment' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;

DROP TRIGGER invoice_required_before_payment ON public.purchase_payments;
CREATE TRIGGER invoice_required_before_payment BEFORE INSERT ON public.purchase_payments
  FOR EACH ROW EXECUTE FUNCTION public._guard_po_payment_invoice_v2();
DROP FUNCTION public._guard_po_payment_invoice_v1();

REVOKE EXECUTE ON FUNCTION public._guard_po_payment_invoice_v2() FROM PUBLIC, anon, authenticated;

-- ─── 2. Règlement groupé : v2, rejeu décidé sous verrou ──────────────────────
CREATE FUNCTION public.record_supplier_payment_v2(
  p_supplier_id uuid, p_po_ids uuid[], p_amount numeric, p_method text,
  p_reference text DEFAULT NULL::text, p_paid_at timestamptz DEFAULT now(),
  p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   uuid;
  v_ids       uuid[];
  v_po        record;
  v_total_due numeric(14,2) := 0;
  v_left      numeric(14,2);
  v_part      numeric(14,2);
  v_res       jsonb;
  v_lines     jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT has_permission(v_uid, 'purchasing.po.pay') THEN
    RAISE EXCEPTION 'permission_denied: purchasing.po.pay' USING ERRCODE = 'P0003';
  END IF;

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_method IS NULL OR length(trim(p_method)) = 0 THEN
    RAISE EXCEPTION 'method_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_po_ids) x WHERE x IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) < 1 THEN
    RAISE EXCEPTION 'po_ids_required' USING ERRCODE = 'P0001';
  END IF;

  -- Verrous dans un ordre stable, puis contrôles de chaque bon.
  FOR v_po IN
    SELECT po.* FROM purchase_orders po
     WHERE po.id = ANY (v_ids)
     ORDER BY po.id
     FOR UPDATE
  LOOP
    IF v_po.supplier_id IS DISTINCT FROM p_supplier_id THEN
      RAISE EXCEPTION 'po_supplier_mismatch: %', v_po.po_number USING ERRCODE = 'P0001';
    END IF;
    IF v_po.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_po.status = 'cancelled' THEN
      RAISE EXCEPTION 'po_cancelled: %', v_po.po_number USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM purchase_orders WHERE id = ANY (v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Rejeu, décidé SOUS les verrous : un appel concurrent de même clé a pu
  -- aboutir pendant l'attente. On rend alors les lignes de la première saisie.
  IF EXISTS (SELECT 1 FROM purchase_payments WHERE payment_group_id = p_idempotency_key) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'po_id', pp.purchase_order_id, 'payment_id', pp.id, 'amount', pp.amount)
             ORDER BY pp.created_at, pp.id), '[]'::jsonb)
      INTO v_lines
      FROM purchase_payments pp
     WHERE pp.payment_group_id = p_idempotency_key AND pp.reversal_of_id IS NULL;
    RETURN jsonb_build_object(
      'payment_group_id', p_idempotency_key,
      'amount_paid', (SELECT SUM(amount) FROM purchase_payments
                       WHERE payment_group_id = p_idempotency_key AND reversal_of_id IS NULL),
      'lines', v_lines,
      'idempotent_replay', true);
  END IF;

  -- Reste dû de chaque bon : la somme du grand livre, contre-passations comprises.
  FOR v_po IN
    SELECT po.id, po.po_number, po.total_amount - COALESCE(
             (SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_order_id = po.id), 0) AS due
      FROM purchase_orders po WHERE po.id = ANY (v_ids)
  LOOP
    IF v_po.due <= 0 THEN
      RAISE EXCEPTION 'po_nothing_due: %', v_po.po_number USING ERRCODE = 'P0001';
    END IF;
    v_total_due := v_total_due + v_po.due;
  END LOOP;

  IF p_amount > v_total_due THEN
    RAISE EXCEPTION 'overpayment_not_allowed: remaining=% requested=%', v_total_due, p_amount
      USING ERRCODE = 'P0001';
  END IF;

  -- Répartition du plus ancien bon au plus récent.
  v_left := p_amount;
  FOR v_po IN
    SELECT po.id, po.total_amount - COALESCE(
             (SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_order_id = po.id), 0) AS due
      FROM purchase_orders po WHERE po.id = ANY (v_ids)
     ORDER BY po.order_date NULLS LAST, po.created_at, po.id
  LOOP
    EXIT WHEN v_left <= 0;
    v_part := LEAST(v_left, v_po.due);
    v_res := _record_po_payment_internal_v2(
      p_po_id            := v_po.id,
      p_amount           := v_part,
      p_method           := p_method,
      p_reference        := p_reference,
      p_idempotency_key  := md5(p_idempotency_key::text || ':' || v_po.id::text)::uuid,
      p_actor            := v_profile,
      p_paid_at          := COALESCE(p_paid_at, now()),
      p_payment_group_id := p_idempotency_key);
    v_lines := v_lines || jsonb_build_object(
      'po_id', v_po.id, 'payment_id', v_res->>'payment_id', 'amount', v_part,
      'remaining_due', v_res->'remaining_due', 'derived_status', v_res->'derived_status');
    v_left := v_left - v_part;
  END LOOP;

  RETURN jsonb_build_object(
    'payment_group_id', p_idempotency_key,
    'amount_paid', p_amount,
    'lines', v_lines,
    'idempotent_replay', false);
END $function$;

DROP FUNCTION public.record_supplier_payment_v1(uuid, uuid[], numeric, text, text, timestamptz, uuid);

REVOKE EXECUTE ON FUNCTION public.record_supplier_payment_v2(uuid, uuid[], numeric, text, text, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_supplier_payment_v2(uuid, uuid[], numeric, text, text, timestamptz, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment_v2(uuid, uuid[], numeric, text, text, timestamptz, uuid) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.record_supplier_payment_v2(uuid, uuid[], numeric, text, text, timestamptz, uuid) IS
  'ADR-048 : règlement groupé de plusieurs bons d''un même fournisseur ; rejeu décidé sous verrou.';
