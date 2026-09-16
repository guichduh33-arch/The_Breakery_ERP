-- 20260908000009_get_pos_b2b_debts_v4_permission_gate.sql
-- Audit b2b-credit 2026-08-31, finding n°2 (P1) — `get_pos_b2b_debts_v3` était la SEULE
-- lecture B2B sans gate de permission : `auth.uid() IS NOT NULL` suffisait. SECURITY DEFINER
-- + GRANT authenticated + `p_customer_id = NULL` ⇒ tout compte connecté, quel que soit son
-- rôle, obtenait le carnet de créances complet (nom, téléphone, plafond, solde, factures).
--
-- Arbitrage Mamat (2026-09-08) : l'écran Debts du POS reste ouvert au caissier. On ne gate
-- donc PAS sur `b2b.read` (réservée SUPER_ADMIN/ADMIN/MANAGER) mais sur une permission POS
-- dédiée `b2b.debts.view`, accordée aussi à CASHIER et waiter. Le périmètre de données
-- ne change pas : l'écran liste tous les débiteurs, c'est sa fonction.

-- 1. La permission dédiée -----------------------------------------------------------------
INSERT INTO permissions (code, module, action, description) VALUES
  ('b2b.debts.view', 'b2b', 'debts_view',
   'View the outstanding customer debts panel (POS Debts screen, read-only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted, granted_at) VALUES
  ('SUPER_ADMIN', 'b2b.debts.view', true, now()),
  ('ADMIN',       'b2b.debts.view', true, now()),
  ('MANAGER',     'b2b.debts.view', true, now()),
  ('CASHIER',     'b2b.debts.view', true, now()),
  ('waiter',      'b2b.debts.view', true, now())
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- 2. La RPC gardée ------------------------------------------------------------------------
-- Corps repris de `pg_get_functiondef('get_pos_b2b_debts_v3')` live au 2026-09-08 ; seule la
-- gate change. `has_permission` attend un `auth.uid()`, JAMAIS un `user_profiles.id`.
CREATE OR REPLACE FUNCTION public.get_pos_b2b_debts_v4(
  p_customer_id uuid DEFAULT NULL,
  p_lookback_days int DEFAULT 180
)
RETURNS TABLE(
  order_id uuid, order_number text, order_type text, total numeric, paid numeric,
  outstanding numeric, created_at timestamptz, customer_id uuid, customer_name text,
  customer_phone text, b2b_credit_limit numeric, b2b_current_balance numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_lookback int := LEAST(GREATEST(COALESCE(p_lookback_days,180),1),730);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='P0001'; END IF;
  IF NOT public.has_permission(auth.uid(), 'b2b.debts.view') THEN
    RAISE EXCEPTION 'permission_denied: b2b.debts.view' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
    SELECT o.id, o.order_number, o.order_type::text, o.total::numeric,
           CASE WHEN o.order_type = 'b2b'
                THEN COALESCE(alloc.paid, 0)
                ELSE COALESCE(op.paid, 0) END::numeric AS paid,
           (o.total - CASE WHEN o.order_type='b2b' THEN COALESCE(alloc.paid,0) ELSE COALESCE(op.paid,0) END)::numeric AS outstanding,
           o.created_at, c.id, c.name, c.phone,
           COALESCE(c.b2b_credit_limit,0)::numeric, COALESCE(c.b2b_current_balance,0)::numeric
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN LATERAL (SELECT SUM(op2.amount) AS paid FROM order_payments op2 WHERE op2.order_id=o.id) op ON TRUE
    LEFT JOIN LATERAL (SELECT SUM(a.amount_applied) AS paid FROM b2b_payment_allocations a WHERE a.invoice_id=o.id) alloc ON TRUE
    WHERE o.customer_id IS NOT NULL
      AND o.status <> 'voided'
      AND o.created_at >= now() - make_interval(days => v_lookback)
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (o.total - CASE WHEN o.order_type='b2b' THEN COALESCE(alloc.paid,0) ELSE COALESCE(op.paid,0) END) > 0.001
    ORDER BY o.created_at ASC;
END $$;

-- 3. Paire REVOKE canonique sur la NOUVELLE signature --------------------------------------
REVOKE ALL ON FUNCTION public.get_pos_b2b_debts_v4(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pos_b2b_debts_v4(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pos_b2b_debts_v4(uuid, int) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_pos_b2b_debts_v4(uuid, int) IS
  'POS outstanding-debts (B2B paid derived from b2b_payment_allocations, retail ardoise from '
  'order_payments). Gardée par `b2b.debts.view` — audit b2b-credit finding n°2. Ne pas '
  're-grant sans gate : SECURITY DEFINER + p_customer_id NULL rend TOUT le carnet de créances '
  '(nom, téléphone, plafond, solde).';

-- 4. DROP de l'ancienne dans la MÊME migration (RPC versioning monotone) -------------------
DROP FUNCTION IF EXISTS public.get_pos_b2b_debts_v3(uuid, int);
