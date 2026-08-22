-- supabase/tests/realtime_publication_orders.test.sql
--
-- Lot E de l'audit POS Waiter du 2026-08-22 — le filet de la panne du lot A.
--
-- CE QUI S'ÉTAIT PASSÉ : `order_items` n'appartenait à AUCUNE publication. Trois
-- hooks s'y abonnaient pourtant en `postgres_changes` (useTabletOrderStatusListener,
-- useKdsRealtime, usePickedUpOrderSync). Deux survivaient par sondage et
-- masquaient la panne ; le troisième — le retour cuisine → salle — était
-- entièrement mort. La migration 20260822000001 l'a réparé.
--
-- POURQUOI LES TESTS EXISTANTS NE POUVAIENT PAS L'ATTRAPER : ils remplacent le
-- client Supabase par un faux et rejouent le callback à la main. Ils éprouvent la
-- logique de tri et de déduplication, jamais le transport. Un abonnement à une
-- table non publiée est vert dans un test mocké et muet en production.
--
-- Ce fichier interroge le catalogue, pas un mock. C'est le seul endroit du dépôt
-- où l'appartenance à la publication est une assertion.
--
-- Jumeau de realtime_publication_settings.test.sql (même patron temp-table).
-- Run via MCP execute_sql (BEGIN..ROLLBACK porté par ce fichier).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- T1: `order_items` est publiée — sans quoi le toast « Item ready » de la
-- tablette ne peut pas se déclencher, et le KDS retombe sur son sondage 30 s.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t1_order_items_published',
    EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public' AND tablename = 'order_items'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_order_items_published', false);
END $$;

-- T2: `orders` l'est aussi (depuis 20260618000022) — la réception caisse
-- (usePendingTabletOrders) et l'occupation des tables en dépendent.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t2_orders_published',
    EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public' AND tablename = 'orders'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_orders_published', false);
END $$;

-- T3: garde-fou — la RLS reste active sur les deux tables publiées. Realtime
-- filtre les événements par la politique SELECT : une table publiée SANS RLS
-- diffuserait chaque ligne de commande à tout porteur de JWT.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t3_rls_still_enabled',
    (SELECT bool_and(relrowsecurity) FROM pg_class
      WHERE oid IN ('public.orders'::regclass,
                    'public.order_items'::regclass)));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_rls_still_enabled', false);
END $$;

-- T4: REPLICA IDENTITY — le filtre `kitchen_status=eq.ready` et la lecture de
-- `payload.new.name_snapshot` portent sur les NOUVELLES valeurs, que le WAL
-- écrit intégralement quel que soit le réglage. 'n' (nothing) est le seul qui
-- casserait la diffusion : on l'exclut sans imposer 'full', qui doublerait le
-- volume WAL pour un `old_record` qu'aucun abonné ne lit.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t4_replica_identity_not_nothing',
    (SELECT bool_and(relreplident <> 'n') FROM pg_class
      WHERE oid IN ('public.orders'::regclass,
                    'public.order_items'::regclass)));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_replica_identity_not_nothing', false);
END $$;

-- Agrégat : 'ok N' si tout passe, sinon la liste des assertions en échec.
SELECT CASE
  WHEN (SELECT count(*) FROM _r WHERE NOT pass) = 0
    THEN 'ok ' || (SELECT count(*) FROM _r)::text
  ELSE 'FAIL: ' || (SELECT string_agg(name, ', ') FROM _r WHERE NOT pass)
END AS result;

ROLLBACK;
