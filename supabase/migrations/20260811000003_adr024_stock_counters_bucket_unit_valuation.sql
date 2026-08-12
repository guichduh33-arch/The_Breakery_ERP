-- 20260811000003_adr024_stock_counters_bucket_unit_valuation.sql
--
-- ADR-024 — la liste de stock : les compteurs quittent les lignes.
--
-- Déc. 1 : les agrégats d'une liste paginée passent dans leur propre fonction
--   de lecture (get_stock_counters), et le total quitte la table de retour des
--   lignes. Recopié sur chaque ligne, total_count cessait d'exister dès que le
--   filtre ne ramenait rien — au moment précis où le pied doit dire « 0 sur N ».
-- Déc. 2 : les compteurs appliquent la recherche et la catégorie, JAMAIS le
--   panier actif — sinon la bande ne pourrait annoncer que le panier déjà
--   sélectionné et cesserait d'être un moyen d'en changer.
-- Déc. 3 : le panier est un type énuméré, pas une chaîne réécrite des deux
--   côtés de la frontière.
-- Déc. 5 : la ligne porte son unité et sa valorisation au coût. La valorisation
--   est `current_stock × cost_price` ; l'ADR-014 a acté qu'elle diverge du solde
--   du grand livre inventaire entre deux opnames, et que c'est une règle.
--   cost_price est NOT NULL DEFAULT 0, donc un produit sans coût connu vaut 0
--   sans casser la colonne ni un éventuel total.
-- Déc. 6 : l'ordre par défaut est l'écart au seuil décroissant, puis le nom.
--
-- Les paniers se RECOUVRENT (décision du propriétaire, 2026-08-11) : un produit
-- à 0 sous un seuil de 10 compte dans `low` ET dans `zero`. `low` reste ainsi la
-- liste complète de ce qu'il faut recommander. Les compteurs ne s'additionnent
-- donc pas au total, et l'interface porte la précision en infobulle.
--
-- Un produit non suivi (track_inventory = false) n'entre dans AUCUN panier de
-- stock : son stock n'a pas de sens. La v2 ne testait pas track_inventory et
-- comptait donc des produits illimités comme « bas » — corrigé ici.
--
-- Bump monotone : DROP v2 + CREATE v3 (la table de retour change → pas de
-- CREATE OR REPLACE possible). Corps repris du live (pg_get_functiondef), pas
-- du fichier de migration d'origine.

CREATE TYPE public.stock_bucket AS ENUM ('all', 'low', 'zero', 'negative', 'untracked');

COMMENT ON TYPE public.stock_bucket IS
  'ADR-024 déc. 3. Paniers de la liste de stock BO. Recouvrants : low inclut '
  'zero et negative. untracked = track_inventory false, exclu des autres paniers.';

DROP FUNCTION IF EXISTS public.get_stock_levels_v2(uuid, text, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.get_stock_levels_v3(
  p_category_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_bucket public.stock_bucket DEFAULT 'all'::public.stock_bucket,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  product_id uuid, sku text, name text, category_id uuid, category_name text,
  current_stock numeric, min_stock_threshold numeric, track_inventory boolean,
  unit text, stock_value numeric,
  last_movement_at timestamp with time zone
)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  RETURN QUERY
  SELECT p.id, p.sku, p.name, p.category_id, c.name,
         p.current_stock, p.min_stock_threshold, p.track_inventory,
         p.unit, (p.current_stock * p.cost_price)::numeric,
         (SELECT max(sm.created_at) FROM stock_movements sm WHERE sm.product_id = p.id)
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
   WHERE p.deleted_at IS NULL
     AND (p_category_id IS NULL OR p.category_id = p_category_id)
     AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.sku ILIKE '%' || p_search || '%')
     -- COALESCE et non `CASE p_bucket` nu : un panier NULL passé explicitement
     -- rendrait NULL pour chaque ligne, donc une liste vide SANS erreur — un
     -- écran muet au lieu d'un refus. On retombe sur le défaut de la signature.
     AND CASE COALESCE(p_bucket, 'all'::public.stock_bucket)
           WHEN 'all'       THEN TRUE
           WHEN 'low'       THEN p.track_inventory AND p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold
           WHEN 'zero'      THEN p.track_inventory AND p.current_stock = 0
           WHEN 'negative'  THEN p.track_inventory AND p.current_stock < 0
           WHEN 'untracked' THEN NOT p.track_inventory
         END
   -- Déc. 6 : l'écart au seuil d'abord. Un produit hors panier « bas » (pas de
   -- seuil, non suivi, ou au-dessus) n'a pas d'écart : il tombe en fin de liste,
   -- classé alphabétiquement.
   ORDER BY CASE WHEN p.track_inventory AND p.min_stock_threshold > 0
                 THEN p.min_stock_threshold - p.current_stock
            END DESC NULLS LAST,
            p.name
   LIMIT p_limit OFFSET p_offset;
END $function$;

CREATE OR REPLACE FUNCTION public.get_stock_counters_v1(
  p_category_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text
)
RETURNS TABLE(
  total_count bigint, low_count bigint, zero_count bigint,
  negative_count bigint, untracked_count bigint
)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- Déc. 2 : mêmes règles de catalogue que get_stock_levels_v3 (produit non
  -- supprimé, catégorie, recherche), et AUCUN filtre de panier. La parité entre
  -- ces comptes et les lignes de v3 est tenue par un test (déc. 4), pas par ce
  -- commentaire : toute règle ajoutée ici doit l'être là-bas, et le test le dira.
  RETURN QUERY
  SELECT COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE p.track_inventory
                            AND p.min_stock_threshold > 0
                            AND p.current_stock < p.min_stock_threshold)::bigint,
         COUNT(*) FILTER (WHERE p.track_inventory AND p.current_stock = 0)::bigint,
         COUNT(*) FILTER (WHERE p.track_inventory AND p.current_stock < 0)::bigint,
         COUNT(*) FILTER (WHERE NOT p.track_inventory)::bigint
    FROM products p
   WHERE p.deleted_at IS NULL
     AND (p_category_id IS NULL OR p.category_id = p_category_id)
     AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.sku ILIKE '%' || p_search || '%');
END $function$;

REVOKE EXECUTE ON FUNCTION public.get_stock_levels_v3(uuid, text, public.stock_bucket, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stock_levels_v3(uuid, text, public.stock_bucket, integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_stock_levels_v3(uuid, text, public.stock_bucket, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_stock_counters_v1(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stock_counters_v1(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_stock_counters_v1(uuid, text) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_stock_levels_v3(uuid, text, public.stock_bucket, integer, integer) IS
  'ADR-024 (v2->v3). inventory.read. Lignes seules — total_count retiré, il vit '
  'dans get_stock_counters_v1. +unit +stock_value (current_stock x cost_price, '
  'ADR-014 : diverge du GL inventaire entre deux opnames). Filtre par panier '
  'stock_bucket. Tri par ecart au seuil decroissant puis nom.';

COMMENT ON FUNCTION public.get_stock_counters_v1(uuid, text) IS
  'ADR-024 dec. 1-2. inventory.read. Agregats de la liste de stock, une ligne, '
  'independants de la pagination. Applique recherche et categorie, jamais le '
  'panier actif. Paniers recouvrants : low inclut zero et negative.';
