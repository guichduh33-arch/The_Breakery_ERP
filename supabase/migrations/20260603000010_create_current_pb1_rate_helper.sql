-- 20260603000010_create_current_pb1_rate_helper.sql
-- Session 26 / Wave 1.B / migration _010 :
--   Helper SQL `current_pb1_rate()` qui lit `business_config.tax_rate`.
--
-- Closes audit finding F-S26-AC-01 :
--   Le trigger create_sale_journal_entry hardcodait 10/110, alors que
--   complete_order_v9 lit business_config.tax_rate dynamiquement. Si l'admin
--   passe le taux à 0.11 (ou autre), la JE était déséquilibrée silencieuse
--   (PB1 calculé sur 10% pendant que orders.tax_amount calculé sur 11%).
--
-- ADR-003 NON-PKP : ce helper représente le **taux PB1 régional Bali** (PEMDA),
--   pas un taux PPN national. Le nom `current_pb1_rate` clarifie la sémantique
--   pour les lecteurs futurs (vs le générique `tax_rate` qui pourrait être
--   confondu avec PPN).
--
-- Usage attendu :
--   vat_tax_amount := round_idr(NEW.total * current_pb1_rate() / (1 + current_pb1_rate()));
--   net           := NEW.total - vat_tax_amount;

CREATE OR REPLACE FUNCTION current_pb1_rate()
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT tax_rate FROM business_config WHERE id = 1
$$;

REVOKE EXECUTE ON FUNCTION current_pb1_rate() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION current_pb1_rate() FROM anon;
GRANT  EXECUTE ON FUNCTION current_pb1_rate() TO authenticated;

COMMENT ON FUNCTION current_pb1_rate() IS
  'Helper SAK EMKM NON-PKP — retourne le taux PB1 actuel depuis '
  'business_config.tax_rate. Utilisé par create_sale_journal_entry et '
  'calculate_pb1_payable_v1 pour calculer dynamiquement le PB1 sur ventes. '
  'Bali PEMDA : 10% par défaut (Perda Provinsi Bali). ADR-003.';
