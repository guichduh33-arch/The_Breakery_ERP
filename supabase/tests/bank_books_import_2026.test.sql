-- Reprise de la comptabilité bancaire 2026 (`post_bank_books_import_v1`).
--
-- Écritures synthétiques : les montants réels de la société n'entrent pas dans
-- le dépôt. Contrôle : droits, simulation sans écriture, refus avant toute
-- écriture (déséquilibre, compte inconnu ou inactif, période fermée ou absente),
-- passage réel tracé, second passage refusé.
--
-- Runner : MCP execute_sql (enveloppe BEGIN … ROLLBACK), pas de runner local.
BEGIN;
SELECT plan(16);

CREATE TEMP TABLE _t(k text PRIMARY KEY, v jsonb) ON COMMIT DROP;

-- La garde de période lève P0004, qui est aussi le code `assert_failure` :
-- `WHEN OTHERS` (donc throws_like / throws_ok) ne l'attrape pas. On le capte ici.
CREATE FUNCTION pg_temp.period_error(p_entries jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.post_bank_books_import_v1(p_entries, false);
  RETURN 'no error';
EXCEPTION WHEN assert_failure THEN
  RETURN SQLERRM;
END $$;

-- Isole le test d'un passage réel déjà fait sur la base partagée.
UPDATE public.journal_entries SET metadata = metadata || '{"kind":"bank_books_import_2026_shadowed"}'::jsonb
 WHERE metadata->>'kind' = 'bank_books_import_2026';
UPDATE public.fiscal_periods SET status = 'open'
 WHERE period_start IN ('2026-02-01', '2026-03-01');

INSERT INTO _t VALUES ('good', $j$[
  {"date":"2026-02-01","description":"Test opening","lines":[
    {"account":"1112","debit":1000},{"account":"3200","credit":1000}]},
  {"date":"2026-02-28","description":"Test month","lines":[
    {"account":"1112","debit":250.50},{"account":"6112","debit":49.50},{"account":"4100","credit":300}]}
]$j$);

SELECT ok(NOT has_function_privilege('anon', 'public.post_bank_books_import_v1(jsonb,boolean,uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.post_bank_books_import_v1(jsonb,boolean,uuid)', 'EXECUTE'),
  'neither anon nor authenticated can run the import');

INSERT INTO _t VALUES ('count0', to_jsonb((SELECT count(*) FROM public.journal_entries)));
INSERT INTO _t VALUES ('dry', public.post_bank_books_import_v1((SELECT v FROM _t WHERE k = 'good')));
SELECT is((SELECT v->>'total_debit' FROM _t WHERE k = 'dry')::numeric, 1300::numeric, 'the dry run sums both entries');
SELECT is((SELECT jsonb_array_length(v->'entries') FROM _t WHERE k = 'dry'), 2, 'the dry run lists both entries');
SELECT is((SELECT count(*) FROM public.journal_entries), (SELECT v::text::bigint FROM _t WHERE k = 'count0'),
  'the dry run writes nothing');

SELECT throws_like($q$ SELECT public.post_bank_books_import_v1(
  '[{"date":"2026-02-01","description":"Bad","lines":[{"account":"1112","debit":10},{"account":"3200","credit":9}]}]', false) $q$,
  '%entry_1_unbalanced%', 'an unbalanced entry is refused');
SELECT throws_like($q$ SELECT public.post_bank_books_import_v1(
  '[{"date":"2026-02-01","description":"Bad","lines":[{"account":"9999","debit":10},{"account":"3200","credit":10}]}]', false) $q$,
  '%entry_1_account_not_found%', 'an unknown account is refused');
SELECT throws_like($q$ SELECT public.post_bank_books_import_v1(
  '[{"date":"2026-02-01","description":"Bad","lines":[{"account":"1151","debit":10},{"account":"3200","credit":10}]}]', false) $q$,
  '%entry_1_account_not_postable%', 'an inactive account is refused');
SELECT throws_like($q$ SELECT public.post_bank_books_import_v1(
  '[{"date":"2026-02-01","description":"Bad","lines":[{"account":"1112","debit":10,"credit":10},{"account":"3200","credit":10}]}]', false) $q$,
  '%entry_1_line_must_be_debit_xor_credit%', 'a line with both a debit and a credit is refused');
SELECT throws_like($q$ SELECT public.post_bank_books_import_v1(
  '[{"date":"2026-02-01","description":"Bad","lines":[{"account":"1112","debit":10}]}]', false) $q$,
  '%entry_1_minimum_2_lines%', 'a one-line entry is refused');
SELECT matches(pg_temp.period_error(
  '[{"date":"2099-01-01","description":"Bad","lines":[{"account":"1112","debit":10},{"account":"3200","credit":10}]}]'),
  'period_undefined', 'a date outside every period is refused');

UPDATE public.fiscal_periods SET status = 'closed' WHERE period_start = '2026-03-01';
SELECT matches(pg_temp.period_error(
  '[{"date":"2026-02-01","description":"Good","lines":[{"account":"1112","debit":10},{"account":"3200","credit":10}]},
    {"date":"2026-03-31","description":"Closed","lines":[{"account":"1112","debit":10},{"account":"3200","credit":10}]}]'),
  'period_locked', 'a closed period refuses the whole batch');
SELECT is((SELECT count(*) FROM public.journal_entries), (SELECT v::text::bigint FROM _t WHERE k = 'count0'),
  'a refused batch writes nothing, not even its valid entries');
UPDATE public.fiscal_periods SET status = 'open' WHERE period_start = '2026-03-01';

INSERT INTO _t VALUES ('real', public.post_bank_books_import_v1((SELECT v FROM _t WHERE k = 'good'), false));
SELECT is((SELECT count(*) FROM public.journal_entries je
            WHERE je.metadata->>'kind' = 'bank_books_import_2026'
              AND je.total_debit = je.total_credit
              AND je.total_debit = (SELECT COALESCE(SUM(l.debit), 0) FROM public.journal_entry_lines l WHERE l.journal_entry_id = je.id)
              AND je.total_credit = (SELECT COALESCE(SUM(l.credit), 0) FROM public.journal_entry_lines l WHERE l.journal_entry_id = je.id)),
  2::bigint, 'the real run posts both entries, balanced, with their lines');
SELECT ok(EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'accounting.bank_books_import.posted'
                   AND (metadata->>'total_debit')::numeric = 1300),
  'the real run is written to the audit log');
SELECT throws_ok($q$ SELECT public.post_bank_books_import_v1((SELECT v FROM _t WHERE k = 'good'), false) $q$,
  'P0003', 'bank_books_import_already_posted', 'a second real run is refused');
SELECT is((public.post_bank_books_import_v1((SELECT v FROM _t WHERE k = 'good')))->>'already_posted', 'true',
  'a dry run after the real run says it is already posted');

SELECT * FROM finish();
ROLLBACK;
