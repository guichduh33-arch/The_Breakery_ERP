-- 20260710000112_retail_tab_credit_gate.sql
-- S62 — Plafond de crédit ardoise retail serveur (décision propriétaire D4, 2026-07-06).
-- Une ardoise retail = commande comptoir fired ('pending_payment', created_via='pos'),
-- créée anonyme (customer_id NULL, total=0) par fire_counter_order_v1/v4. On attache un
-- client via attach_tab_customer_v1, qui pose le total provisoire de la commande ET gate
-- l'encours contre customers.retail_credit_limit — pattern B2B S52 (validate_b2b_credit_limit_v1),
-- mais SANS colonne solde dédiée : l'encours retail est recalculé live (décision scouting S62 —
-- pas de nouveau ledger, la source de vérité reste orders/order_payments comme
-- get_pos_b2b_debts_v3 le fait déjà pour l'ardoise non-b2b).
-- Money-path (complete_order_with_payment_v17 / pay_existing_order_v11 / fire_counter_order_v4)
-- INCHANGÉE : pay_existing_order_v11 recalcule le total réel (avec remises/promos/taxe) au
-- paiement — le total posé ici n'est qu'un affichage provisoire pour la liste des ardoises.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS retail_credit_limit NUMERIC(14,2)
  CHECK (retail_credit_limit IS NULL OR retail_credit_limit >= 0);

COMMENT ON COLUMN public.customers.retail_credit_limit IS
  'Plafond ardoise comptoir (IDR). NULL = illimité. Gate: attach_tab_customer_v1 (S62).';

CREATE OR REPLACE FUNCTION public.attach_tab_customer_v1(
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
  v_tax_rate       NUMERIC(5,4);
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

    v_exceed := GREATEST(0, v_outstanding + v_items_total - v_customer.retail_credit_limit);
    v_credit_check := jsonb_build_object(
      'allowed',             v_exceed <= 0,
      'current_outstanding', v_outstanding,
      'order_amount',        v_items_total,
      'credit_limit',        v_customer.retail_credit_limit,
      'would_exceed_by',     v_exceed
    );
    IF v_exceed > 0 THEN
      RAISE EXCEPTION 'credit_limit_exceeded: %', v_credit_check::text
        USING ERRCODE = 'P0011', DETAIL = v_credit_check::text;
    END IF;
  END IF;

  -- Lecture business_config — MIRROIR verbatim (id = 1) de pay_existing_order_v11.
  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;
  -- Sémantique du SET — MIRROIR exact de v11 : subtotal = somme TTC des lignes (la taxe
  -- est EXTRAITE, pas ajoutée), total = subtotal (pas de remise/promo à l'attache).
  v_tax_amount := round_idr(v_items_total * v_tax_rate / (1 + v_tax_rate));

  UPDATE orders SET
    customer_id = p_customer_id,
    subtotal    = v_items_total,
    tax_amount  = v_tax_amount,
    total       = v_items_total,
    updated_at  = now()
   WHERE id = p_order_id;  -- provisoire : pay_existing_order_v11 recalcule le vrai total au paiement.

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.attach_tab_customer', 'orders', p_order_id,
      jsonb_build_object(
        'order_number',      v_order.order_number,
        'customer_id',       p_customer_id,
        'total',             v_items_total,
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

REVOKE ALL ON FUNCTION public.attach_tab_customer_v1(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_tab_customer_v1(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.attach_tab_customer_v1(UUID, UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.attach_tab_customer_v1(UUID, UUID) IS
  'S62: attache un client à une commande comptoir pending_payment (ardoise nommée) sous plafond '
  'retail_credit_limit. Gate payments.process. Errors: P0002 order_not_found/'
  'customer_not_found_or_inactive, P0001 order_not_attachable, P0011 credit_limit_exceeded '
  '(DETAIL=payload JSONB). Idempotent en ré-écriture (pas de clé dédiée : re-attacher le même '
  'client re-passe le gate et repose les mêmes valeurs, aucune écriture cumulative). Appelé en '
  'RPC direct par le POS.';
