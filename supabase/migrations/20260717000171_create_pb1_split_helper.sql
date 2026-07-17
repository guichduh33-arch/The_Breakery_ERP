-- 20260717000171_create_pb1_split_helper.sql
-- Lot 6a (Settings, ADR-006 décision 7) — socle du réglage `tax_inclusive`.
--
-- Constat à l'origine du lot (audit code + base live, 2026-07-17) :
--   * `business_config.tax_inclusive` était écrit mais jamais lu ;
--   * `products.tax_inclusive` était sélectionné, typé et éditable, mais aucun
--     calcul ne le consommait (441/441 produits à `true`, défaut jamais dérogé) ;
--   * le mode effectif n'était NI global NI par produit : il était codé en dur,
--     inclusif, recopié dans 7 fonctions live.
--
-- Ce helper devient le SEUL porteur de la formule. Les 7 call-sites l'appellent
-- (migrations _172 → _178). Le réglage devient effectif par construction : il
-- n'existe plus qu'un seul endroit où le mode est décidé.
--
-- Modèle : `_record_sale_stock_v1` (helper interne unique du money-path stock).
--
-- À comportement constant : `tax_inclusive` vaut `true` en base, la branche
-- inclusive reproduit à l'identique `round_idr(x * r / (1 + r))` / `total = x`.

CREATE FUNCTION public._pb1_split_v1(p_items_total NUMERIC)
RETURNS TABLE (subtotal NUMERIC, tax_amount NUMERIC, total NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_rate      NUMERIC;
  v_inclusive BOOLEAN;
BEGIN
  SELECT tax_rate, tax_inclusive INTO v_rate, v_inclusive
  FROM business_config WHERE id = 1;

  subtotal := p_items_total;

  IF v_inclusive THEN
    -- Prix catalogue TTC : le PB1 est la part déjà embarquée dans le brut.
    tax_amount := round_idr(p_items_total * v_rate / (1 + v_rate));
    total      := p_items_total;
  ELSE
    -- Prix catalogue HT : le PB1 s'ajoute au brut.
    tax_amount := round_idr(p_items_total * v_rate);
    total      := p_items_total + tax_amount;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._pb1_split_v1(NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._pb1_split_v1(NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public._pb1_split_v1(NUMERIC) FROM authenticated;

COMMENT ON FUNCTION public._pb1_split_v1 IS
  'Lot 6a — SEUL porteur de la formule PB1. Lit business_config (tax_rate + '
  'tax_inclusive) et retourne (subtotal, tax_amount, total). '
  'inclusive : tax = round_idr(x*r/(1+r)), total = x. '
  'exclusive : tax = round_idr(x*r), total = x + tax. '
  'Interne : REVOKE de tous les rôles, invoqué uniquement via la chaîne '
  'SECURITY DEFINER (complete_order_with_payment, pay_existing_order, '
  'cancel_order_item_rpc, refund_order_rpc, attach_tab_customer, '
  '_recalc_order_totals). '
  'HORS CHAMP — décision propriétaire du 2026-07-17, cf. ADR-005 (NON-PKP, PBJT '
  'municipale) : create_b2b_order_v5 et import_sales_v1 écrivent tax_amount = 0 '
  'DÉLIBÉRÉMENT — la vente en gros B2B et les ventes historiques importées ne '
  'sont pas assujetties au PBJT. Ce zéro n''est PAS un bug : ne pas les brancher '
  'sur ce helper.';
