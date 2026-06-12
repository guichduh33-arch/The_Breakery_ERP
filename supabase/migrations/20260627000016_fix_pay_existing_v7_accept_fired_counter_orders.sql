-- 20260627000016_fix_pay_existing_v7_accept_fired_counter_orders.sql
-- S43 Wave F corrective (DEV-S43-F1-03) — découvert par l'E2E T3 en navigateur réel.
--
-- pay_existing_order_v7 gardait `status = 'draft'` uniquement : le flux tablette
-- passe par pickup_tablet_order qui flippe pending_payment → draft AVANT le
-- paiement. Le nouveau flux comptoir S43 (fire_counter_order_v1) crée des ordres
-- `pending_payment` payés DIRECTEMENT par v7 (pas d'étape pickup) → 23514
-- « Order is not in draft status » sur chaque checkout d'ordre fired.
--
-- Fix : payable = draft (chemin pickup inchangé — l'invariant pickup-first
-- tablette est préservé : un pending_payment created_via='tablet' reste rejeté)
-- OU (pending_payment ET created_via='pos') (ordre comptoir fired).
-- Pattern corrective S38 : pg_get_functiondef + replace, signature inchangée,
-- ACL conservées.
DO $$
DECLARE
  v_def TEXT;
  v_old TEXT := $gate$  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'Order is not in draft status (current: %)', v_order.status
      USING ERRCODE = 'check_violation';
  END IF;$gate$;
  v_new TEXT := $gate$  -- S43 (DEV-S43-F1-03) : draft = pickup tablette ; pending_payment + created_via
  -- 'pos' = ordre comptoir fired (fire_counter_order_v1), payé sans étape pickup.
  IF NOT (v_order.status = 'draft'
          OR (v_order.status = 'pending_payment' AND v_order.created_via = 'pos')) THEN
    RAISE EXCEPTION 'Order is not payable (status: %, via: %)', v_order.status, v_order.created_via
      USING ERRCODE = 'check_violation';
  END IF;$gate$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'pay_existing_order_v7' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'pay_existing_order_v7 introuvable';
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'gate draft-only introuvable dans pay_existing_order_v7 — replace abandonné';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END $$;
