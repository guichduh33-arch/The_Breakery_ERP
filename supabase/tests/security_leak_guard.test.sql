-- supabase/tests/security_leak_guard.test.sql
-- Session 50 / pgTAP — Security leak guard tests.
--
-- Couvre :
--   T1–T3  : MVs inaccessibles à authenticated (W1.5) — throws_ok 4-arg + RESET ROLE
--   T4     : audit_log security_invoker=true (W1.5) — seule vue appliquée
--   T5–T6  : v_product_available_stock + view_product_allergens_resolved → DEFERRED V2
--   T7     : get_customer_product_price search_path (W1.6) — SECURITY DEFINER
--   T8–T9  : enforce_margin_alerts_ack_only + next_expense_number search_path (W1.6)
--            — SECURITY INVOKER (proconfig uniquement, pas prosecdef)
--   T10–T11: _resolve_dispatch_stations_v1 non callable par authenticated/anon (W1.1)
--   T12    : b2b.read seeded (W1.3)
--   T13    : settings.security.manage seeded (W1.3)
--
-- Fixes S50 post-live (validé 11/11 vert) :
--   - T1–T3 : forme 4-arg throws_ok + RESET ROLE (SET LOCAL ROLE fuit sinon)
--   - T4    : reloptions @> ARRAY['security_invoker=true'] (pas '=on')
--   - T5–T6 : skip(2) — vues POS différées (cascade RLS inventory.read cassée)
--   - T8–T9 : retire prosecdef=true (INVOKER en réalité ; seul proconfig testé)
--
-- Exécution : mcp__plugin_supabase_supabase__execute_sql avec BEGIN/ROLLBACK.
-- DEV-S50-pgTAP-leaks

BEGIN;
SELECT plan(13);

-- ============================================================
-- T1–T3 : MVs — authenticated ne peut pas SELECT
-- Forme 4-arg : throws_ok(sql, errcode, errmsg, description)
-- RESET ROLE après chaque pour éviter la fuite SET LOCAL ROLE.
-- ============================================================

SELECT throws_ok(
  $$
    SET LOCAL ROLE authenticated;
    SELECT 1 FROM mv_sales_daily LIMIT 1;
  $$,
  '42501',
  NULL,
  'T1 — mv_sales_daily inaccessible à authenticated'
);
RESET ROLE;

SELECT throws_ok(
  $$
    SET LOCAL ROLE authenticated;
    SELECT 1 FROM mv_stock_variance LIMIT 1;
  $$,
  '42501',
  NULL,
  'T2 — mv_stock_variance inaccessible à authenticated'
);
RESET ROLE;

SELECT throws_ok(
  $$
    SET LOCAL ROLE authenticated;
    SELECT 1 FROM mv_pl_monthly LIMIT 1;
  $$,
  '42501',
  NULL,
  'T3 — mv_pl_monthly inaccessible à authenticated'
);
RESET ROLE;

-- ============================================================
-- T4 : audit_log compat view dropped (S56 _088)
-- (remplace l'assertion S50 security_invoker — la vue n'existe plus)
-- ============================================================
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_log'
  ),
  'T4 — audit_log compat view dropped (S56)'
);

-- ============================================================
-- T5–T6 : vues POS différées (DEFERRED to V2)
-- CASCADE RLS inventory.read cassée pour CASHIER/waiter → non appliqué live.
-- ============================================================

SELECT skip('DEFERRED to V2: security_invoker on POS views breaks CASHIER cascade (inventory.read RLS)', 2);

-- ============================================================
-- T7–T9 : search_path hardening
-- T7 : get_customer_product_price → SECURITY DEFINER confirmé
-- T8–T9 : enforce_margin_alerts_ack_only + next_expense_number → INVOKER
--          (prosecdef=false en réalité — ne pas tester ; tester seulement proconfig)
-- ============================================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_customer_product_price'
      AND p.prosecdef = true
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ),
  'T7 — get_customer_product_price DEFINER + search_path set'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_margin_alerts_ack_only'
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ),
  'T8 — enforce_margin_alerts_ack_only search_path set'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'next_expense_number'
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ),
  'T9 — next_expense_number search_path set'
);

-- ============================================================
-- T10–T11 : _resolve_dispatch_stations_v1 — REVOKE authenticated + anon
-- ============================================================

SELECT ok(
  NOT has_function_privilege('authenticated', 'public._resolve_dispatch_stations_v1(uuid)', 'EXECUTE'),
  'T10 — authenticated cannot EXECUTE _resolve_dispatch_stations_v1'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public._resolve_dispatch_stations_v1(uuid)', 'EXECUTE'),
  'T11 — anon cannot EXECUTE _resolve_dispatch_stations_v1'
);

-- ============================================================
-- T12–T13 : Permissions seedées W1.3
-- ============================================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM permissions WHERE code = 'b2b.read'
  ),
  'T12 — permission b2b.read seedée'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM permissions WHERE code = 'settings.security.manage'
  ),
  'T13 — permission settings.security.manage seedée'
);

SELECT * FROM finish();
ROLLBACK;
