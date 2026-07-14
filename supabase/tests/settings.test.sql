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
SELECT has_function('public', 'get_settings_by_category_v1', ARRAY['text'], 'get_settings_by_category_v1 exists');
SELECT has_function('public', 'set_setting_v1',              ARRAY['text','jsonb','text'], 'set_setting_v1 exists');

-- get_settings_by_category_v1 should return business keys for 'business'
-- when called with service_role search_path bypassing RLS — we drive it
-- as SECURITY DEFINER so its inner has_permission check is the gate.
-- Since this is a pgTAP suite running outside an auth context,
-- auth.uid() is NULL and has_permission returns FALSE. We instead just
-- verify the function exists and exits with the expected error code.
SELECT throws_ok(
  $$SELECT get_settings_by_category_v1('business')$$,
  '42501',
  NULL,
  'get_settings_by_category_v1 rejects unauthenticated callers'
);

-- set_setting_v1 also rejects unauthenticated callers
SELECT throws_ok(
  $$SELECT set_setting_v1('name', '"Test"'::jsonb, 'business')$$,
  '42501',
  NULL,
  'set_setting_v1 rejects unauthenticated callers'
);

SELECT * FROM finish();
ROLLBACK;
