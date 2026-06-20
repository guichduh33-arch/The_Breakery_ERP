-- supabase/tests/units_registry.test.sql
-- Central units registry + convert_quantity registry-derivation.
-- Run via MCP execute_sql inside a BEGIN/ROLLBACK envelope, or by the nightly
-- pgTAP CI. Covers: table shape, seed, dimensional derivation, legacy-pair
-- preservation, and the unconvertible (cross-dimension / container) contract.

BEGIN;
SELECT plan(13);

-- ── Table + seed ────────────────────────────────────────────────────────────
SELECT has_table('public', 'units', 'units registry table exists');
SELECT ok((SELECT count(*) FROM public.units) >= 22, 'units seeded (>= 22 codes)');
SELECT is((SELECT dimension FROM public.units WHERE code = 'gr'), 'mass', 'gr is mass');
SELECT is((SELECT factor_to_canonical FROM public.units WHERE code = 'kg'), 1000::numeric, 'kg = 1000 g');
SELECT is((SELECT factor_to_canonical FROM public.units WHERE code = 'lt'), 1000::numeric, 'lt = 1000 ml');
SELECT is((SELECT factor_to_canonical FROM public.units WHERE code = 'bag'), NULL, 'container has no global factor');

-- ── convert_quantity: registry-derived same-dimension ───────────────────────
SELECT is(convert_quantity(18::numeric, 'g',  'kg'), 0.018::numeric,   'g -> kg derived (the ×1000 bug fix)');
SELECT is(convert_quantity(1::numeric,  'g',  'gr'), 1::numeric,       'g == gr');
SELECT is(convert_quantity(2::numeric,  'kg', 'g'),  2000::numeric,    'kg -> g derived');
SELECT is(convert_quantity(1000::numeric,'ml','lt'), 1::numeric,       'ml -> lt derived');

-- ── Legacy exact pair preserved (zero regression) ───────────────────────────
SELECT is(convert_quantity(18::numeric, 'gr', 'kg'), 0.018::numeric,   'gr -> kg via legacy unit_conversions pair');

-- ── Unconvertible pairs still raise P0002 (unchanged contract) ──────────────
SELECT throws_ok($$ SELECT convert_quantity(1::numeric, 'g', 'ml') $$, 'P0002',
                 NULL, 'cross-dimension raises unit_conversion_missing');
SELECT throws_ok($$ SELECT convert_quantity(1::numeric, 'bag', 'kg') $$, 'P0002',
                 NULL, 'container (no global factor) raises unit_conversion_missing');

SELECT * FROM finish();
ROLLBACK;
