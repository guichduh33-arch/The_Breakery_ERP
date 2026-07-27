-- ADR-013 Lot 4 (PR UI) — search_customers v3→v4 : projection store_credit_balance.
-- Seul chemin de lecture du solde d'avoir pour un cashier (la RLS customers est
-- gatée customers.read) ; colonne ajoutée en DERNIER (additif, call-sites sûrs).
-- Corps de départ = pg_get_functiondef live de v3 (dual gate + SECURITY DEFINER inchangés).

CREATE OR REPLACE FUNCTION public.search_customers_v4(p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, name text, phone text, email text, customer_type customer_type, loyalty_points integer, lifetime_points integer, total_spent numeric, total_visits integer, last_visit_at timestamp with time zone, category_id uuid, category jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, deleted_at timestamp with time zone, store_credit_balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_term TEXT := btrim(COALESCE(p_query, ''));
  v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT (has_permission(v_caller_id, 'customers.read') OR has_permission(v_caller_id, 'pos.sale.create')) THEN
    RAISE EXCEPTION 'permission denied: customers.read or pos.sale.create required' USING ERRCODE = '42501';
  END IF;
  IF length(v_term) < 2 THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.id, c.name, c.phone, c.email, c.customer_type, c.loyalty_points, c.lifetime_points,
           c.total_spent, c.total_visits, c.last_visit_at, c.category_id,
           CASE WHEN cc.id IS NULL THEN NULL ELSE jsonb_build_object('id', cc.id, 'name', cc.name, 'slug', cc.slug,
             'color', cc.color, 'icon', cc.icon, 'price_modifier_type', cc.price_modifier_type,
             'discount_percentage', cc.discount_percentage, 'loyalty_enabled', cc.loyalty_enabled,
             'points_multiplier', cc.points_multiplier, 'is_default', cc.is_default) END,
           c.created_at, c.updated_at, c.deleted_at,
           c.store_credit_balance
    FROM customers c
    LEFT JOIN customer_categories cc ON cc.id = c.category_id AND cc.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
      AND (c.name ILIKE '%' || v_term || '%' OR c.phone ILIKE '%' || v_term || '%')
    ORDER BY c.name LIMIT v_lim;
END; $function$;

DROP FUNCTION IF EXISTS public.search_customers_v3(TEXT, INT);

REVOKE EXECUTE ON FUNCTION public.search_customers_v4(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_customers_v4(TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_customers_v4(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION public.search_customers_v4(TEXT, INT) IS
  'Recherche clients POS/BO (nom/téléphone, min 2 chars). Gate: customers.read OR pos.sale.create. '
  'v4 (ADR-013 Lot 4): + store_credit_balance en dernière colonne. anon-callable: no';

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
