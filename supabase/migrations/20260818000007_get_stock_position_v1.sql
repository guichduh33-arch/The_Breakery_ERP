-- 20260818000007_get_stock_position_v1.sql
--
-- Rapport « Position de stock à date » (famille Inventory) — la photo du stock
-- au soir du jour J : quantité et valeur, pour l'inventaire comptable, la
-- clôture et les écarts (maquette + arbitrages validés par Mamat 2026-08-17 :
-- valorisation au WAC COURANT étiquetée, vitrine EXCLUE).
--
-- RECONSTRUCTION ARRIÈRE, PAS AVANT : position(J) = current_stock −
-- Σ quantity des mouvements POSTÉRIEURS à J. Un forward-sum depuis le début du
-- ledger serait faux sur tout produit dont le stock initial n'est jamais entré
-- par le ledger (cas normal d'un site migré — cf. skill stock, caveat opname) ;
-- la reconstruction arrière part du cache présent, exact par construction.
-- Corollaire : un produit sans mouvement postérieur à J rend current_stock.
--
-- VALORISATION AU WAC COURANT (products.cost_price), ÉTIQUETÉE : le champ
-- `valuation` du résultat dit 'current_wac'. Reconstruire le WAC historique à
-- J est un chantier séparé, non demandé (arbitrage). L'écart entre cette
-- valorisation instantanée et le grand livre inventaire est NORMAL entre deux
-- opnames (ADR-014) — ce rapport n'est pas une écriture comptable.
--
-- PÉRIMÈTRE : produits suivis (track_inventory), vivants (deleted_at NULL),
-- HORS vitrine (is_display_item — display_stock est un ledger séparé qui ne
-- s'additionne JAMAIS au stock BO). Les quantités négatives (vente à découvert
-- autorisée, forçage production) sortent telles quelles avec statut 'negative'
-- — les masquer fausserait le total que la table doit recouper.

CREATE OR REPLACE FUNCTION public.get_stock_position_v1(
  p_as_of date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     text;
  v_today  date;
  v_as_of  date;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_as_of := COALESCE(p_as_of, v_today);

  IF v_as_of > v_today THEN
    RAISE EXCEPTION 'as_of_in_the_future' USING ERRCODE = 'P0001';
  END IF;

  WITH pos AS (
    SELECT
      p.id, p.name, p.sku, p.unit, p.category_id,
      c.name AS category_name,
      COALESCE(p.cost_price, 0)          AS wac,
      COALESCE(p.min_stock_threshold, 0) AS min_threshold,
      p.current_stock
        - COALESCE((SELECT SUM(sm.quantity)
                      FROM stock_movements sm
                     WHERE sm.product_id = p.id
                       AND ((sm.created_at AT TIME ZONE v_tz))::date > v_as_of), 0)
        AS qty
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.deleted_at IS NULL
      AND p.track_inventory
      AND NOT p.is_display_item
  ),
  valued AS (
    SELECT pos.*,
      pos.qty * pos.wac AS value,
      CASE
        WHEN pos.qty < 0                                            THEN 'negative'
        WHEN pos.qty = 0                                            THEN 'at_zero'
        WHEN pos.min_threshold > 0 AND pos.qty < pos.min_threshold  THEN 'below_threshold'
        ELSE 'ok'
      END AS status
    FROM pos
  )
  SELECT jsonb_build_object(
    'as_of',        v_as_of,
    'timezone',     v_tz,
    'generated_at', now(),
    -- L'étiquette de valorisation fait partie du CONTRAT : la page l'affiche.
    'valuation',    'current_wac',
    'summary', jsonb_build_object(
      'total_value',          COALESCE((SELECT SUM(value) FROM valued), 0),
      'refs_tracked',         (SELECT COUNT(*) FROM valued),
      'refs_in_stock',        (SELECT COUNT(*) FROM valued WHERE qty > 0),
      'refs_at_zero',         (SELECT COUNT(*) FROM valued WHERE status = 'at_zero'),
      'refs_negative',        (SELECT COUNT(*) FROM valued WHERE status = 'negative'),
      'refs_below_threshold', (SELECT COUNT(*) FROM valued WHERE status = 'below_threshold')
    ),
    'by_category', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category_id',   bc.category_id,
        'category_name', bc.category_name,
        'value',         bc.value,
        'refs',          bc.refs
      ) ORDER BY bc.value DESC)
      FROM (
        SELECT category_id, category_name,
               SUM(value) AS value, COUNT(*) AS refs
        FROM valued
        GROUP BY category_id, category_name
      ) bc
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id',    v.id,
        'name',          v.name,
        'sku',           v.sku,
        'unit',          v.unit,
        'category_name', v.category_name,
        'qty',           v.qty,
        'wac',           v.wac,
        'value',         v.value,
        'min_threshold', v.min_threshold,
        'status',        v.status
      ) ORDER BY v.value DESC, v.name ASC)
      FROM valued v
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_stock_position_v1(date) IS
  'Position de stock au soir du jour J — reconstruction ARRIÈRE depuis le '
  'ledger (current_stock − Σ mouvements postérieurs à J, robuste au stock '
  'initial jamais entré au ledger). Valorisation au WAC courant, étiquetée '
  '(valuation=current_wac) — le WAC historique est un chantier séparé. '
  'Produits track_inventory hors vitrine ; négatifs montrés, jamais masqués. '
  'Gate reports.inventory.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_stock_position_v1(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stock_position_v1(date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_stock_position_v1(date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
