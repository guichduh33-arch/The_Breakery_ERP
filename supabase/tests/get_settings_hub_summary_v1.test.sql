-- supabase/tests/get_settings_hub_summary_v1.test.sql
-- Lot 5 chantier 1 (2026-08-13) — le résumé agrégé du hub Réglages.
-- Exécution : MCP execute_sql, enveloppe BEGIN … ROLLBACK (pas de runner local).

BEGIN;
SELECT plan(7);

-- Privilèges : trio REVOKE + grant authenticated (défense en profondeur anon).
SELECT ok(has_function_privilege('authenticated','public.get_settings_hub_summary_v1()','EXECUTE'),
  'authenticated peut exécuter');
SELECT ok(NOT has_function_privilege('anon','public.get_settings_hub_summary_v1()','EXECUTE'),
  'anon ne peut pas exécuter');
SELECT ok(NOT has_function_privilege('public','public.get_settings_hub_summary_v1()','EXECUTE'),
  'PUBLIC ne peut pas exécuter');

-- Sans JWT : refus explicite.
SELECT throws_ok('SELECT public.get_settings_hub_summary_v1()', '28000', 'not_authenticated',
  'sans JWT: refus');

-- Sous le profil E2E owner (seed S71) : sections libres + section gatée.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM user_profiles
                             WHERE id='0e2e0000-0000-4000-a000-000000000001'))::text, true);
SELECT ok((public.get_settings_hub_summary_v1()) ? 'company',
  'section company présente (owner)');
SELECT ok((public.get_settings_hub_summary_v1()) ? 'payment_methods',
  'section payment_methods présente');
SELECT ok((public.get_settings_hub_summary_v1()) ? 'expense_thresholds',
  'section gatée présente pour owner (expenses.thresholds.read)');

SELECT finish();
ROLLBACK;
