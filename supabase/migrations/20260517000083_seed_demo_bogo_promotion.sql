-- 20260517000083_seed_demo_bogo_promotion.sql
-- Session 13 / Phase 2.C — seed a demo BOGO promotion using the new shape
-- so QA / dev demos have something to evaluate against.
--
-- Idempotent (`ON CONFLICT (slug) DO NOTHING`) ; safe to re-apply. If no
-- matching bread product is found, the INSERT is a no-op via the LIMIT 0
-- branch (CTE returns 0 rows).
--
-- The seed targets the first "bread"/"loaf"/"baguette" product available.
-- On environments without a matching product, no row is inserted — this
-- is intentional ; the form-driven flows in BO will create promos at
-- runtime so demo data isn't strictly required.

INSERT INTO promotions (
  name, slug, description, type,
  bogo_buy_quantity, bogo_get_quantity, bogo_get_product_id,
  priority, stackable_with_promo, stackable_with_manual, is_active
)
SELECT
  'Buy 2 Get 1 Free — ' || p.name AS name,
  'demo-bogo-2-1-' || lower(regexp_replace(p.name, '[^a-z0-9]+', '-', 'gi')) AS slug,
  'Demo BOGO seeded by 20260517000083. Buy any 2 cart items, get 1 free ' || p.name || '.' AS description,
  'bogo'::promotion_type,
  2,
  1,
  p.id,
  50,
  false,
  true,
  true
FROM products p
WHERE p.deleted_at IS NULL
  AND (p.name ILIKE '%baguette%'
       OR p.name ILIKE '%bread%'
       OR p.name ILIKE '%loaf%'
       OR p.name ILIKE '%sourdough%')
ORDER BY p.created_at
LIMIT 1
ON CONFLICT (slug) DO NOTHING;
