-- pgTAP — get_product_performance_v1 (fiche produit, carte Performance).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
--
-- Vérifie : le gate `reports.sales.read` avec son TEST NÉGATIF (ADR-021 déc. 6),
-- le garde sur p_product_id, la forme de l'enveloppe et le fuseau métier, la
-- cohérence arithmétique total = comptoir + B2B, les bornes de la conversion,
-- le défaut de fenêtre — et surtout la RÉCONCILIATION CROISÉE : la part comptoir
-- doit égaler, au chiffre près, ce que get_pos_top_products_v1 rapporte pour le
-- même produit sur la même fenêtre. C'est ce test qui interdit à la fiche
-- produit et au rapport Top products de diverger.

BEGIN;
SELECT plan(11);

-- ── Gate : appelant sans auth.uid() / sans reports.sales.read est refusé ────
-- Test NÉGATIF exigé par ADR-021 décision 6 : on prouve le refus, pas seulement
-- le cas passant.
SELECT throws_ok(
  $$ SELECT get_product_performance_v1('00000000-0000-0000-0000-0000000000ff'::uuid) $$,
  '42501', NULL,
  'anon / no-perm caller is denied (reports.sales.read)'
);

-- ── On endosse un propriétaire porteur de reports.sales.read ───────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
SET LOCAL role authenticated;

-- ── Garde sur l'argument ───────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_product_performance_v1(NULL) $$, 'P0001', NULL,
  'NULL product id raises product_required');

-- ── Forme de l'enveloppe ───────────────────────────────────────────────────
WITH t AS (SELECT id FROM products ORDER BY created_at LIMIT 1),
     r AS (SELECT get_product_performance_v1(t.id) AS j FROM t)
SELECT ok((SELECT j ? 'total' AND j ? 'counter' AND j ? 'b2b'
                  AND j ? 'timezone' AND j ? 'window_days' FROM r),
          'envelope exposes total/counter/b2b/timezone/window_days');

-- ── Fuseau métier ──────────────────────────────────────────────────────────
WITH t AS (SELECT id FROM products ORDER BY created_at LIMIT 1),
     r AS (SELECT get_product_performance_v1(t.id) AS j FROM t)
SELECT is((SELECT j->>'timezone' FROM r), 'Asia/Makassar',
          'timezone is the business tz (WITA)');

-- ── p_days NULL retombe sur la fenêtre par défaut ──────────────────────────
WITH t AS (SELECT id FROM products ORDER BY created_at LIMIT 1),
     r AS (SELECT get_product_performance_v1(t.id, NULL) AS j FROM t)
SELECT is((SELECT (j->>'window_days')::int FROM r), 30,
          'NULL p_days falls back to a 30-day window');

-- ── Cohérence arithmétique : total = comptoir + B2B ────────────────────────
WITH t AS (SELECT id FROM products ORDER BY created_at LIMIT 1),
     r AS (SELECT get_product_performance_v1(t.id) AS j FROM t)
SELECT is(
  (SELECT (j->'total'->>'units_sold')::numeric FROM r),
  (SELECT (j->'counter'->>'units_sold')::numeric
        + (j->'b2b'->>'units_sold')::numeric FROM r),
  'total.units_sold = counter + b2b');

WITH t AS (SELECT id FROM products ORDER BY created_at LIMIT 1),
     r AS (SELECT get_product_performance_v1(t.id) AS j FROM t)
SELECT is(
  (SELECT (j->'total'->>'revenue')::numeric FROM r),
  (SELECT (j->'counter'->>'revenue')::numeric
        + (j->'b2b'->>'revenue')::numeric FROM r),
  'total.revenue = counter + b2b');

WITH t AS (SELECT id FROM products ORDER BY created_at LIMIT 1),
     r AS (SELECT get_product_performance_v1(t.id) AS j FROM t)
SELECT is(
  (SELECT (j->'total'->>'orders_total')::numeric FROM r),
  (SELECT (j->'counter'->>'orders_total')::numeric
        + (j->'b2b'->>'orders_total')::numeric FROM r),
  'total.orders_total = counter + b2b (une commande est B2B ou comptoir, jamais les deux)');

-- ── La conversion reste une part : 0 ≤ pct ≤ 100 ───────────────────────────
WITH t AS (SELECT id FROM products ORDER BY created_at LIMIT 1),
     r AS (SELECT get_product_performance_v1(t.id) AS j FROM t)
SELECT ok(
  (SELECT (j->'total'->>'conversion_pct')::numeric BETWEEN 0 AND 100 FROM r),
  'total.conversion_pct stays within 0..100');

-- ── RÉCONCILIATION CROISÉE avec get_pos_top_products_v1 ────────────────────
-- Le produit cible est le mieux vendu du rapport sur la fenêtre, à défaut le
-- premier produit venu (auquel cas les deux côtés valent 0 et le test tient
-- encore). Les dates viennent de l'enveloppe de la RPC testée, donc les deux
-- appels portent sur exactement la même fenêtre métier.
WITH t   AS (SELECT id FROM products ORDER BY created_at LIMIT 1),
     w   AS (SELECT get_product_performance_v1(t.id) AS j FROM t),
     d   AS (SELECT (j->>'from_date')::date AS d_from, (j->>'to_date')::date AS d_to FROM w),
     tp  AS (SELECT get_pos_top_products_v1(d.d_from, d.d_to) AS j FROM d),
     tgt AS (
       SELECT COALESCE(
         (SELECT (p->>'product_id')::uuid
            FROM tp, jsonb_array_elements(tp.j->'products') p LIMIT 1),
         (SELECT id FROM products ORDER BY created_at LIMIT 1)
       ) AS product_id
     )
SELECT is(
  (SELECT (get_product_performance_v1(tgt.product_id)->'counter'->>'units_sold')::numeric
     FROM tgt),
  (SELECT COALESCE(SUM((p->>'qty')::numeric), 0)
     FROM tp, tgt, jsonb_array_elements(tp.j->'products') p
    WHERE (p->>'product_id')::uuid = tgt.product_id),
  'counter.units_sold reconciles with get_pos_top_products_v1 qty (same product, same window)')
FROM tp, tgt LIMIT 1;

WITH t   AS (SELECT id FROM products ORDER BY created_at LIMIT 1),
     w   AS (SELECT get_product_performance_v1(t.id) AS j FROM t),
     d   AS (SELECT (j->>'from_date')::date AS d_from, (j->>'to_date')::date AS d_to FROM w),
     tp  AS (SELECT get_pos_top_products_v1(d.d_from, d.d_to) AS j FROM d),
     tgt AS (
       SELECT COALESCE(
         (SELECT (p->>'product_id')::uuid
            FROM tp, jsonb_array_elements(tp.j->'products') p LIMIT 1),
         (SELECT id FROM products ORDER BY created_at LIMIT 1)
       ) AS product_id
     )
SELECT is(
  (SELECT (get_product_performance_v1(tgt.product_id)->'counter'->>'revenue')::numeric
     FROM tgt),
  (SELECT COALESCE(SUM((p->>'revenue')::numeric), 0)
     FROM tp, tgt, jsonb_array_elements(tp.j->'products') p
    WHERE (p->>'product_id')::uuid = tgt.product_id),
  'counter.revenue reconciles with get_pos_top_products_v1 revenue (same product, same window)')
FROM tp, tgt LIMIT 1;

SELECT * FROM finish();
ROLLBACK;
