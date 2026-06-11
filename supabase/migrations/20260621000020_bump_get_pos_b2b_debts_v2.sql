-- 20260621000020_bump_get_pos_b2b_debts_v2.sql
-- Session 37 / Wave C / Task C5 (DB-06) — bump get_pos_b2b_debts_v1 → v2.
--
-- La v1 (PR #53 _042, jamais câblée — dead code) avait été conçue sur une
-- prémisse fausse : "the panel never displayed them [credit fields]". En réalité
-- CustomerDebtsPanel.tsx affiche bien credit_limit/credit_used (barre de
-- progression crédit), et useOutstandingDebts couvre TOUS les types d'ordres
-- impayés (ardoise retail pending_payment incluse), pas seulement order_type='b2b',
-- avec une fenêtre de lookback (180 j côté client).
-- v2 matche la sémantique réelle du panel pour un câblage sans régression :
--   - tout ordre non-voided avec customer attaché, créé dans p_lookback_days ;
--   - dû = total − Σ payments > 0 (calculé server-side) ;
--   - expose b2b_credit_limit / b2b_current_balance (le panel les affiche déjà
--     aujourd'hui à tout rôle authenticated via l'embed PostgREST ; pas une PII —
--     le gate _018 vise phones/emails/birth_dates, le nom/téléphone restent
--     nécessaires au panel ardoise).
-- L'agrégation par client reste côté client (inchangée).
-- Versioning monotone : DROP v1 dans la même migration.

DROP FUNCTION IF EXISTS public.get_pos_b2b_debts_v1(UUID);

CREATE OR REPLACE FUNCTION public.get_pos_b2b_debts_v2(
  p_customer_id   UUID DEFAULT NULL,
  p_lookback_days INT  DEFAULT 180
) RETURNS TABLE (
  order_id            UUID,
  order_number        TEXT,
  order_type          TEXT,
  total               NUMERIC,
  paid                NUMERIC,
  outstanding         NUMERIC,
  created_at          TIMESTAMPTZ,
  customer_id         UUID,
  customer_name       TEXT,
  customer_phone      TEXT,
  b2b_credit_limit    NUMERIC,
  b2b_current_balance NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lookback INT := LEAST(GREATEST(coalesce(p_lookback_days, 180), 1), 730);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT o.id, o.order_number, o.order_type::text,
           o.total::numeric,
           COALESCE(p.paid, 0)::numeric,
           (o.total - COALESCE(p.paid, 0))::numeric,
           o.created_at,
           c.id, c.name, c.phone,
           COALESCE(c.b2b_credit_limit, 0)::numeric,
           COALESCE(c.b2b_current_balance, 0)::numeric
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN LATERAL (
      SELECT SUM(op.amount) AS paid FROM order_payments op WHERE op.order_id = o.id
    ) p ON TRUE
    WHERE o.customer_id IS NOT NULL
      AND o.status <> 'voided'
      AND o.created_at >= now() - make_interval(days => v_lookback)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (o.total - COALESCE(p.paid, 0)) > 0.001
    ORDER BY o.created_at ASC;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_pos_b2b_debts_v2(UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pos_b2b_debts_v2(UUID, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_pos_b2b_debts_v2(UUID, INT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_pos_b2b_debts_v2 IS
  'S37 C5 (DB-06): POS outstanding-debts panel v2 — real panel semantics (all order types, lookback window, due > 0 server-side, credit fields the panel already displays). Definer so it survives the customers.read gate.';
