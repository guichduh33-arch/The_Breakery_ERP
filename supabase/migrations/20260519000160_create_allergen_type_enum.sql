-- Session 15 / Phase 5.C — allergen_type enum.
--
-- 14 EU standard allergens per Regulation (EU) No 1169/2011 Annex II
-- (Food Information to Consumers). Used by `products.allergens` (Phase 5.C
-- migration 161) and the recursive `view_product_allergens_resolved`
-- (migration 162) to drive POS + BO badges.
--
-- Spec ref: docs/workplan/specs/2026-05-15-session-15-spec.md §D14.
-- Idempotent — safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'allergen_type') THEN
    CREATE TYPE allergen_type AS ENUM (
      'gluten',
      'crustaceans',
      'eggs',
      'fish',
      'peanuts',
      'soy',
      'milk',
      'nuts',
      'celery',
      'mustard',
      'sesame',
      'sulphites',
      'lupin',
      'molluscs'
    );
  END IF;
END $$;

COMMENT ON TYPE allergen_type IS
  '14 EU standard allergens per Regulation (EU) No 1169/2011 Annex II. Used by products.allergens and view_product_allergens_resolved (Session 15 Phase 5.C, decision D14).';
