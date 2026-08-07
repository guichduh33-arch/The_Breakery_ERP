-- 20260805000001_align_movement_aggregates_cost_source.sql
--
-- Ecran /backoffice/inventory/movements : le tableau et la tuile KPI valorisaient
-- un meme mouvement differemment.
--
--   tableau  get_stock_movement_ledger_v1 : COALESCE(p.cost_price, 0)
--            -> cout COURANT du produit
--   tuile    get_movement_aggregates_v1   : COALESCE(sm.unit_cost, p.cost_price)
--            -> cout STOCKE du mouvement
--
-- Consequence mesuree le 2026-08-05 : une unique ligne production_in du
-- 2026-07-13 porte un unit_cost x1000 (6 161 868,71 au lieu de 6 161,68).
-- Invisible dans le tableau, elle pesait 616 186 871 IDR dans la tuile, soit
-- 47 % du total affiche sur l'ensemble du rapport. 1 mouvement sur 765.
--
-- Le ledger etant append-only, la ligne fautive ne peut pas etre corrigee :
-- on aligne donc l'agregat sur la semantique du tableau (cout courant du
-- produit), qui est immunisee contre une valeur historique aberrante.
--
-- v1 n'est PAS SECURITY DEFINER (gate has_permission + RLS) : v2 non plus.
-- Grants d'origine releves : postgres, authenticated, service_role.

CREATE OR REPLACE FUNCTION public.get_movement_aggregates_v2(
  p_section_id UUID        DEFAULT NULL,
  p_product_id UUID        DEFAULT NULL,
  p_date_start TIMESTAMPTZ DEFAULT NULL,
  p_date_end   TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::JSONB) INTO v_result
  FROM (
    SELECT
      sm.movement_type::TEXT AS movement_type,
      COUNT(*)::BIGINT       AS count,
      SUM(ABS(sm.quantity))  AS qty_total,
      -- Aligne sur get_stock_movement_ledger_v1 : cout courant du produit.
      -- On ne lit PLUS sm.unit_cost : une valeur historique aberrante ne doit
      -- pas pouvoir dominer un total de rapport.
      SUM(ABS(sm.quantity) * COALESCE(p.cost_price, 0)) AS value_total
    FROM stock_movements sm
    LEFT JOIN products p ON p.id = sm.product_id
    WHERE (p_section_id IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
      AND (p_product_id IS NULL OR sm.product_id = p_product_id)
      AND (p_date_start IS NULL OR sm.created_at >= p_date_start)
      AND (p_date_end   IS NULL OR sm.created_at <= p_date_end)
    GROUP BY sm.movement_type
    ORDER BY sm.movement_type::TEXT
  ) t;

  RETURN v_result;
END $function$;

-- Versioning monotone : la v1 disparait dans la meme migration que la v2.
DROP FUNCTION IF EXISTS public.get_movement_aggregates_v1(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ);

-- anon herite EXECUTE via PUBLIC : revoquer les deux, puis re-accorder
-- explicitement les seuls roles que portait la v1.
REVOKE ALL ON FUNCTION public.get_movement_aggregates_v2(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_movement_aggregates_v2(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_movement_aggregates_v2(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_movement_aggregates_v2(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_movement_aggregates_v2(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Agregats de mouvements par type. Valorise au cout courant du produit, aligne sur get_stock_movement_ledger_v1 (2026-08-05).';
