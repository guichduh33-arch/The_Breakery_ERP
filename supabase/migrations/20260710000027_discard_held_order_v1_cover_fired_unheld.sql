-- 20260710000027_discard_held_order_v1_cover_fired_unheld.sql
-- BUGFIX (held-order lifecycle gap) — discard_held_order_v1 n'acceptait que les
-- commandes is_held=true. Une commande FIRED non payée (status='pending_payment',
-- created_via='pos') mais NON mise en attente (is_held=false — ex. reprise via
-- reopen_held_order_v1, ou fired puis abandonnée) n'avait AUCUN chemin de
-- suppression : le void exige 'paid', le discard exigeait is_held=true. Résultat :
-- commande coincée (cf. #0001 Egg Benedict, #0002 Banh Mi Croissant…).
--
-- On élargit la clause pour couvrir toute commande NON payée d'origine POS
-- (draft/pending_payment), qu'elle soit held ou non. Reste un DELETE (pas de JE,
-- pas de stock déduit avant paiement → rien à contre-passer), trace audit
-- préservée. Gate inchangé : orders.void (MANAGER+/ADMIN/SUPER_ADMIN). Signature
-- inchangée → useDiscardHeldOrder ne bouge pas.
CREATE OR REPLACE FUNCTION public.discard_held_order_v1(p_order_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_order_no  TEXT;
  v_was_held  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'orders.void') THEN
    RAISE EXCEPTION 'Permission denied: orders.void' USING ERRCODE = 'P0003';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_too_short' USING ERRCODE = 'P0001';
  END IF;

  -- Held draft/fired OU commande POS non payée orpheline (is_held=false).
  -- Jamais une commande payée/voided (→ void/refund), ni B2B.
  SELECT order_number, is_held INTO v_order_no, v_was_held
  FROM orders
  WHERE id = p_order_id
    AND status IN ('draft', 'pending_payment')
    AND (is_held = true OR created_via = 'pos')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'held_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'order.held_discarded', 'orders', p_order_id,
          jsonb_build_object('reason', p_reason, 'order_number', v_order_no, 'was_held', v_was_held));

  DELETE FROM orders WHERE id = p_order_id;  -- cascades order_items + held_order_idempotency_keys
END $function$;

REVOKE EXECUTE ON FUNCTION public.discard_held_order_v1(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.discard_held_order_v1(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.discard_held_order_v1(UUID, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
