-- supabase/tests/adr019_timezone_session_invariant.test.sql
-- ADR-019 (D4), lot 2 « l'invariant » — la colonne miroir est égale au
-- paramètre de session PostgreSQL. Une divergence est un ÉCHEC DE TEST, pas une
-- découverte d'audit.
--
-- Pourquoi l'invariant n'est pas cosmétique : au relevé du 2026-08-02, sur 78
-- fonctions publiques qui déduisent une date d'un horodatage, 30 résolvent le
-- fuseau explicitement (elles lisent la COLONNE) et 48 s'en remettent au
-- paramètre de session. Tant que les deux valeurs coïncident, les deux groupes
-- s'accordent ; le jour où elles divergent, ils se contredisent EN SILENCE —
-- aucune erreur n'est levée, les écritures comptables changent de jour métier.
-- Ce fichier est le capteur de cette divergence.
--
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- T1: l'autorité (D1) — le fuseau est posé AU NIVEAU DE LA BASE, pour tous les
-- rôles (setrole = 0), et la colonne miroir porte exactement cette valeur.
-- On lit le réglage persistant plutôt que la session courante : un client de
-- test qui exporterait PGTZ ne doit pas pouvoir masquer une vraie divergence.
DO $$ DECLARE v_db_tz TEXT; v_col TEXT; BEGIN
  SELECT split_part(cfg, '=', 2) INTO v_db_tz
    FROM pg_db_role_setting s
    JOIN pg_database d ON d.oid = s.setdatabase,
         unnest(s.setconfig) AS cfg
   WHERE d.datname = current_database()
     AND s.setrole = 0
     AND cfg LIKE 'TimeZone=%';
  SELECT timezone INTO v_col FROM business_config WHERE id = 1;
  INSERT INTO _r VALUES ('t1_column_equals_database_default',
    v_db_tz IS NOT NULL AND v_col IS NOT NULL AND v_col = v_db_tz);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_column_equals_database_default', false);
END $$;

-- T2: la lettre de D4 — la colonne est égale au paramètre de session tel que
-- le voit RÉELLEMENT une connexion applicative (celle qui exécute ce fichier).
DO $$ DECLARE v_col TEXT; BEGIN
  SELECT timezone INTO v_col FROM business_config WHERE id = 1;
  INSERT INTO _r VALUES ('t2_column_equals_session',
    v_col = current_setting('TimeZone'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_column_equals_session', false);
END $$;

-- T3: la session tient son fuseau de la BASE, pas d'un override de connexion.
-- Sans cela T2 pourrait passer pour une mauvaise raison (client et colonne
-- accidentellement d'accord), et l'invariant ne prouverait plus rien.
DO $$ DECLARE v_src TEXT; BEGIN
  SELECT source INTO v_src FROM pg_settings WHERE name = 'TimeZone';
  INSERT INTO _r VALUES ('t3_source_is_database', v_src = 'database');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_source_is_database', false);
END $$;

-- T4: aucun override PAR RÔLE. Un ALTER ROLE <r> SET TimeZone ferait diverger
-- les seules connexions de ce rôle — exactement le mode de panne silencieux que
-- D1 déclare fermé, et que ni T1 ni T2 ne verraient depuis une autre session.
DO $$ DECLARE v_overrides INT; BEGIN
  SELECT count(*) INTO v_overrides
    FROM pg_db_role_setting s, unnest(s.setconfig) AS cfg
   WHERE s.setrole <> 0 AND cfg LIKE 'TimeZone=%';
  INSERT INTO _r VALUES ('t4_no_per_role_override', v_overrides = 0);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_no_per_role_override', false);
END $$;

-- T5: cohérence avec la constante client (D5). Les applications ne lisent pas
-- la configuration métier pour le fuseau : elles portent une constante. Si elle
-- s'écarte de la base, les bornes de période calculées côté client ne
-- désignent plus les mêmes journées que les RPC serveur.
DO $$ DECLARE v_col TEXT; BEGIN
  SELECT timezone INTO v_col FROM business_config WHERE id = 1;
  INSERT INTO _r VALUES ('t5_matches_client_constant', v_col = 'Asia/Makassar');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_matches_client_constant', false);
END $$;

SELECT plan(5);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_column_equals_database_default'), 'T1: mirror column equals the database-level TimeZone (D1)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_column_equals_session'),          'T2: mirror column equals the live session TimeZone (D4)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_source_is_database'),             'T3: session TimeZone comes from the database, not a client override');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_no_per_role_override'),           'T4: no per-role TimeZone override exists');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_matches_client_constant'),        'T5: value matches the single client constant (D5)');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
