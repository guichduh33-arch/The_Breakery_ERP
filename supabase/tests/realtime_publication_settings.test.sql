-- supabase/tests/realtime_publication_settings.test.sql
-- Settings §6.C (migration 20260717000181) — les deux tables de configuration
-- consommées en live par les appareils POS sont membres de la publication
-- `supabase_realtime`, prérequis des subscriptions postgres_changes du hook
-- useSettingsRealtime (apps/pos). ADR-006 décision 4.
--
-- Run via MCP execute_sql (BEGIN..ROLLBACK porté par ce fichier ; pattern
-- temp-table, cf. settings_business_identity.test.sql).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- T1: business_config est publiée sur supabase_realtime.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t1_business_config_published',
    EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public' AND tablename = 'business_config'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_business_config_published', false);
END $$;

-- T2: receipt_templates est publiée sur supabase_realtime.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t2_receipt_templates_published',
    EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public' AND tablename = 'receipt_templates'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_receipt_templates_published', false);
END $$;

-- T3: garde-fou — la RLS reste active sur les deux tables publiées (les
-- événements postgres_changes sont filtrés par la RLS SELECT ; une table
-- publiée SANS RLS diffuserait à tout porteur de JWT).
DO $$ BEGIN
  INSERT INTO _r VALUES ('t3_rls_still_enabled',
    (SELECT bool_and(relrowsecurity) FROM pg_class
      WHERE oid IN ('public.business_config'::regclass,
                    'public.receipt_templates'::regclass)));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_rls_still_enabled', false);
END $$;

-- Agrégat : 'ok N' si tout passe, sinon la liste des assertions en échec.
SELECT CASE
  WHEN (SELECT count(*) FROM _r WHERE NOT pass) = 0
    THEN 'ok ' || (SELECT count(*) FROM _r)::text
  ELSE 'FAIL: ' || (SELECT string_agg(name, ', ') FROM _r WHERE NOT pass)
END AS result;

ROLLBACK;
