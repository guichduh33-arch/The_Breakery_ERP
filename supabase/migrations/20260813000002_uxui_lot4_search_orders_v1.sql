-- Audit UX/UI 2026-08-13, lot 4 — recherche globale (palette Ctrl+K).
-- La palette ne cherchait que pages et actions ; les commandes n'avaient AUCUN
-- chemin de recherche serveur (get_orders_list_v3 n'a pas de filtre texte).
-- search_orders_v1 : recherche par numéro de commande (ILIKE), gate orders.read,
-- projection minimale pour une ligne de résultat de palette.
-- Patron : search_customers_v4 (gate + clamp + min 2 chars + REVOKE pair).

CREATE OR REPLACE FUNCTION public.search_orders_v1(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(
   id uuid,
   order_number text,
   status order_status,
   order_type order_type,
   total numeric,
   created_at timestamp with time zone,
   customer_name text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_term TEXT := btrim(COALESCE(p_query, ''));
  v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 20);
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'permission denied: orders.read required' USING ERRCODE = '42501';
  END IF;
  IF length(v_term) < 2 THEN RETURN; END IF;
  RETURN QUERY
    SELECT o.id, o.order_number, o.status, o.order_type, o.total, o.created_at,
           c.name AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.order_number ILIKE '%' || v_term || '%'
    ORDER BY o.created_at DESC
    LIMIT v_lim;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.search_orders_v1(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_orders_v1(TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_orders_v1(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION public.search_orders_v1(TEXT, INT) IS
  'Recherche de commandes par numéro (ILIKE, min 2 chars) pour la palette globale BO. '
  'Gate: orders.read. v1 (audit UX/UI lot 4). anon-callable: no';

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
