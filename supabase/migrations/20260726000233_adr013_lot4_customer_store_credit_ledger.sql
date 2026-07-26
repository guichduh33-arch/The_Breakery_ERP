-- ADR-013 Lot 4 (D5) — ledger d'avoirs client, append-only, sibling inversé de
-- l'AR B2B. Vérité = ledger ; customers.store_credit_balance = cache verrouillable
-- (objet de FOR UPDATE canonique + CHECK >= 0 backstop anti-double-spend, miroir
-- b2b_current_balance _130). Écritures via l'unique writer privé
-- _apply_store_credit_v1, appelé sous verrou client par des fonctions SECURITY
-- DEFINER uniquement (jamais d'INSERT direct).

-- ── 1. Table ledger ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.customer_store_credit_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  delta           numeric(14,2) NOT NULL CHECK (delta <> 0),
  balance_after   numeric(14,2) NOT NULL CHECK (balance_after >= 0),
  source          text NOT NULL CHECK (source IN ('refund','manager_grant','loyalty_conversion','expiry','spend')),
  reference_type  text,
  reference_id    uuid,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  idempotency_key uuid UNIQUE,
  -- Cohérence signe/source : les émissions créditent, spend/expiry débitent.
  CONSTRAINT scl_sign_coherent CHECK (
    (source IN ('spend','expiry') AND delta < 0) OR
    (source IN ('refund','manager_grant','loyalty_conversion') AND delta > 0)),
  -- L'expiration ne se pose que sur un crédit émis.
  CONSTRAINT scl_expiry_on_credit_only CHECK (expires_at IS NULL OR delta > 0)
);

COMMENT ON TABLE public.customer_store_credit_ledger IS
  'Ledger append-only des avoirs client (ADR-013 D5). Invariant : '
  'SUM(delta) par client = customers.store_credit_balance, et le total global = '
  'solde du compte 2220. Écritures via _apply_store_credit_v1 uniquement.';

CREATE INDEX idx_scl_customer  ON public.customer_store_credit_ledger (customer_id, created_at DESC);
CREATE INDEX idx_scl_reference ON public.customer_store_credit_ledger (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX idx_scl_expirable ON public.customer_store_credit_ledger (expires_at)
  WHERE delta > 0 AND expires_at IS NOT NULL;
-- Idempotence du job d'expiration : au plus UNE ligne expiry par crédit émis.
CREATE UNIQUE INDEX ux_scl_expiry_per_credit ON public.customer_store_credit_ledger (reference_id)
  WHERE source = 'expiry';
-- Anti-rejeu : au plus UNE ligne spend par commande.
CREATE UNIQUE INDEX ux_scl_spend_per_order ON public.customer_store_credit_ledger (reference_id)
  WHERE source = 'spend';

-- ── 2. ACL append-only (miroir b2b_payment_allocations _065) ────────────────

ALTER TABLE public.customer_store_credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scl_auth_read ON public.customer_store_credit_ledger;
CREATE POLICY scl_auth_read ON public.customer_store_credit_ledger
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.customer_store_credit_ledger FROM PUBLIC;
REVOKE ALL ON public.customer_store_credit_ledger FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.customer_store_credit_ledger FROM authenticated;
GRANT SELECT ON public.customer_store_credit_ledger TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

-- ── 3. Cache de solde sur customers ─────────────────────────────────────────

ALTER TABLE public.customers
  ADD COLUMN store_credit_balance numeric(14,2) NOT NULL DEFAULT 0
    CONSTRAINT customers_store_credit_balance_nonneg CHECK (store_credit_balance >= 0);

COMMENT ON COLUMN public.customers.store_credit_balance IS
  'Cache du solde d''avoir (ADR-013 D5). Source de vérité = '
  'customer_store_credit_ledger. Verrou canonique du gate D8 (FOR UPDATE). '
  'Jamais d''UPDATE direct hors _apply_store_credit_v1.';

-- Pattern _013 : la colonne money est interdite d'UPDATE direct.
REVOKE UPDATE (store_credit_balance) ON public.customers FROM authenticated;
REVOKE UPDATE (store_credit_balance) ON public.customers FROM anon;
REVOKE UPDATE (store_credit_balance) ON public.customers FROM PUBLIC;

-- ── 4. Writer privé unique ──────────────────────────────────────────────────

CREATE FUNCTION public._apply_store_credit_v1(
  p_customer_id     uuid,
  p_delta           numeric,
  p_source          text,
  p_reference_type  text,
  p_reference_id    uuid,
  p_expires_at      timestamptz,
  p_created_by      uuid,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS TABLE (ledger_id uuid, balance_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_balance numeric(14,2);
  v_ledger_id   uuid;
BEGIN
  -- PRÉCONDITION : l'appelant détient déjà le FOR UPDATE sur customers(p_customer_id)
  -- (lock-then-check, patron create_b2b_order_v5). Le CHECK >= 0 de la colonne est
  -- le backstop (23514) si un chemin contournait le verrou.
  UPDATE customers
     SET store_credit_balance = store_credit_balance + p_delta
   WHERE id = p_customer_id
   RETURNING store_credit_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found for store credit apply', p_customer_id
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO customer_store_credit_ledger
    (customer_id, delta, balance_after, source, reference_type, reference_id,
     expires_at, created_by, idempotency_key)
  VALUES
    (p_customer_id, p_delta, v_new_balance, p_source, p_reference_type, p_reference_id,
     p_expires_at, p_created_by, p_idempotency_key)
  RETURNING id INTO v_ledger_id;

  RETURN QUERY SELECT v_ledger_id, v_new_balance;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._apply_store_credit_v1(uuid, numeric, text, text, uuid, timestamptz, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_store_credit_v1(uuid, numeric, text, text, uuid, timestamptz, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_store_credit_v1(uuid, numeric, text, text, uuid, timestamptz, uuid, uuid) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._apply_store_credit_v1(uuid, numeric, text, text, uuid, timestamptz, uuid, uuid) IS
  'Unique point d''écriture du ledger d''avoirs + cache customers.store_credit_balance '
  '(ADR-013 D5). Appelable uniquement depuis des fonctions SECURITY DEFINER qui '
  'détiennent le FOR UPDATE sur la ligne customers.';
