-- 20260908000010_cancel_b2b_order_v2_display_stock.sql
-- Audit b2b-credit 2026-08-31, findings n°3 (P1) et n°11 (P2, même cause racine).
--
-- Le défaut : `cancel_b2b_order_v1` RECOPIAIT la logique de mouvement de stock au lieu
-- d'appeler un helper. La création passe par `_record_sale_stock_v1`, qui pour un
-- `is_display_item` décrémente `products.current_stock` ET `display_stock.quantity`, et
-- écrit une ligne `display_movements`. L'annulation ne rendait que `products.current_stock` :
-- le stock vitrine partait définitivement et `display_movements` perdait une entrée.
-- Asymétrie exacte entre la porte d'entrée et la porte de sortie — produite par la recopie,
-- puisque le helper a évolué (vitrine) et la copie non.
--
-- Le correctif n'invente rien : `_restore_sale_stock_v1` existe déjà (chantier void/refund
-- rend la recette, 2026-09-01) et est le miroir exact de `_record_sale_stock_v1`. La v2 se
-- contente de l'appeler, en miroir des DEUX branches de `create_b2b_order_v6`
-- (`track_inventory` direct, sinon `deduct_stock` via `_resolve_recipe_consumption_v1`).
--
-- Corps repris de `pg_get_functiondef('cancel_b2b_order_v1')` live au 2026-09-08 ; seule la
-- boucle de stock change (plus `rpc_version` dans l'audit).
--
-- Note d'application : appliquée sur dev en DEUX appels MCP le 2026-09-08. Le premier avait
-- transcrit les tirets cadratins des libellés d'écriture comptable en tirets ASCII ; le
-- second (`CREATE OR REPLACE` seul, signature inchangée) a restitué le libellé exact de la
-- v1. Ce fichier est l'artefact de référence et correspond au corps live vérifié après coup.

CREATE OR REPLACE FUNCTION public.cancel_b2b_order_v2(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid            uuid := auth.uid();
  v_profile_id     uuid;
  v_order          record;
  v_balance_before numeric(14,2);
  v_balance_after  numeric(14,2);
  v_je_id          uuid;
  v_entry_no       text;
  v_ar_id          uuid;
  v_revenue_id     uuid;
  v_now            timestamptz := now();
  v_existing       jsonb;
  v_line           record;
  v_cons           record;
  v_track          boolean;
  v_deduct         boolean;
  v_unit           text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id=v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT has_permission(v_uid, 'b2b.order.cancel') THEN
    RAISE EXCEPTION 'permission_denied: b2b.order.cancel' USING ERRCODE='P0003';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT metadata INTO v_existing FROM audit_logs
     WHERE action='b2b.order.cancelled' AND metadata->>'idempotency_key'=p_idempotency_key::text LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', (v_existing->>'order_id')::uuid,
        'order_number', v_existing->>'order_number',
        'reversed_je_id', NULLIF(v_existing->>'reversed_je_id','')::uuid,
        'balance_after', (v_existing->>'balance_after')::numeric,
        'idempotent_replay', TRUE);
    END IF;
  END IF;

  SELECT id, order_number, customer_id, total, status, order_type
    INTO v_order FROM orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='P0002'; END IF;
  IF v_order.order_type <> 'b2b' THEN RAISE EXCEPTION 'not_a_b2b_order' USING ERRCODE='P0001'; END IF;
  IF v_order.status <> 'b2b_pending' THEN
    RAISE EXCEPTION 'order_not_cancellable (status: %)', v_order.status USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM b2b_payment_allocations WHERE invoice_id = p_order_id) THEN
    RAISE EXCEPTION 'order_has_payments' USING ERRCODE='P0011';
  END IF;

  -- Restitution du stock — MIROIR de create_b2b_order (`_record_sale_stock_v1`), via le
  -- helper de restitution partagé. Ne PAS recopier la logique ici : c'est cette recopie qui
  -- a fait diverger la vitrine (finding n°3).
  FOR v_line IN SELECT oi.product_id, oi.quantity FROM order_items oi WHERE oi.order_id = p_order_id LOOP
    SELECT track_inventory, deduct_stock, unit INTO v_track, v_deduct, v_unit
      FROM products WHERE id=v_line.product_id;
    IF v_track THEN
      PERFORM _restore_sale_stock_v1(
        p_product_id   := v_line.product_id,
        p_quantity     := v_line.quantity,
        p_reference_id := p_order_id,
        p_created_by   := v_profile_id,
        p_reason       := 'B2B order cancel',
        p_unit         := v_unit
      );
    ELSIF v_deduct THEN
      FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_line.product_id, v_line.quantity) LOOP
        PERFORM _restore_sale_stock_v1(
          p_product_id   := v_cons.product_id,
          p_quantity     := v_cons.qty_base,
          p_reference_id := p_order_id,
          p_created_by   := v_profile_id,
          p_reason       := 'B2B order cancel — recipe restore',
          p_unit         := v_cons.unit
        );
      END LOOP;
    END IF;
  END LOOP;

  v_ar_id      := resolve_mapping_account('B2B_AR');
  v_revenue_id := resolve_mapping_account('SALE_B2B_REVENUE');
  PERFORM check_fiscal_period_open(v_now::date);
  v_entry_no   := next_journal_entry_number(v_now::date);
  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by)
    VALUES (v_entry_no, v_now::date, 'B2B order cancel '||v_order.order_number||' — '||left(p_reason,120),
            'b2b_order_cancel', p_order_id, 'posted', v_order.total, v_order.total, v_profile_id)
    RETURNING id INTO v_je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_revenue_id, v_order.total, 0, 'Reverse B2B revenue — '||v_order.order_number),
    (v_je_id, v_ar_id,      0, v_order.total, 'Reverse B2B AR — '||v_order.order_number);

  SELECT b2b_current_balance INTO v_balance_before FROM customers WHERE id=v_order.customer_id FOR UPDATE;
  v_balance_before := COALESCE(v_balance_before,0);
  v_balance_after  := v_balance_before - v_order.total;
  IF v_balance_after < 0 THEN
    RAISE EXCEPTION 'balance_underflow_on_cancel (before: %, total: %)', v_balance_before, v_order.total USING ERRCODE='P0011';
  END IF;
  UPDATE customers SET b2b_current_balance=v_balance_after, updated_at=now() WHERE id=v_order.customer_id;

  UPDATE orders SET status='voided', voided_at=v_now, voided_by=v_profile_id,
                    void_reason=p_reason, updated_at=now()
   WHERE id=p_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'b2b.order.cancelled', 'orders', p_order_id, jsonb_build_object(
    'order_id', p_order_id, 'order_number', v_order.order_number, 'customer_id', v_order.customer_id,
    'total', v_order.total, 'reason', p_reason, 'reversed_je_id', v_je_id,
    'balance_before', v_balance_before, 'balance_after', v_balance_after,
    'idempotency_key', p_idempotency_key, 'rpc_version', 'v2'));

  RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number,
    'reversed_je_id', v_je_id, 'balance_after', v_balance_after, 'idempotent_replay', FALSE);
END $$;

-- Paire REVOKE canonique sur la NOUVELLE signature
REVOKE ALL ON FUNCTION public.cancel_b2b_order_v2(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_b2b_order_v2(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_b2b_order_v2(uuid, text, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.cancel_b2b_order_v2(uuid, text, uuid) IS
  'Annule une facture B2B non réglée : restitution stock via le helper partagé '
  '_restore_sale_stock (vitrine incluse), JE inverse, solde AR décrémenté, statut voided. '
  'Ne jamais recopier la logique de stock ici — la recopie de la v1 avait fait perdre le '
  'stock vitrine (audit b2b-credit findings 3 et 11).';

DROP FUNCTION IF EXISTS public.cancel_b2b_order_v1(uuid, text, uuid);
