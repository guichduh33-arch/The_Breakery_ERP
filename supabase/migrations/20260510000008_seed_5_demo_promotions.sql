-- 20260510000008_seed_5_demo_promotions.sql
-- Session 8 / migration 8 : 5 promos demo placeholder.
-- NOTE: The actual INSERT INTO promotions is in supabase/seed.sql (SESSION 8 section)
-- because the promo conditions reference products (PAS-CROI, BEV-AMER) and categories
-- (beverage slug) that are seeded in seed.sql AFTER migrations run.
-- See: supabase/seed.sql — SESSION 8 section for the actual 5-promo INSERT.
--
-- This migration file is a placeholder that ensures the migration sequence
-- 20260510000001 → 20260510000008 is complete and the promotions table is available.

SELECT 1; -- no-op placeholder
