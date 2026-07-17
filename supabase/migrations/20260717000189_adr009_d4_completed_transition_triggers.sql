-- 20260717000189_adr009_d4_completed_transition_triggers.sql
-- ADR-009 déc. 4 — implémentation de la transition paid → completed.
-- Événement (décision D4bis) : une commande passe `completed` quand elle est
-- PAYÉE et que tous ses items non annulés sont SERVIS (≥ 1 item non annulé).
-- Les deux ordres d'événements sont couverts :
--   - payée d'abord, service ensuite → trigger sur order_items (served/cancel) ;
--   - servie d'abord (comptoir), paiement ensuite → trigger sur orders (→ paid).
-- Pas de retour arrière automatique (recall KDS) : completed → paid re-passerait
-- dans la WHEN du trigger JE vente et créerait une double écriture ; le void
-- reste la seule sortie de completed (RPC v5, _188).
--
-- Non-feux vérifiés sur le catalogue live (2026-07-17) :
--   - trg_create_sale_journal_entry_upd : WHEN exige NEW paid ou NEW voided →
--     paid→completed ne déclenche rien (pas de double JE) ;
--   - trg_notify_order_complete_update : WHEN exige OLD ∉ (paid, completed) →
--     paid→completed ne re-notifie pas ;
--   - la cascade s'arrête : l'UPDATE posé par le helper a NEW.status=completed,
--     qui ne matche la WHEN d'aucun trigger d'écriture.
-- Cette migration arrive APRÈS l'élargissement de tous les lecteurs
-- (_184.._186), du trigger JE (_187) et de void/refund (_188) — aucune fenêtre
-- où une commande completed disparaît des rapports ou devient invoidable.

CREATE OR REPLACE FUNCTION public._try_complete_order_v1(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE orders o
     SET status = 'completed',
         updated_at = now()
   WHERE o.id = p_order_id
     AND o.status = 'paid'
     AND EXISTS (
       SELECT 1 FROM order_items oi
        WHERE oi.order_id = o.id AND oi.is_cancelled = false
     )
     AND NOT EXISTS (
       SELECT 1 FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.is_cancelled = false
          AND oi.kitchen_status IS DISTINCT FROM 'served'
     );
END $function$;

REVOKE EXECUTE ON FUNCTION public._try_complete_order_v1(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._try_complete_order_v1(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._try_complete_order_v1(uuid) FROM authenticated;

COMMENT ON FUNCTION public._try_complete_order_v1(uuid) IS
  'Évaluateur ADR-009 déc. 4 : passe une commande paid → completed si ≥ 1 item non annulé et aucun item non annulé non servi. No-op sinon. Appelé par triggers uniquement.';

-- Chemin 1 : la commande est déjà payée, le dernier item passe served (ou le
-- dernier item non servi est annulé).
CREATE OR REPLACE FUNCTION public._trg_try_complete_on_item_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._try_complete_order_v1(NEW.order_id);
  RETURN NULL;
END $function$;

REVOKE EXECUTE ON FUNCTION public._trg_try_complete_on_item_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._trg_try_complete_on_item_change() FROM anon;
REVOKE EXECUTE ON FUNCTION public._trg_try_complete_on_item_change() FROM authenticated;

DROP TRIGGER IF EXISTS trg_order_items_try_complete ON public.order_items;
CREATE TRIGGER trg_order_items_try_complete
AFTER UPDATE OF kitchen_status, is_cancelled ON public.order_items
FOR EACH ROW
WHEN (NEW.kitchen_status = 'served' OR NEW.is_cancelled)
EXECUTE FUNCTION public._trg_try_complete_on_item_change();

-- Chemin 2 : tous les items étaient déjà servis (flux comptoir), la commande
-- passe paid au moment du paiement.
CREATE OR REPLACE FUNCTION public._trg_try_complete_on_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._try_complete_order_v1(NEW.id);
  RETURN NULL;
END $function$;

REVOKE EXECUTE ON FUNCTION public._trg_try_complete_on_paid() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._trg_try_complete_on_paid() FROM anon;
REVOKE EXECUTE ON FUNCTION public._trg_try_complete_on_paid() FROM authenticated;

DROP TRIGGER IF EXISTS trg_orders_try_complete_on_paid ON public.orders;
CREATE TRIGGER trg_orders_try_complete_on_paid
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (NEW.status = 'paid'::order_status AND OLD.status IS DISTINCT FROM 'paid'::order_status)
EXECUTE FUNCTION public._trg_try_complete_on_paid();

COMMENT ON TRIGGER trg_order_items_try_complete ON public.order_items IS
  'ADR-009 déc. 4 — tente paid→completed quand un item passe served ou est annulé.';
COMMENT ON TRIGGER trg_orders_try_complete_on_paid ON public.orders IS
  'ADR-009 déc. 4 — tente paid→completed au passage paid (flux comptoir : items déjà servis avant paiement).';
