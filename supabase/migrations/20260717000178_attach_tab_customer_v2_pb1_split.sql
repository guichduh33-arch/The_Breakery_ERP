-- 20260717000178_attach_tab_customer_v2_pb1_split.sql
-- Lot 6a (8/8, dernier bump) — attach_tab_customer_v1 -> _v2 : formule PB1 ->
-- _pb1_split_v1.
--
-- A COMPORTEMENT CONSTANT en mode inclusive (v_total == v_items_total partout).
--
-- Deux choix de substitution, memes raisons que refund _177 :
--   * le split remonte AVANT le gate de credit : l'encours somme des
--     orders.total (TTC), le montant de l'ardoise doit compter en TTC aussi ;
--   * orders.total et le payload d'audit portent v_total (TTC en exclusive),
--     subtotal reste v_items_total (la base) — provisoire dans les deux cas :
--     pay_existing_order_v12 recalcule le vrai total au paiement.
--
-- Provenance : corps de _112 PROUVE equivalent au live avant reprise
-- (2026-07-17 : 90 lignes de code des deux cotes, md5 normalise identique
-- 5378852d0a03d29180d9cbb324b1ebde). Substitutions scriptees (7).
--
-- Grants v1 releves live : anon=false, authenticated=TRUE, service_role=true.
-- Le POS appelle EN DIRECT (useAttachTabCustomer.ts, JWT utilisateur) : sans le
-- GRANT authenticated, l'attache d'une ardoise nommee casse en permission denied.

CREATE OR REPLACE FUNCTION public.attach_tab_customer_v2(
  p_order_id UUID,
  p_customer_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  -- Résolution d'acteur + gate permission — MIRROIR verbatim de pay_existing_order_v11
  -- (le caissier qui encaisse est le même profil qui décide de mettre sur ardoise).
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

  -- Lock la commande d'abord (anti-TOCTOU S52) : une ardoise est TOUJOURS une commande
  -- comptoir fired non payée — les drafts restent dans le panier, jamais attachables ici.
  SELECT id, status, created_via, order_number INTO v_order
    FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'pending_payment' OR v_order.created_via <> 'pos' THEN
    RAISE EXCEPTION 'order_not_attachable: status=%, via=%', v_order.status, v_order.created_via
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock le client ensuite (anti-TOCTOU S52) : re-check contre la ligne lockée.
  -- customers n'a pas de colonne is_active (vérifié live) — l'état "actif" est deleted_at
  -- IS NULL (soft-delete, pattern RLS auth_read de customers).
  SELECT id, name, deleted_at, retail_credit_limit INTO v_customer
    FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_customer.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer_not_found_or_inactive' USING ERRCODE = 'P0002';
  END IF;

  -- Total provisoire = MIRROIR exact de l'expression v_items_total du corps live de
  -- pay_existing_order_v11 (pas de filtre is_cancelled — line_total des items annulés vaut 0).
  SELECT COALESCE(SUM(line_total), 0) INTO v_items_total
    FROM order_items WHERE order_id = p_order_id;

  -- Lot 6a : le mode taxe vit UNIQUEMENT dans _pb1_split_v1 (migration _171).
  -- Le split est fait ICI, AVANT le gate de credit : l'encours (v_outstanding)
  -- somme des orders.total (TTC) — le montant de CETTE ardoise doit etre compte
  -- en TTC lui aussi (v_total), sinon en mode exclusive le gate sous-compterait
  -- de la taxe. En mode inclusive, v_total == v_items_total : rien ne change.
  SELECT s.tax_amount, s.total
    INTO v_tax_amount, v_total
    FROM _pb1_split_v1(v_items_total) s;

  IF v_customer.retail_credit_limit IS NOT NULL THEN
    -- Encours ardoise live = MIRROIR de l'expression outstanding de get_pos_b2b_debts_v3,
    -- restreint aux commandes comptoir (created_via='pos') de CE client — le crédit B2B a
    -- son propre plafond/ledger (b2b_credit_limit / b2b_current_balance), non touché ici.
    -- Décision contrôleur : pas de lookback 180j (celui de la vue d'affichage) — un plafond
    -- de crédit ne doit pas oublier les vieilles dettes. AND o.id <> p_order_id exclut la
    -- commande en cours d'attache elle-même : sur un re-attach idempotent (même client déjà
    -- posé au premier appel), sans cette exclusion son propre outstanding se cumulerait avec
    -- v_items_total et doublerait le montant compté contre le plafond.
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

    v_exceed := GREATEST(0, v_outstanding + v_total - v_customer.retail_credit_limit);
    v_credit_check := jsonb_build_object(
      'allowed',             v_exceed <= 0,
      'current_outstanding', v_outstanding,
      'order_amount',        v_total,
      'credit_limit',        v_customer.retail_credit_limit,
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
   WHERE id = p_order_id;  -- provisoire : pay_existing_order_v11 recalcule le vrai total au paiement.

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.attach_tab_customer', 'orders', p_order_id,
      jsonb_build_object(
        'order_number',      v_order.order_number,
        'customer_id',       p_customer_id,
        'total',             v_total,
        'outstanding_before', v_outstanding
      ));

  RETURN jsonb_build_object(
    'order_id',           p_order_id,
    'customer_id',        p_customer_id,
    'customer_name',      v_customer.name,
    'total',              v_items_total,
    'outstanding_before', v_outstanding,
    'credit_limit',       v_customer.retail_credit_limit
  );
END $$;

DROP FUNCTION IF EXISTS public.attach_tab_customer_v1(uuid, uuid);

REVOKE EXECUTE ON FUNCTION public.attach_tab_customer_v2(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.attach_tab_customer_v2(uuid, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Appel POS direct (JWT utilisateur) — grant vital, cf. header.
GRANT EXECUTE ON FUNCTION public.attach_tab_customer_v2(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_tab_customer_v2(uuid, uuid) TO service_role;
