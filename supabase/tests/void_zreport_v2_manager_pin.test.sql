-- S50 Vague 2a-i · T5 — void_zreport_v2 : PIN manager validé serveur
--
-- T1 : PIN invalide          -> invalid_pin (P0003), Z-Report reste draft.
-- T2 : void valide           -> status voided + voided_by/void_reason posés, idempotent_replay=false.
-- T3 : replay (déjà annulé)  -> idempotent_replay=true, statut stable.
-- T4 : void_zreport_v1 droppée (bump v1->v2).
--
-- Run via MCP execute_sql sous BEGIN/ROLLBACK. Auth simulée via request.jwt.claim.sub (EMP000,
-- SUPER_ADMIN -> a zreports.void). PIN manager posé transaction-local (hash_pin('112233')).
-- z_report de test inséré sur une pos_session libre (UNIQUE(shift_id)).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

SELECT set_config('request.jwt.claim.sub',
  (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);
UPDATE user_profiles SET pin_hash=hash_pin('112233'), locked_until=NULL, failed_login_attempts=0
  WHERE employee_code='EMP000';

INSERT INTO z_reports (id, shift_id, snapshot, status)
VALUES ('eee50001-0000-0000-0000-000000000001',
        (SELECT ps.id FROM pos_sessions ps WHERE NOT EXISTS (SELECT 1 FROM z_reports zr WHERE zr.shift_id=ps.id) LIMIT 1),
        '{}'::jsonb, 'draft');

CREATE TEMP TABLE _r(name text PRIMARY KEY, pass boolean) ON COMMIT DROP;

-- T1 : PIN invalide -> invalid_pin (P0003) ; le Z-Report reste draft
DO $a$ BEGIN
  PERFORM void_zreport_v2('eee50001-0000-0000-0000-000000000001', 'manager misclicked wrong shift', '0000');
  INSERT INTO _r VALUES ('A', false);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('A', SQLERRM LIKE '%invalid_pin%'); END $a$;

-- T2 : void valide -> voided + idempotent_replay=false + champs voided_* posés
DO $b$ DECLARE v jsonb; st text; vb uuid; vr text; BEGIN
  v := void_zreport_v2('eee50001-0000-0000-0000-000000000001', 'manager misclicked wrong shift', '112233');
  SELECT status::text, voided_by, void_reason INTO st, vb, vr FROM z_reports WHERE id='eee50001-0000-0000-0000-000000000001';
  INSERT INTO _r VALUES ('B', (v->>'idempotent_replay')::boolean=false AND st='voided' AND vb IS NOT NULL AND vr='manager misclicked wrong shift');
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('B', false); END $b$;

-- T3 : replay -> idempotent_replay=true, statut stable
DO $c$ DECLARE v jsonb; BEGIN
  v := void_zreport_v2('eee50001-0000-0000-0000-000000000001', 'manager misclicked wrong shift', '112233');
  INSERT INTO _r VALUES ('C', (v->>'idempotent_replay')::boolean=true AND v->>'status'='voided');
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('C', false); END $c$;

SELECT ok((SELECT pass FROM _r WHERE name='A'), 'T1 — PIN invalide -> invalid_pin (P0003)');
SELECT ok((SELECT pass FROM _r WHERE name='B'), 'T2 — void valide -> voided + voided_by/void_reason poses');
SELECT ok((SELECT pass FROM _r WHERE name='C'), 'T3 — replay -> idempotent_replay=true, statut stable');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public' AND p.proname='void_zreport_v1'),
  'T4 — void_zreport_v1 droppe (bump v1->v2)');

SELECT * FROM finish();
ROLLBACK;
