-- 20260901000012_b2b_payment_allocation_invariant_types_noop.sql
--
-- Lot chore/b2b-allocation-invariant — décision Mamat du 2026-09-06.
-- Audit b2b-credit du 2026-08-31 (docs/audits/2026-08-31-audit-b2b-credit.md,
-- finding 1) : « aucun CHECK, aucun trigger, aucun test n'impose
-- Σ b2b_payment_allocations.amount_applied = b2b_payments.amount ». La migration
-- 20260901000006 (record_b2b_payment_v3, refus du reliquat) l'annonçait comme lot
-- séparé, « précédé d'une réconciliation des paiements historiques amputés ».
--
-- Réconciliation faite le 2026-09-06 sur dev, en lecture seule : 53 paiements,
-- 0 dont le montant s'écarte de la somme de ses allocations. La garde ci-dessous
-- la rejoue : la migration REFUSE de s'appliquer sur une base à réconcilier.
--
-- Pourquoi un trigger de contrainte DIFFÉRÉ et pas un CHECK ni un trigger
-- ordinaire : l'invariant traverse deux tables, et record_b2b_payment_v3 insère
-- le paiement AVANT ses allocations (ciblées puis FIFO) — entre les deux, le
-- paiement est déséquilibré par construction. Un trigger AFTER INSERT ordinaire
-- refuserait chaque paiement à l'INSERT ; DEFERRABLE INITIALLY DEFERRED tire au
-- COMMIT, quand la RPC a terminé (précédent : trg_create_je_for_refund,
-- 20260725000221, ADR-013).
--
-- Pourquoi la base et pas seulement la RPC : la RPC refuse déjà le reliquat
-- (P0011), mais RLS et REVOKE n'arrêtent pas un corps SECURITY DEFINER —
-- un futur écrivain, une annulation de paiement mal contre-passée, un DELETE
-- d'allocation depuis un helper : tout cela échoue désormais au COMMIT avec le
-- paiement et les deux montants dans le message.
--
-- Relevé exhaustif du dépôt : un seul écrivain live des deux ledgers
-- (record_b2b_payment_v3) ; aucun UPDATE ni DELETE de b2b_payment_allocations ;
-- aucune RPC d'annulation de paiement B2B ; FK ON DELETE RESTRICT des deux côtés.
-- Le seul INSERT direct de paiement orphelin (notification_triggers.test.sql)
-- ne flushe jamais ses contraintes : non affecté.
--
-- Aucun bump de RPC, aucun client touché. [types-noop] : trigger + fonction
-- RETURNS trigger, rien n'entre dans types.generated.ts.

-- ---------------------------------------------------------------------------
-- 1. Garde de réconciliation : aucun paiement déséquilibré ne doit préexister.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(p.id::text || ' amount=' || p.amount::text || ' allocated=' || s.allocated::text, ', ')
    INTO v_bad
    FROM b2b_payments p
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(a.amount_applied), 0) AS allocated
        FROM b2b_payment_allocations a WHERE a.payment_id = p.id
    ) s
   WHERE p.amount <> s.allocated;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'b2b_payment_allocation_invariant : paiements à réconcilier avant de poser la contrainte — %', v_bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Fonction de trigger : recalcule Σ allocations du paiement touché.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_b2b_payment_allocated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids        UUID[];
  v_payment_id UUID;
  v_amount     NUMERIC(14,2);
  v_allocated  NUMERIC(14,2);
BEGIN
  -- Paiements à revérifier : celui que la ligne désigne après l'opération, et,
  -- quand une allocation change de paiement, celui qu'elle vient de quitter
  -- (sinon l'ancien paiement resterait sous-alloué sans jamais être relu —
  -- review du 2026-09-06).
  IF TG_TABLE_NAME = 'b2b_payments' THEN
    v_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.payment_id];
  ELSIF TG_OP = 'UPDATE' AND OLD.payment_id IS DISTINCT FROM NEW.payment_id THEN
    v_ids := ARRAY[NEW.payment_id, OLD.payment_id];
  ELSE
    v_ids := ARRAY[NEW.payment_id];
  END IF;

  FOREACH v_payment_id IN ARRAY v_ids LOOP
    SELECT amount INTO v_amount FROM b2b_payments WHERE id = v_payment_id;
    IF NOT FOUND THEN
      -- Paiement supprimé dans la même transaction : la FK ON DELETE RESTRICT
      -- a déjà exigé la suppression de ses allocations, il n'y a plus rien à
      -- équilibrer.
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(amount_applied), 0) INTO v_allocated
      FROM b2b_payment_allocations WHERE payment_id = v_payment_id;

    IF v_allocated <> v_amount THEN
      RAISE EXCEPTION 'b2b_payment_allocation_invariant: payment % amount % allocated %',
        v_payment_id, v_amount, v_allocated
        USING ERRCODE = 'P0011',
              DETAIL  = jsonb_build_object(
                'payment_id', v_payment_id,
                'amount',     v_amount,
                'allocated',  v_allocated
              )::text;
    END IF;
  END LOOP;

  RETURN NULL;
END $function$;

-- ---------------------------------------------------------------------------
-- 3. Triggers de contrainte différés sur les deux ledgers.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_b2b_payments_allocation_invariant ON public.b2b_payments;
CREATE CONSTRAINT TRIGGER trg_b2b_payments_allocation_invariant
  AFTER INSERT OR UPDATE OF amount ON public.b2b_payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_check_b2b_payment_allocated();

DROP TRIGGER IF EXISTS trg_b2b_payment_allocations_invariant ON public.b2b_payment_allocations;
CREATE CONSTRAINT TRIGGER trg_b2b_payment_allocations_invariant
  AFTER INSERT OR UPDATE OR DELETE ON public.b2b_payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_check_b2b_payment_allocated();

-- ---------------------------------------------------------------------------
-- 4. Grants : fonction interne, fermée à tout rôle applicatif.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_check_b2b_payment_allocated() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_check_b2b_payment_allocated() FROM anon;
REVOKE ALL ON FUNCTION public.fn_check_b2b_payment_allocated() FROM authenticated;

COMMENT ON FUNCTION public.fn_check_b2b_payment_allocated() IS
  'Deferred constraint-trigger body (2026-09-06, audit lot 1 b2b-credit finding 1): enforces SUM(b2b_payment_allocations.amount_applied) = b2b_payments.amount at COMMIT for every payment touched by an INSERT/UPDATE/DELETE on either ledger. Raises P0011 b2b_payment_allocation_invariant with payment_id, amount and allocated in DETAIL. record_b2b_payment_v3 refuses an unallocatable remainder upstream; this is the DB-level belt that SECURITY DEFINER bodies cannot bypass.';

-- Défense en profondeur : anon hérite EXECUTE via PUBLIC sur toute fonction future.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
