-- 20260710000054_gate_customer_search_rpcs.sql
-- Session 50 / W1.4 — Gate customer search/lookup RPCs.
--
-- Bump search_customers_v2 → v3 et get_customer_v2 → v3.
-- create_customer_v2 : ne pas bumper, déjà correctement gaté (auth.uid() check) et
-- le gate POS est sur le rôle (TO authenticated), pas sur permissions métier.
--
-- Gate dual : has_permission(., 'customers.read') OR has_permission(., 'pos.sale.create')
--   - customers.read  → MANAGER/ADMIN/SUPER_ADMIN (BO accès complet)
--   - pos.sale.create → CASHIER/waiter (POS flux attach client sur vente)
-- Rationale : le CASHIER n'a pas customers.read (évite l'accès PII brut),
-- mais a pos.sale.create pour attacher un client à la commande.
--
-- Call-sites à mettre à jour (dans le même PR, séparément) :
--   apps/pos/src/features/customers/hooks/useCustomerSearch.ts     → search_customers_v3
--   apps/pos/src/features/heldOrders/hooks/useReopenHeldOrder.ts   → get_customer_v3
--   apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts  → get_customer_v3
--   apps/pos/src/pages/Pos.tsx                                     → search_customers_v3
--
-- DEV-S50-W1.4

-- ============================================================
-- Vérifier que la permission pos.sale.create existe
-- (seedée en S13 avec les permissions CASHIER de base).
-- INSERT ... ON CONFLICT DO NOTHING est idempotent.
-- ============================================================
INSERT INTO permissions (code, module, action, description)
VALUES ('pos.sale.create', 'pos', 'sale.create', 'Create and process a POS sale')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted)
VALUES
  ('CASHIER', 'pos.sale.create', true),
  ('waiter',  'pos.sale.create', true)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = true;

-- ============================================================
-- search_customers_v3
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_customers_v3(
  p_query TEXT,
  p_limit INT DEFAULT 20
) RETURNS TABLE (
  id              UUID,
  name            TEXT,
  phone           TEXT,
  email           TEXT,
  customer_type   customer_type,
  loyalty_points  INTEGER,
  lifetime_points INTEGER,
  total_spent     NUMERIC,
  total_visits    INTEGER,
  last_visit_at   TIMESTAMPTZ,
  category_id     UUID,
  category        JSONB,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_term      TEXT := btrim(COALESCE(p_query, ''));
  v_lim       INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    has_permission(v_caller_id, 'customers.read')
    OR has_permission(v_caller_id, 'pos.sale.create')
  ) THEN
    RAISE EXCEPTION 'permission denied: customers.read or pos.sale.create required'
      USING ERRCODE = '42501';
  END IF;

  IF length(v_term) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.phone, c.email, c.customer_type,
           c.loyalty_points, c.lifetime_points, c.total_spent, c.total_visits,
           c.last_visit_at, c.category_id,
           CASE WHEN cc.id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', cc.id, 'name', cc.name, 'slug', cc.slug, 'color', cc.color,
             'icon', cc.icon, 'price_modifier_type', cc.price_modifier_type,
             'discount_percentage', cc.discount_percentage,
             'loyalty_enabled', cc.loyalty_enabled,
             'points_multiplier', cc.points_multiplier,
             'is_default', cc.is_default
           ) END,
           c.created_at, c.updated_at, c.deleted_at
    FROM customers c
    LEFT JOIN customer_categories cc ON cc.id = c.category_id AND cc.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
      AND (c.name ILIKE '%' || v_term || '%' OR c.phone ILIKE '%' || v_term || '%')
    ORDER BY c.name
    LIMIT v_lim;
END;
$$;

DROP FUNCTION IF EXISTS public.search_customers_v2(TEXT, INT);

REVOKE EXECUTE ON FUNCTION public.search_customers_v3(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_customers_v3(TEXT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.search_customers_v3(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION public.search_customers_v3(TEXT, INT) IS
  'S50 W1.4 — Customer search v3 (was v2 S37). Gate dual: customers.read (BO mgmt) OR pos.sale.create (POS cashier attach). Logic identique à v2. anon-callable: no.';

-- ============================================================
-- get_customer_v3
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_customer_v3(
  p_id UUID
) RETURNS TABLE (
  id              UUID,
  name            TEXT,
  phone           TEXT,
  email           TEXT,
  customer_type   customer_type,
  loyalty_points  INTEGER,
  lifetime_points INTEGER,
  total_spent     NUMERIC,
  total_visits    INTEGER,
  last_visit_at   TIMESTAMPTZ,
  category_id     UUID,
  category        JSONB,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    has_permission(v_caller_id, 'customers.read')
    OR has_permission(v_caller_id, 'pos.sale.create')
  ) THEN
    RAISE EXCEPTION 'permission denied: customers.read or pos.sale.create required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.phone, c.email, c.customer_type,
           c.loyalty_points, c.lifetime_points, c.total_spent, c.total_visits,
           c.last_visit_at, c.category_id,
           CASE WHEN cc.id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', cc.id, 'name', cc.name, 'slug', cc.slug, 'color', cc.color,
             'icon', cc.icon, 'price_modifier_type', cc.price_modifier_type,
             'discount_percentage', cc.discount_percentage,
             'loyalty_enabled', cc.loyalty_enabled,
             'points_multiplier', cc.points_multiplier,
             'is_default', cc.is_default
           ) END,
           c.created_at, c.updated_at, c.deleted_at
    FROM customers c
    LEFT JOIN customer_categories cc ON cc.id = c.category_id AND cc.deleted_at IS NULL
    WHERE c.id = p_id AND c.deleted_at IS NULL;
END;
$$;

DROP FUNCTION IF EXISTS public.get_customer_v2(UUID);

REVOKE EXECUTE ON FUNCTION public.get_customer_v3(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_customer_v3(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_v3(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_customer_v3(UUID) IS
  'S50 W1.4 — Customer lookup v3 (was v2 S37). Gate dual: customers.read OR pos.sale.create. Used for held-order restore badge re-fetch, post-sale loyalty refresh. anon-callable: no.';

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
