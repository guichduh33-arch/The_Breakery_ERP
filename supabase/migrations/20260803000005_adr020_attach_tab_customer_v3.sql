-- ADR-020 décision 1 (suite) — le contrôle d'encours d'une ardoise comptoir
-- évalue TOUJOURS un plafond. Jusqu'ici il ne s'appliquait que si un plafond
-- individuel était posé, et aucun ne l'était : toute ardoise était illimitée.
--
-- retail : plafond individuel, sinon business_config.retail_tab_credit_limit_default
-- b2b    : b2b_credit_limit (NULL = illimité, décision propriétaire) évalué
--          contre le solde B2B augmenté de l'encours comptoir
--
-- ⚠️ RÉCONCILIATION (2026-08-03). Comme la migration précédente, ces objets
-- existent déjà sur le projet V3 dev — appliqués le 2026-08-02 sous le nom
-- `adr019_lot1_attach_tab_customer_v3_and_grant_revoke`, jamais versionnés.
-- Le corps ci-dessous est reconstitué depuis `pg_get_functiondef`. Le DROP de
-- v2 a déjà eu lieu en base ; il est conservé ici pour qu'un rejeu depuis zéro
-- respecte le versionnage monotone (créer vN+1 et dropper vN dans la même
-- migration).

CREATE OR REPLACE FUNCTION public.attach_tab_customer_v3(p_order_id uuid, p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order          RECORD;
  v_customer       RECORD;
  v_items_total    NUMERIC(14,2);
  v_total          NUMERIC(14,2);
  v_tax_amount     NUMERIC(14,2);
  v_outstanding    NUMERIC(14,2) := 0;
  v_exceed         NUMERIC(14,2);
  v_credit_check   JSONB;
  v_limit          NUMERIC(14,2);
  v_limit_source   TEXT;
  v_b2b_balance    NUMERIC(14,2) := 0;
  v_base           NUMERIC(14,2);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_user_id, 'payments.process') THEN
    RAISE EXCEPTION 'Permission denied: payments.process' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, status, created_via, order_number INTO v_order
    FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'pending_payment' OR v_order.created_via <> 'pos' THEN
    RAISE EXCEPTION 'order_not_attachable: status=%, via=%', v_order.status, v_order.created_via
      USING ERRCODE = 'P0001';
  END IF;

  SELECT id, name, deleted_at, retail_credit_limit,
         customer_type, b2b_credit_limit, b2b_current_balance
    INTO v_customer
    FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_customer.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer_not_found_or_inactive' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(line_total), 0) INTO v_items_total
    FROM order_items WHERE order_id = p_order_id;

  SELECT s.tax_amount, s.total INTO v_tax_amount, v_total FROM _pb1_split_v1(v_items_total) s;

  SELECT COALESCE(SUM(o.total - COALESCE(op.paid, 0)), 0) INTO v_outstanding
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT SUM(op2.amount) AS paid FROM order_payments op2 WHERE op2.order_id = o.id
    ) op ON TRUE
   WHERE o.customer_id = p_customer_id
     AND o.created_via = 'pos'
     AND o.status <> 'voided'
     AND o.id <> p_order_id
     AND (o.total - COALESCE(op.paid, 0)) > 0.001;

  IF v_customer.customer_type = 'b2b' THEN
    v_limit        := v_customer.b2b_credit_limit;
    v_limit_source := 'b2b';
    v_b2b_balance  := COALESCE(v_customer.b2b_current_balance, 0);
    v_base         := v_b2b_balance + v_outstanding;
  ELSE
    IF v_customer.retail_credit_limit IS NOT NULL THEN
      v_limit        := v_customer.retail_credit_limit;
      v_limit_source := 'individual';
    ELSE
      SELECT retail_tab_credit_limit_default INTO v_limit
        FROM business_config WHERE id = 1;
      v_limit_source := 'default';
      IF v_limit IS NULL THEN
        RAISE EXCEPTION 'business_config_missing' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_base := v_outstanding;
  END IF;

  IF v_limit IS NOT NULL THEN
    v_exceed := GREATEST(0, v_base + v_total - v_limit);
    v_credit_check := jsonb_build_object(
      'allowed',             v_exceed <= 0,
      'current_outstanding', v_outstanding,
      'b2b_balance',         v_b2b_balance,
      'order_amount',        v_total,
      'credit_limit',        v_limit,
      'credit_limit_source', v_limit_source,
      'would_exceed_by',     v_exceed
    );
    IF v_exceed > 0 THEN
      RAISE EXCEPTION 'credit_limit_exceeded: %', v_credit_check::text
        USING ERRCODE = 'P0011', DETAIL = v_credit_check::text;
    END IF;
  END IF;

  UPDATE orders SET
    customer_id = p_customer_id,
    subtotal    = v_items_total,
    tax_amount  = v_tax_amount,
    total       = v_total,
    updated_at  = now()
   WHERE id = p_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.attach_tab_customer', 'orders', p_order_id,
      jsonb_build_object(
        'order_number',        v_order.order_number,
        'customer_id',         p_customer_id,
        'total',               v_total,
        'outstanding_before',  v_outstanding,
        'credit_limit',        v_limit,
        'credit_limit_source', v_limit_source
      ));

  RETURN jsonb_build_object(
    'order_id',            p_order_id,
    'customer_id',         p_customer_id,
    'customer_name',       v_customer.name,
    'total',               v_items_total,
    'outstanding_before',  v_outstanding,
    'credit_limit',        v_limit,
    'credit_limit_source', v_limit_source,
    'b2b_balance_before',  v_b2b_balance
  );
END $function$;

-- Versionnage monotone : vN+1 creee, vN droppee dans la meme migration.
DROP FUNCTION IF EXISTS public.attach_tab_customer_v2(uuid, uuid);

-- Defense-in-depth : `anon` herite EXECUTE via PUBLIC.
REVOKE ALL ON FUNCTION public.attach_tab_customer_v3(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_tab_customer_v3(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.attach_tab_customer_v3(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.attach_tab_customer_v3(uuid, uuid) IS
  'ADR-020 dec. 1 : attache un client a une commande comptoir fired. Le controle d''encours evalue TOUJOURS un plafond - retail : plafond individuel sinon business_config.retail_tab_credit_limit_default ; B2B : b2b_credit_limit (NULL = illimite) contre solde B2B + encours comptoir. Remplace attach_tab_customer_v2.';
