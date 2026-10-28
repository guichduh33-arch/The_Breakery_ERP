-- La garde PIN complète la fermeture ACL ; aucune fixture métier ni droit ajouté.
BEGIN;
SET LOCAL search_path = pg_catalog, public, extensions;
SELECT plan(337);

CREATE TEMP TABLE expected_bank_pin_tables(table_name text PRIMARY KEY);
INSERT INTO expected_bank_pin_tables(table_name) VALUES
  ('bank_reconciliations'),
  ('bank_statement_imports'),
  ('bank_statement_lines'),
  ('bank_reconciliation_matches'),
  ('bank_reconciliation_bank_claims'),
  ('bank_reconciliation_gl_claims'),
  ('bank_reconciliation_operations'),
  ('bank_reconciliation_entries'),
  ('bank_reconciliation_clearing_claims'),
  ('bank_reconciliation_transit'),
  ('bank_reconciliation_entry_bank_claims'),
  ('bank_reconciliation_net_fee_claims');

-- Douze tables attendues, même si une table ou sa policy a disparu.
SELECT ok(EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=e.table_name AND c.relkind IN ('r','p')
), e.table_name || ': table publique présente')
FROM expected_bank_pin_tables e ORDER BY e.table_name;

SELECT ok((
  SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=e.table_name AND c.relkind IN ('r','p')
), e.table_name || ': RLS reste activée')
FROM expected_bank_pin_tables e ORDER BY e.table_name;

SELECT is((
  SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN expected_bank_pin_tables e ON e.table_name=c.relname
  WHERE n.nspname='public'
), 12::bigint, 'exactement douze policies bancaires, sans porte supplémentaire');

SELECT is((
  SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=e.table_name
    AND p.polname='pin_session_required' AND NOT p.polpermissive AND p.polcmd='*'
    AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[]
), 1::bigint, e.table_name || ': policy PIN unique, RESTRICTIVE ALL authenticated')
FROM expected_bank_pin_tables e ORDER BY e.table_name;

-- Comparaison entière du prédicat, pas un LIKE qui accepterait « OR true ».
-- pg_get_expr omet le schéma public visible dans le search_path du test.
SELECT is((
  SELECT regexp_replace(pg_get_expr(p.polqual,p.polrelid), '[[:space:]]', '', 'g')
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=e.table_name AND p.polname='pin_session_required'
), '(SELECTrequest_has_active_pin_session_v1()ASrequest_has_active_pin_session_v1)',
e.table_name || ': USING exige uniquement le helper de session PIN')
FROM expected_bank_pin_tables e ORDER BY e.table_name;

SELECT is((
  SELECT regexp_replace(pg_get_expr(p.polwithcheck,p.polrelid), '[[:space:]]', '', 'g')
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=e.table_name AND p.polname='pin_session_required'
), '(SELECTrequest_has_active_pin_session_v1()ASrequest_has_active_pin_session_v1)',
e.table_name || ': WITH CHECK exige uniquement le helper de session PIN')
FROM expected_bank_pin_tables e ORDER BY e.table_name;

SELECT is((
  SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=e.table_name AND p.polpermissive
), 0::bigint, e.table_name || ': aucune policy permissive')
FROM expected_bank_pin_tables e ORDER BY e.table_name;

-- Les ACL effectives incluent les droits hérités de PUBLIC et des autres rôles.
SELECT ok(NOT coalesce(
  has_table_privilege(r.role_name,c.oid,a.privilege_name) OR
  CASE WHEN a.privilege_name IN ('SELECT','INSERT','UPDATE','REFERENCES')
    THEN has_any_column_privilege(r.role_name,c.oid,a.privilege_name) ELSE false END,
  true),
  e.table_name || ': ' || r.role_name || ' sans droit direct ' || a.privilege_name)
FROM expected_bank_pin_tables e
CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) r(role_name)
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
  ('TRUNCATE'),('REFERENCES'),('TRIGGER')) a(privilege_name)
LEFT JOIN pg_class c ON c.relnamespace='public'::regnamespace
  AND c.relname=e.table_name AND c.relkind IN ('r','p')
ORDER BY e.table_name,r.role_name,a.privilege_name;

SELECT ok(EXISTS (
  SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relname='bank_statement_lines_ordinal_seq' AND relkind='S'
), 'séquence des lignes importées présente');

SELECT is(pg_get_serial_sequence('public.bank_statement_lines','ordinal'),
  'public.bank_statement_lines_ordinal_seq', 'la séquence testée porte bien les ordinaux importés');

SELECT ok(NOT coalesce(has_sequence_privilege(r.role_name,c.oid,a.privilege_name),true),
  'séquence import : ' || r.role_name || ' sans droit direct ' || a.privilege_name)
FROM (VALUES ('anon'),('authenticated'),('service_role')) r(role_name)
CROSS JOIN (VALUES ('USAGE'),('SELECT'),('UPDATE')) a(privilege_name)
LEFT JOIN pg_class c ON c.relnamespace='public'::regnamespace
  AND c.relname='bank_statement_lines_ordinal_seq' AND c.relkind='S'
ORDER BY r.role_name,a.privilege_name;

-- Même invariant global que pin_session_enforcement, aucune exception bancaire.
SELECT is((
  SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity
    AND NOT EXISTS (
      SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid
        AND p.polname='pin_session_required' AND NOT p.polpermissive
    )
), 0::bigint, 'toutes les tables publiques RLS gardées par une policy PIN restrictive');

SELECT * FROM finish();
ROLLBACK;
