-- supabase/tests/settings.test.sql
-- Session 13 / Phase 5.C — pgTAP suite for settings module.
--
-- Run from a `BEGIN ... ROLLBACK` envelope via MCP execute_sql ; the
-- pgtap extension is already enabled on staging
-- (`ikcyvlovptebroadgtvd`). See CLAUDE.md "DB workflow".

BEGIN;
SELECT plan(21);

-- --------------------------------------------------------------
-- Schema : holidays
-- --------------------------------------------------------------
SELECT has_table('public', 'holidays', 'holidays table exists');
SELECT col_is_pk('public', 'holidays', 'id', 'holidays.id is primary key');
SELECT col_not_null('public', 'holidays', 'name',         'holidays.name NOT NULL');
SELECT col_not_null('public', 'holidays', 'date',         'holidays.date NOT NULL');
SELECT col_not_null('public', 'holidays', 'type',         'holidays.type NOT NULL');
SELECT col_not_null('public', 'holidays', 'is_recurring', 'holidays.is_recurring NOT NULL');

-- Seed count for 2026 Indonesian holidays
SELECT cmp_ok(
  (SELECT COUNT(*) FROM holidays WHERE deleted_at IS NULL)::INT,
  '>=', 16,
  'holidays seed contains at least 16 entries for 2026'
);

-- --------------------------------------------------------------
-- Schema : email_templates
-- --------------------------------------------------------------
SELECT has_table('public', 'email_templates', 'email_templates table exists');
SELECT col_not_null('public', 'email_templates', 'code',      'email_templates.code NOT NULL');
SELECT col_not_null('public', 'email_templates', 'subject',   'email_templates.subject NOT NULL');
SELECT col_not_null('public', 'email_templates', 'body_html', 'email_templates.body_html NOT NULL');
SELECT col_not_null('public', 'email_templates', 'body_text', 'email_templates.body_text NOT NULL');

SELECT cmp_ok(
  (SELECT COUNT(*) FROM email_templates WHERE code IN ('welcome','order_complete','payment_received','password_reset'))::INT,
  '=', 4,
  'email_templates seeded with the 4 expected codes'
);

-- --------------------------------------------------------------
-- Schema : receipt_templates
-- --------------------------------------------------------------
SELECT has_table('public', 'receipt_templates', 'receipt_templates table exists');
SELECT col_not_null('public', 'receipt_templates', 'name',       'receipt_templates.name NOT NULL');
SELECT col_not_null('public', 'receipt_templates', 'paper_size', 'receipt_templates.paper_size NOT NULL');

-- S77 : « exactement un défaut » était une assertion sur des DONNÉES vivantes
-- (0 défaut constaté le 2026-07-14 — l'édition BO S73 permet de le déposer, et
-- les templates tickets sont re-statués « À venir » S76, ⚫#17). Aucune
-- contrainte DB n'impose un défaut ; l'invariant défendable est « au plus un ».
SELECT cmp_ok(
  (SELECT COUNT(*) FROM receipt_templates WHERE is_default = true)::INT,
  '<=', 1,
  'at most one default receipt template exists (0 tolerated — templates not wired, S76)'
);

-- --------------------------------------------------------------
-- Functions
-- --------------------------------------------------------------
-- Lot 1.B (2026-08-03) — repointé v1 -> versions vivantes. Ces quatre
-- assertions étaient rouges au run nocturne depuis les bumps de la famille
-- settings : elles épinglaient des versions droppées, et la garde
-- « un appelant non authentifié se fait refuser » ne portait donc plus sur
-- rien. La version se vérifie dans supabase/migrations/ et au call-site.
SELECT has_function('public', 'get_settings_by_category_v9', ARRAY['text'], 'get_settings_by_category_v9 exists');
SELECT has_function('public', 'set_setting_v12',             ARRAY['text','jsonb','text'], 'set_setting_v12 exists');

-- La lecture par catégorie est SECURITY DEFINER : sa garde interne est
-- has_permission. Cette suite tourne hors contexte d'auth, donc auth.uid()
-- est NULL et has_permission renvoie FALSE — on vérifie que le refus sort
-- bien en 42501, pas que la lecture fonctionne.
SELECT throws_ok(
  $$SELECT get_settings_by_category_v9('business')$$,
  '42501',
  NULL,
  'get_settings_by_category_v9 rejects unauthenticated callers'
);

-- L'écriture refuse elle aussi un appelant non authentifié
SELECT throws_ok(
  $$SELECT set_setting_v12('name', '"Test"'::jsonb, 'business')$$,
  '42501',
  NULL,
  'set_setting_v12 rejects unauthenticated callers'
);

SELECT * FROM finish();
ROLLBACK;
