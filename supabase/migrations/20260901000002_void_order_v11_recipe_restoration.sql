-- Bug 2026-09-01 — l'annulation d'une vente rendait le mauvais stock.
--
-- Depuis la v18 de `pay_existing_order` (PR #469, 2026-08-26) et depuis
-- `complete_order_with_payment_v27`, un produit fini NON SUIVI en stock
-- (`track_inventory = false`, `deduct_stock = true`) consomme les ingredients
-- de sa recette a la vente, et non son propre stock. Le RETOUR n'avait jamais
-- suivi : `void_order_rpc_v10` rendait le stock du produit lui-meme, sans
-- regarder `track_inventory` ni `deduct_stock`.
--
-- Deux defauts distincts, mesures sur dev le 2026-09-01 :
--   * 34 produits `track=false, deduct=true` : la vente retirait la recette,
--     le void rendait le fini — d'ou 9 produits a `current_stock` negatif ;
--   * 6 produits `track=false, deduct=false` : la vente ne retire rien, le
--     void AJOUTAIT du stock qui n'a jamais existe.
--
-- Arbitrage Mamat du 2026-09-01 : le retour est SYMETRIQUE de la vente — ce
-- qui a ete retire est remis, ni plus ni moins.
--
-- Corps construit depuis le corps LIVE de `void_order_rpc_v10`
-- (pg_get_functiondef, 2026-09-01). Changements, et rien d'autre :
--   1. la boucle des items lit `unit`, `track_inventory`, `deduct_stock` et
--      `is_display_item` depuis `products` ;
--   2. branche non-combo : vitrine ou suivi -> son propre stock (inchange) ;
--      `deduct_stock` seul -> restitution de la recette via
--      `_resolve_recipe_consumption_v1` (miroir de pay_existing_order_v18) ;
--      ni l'un ni l'autre -> aucune restitution ;
--   3. les six triplets `INSERT stock_movements` + `UPDATE products` +
--      `UPDATE display_stock` passent par `_restore_sale_stock_v1` ;
--   4. DECLARE : + v_cons RECORD ;
--   5. `rpc_version` ajoute aux audit_logs.
-- Les branches COMBO et MODIFICATEURS ne changent pas de semantique : elles
-- portent deja des `product_id` d'ingredients, resolus a la vente.

CREATE OR REPLACE FUNCTION public.void_order_rpc_v11(p_order_id uuid, p_reason text, p_authorized_by uuid, p_acting_auth_user_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID; v_profile_id UUID; v_order RECORD; v_open_session UUID; v_item RECORD;
  v_loyalty_now INTEGER; v_refund_id UUID; v_refund_number TEXT; v_seq_number INTEGER; v_pay RECORD;
  v_sc_paid DECIMAL(14,2) := 0; v_sc_months INTEGER; v_sc_expires TIMESTAMPTZ;
  v_comp JSONB; v_comp_qty NUMERIC; v_ing RECORD; v_existing RECORD;
  v_void_session UUID;
  v_cons RECORD;
BEGIN
  v_user_id := p_acting_auth_user_id;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.refund_number, r.order_id, r.total, r.tax_refunded
      INTO v_existing
      FROM refunds r
      WHERE r.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_existing.order_id,
        'order_number', (SELECT order_number FROM orders WHERE id = v_existing.order_id),
        'refund_id', v_existing.id, 'refund_number', v_existing.refund_number,
        'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded,
        'tenders', (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                      FROM refund_payments WHERE refund_id = v_existing.id),
        'idempotent_replay', true);
    END IF;
  END IF;

  IF p_authorized_by IS NULL THEN RAISE EXCEPTION 'Manager authorization required' USING ERRCODE = 'P0003'; END IF;
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.void') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.void' USING ERRCODE = 'P0003'; END IF;
  IF length(coalesce(p_reason,'')) < 3 THEN RAISE EXCEPTION 'Reason required (>= 3 chars)' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  IF v_order.status NOT IN ('paid', 'completed') THEN
    RAISE EXCEPTION 'Cannot void % order (only paid or completed orders)', v_order.status USING ERRCODE = 'check_violation'; END IF;
  SELECT id INTO v_open_session FROM pos_sessions WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NOT NULL AND v_order.session_id = v_open_session THEN
    -- Chemin v9 inchange : l'acteur a une session ouverte ET la commande lui appartient.
    v_void_session := v_open_session;
  ELSE
    -- v10 cross-shift (back-office) : gate orders.void sur le profil ACTEUR,
    -- cash refuse (P0016), rattachement a la session d'ORIGINE de la commande.
    IF NOT has_permission_for_profile(v_profile_id, 'orders.void') THEN
      RAISE EXCEPTION 'Cross-shift void permission denied: orders.void' USING ERRCODE = 'P0003';
    END IF;
    IF v_order.session_id IS NULL THEN
      RAISE EXCEPTION 'order has no session' USING ERRCODE = 'P0011';
    END IF;
    IF EXISTS (SELECT 1 FROM order_payments WHERE order_id = p_order_id AND method = 'cash') THEN
      RAISE EXCEPTION 'cash_void_requires_open_session' USING ERRCODE = 'P0016';
    END IF;
    v_void_session := v_order.session_id;
  END IF;

  IF EXISTS (SELECT 1 FROM refunds WHERE order_id = p_order_id AND is_full_void = false) THEN
    RAISE EXCEPTION 'Cannot void order %: a partial refund already exists (refund the remainder instead)', v_order.order_number
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE orders SET status='voided', voided_at=now(), voided_by=p_authorized_by, void_reason=p_reason, updated_at=now() WHERE id = p_order_id;

  FOR v_item IN SELECT oi.id, oi.product_id, oi.quantity, oi.combo_components, oi.modifier_ingredients_deducted,
                       p.product_type AS ptype, p.unit,
                       COALESCE(p.is_display_item, false) AS is_display_item,
                       COALESCE(p.track_inventory, true) AS track_inventory,
                       COALESCE(p.deduct_stock, false)   AS deduct_stock
                FROM order_items oi JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = p_order_id AND oi.is_cancelled = false LOOP
    IF v_item.ptype = 'combo' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.combo_components, '[]'::jsonb)) LOOP
        v_comp_qty := (v_comp->>'quantity')::NUMERIC * v_item.quantity;
        PERFORM _restore_sale_stock_v1(
          p_product_id           := (v_comp->>'product_id')::UUID,
          p_quantity             := v_comp_qty,
          p_reference_id         := p_order_id,
          p_created_by           := v_profile_id,
          p_reason               := 'Order voided — combo display restore',
          p_reference_type       := 'orders',
          p_display_reference_id := p_order_id
        );
      END LOOP;
    ELSE
      -- Bug 2026-09-01 : miroir de la branche de vente (pay_existing_order_v18,
      -- complete_order_with_payment_v27). Un produit suivi (ou en vitrine) rend
      -- son propre stock ; un fini non suivi avec deduct_stock rend sa recette
      -- (_resolve_recipe_consumption_v1, descente ADR-016 : stop au premier
      -- intermediaire stocke) ; sans deduct_stock, la vente n'avait rien retire,
      -- donc le retour ne rend rien.
      IF v_item.is_display_item OR v_item.track_inventory THEN
        PERFORM _restore_sale_stock_v1(
          p_product_id           := v_item.product_id,
          p_quantity             := v_item.quantity,
          p_reference_id         := p_order_id,
          p_created_by           := v_profile_id,
          p_reason               := 'Order voided — display restore',
          p_reference_type       := 'orders',
          p_unit                 := v_item.unit,
          p_display_reference_id := p_order_id
        );
      ELSIF v_item.deduct_stock THEN
        FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_item.product_id, v_item.quantity) LOOP
          PERFORM _restore_sale_stock_v1(
            p_product_id           := v_cons.product_id,
            p_quantity             := v_cons.qty_base,
            p_reference_id         := p_order_id,
            p_created_by           := v_profile_id,
            p_reason               := 'Order voided — recipe restore',
            p_reference_type       := 'orders',
            p_unit                 := v_cons.unit,
            p_display_reference_id := p_order_id
          );
        END LOOP;
      END IF;
    END IF;

    IF v_item.modifier_ingredients_deducted IS NOT NULL THEN
      FOR v_ing IN SELECT * FROM jsonb_to_recordset(v_item.modifier_ingredients_deducted)
        AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT) LOOP
        PERFORM _restore_sale_stock_v1(
          p_product_id           := v_ing.product_id,
          p_quantity             := v_ing.qty_base,
          p_reference_id         := p_order_id,
          p_created_by           := v_profile_id,
          p_reason               := 'Order voided — modifier restore: ' || v_ing.group_name || ' / ' || v_ing.option_label,
          p_reference_type       := 'orders',
          p_unit                 := COALESCE(v_ing.unit, 'pcs'),
          p_display_reference_id := p_order_id
        );
      END LOOP;
    END IF;
  END LOOP;

  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned > 0 THEN
    UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - v_order.loyalty_points_earned),
      lifetime_points = GREATEST(0, lifetime_points - v_order.loyalty_points_earned),
      total_spent = GREATEST(0, total_spent - v_order.total), updated_at = now()
    WHERE id = v_order.customer_id RETURNING loyalty_points INTO v_loyalty_now;
    INSERT INTO loyalty_transactions (customer_id, order_id, transaction_type, points, points_balance_after, description, created_by)
    VALUES (v_order.customer_id, p_order_id, 'refund', -v_order.loyalty_points_earned, v_loyalty_now, 'Reversal: void order ' || v_order.order_number, v_profile_id);
  END IF;
  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_redeemed > 0 THEN
    UPDATE customers SET loyalty_points = loyalty_points + v_order.loyalty_points_redeemed, updated_at = now()
    WHERE id = v_order.customer_id RETURNING loyalty_points INTO v_loyalty_now;
    INSERT INTO loyalty_transactions (customer_id, order_id, transaction_type, points, points_balance_after, description, created_by)
    VALUES (v_order.customer_id, p_order_id, 'refund', v_order.loyalty_points_redeemed, v_loyalty_now, 'Restored redemption: void order ' || v_order.order_number, v_profile_id);
  END IF;

  INSERT INTO refund_sequences (date, last_number) VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE SET last_number = refund_sequences.last_number + 1 RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || to_char(CURRENT_DATE, 'YYMMDD') || '-' || LPAD(v_seq_number::TEXT, 4, '0');
  BEGIN
    INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void, idempotency_key)
    VALUES (v_refund_number, p_order_id, v_void_session, v_order.total, v_order.tax_amount, p_reason, v_profile_id, p_authorized_by, true, p_idempotency_key)
    RETURNING id INTO v_refund_id;
  EXCEPTION WHEN unique_violation THEN
    -- Fix 2026-07-27 : une unique_violation n'est un replay idempotent QUE si
    -- une vraie cle correspond. Sans cle (ou cle inconnue), on RELANCE --
    -- l'ancien catch avalait la collision de refund_number au changement de
    -- jour et renvoyait une enveloppe vide (no-op silencieux).
    IF p_idempotency_key IS NULL THEN RAISE; END IF;
    SELECT r.id, r.refund_number, r.order_id, r.total, r.tax_refunded INTO v_existing
      FROM refunds r WHERE r.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NULL THEN RAISE; END IF;
    RETURN jsonb_build_object(
      'order_id', v_existing.order_id,
      'order_number', (SELECT order_number FROM orders WHERE id = v_existing.order_id),
      'refund_id', v_existing.id, 'refund_number', v_existing.refund_number,
      'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded,
      'tenders', (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                    FROM refund_payments WHERE refund_id = v_existing.id),
      'idempotent_replay', true);
  END;
  INSERT INTO refund_lines (refund_id, order_item_id, qty, amount)
  SELECT v_refund_id, id, quantity, line_total FROM order_items WHERE order_id = p_order_id AND is_cancelled = false;
  FOR v_pay IN SELECT method, amount, reference FROM order_payments WHERE order_id = p_order_id LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference) VALUES (v_refund_id, v_pay.method, v_pay.amount, v_pay.reference);
  END LOOP;
  -- ADR-013 Lot 4 : void d'une commande payee en avoir -- le JE sale_void
  -- credite 2220 (repoint _232), le ledger DOIT etre re-credite en miroir,
  -- sinon l'invariant D5 (somme des soldes = solde 2220) casse. Source 'refund'
  -- reutilisee, reference = la ligne refunds is_full_void (miroir audit D2).
  SELECT COALESCE(SUM(amount), 0) INTO v_sc_paid
    FROM order_payments WHERE order_id = p_order_id AND method = 'store_credit';
  IF v_sc_paid > 0 THEN
    IF v_order.customer_id IS NOT NULL THEN
      PERFORM 1 FROM customers WHERE id = v_order.customer_id FOR UPDATE;
      SELECT store_credit_expiry_months INTO v_sc_months FROM business_config WHERE id = 1;
      IF COALESCE(v_sc_months, 0) > 0 THEN
        v_sc_expires := now() + make_interval(months => v_sc_months);
      END IF;
      PERFORM _apply_store_credit_v1(v_order.customer_id, v_sc_paid, 'refund',
                'refunds', v_refund_id, v_sc_expires, v_profile_id, NULL);
    ELSE
      -- Impossible post-D8 (le gate exige un client au paiement) ; garde
      -- defensive : trace l'orphelin plutot que d'echouer le void.
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_profile_id, 'order.void_store_credit_orphan', 'orders', p_order_id,
              jsonb_build_object('amount', v_sc_paid, 'refund_id', v_refund_id));
    END IF;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_authorized_by, 'order.void', 'orders', p_order_id, jsonb_build_object(
    'order_number', v_order.order_number, 'total_voided', v_order.total, 'reason', p_reason,
    'authorized_by', p_authorized_by, 'acting_cashier_id', v_profile_id, 'refund_id', v_refund_id, 'refund_number', v_refund_number,
    'rpc_version', 'v11-recipe-restoration'));
  RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number, 'refund_id', v_refund_id,
    'refund_number', v_refund_number, 'total_refunded', v_order.total, 'tax_refunded', v_order.tax_amount,
    'tenders', (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount)) FROM refund_payments WHERE refund_id = v_refund_id));
END $function$;

-- Versioning monotone : la v10 tombe dans la meme migration.
DROP FUNCTION public.void_order_rpc_v10(uuid, text, uuid, uuid, uuid);

-- Grants : paire REVOKE (anon herite EXECUTE via PUBLIC) + GRANT explicite,
-- miroir EXACT des grants live de la v10 (`{postgres=X, service_role=X}`,
-- releve le 2026-09-01). PAS de grant a `authenticated` : la RPC n'est
-- joignable que par l'edge function `void-order`, qui appelle en service_role.
REVOKE ALL ON FUNCTION public.void_order_rpc_v11(uuid, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_order_rpc_v11(uuid, text, uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.void_order_rpc_v11(uuid, text, uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.void_order_rpc_v11(uuid, text, uuid, uuid, uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
