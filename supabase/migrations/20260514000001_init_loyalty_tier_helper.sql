-- 20260514000001_init_loyalty_tier_helper.sql
-- Session 12 (BO loyalty) / migration 1 : pure SQL helper that mirrors
-- packages/domain/src/loyalty/tiers.ts (4-tier table).
-- IMMUTABLE so the planner can fold calls in views/expressions.

CREATE OR REPLACE FUNCTION get_loyalty_tier(p_lifetime_points INT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_lifetime_points >= 5000 THEN 'platinum'
    WHEN p_lifetime_points >= 2000 THEN 'gold'
    WHEN p_lifetime_points >=  500 THEN 'silver'
    ELSE 'bronze'
  END
$$;

COMMENT ON FUNCTION get_loyalty_tier IS
  'Session 12. Mirrors packages/domain/src/loyalty/tiers.ts tierFromLifetime(). '
  'Used by tests and any future RPC that needs to project a tier.';
