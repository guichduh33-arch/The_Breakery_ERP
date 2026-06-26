-- 20260710000041_create_resolve_dispatch_stations_v1.sql
-- Spec B-1 Ph2 Bloc 2.2 — résolution multi-station (override produit > catégorie).
-- COALESCE(products.dispatch_stations, ARRAY[categories.dispatch_station]) filtré
-- de 'none', ORDRE D'ENTRÉE PRÉSERVÉ (WITH ORDINALITY) pour que le legacy single
-- = element[1] soit déterministe. '{}' si non routé / produit absent.
--
-- Déviation vs plan : le plan utilisait `EXCEPT SELECT 'none'` qui ne préserve
-- pas l'ordre (et déduplique) — incompatible avec « 1er élément » legacy de la
-- Task 7. Remplacé par unnest WITH ORDINALITY (ordre stable, vérifié).

CREATE OR REPLACE FUNCTION _resolve_dispatch_stations_v1(p_product_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT array_agg(u.s ORDER BY u.ord)
     FROM unnest(
       (SELECT COALESCE(p.dispatch_stations, ARRAY[c.dispatch_station])
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE p.id = p_product_id)
     ) WITH ORDINALITY AS u(s, ord)
     WHERE u.s <> 'none'),
    ARRAY[]::text[]);
$$;

-- Paire REVOKE S25 (defense-in-depth) : helper interne, non appelable hors RPC.
REVOKE EXECUTE ON FUNCTION _resolve_dispatch_stations_v1(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION _resolve_dispatch_stations_v1(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION _resolve_dispatch_stations_v1(uuid) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
