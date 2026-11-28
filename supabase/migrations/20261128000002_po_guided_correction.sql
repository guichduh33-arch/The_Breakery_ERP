-- 20261128000002_po_guided_correction.sql
--
-- ADR-050 — Correction guidée d'un bon de commande reçu et payé, par le super
-- admin. Trois objets :
--
-- 1. `update_purchase_order_v3` : copie du corps LIVE de la v2 (relevé du
--    2026-11-28), où seules changent les règles de verrou. Une réception
--    ANNULÉE et un paiement CONTRE-PASSÉ ne verrouillent plus le bon : c'est
--    ce qui rend l'édition possible une fois la correction faite. La v2
--    regardait l'existence d'une ligne, pas son état (conséquence notée par
--    l'ADR-048). La v2 est supprimée dans la même migration.
--
-- 2. `start_po_correction_v1` : le geste de correction. Super admin seul, PIN
--    vérifié avec verrouillage, motif obligatoire. Dans UNE transaction, il
--    contre-passe chaque paiement vivant du bon (`reverse_po_payment_v1`, ADR-048)
--    puis annule chaque réception active (`cancel_goods_receipt_v1`, qui
--    contre-passe stock, coût moyen et dette). Un seul refus annule le tout.
--    Le bon revient « pending » et redevient éditable.
--
-- 3. Champs calculés PostgREST `po_paid_amount` / `po_payment_status` : la
--    liste des bons filtre le statut de paiement côté serveur sans casser la
--    pagination. SECURITY INVOKER : la RLS de l'appelant s'applique.

-- ---------------------------------------------------------------------------
-- 1. update_purchase_order_v3
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_purchase_order_v3(p_po_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_profile       UUID;
  v_po            RECORD;
  v_item          JSONB;
  v_product_id    UUID;
  v_quantity      DECIMAL(14,3);
  v_unit          TEXT;
  v_unit_cost     DECIMAL(14,2);
  v_factor        NUMERIC(20,10);
  v_product_unit  TEXT;
  v_cat_type      TEXT;
  v_subtotal      DECIMAL(14,2) := 0;
  v_vat_rate      DECIMAL(6,4);
  v_vat_amount    DECIMAL(14,2);
  v_total_amount  DECIMAL(14,2);
  v_line_sub      DECIMAL(14,2);
  v_line_disc     DECIMAL(14,2);
  v_item_count    INT := 0;
  v_new_supplier  UUID;
  v_new_exp_date  DATE;
  v_new_terms     TEXT;
  v_new_notes     TEXT;
  v_new_discount  DECIMAL(14,2);
  v_new_fee       DECIMAL(14,2);
  v_old_taxable   DECIMAL(14,2);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT has_permission(v_uid, 'purchasing.po.edit') THEN
    RAISE EXCEPTION 'permission_denied: purchasing.po.edit' USING ERRCODE = 'P0003';
  END IF;

  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_po.status <> 'pending' THEN
    RAISE EXCEPTION 'po_locked: status=%', v_po.status USING ERRCODE = 'P0001';
  END IF;
  -- v3 : seule une réception ACTIVE verrouille (une réception annulée a déjà
  -- contre-passé son stock, son coût moyen et sa dette).
  IF EXISTS (SELECT 1 FROM goods_receipt_notes
              WHERE po_id = p_po_id AND cancelled_at IS NULL LIMIT 1) THEN
    RAISE EXCEPTION 'po_locked: goods_receipt_note_exists' USING ERRCODE = 'P0001';
  END IF;
  -- v3 : seul un paiement VIVANT verrouille — ni une contre-passation, ni un
  -- paiement déjà contre-passé (ADR-048 : la paire se compense au grand livre).
  IF EXISTS (SELECT 1 FROM purchase_payments p
              WHERE p.purchase_order_id = p_po_id
                AND p.reversal_of_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM purchase_payments r WHERE r.reversal_of_id = p.id)
              LIMIT 1) THEN
    RAISE EXCEPTION 'po_locked: payment_exists' USING ERRCODE = 'P0001';
  END IF;

  v_new_supplier := COALESCE((p_patch->>'supplier_id')::uuid, v_po.supplier_id);
  v_new_exp_date := CASE
    WHEN p_patch ? 'expected_date' AND p_patch->>'expected_date' IS NOT NULL
    THEN (p_patch->>'expected_date')::date
    ELSE v_po.expected_date
  END;
  v_new_terms    := COALESCE(NULLIF(p_patch->>'payment_terms',''), v_po.payment_terms);
  v_new_notes    := CASE
    WHEN p_patch ? 'notes' THEN p_patch->>'notes'
    ELSE v_po.notes
  END;
  v_new_discount := CASE
    WHEN p_patch ? 'discount_amount'
    THEN round(COALESCE((p_patch->>'discount_amount')::numeric, 0), 2)
    ELSE v_po.discount_amount
  END;
  v_new_fee      := CASE
    WHEN p_patch ? 'delivery_fee'
    THEN round(COALESCE((p_patch->>'delivery_fee')::numeric, 0), 2)
    ELSE v_po.delivery_fee
  END;

  IF v_new_supplier <> v_po.supplier_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM suppliers WHERE id = v_new_supplier AND is_active = TRUE AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'supplier_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF v_new_terms NOT IN ('cash','credit') THEN
    RAISE EXCEPTION 'invalid_payment_terms: %', v_new_terms USING ERRCODE = 'P0001';
  END IF;
  IF v_new_discount < 0 THEN
    RAISE EXCEPTION 'discount_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;
  IF v_new_fee < 0 THEN
    RAISE EXCEPTION 'delivery_fee_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;

  -- Taux de PPN du bon : rapport PPN / base taxable d'origine (avant patch).
  v_old_taxable := v_po.subtotal - v_po.discount_amount;
  v_vat_rate := CASE
    WHEN v_old_taxable > 0 THEN ROUND(v_po.vat_amount / v_old_taxable, 4)
    ELSE 0.11
  END;

  IF p_patch ? 'items' AND jsonb_typeof(p_patch->'items') = 'array' THEN
    IF jsonb_array_length(p_patch->'items') = 0 THEN
      RAISE EXCEPTION 'items_required' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_patch->'items') LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity   := (v_item->>'quantity')::numeric;
      v_unit       := NULLIF(v_item->>'unit', '');
      v_unit_cost  := (v_item->>'unit_cost')::numeric;
      v_factor     := COALESCE((v_item->>'unit_factor_to_base')::numeric, 1);
      v_line_disc  := round(COALESCE((v_item->>'discount_amount')::numeric, 0), 2);

      IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
      END IF;
      IF v_quantity IS NULL OR v_quantity <= 0 THEN
        RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
      END IF;
      IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
        RAISE EXCEPTION 'unit_cost_must_be_non_negative' USING ERRCODE = 'P0001';
      END IF;
      IF v_factor <= 0 THEN
        RAISE EXCEPTION 'unit_factor_must_be_positive' USING ERRCODE = 'P0001';
      END IF;

      SELECT p.unit, c.category_type
        INTO v_product_unit, v_cat_type
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE p.id = v_product_id AND p.is_active = TRUE AND p.deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'product_not_found: %', v_product_id USING ERRCODE = 'P0002';
      END IF;
      IF v_cat_type <> 'raw_material' THEN
        RAISE EXCEPTION 'product_not_raw_material: % (category_type=%)',
          v_product_id, v_cat_type USING ERRCODE = 'P0001';
      END IF;

      v_line_sub := round(v_quantity * v_unit_cost, 2);
      IF v_line_disc < 0 OR v_line_disc > v_line_sub THEN
        RAISE EXCEPTION 'line_discount_out_of_range: product=% discount=% line=%',
          v_product_id, v_line_disc, v_line_sub USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    DELETE FROM purchase_order_items WHERE po_id = p_po_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_patch->'items') LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity   := (v_item->>'quantity')::numeric;
      v_unit       := NULLIF(v_item->>'unit', '');
      v_unit_cost  := (v_item->>'unit_cost')::numeric;
      v_factor     := COALESCE((v_item->>'unit_factor_to_base')::numeric, 1);
      v_line_disc  := round(COALESCE((v_item->>'discount_amount')::numeric, 0), 2);

      SELECT unit INTO v_product_unit FROM products WHERE id = v_product_id;
      v_unit := COALESCE(v_unit, v_product_unit, 'pcs');

      INSERT INTO purchase_order_items (
        po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base,
        discount_amount, notes
      ) VALUES (
        p_po_id, v_product_id, v_quantity, v_unit, v_unit_cost, v_factor,
        v_line_disc, NULLIF(v_item->>'notes', '')
      );
    END LOOP;
  END IF;

  -- Totaux toujours recalculés depuis les lignes en base : un patch d'escompte
  -- ou de port seul doit aussi changer le total.
  SELECT COALESCE(SUM(round(quantity * unit_cost, 2) - discount_amount), 0), COUNT(*)
    INTO v_subtotal, v_item_count
    FROM purchase_order_items WHERE po_id = p_po_id;

  IF v_new_discount > v_subtotal THEN
    RAISE EXCEPTION 'discount_exceeds_subtotal: discount=% subtotal=%',
      v_new_discount, v_subtotal USING ERRCODE = 'P0001';
  END IF;

  IF (p_patch ? 'items' AND jsonb_typeof(p_patch->'items') = 'array')
     OR p_patch ? 'discount_amount' THEN
    v_vat_amount := round((v_subtotal - v_new_discount) * v_vat_rate, 2);
  ELSE
    v_vat_amount := v_po.vat_amount;
  END IF;
  v_total_amount := v_subtotal - v_new_discount + v_vat_amount + v_new_fee;

  UPDATE purchase_orders
    SET supplier_id     = v_new_supplier,
        expected_date   = v_new_exp_date,
        payment_terms   = v_new_terms,
        notes           = v_new_notes,
        subtotal        = v_subtotal,
        discount_amount = v_new_discount,
        vat_amount      = v_vat_amount,
        delivery_fee    = v_new_fee,
        total_amount    = v_total_amount,
        updated_at      = now()
    WHERE id = p_po_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile,
    'po.updated',
    'purchase_orders',
    p_po_id,
    jsonb_build_object(
      'po_number',       v_po.po_number,
      'supplier_id',     v_new_supplier,
      'payment_terms',   v_new_terms,
      'subtotal',        v_subtotal,
      'discount_amount', v_new_discount,
      'vat_amount',      v_vat_amount,
      'delivery_fee',    v_new_fee,
      'total_amount',    v_total_amount,
      'item_count',      v_item_count,
      'items_patched',   (p_patch ? 'items'),
      'rpc_version',     'v3'
    )
  );

  RETURN jsonb_build_object(
    'po_id',           p_po_id,
    'po_number',       v_po.po_number,
    'subtotal',        v_subtotal,
    'discount_amount', v_new_discount,
    'vat_amount',      v_vat_amount,
    'delivery_fee',    v_new_fee,
    'total_amount',    v_total_amount,
    'item_count',      v_item_count,
    'status',          'pending'
  );
END $function$;

DROP FUNCTION IF EXISTS public.update_purchase_order_v2(uuid, jsonb);

REVOKE ALL ON FUNCTION public.update_purchase_order_v3(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_purchase_order_v3(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_order_v3(uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. start_po_correction_v1
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_po_correction_v1(
  p_po_id           uuid,
  p_reason          text,
  p_manager_pin     text,
  p_idempotency_key uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   uuid;
  v_reason    text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_po        purchase_orders%ROWTYPE;
  v_prior     jsonb;
  v_pay_id    uuid;
  v_res       jsonb;
  v_grn_id    uuid;
  v_reversed  uuid[] := '{}';
  v_cancelled uuid[] := '{}';
  v_others    uuid[] := '{}';
  v_result    jsonb;
BEGIN
  IF p_po_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_manager_pin), '') = '' THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;
  -- Même borne que la contre-passation et l'annulation de réception, qui
  -- reçoivent ce motif.
  IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL AND is_active
   LIMIT 1;
  IF v_profile IS NULL OR NOT public.is_business_owner_v1() THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_po FROM purchase_orders
   WHERE id = p_po_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Rejeu : sous le verrou du bon, la trace d'audit de la première exécution
  -- fait foi et renvoie son résultat.
  SELECT metadata->'result' INTO v_prior FROM audit_logs
   WHERE entity_type = 'purchase_order' AND entity_id = p_po_id
     AND action = 'po.correction_started'
     AND metadata->>'idempotency_key' = p_idempotency_key::text
   LIMIT 1;
  IF v_prior IS NOT NULL THEN
    RETURN v_prior || jsonb_build_object('replayed', true);
  END IF;

  -- Un PIN faux se RETOURNE au lieu de lever : le compteur de verrouillage
  -- incrémenté par _verify_pin_with_lockout doit survivre à la réponse.
  IF p_manager_pin !~ '^\d{6}$'
     OR NOT public._verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  IF v_po.is_historical_import THEN
    RAISE EXCEPTION 'po_correction_historical_import' USING ERRCODE = 'P0003';
  END IF;
  IF v_po.status NOT IN ('pending', 'partial', 'received') THEN
    RAISE EXCEPTION 'po_correction_invalid_status: %', v_po.status USING ERRCODE = 'P0001';
  END IF;

  -- 1. Les paiements vivants, du plus ancien au plus récent. Un paiement groupé
  --    se contre-passe en entier (ADR-048) : on relit à chaque tour, une ligne
  --    du même groupe a pu tomber avec la précédente.
  LOOP
    SELECT p.id INTO v_pay_id FROM purchase_payments p
     WHERE p.purchase_order_id = p_po_id
       AND p.reversal_of_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM purchase_payments r WHERE r.reversal_of_id = p.id)
     ORDER BY p.paid_at, p.created_at, p.id
     LIMIT 1;
    EXIT WHEN v_pay_id IS NULL;

    v_res := public.reverse_po_payment_v1(
      v_pay_id, v_reason, p_manager_pin,
      md5(p_idempotency_key::text || ':pay:' || v_pay_id::text)::uuid
    );
    IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'po_correction_payment_reversal_failed: %', COALESCE(v_res->>'error', 'unknown')
        USING ERRCODE = 'P0001';
    END IF;

    SELECT v_reversed || COALESCE(array_agg((l->>'reversed_payment_id')::uuid), '{}')
      INTO v_reversed
      FROM jsonb_array_elements(v_res->'lines') l;
    SELECT v_others || COALESCE(array_agg(DISTINCT pp.purchase_order_id), '{}')
      INTO v_others
      FROM jsonb_array_elements(v_res->'lines') l
      JOIN purchase_payments pp ON pp.id = (l->>'reversed_payment_id')::uuid
     WHERE pp.purchase_order_id <> p_po_id;
    v_pay_id := NULL;
  END LOOP;

  -- 2. Les réceptions actives, de la plus récente à la plus ancienne. Après la
  --    contre-passation, le solde payé est nul : leur annulation redevient
  --    possible, et chacune contre-passe stock, coût moyen et dette.
  FOR v_grn_id IN
    SELECT g.id FROM goods_receipt_notes g
     WHERE g.po_id = p_po_id AND g.cancelled_at IS NULL
     ORDER BY g.received_date DESC, g.created_at DESC, g.id DESC
  LOOP
    PERFORM public.cancel_goods_receipt_v1(
      v_grn_id, v_reason,
      md5(p_idempotency_key::text || ':grn:' || v_grn_id::text)::uuid
    );
    v_cancelled := v_cancelled || v_grn_id;
  END LOOP;

  IF cardinality(v_reversed) = 0 AND cardinality(v_cancelled) = 0 THEN
    RAISE EXCEPTION 'po_correction_nothing_to_correct' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id;

  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_others FROM unnest(v_others) x;

  v_result := jsonb_build_object(
    'ok',                   true,
    'po_id',                p_po_id,
    'status',               v_po.status,
    'reversed_payment_ids', to_jsonb(v_reversed),
    'cancelled_grn_ids',    to_jsonb(v_cancelled),
    'other_po_ids',         to_jsonb(v_others),
    'replayed',             false
  );

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile,
    'po.correction_started',
    'purchase_order',
    p_po_id,
    jsonb_build_object(
      'po_number',            v_po.po_number,
      'reason',               v_reason,
      'reversed_payment_ids', to_jsonb(v_reversed),
      'cancelled_grn_ids',    to_jsonb(v_cancelled),
      'other_po_ids',         to_jsonb(v_others),
      'idempotency_key',      p_idempotency_key,
      'result',               v_result
    )
  );

  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.start_po_correction_v1(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_po_correction_v1(uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_po_correction_v1(uuid, text, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Champs calculés de paiement (PostgREST)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.po_paid_amount(po public.purchase_orders)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Somme simple du grand livre : une contre-passation est une ligne négative.
  SELECT COALESCE(SUM(pp.amount), 0)
    FROM purchase_payments pp
   WHERE pp.purchase_order_id = po.id
$function$;

CREATE OR REPLACE FUNCTION public.po_payment_status(po public.purchase_orders)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Miroir de `derivePaymentStatus` (back-office) : indépendant de la réception.
  SELECT CASE
    WHEN po.status = 'cancelled'      THEN 'none'
    WHEN po.is_historical_import       THEN 'imported'
    WHEN public.po_paid_amount(po) <= 0 THEN 'unpaid'
    WHEN public.po_paid_amount(po) + 0.005 >= po.total_amount THEN 'paid'
    ELSE 'partial'
  END
$function$;

REVOKE ALL ON FUNCTION public.po_paid_amount(public.purchase_orders) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.po_paid_amount(public.purchase_orders) FROM anon;
GRANT EXECUTE ON FUNCTION public.po_paid_amount(public.purchase_orders) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.po_payment_status(public.purchase_orders) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.po_payment_status(public.purchase_orders) FROM anon;
GRANT EXECUTE ON FUNCTION public.po_payment_status(public.purchase_orders) TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.start_po_correction_v1(uuid, text, text, uuid) IS
  'ADR-050 — correction guidée d''un bon reçu et/ou payé : super admin, PIN, motif ; contre-passe les paiements puis annule les réceptions, en une transaction.';
