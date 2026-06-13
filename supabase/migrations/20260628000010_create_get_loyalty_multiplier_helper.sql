-- 20260628000010_create_get_loyalty_multiplier_helper.sql
-- Session 44 / Wave A / D4 : miroir SQL de packages/domain/src/loyalty/tiers.ts
-- (même pattern que get_loyalty_tier, S12 20260514000001). Consommé par
-- complete_order_with_payment_v12 + pay_existing_order_v8 pour résoudre le
-- multiplier de points server-side (P0-C : l'arg client p_loyalty_multiplier
-- disparaît des signatures).

CREATE OR REPLACE FUNCTION get_loyalty_multiplier(p_lifetime_points INT)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_lifetime_points >= 5000 THEN 1.2
    WHEN p_lifetime_points >= 2000 THEN 1.1
    WHEN p_lifetime_points >=  500 THEN 1.05
    ELSE 1.0
  END::NUMERIC
$$;

COMMENT ON FUNCTION get_loyalty_multiplier IS
  'Session 44. Mirrors packages/domain/src/loyalty/tiers.ts points_multiplier. '
  'If you change one side, change the other (pinned by tiers-multipliers.test.ts + s44_money_gates pgTAP).';

-- REVOKE pair par cohérence (helper pur, pas de raison d'exposition anon).
REVOKE EXECUTE ON FUNCTION get_loyalty_multiplier(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_loyalty_multiplier(INT) FROM anon;
GRANT EXECUTE ON FUNCTION get_loyalty_multiplier(INT) TO authenticated;
