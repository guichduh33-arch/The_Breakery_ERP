-- supabase/tests/orders_read_policy_is_deliberately_broad.test.sql
--
-- Audit POS Waiter du 2026-08-22, lot C (a) — la lecture des commandes.
--
-- Arbitrage du propriétaire du 2026-08-22 : version allégée, chaque serveur
-- peut ouvrir toutes les commandes. `tablet_waiter_own_pending` prétendait
-- cloisonner et ne cloisonnait rien — deux politiques PERMISSIVES se combinent
-- par OU, et `auth_read` accordait déjà tout. Elle est retirée.
--
-- Ce filet ne tient pas « la lecture est large » — ça, c'est le défaut d'une
-- table sans politique restrictive, et rien à tester. Il tient les DEUX choses
-- qui rendent cette largeur acceptable :
--
--   1. les ÉCRITURES restent fermées (T3) — c'est le seul rempart qui compte
--      une fois la lecture ouverte ;
--   2. la règle est ÉCRITE là où on la lit (T4) — une politique muette
--      laisserait le prochain audit reconclure à un cloisonnement absent.
--
-- T1 empêche la politique décorative de revenir par une fusion écrasante.

BEGIN;
SELECT plan(5);

-- T1 — la politique qui mentait ne revient pas.
SELECT is_empty(
  $$ SELECT 1 FROM pg_policy
      WHERE polrelid = 'public.orders'::regclass
        AND polname = 'tablet_waiter_own_pending' $$,
  'T1 — tablet_waiter_own_pending est retirée de orders'
);

-- T2 — il ne reste qu'une seule porte de lecture. Deux politiques SELECT
-- permissives sur la même table, c'est exactement le piège d'origine.
SELECT is(
  (SELECT count(*) FROM pg_policy
    WHERE polrelid = 'public.orders'::regclass AND polcmd = 'r'),
  1::bigint,
  'T2 — orders ne porte qu''une politique SELECT'
);

-- T3 — le rempart réel. Aucune écriture directe : tout passe par les RPC
-- SECURITY DEFINER. Si cette assertion tombe, la lecture large cesse d'être
-- acceptable le jour même.
SELECT is(
  (SELECT count(*) FROM pg_policy
    WHERE polrelid IN ('public.orders'::regclass, 'public.order_items'::regclass)
      AND polcmd <> 'r'),
  0::bigint,
  'T3 — aucune politique INSERT/UPDATE/DELETE sur orders ni order_items'
);

-- T4 — la règle est écrite à l'endroit où elle s'applique, et elle se nomme.
SELECT matches(
  (SELECT obj_description(pol.oid, 'pg_policy')
     FROM pg_policy pol
    WHERE pol.polrelid = 'public.orders'::regclass AND pol.polname = 'auth_read'),
  'DÉLIBÉRÉE',
  'T4 — la politique survivante porte le commentaire qui assume la lecture large'
);

-- T5 — RLS reste activée. Le retrait d'une politique n'est pas le retrait de
-- la sécurité de niveau ligne.
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.orders'::regclass),
  true,
  'T5 — RLS reste activée sur orders'
);

SELECT * FROM finish();
ROLLBACK;
