-- supabase/tests/security_audit_lot1.test.sql
-- Non-régression des trois P0 corrigés le 2026-08-31 (audit lot 1 : skills
-- security-fraud-guard et expense-governance).
--
-- Ces trois défauts ont un point commun : ils sont INVISIBLES à la lecture du code
-- applicatif et à la relecture d'une migration. Deux d'entre eux étaient déjà des
-- régressions silencieuses d'un correctif antérieur. D'où ce fichier.
--
--   T1-T3 : `verify_user_pin` n'est exécutable QUE par service_role.
--           Oracle bcrypt sans lockout / rate-limit / audit. La faille n°7 du
--           2026-05-31 avait été fermée côté appelants, jamais côté GRANT.
--   T4    : `view_b2b_invoices` porte `security_invoker`.
--           Un `CREATE OR REPLACE VIEW` sans la clause `WITH` l'efface EN SILENCE —
--           c'est exactement ce qu'a fait 20260808000001. `pg_class.reloptions` fait
--           foi, jamais le COMMENT (celui posé en 2026-08-08 mentait).
--   T5-T7 : la policy UPDATE de `expenses` est bornée au brouillon de son auteur,
--           et porte un WITH CHECK. Sans WITH CHECK, un UPDATE nu promeut une
--           dépense en `approved` sans SOD, sans PIN et sans écriture comptable.
--
-- Run via MCP execute_sql wrap BEGIN/ROLLBACK ; pgtap est pré-créée sur V3 dev.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- ---------------------------------------------------------------------------
-- T1-T3 — verify_user_pin : service_role only
-- ---------------------------------------------------------------------------

SELECT is(
  has_function_privilege('authenticated', 'public.verify_user_pin(uuid,text)', 'EXECUTE'),
  false,
  'T1: verify_user_pin is NOT executable by authenticated (brute-force oracle)'
);

SELECT is(
  has_function_privilege('anon', 'public.verify_user_pin(uuid,text)', 'EXECUTE'),
  false,
  'T2: verify_user_pin is NOT executable by anon'
);

-- Contrôle positif : les trois Edge Functions (manager-pin, auth-verify-pin,
-- auth-change-pin) passent par un client service_role. Ce test échoue si un REVOKE
-- futur est écrit trop large et casse l'authentification par PIN.
SELECT is(
  has_function_privilege('service_role', 'public.verify_user_pin(uuid,text)', 'EXECUTE'),
  true,
  'T3: verify_user_pin IS still executable by service_role (the three edge functions)'
);

-- ---------------------------------------------------------------------------
-- T4 — view_b2b_invoices : security_invoker
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT 'security_invoker=true' = ANY (c.reloptions)
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'view_b2b_invoices'),
  true,
  'T4: view_b2b_invoices has security_invoker=true (a CREATE OR REPLACE VIEW without the WITH clause silently drops it)'
);

-- ---------------------------------------------------------------------------
-- T5-T7 — expenses : la policy UPDATE est bornée
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expenses' AND cmd = 'UPDATE'),
  1,
  'T5: expenses has exactly one UPDATE policy'
);

-- La policy ne doit PAS ouvrir sur une permission large : toute transition de statut
-- passe par les RPC SECURITY DEFINER, qui portent la SOD, le PIN et la JE.
SELECT is(
  (SELECT bool_or(qual ILIKE '%expenses.manage%') FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expenses' AND cmd = 'UPDATE'),
  false,
  'T6: the expenses UPDATE policy does NOT grant blanket access to expenses.manage holders'
);

-- Sans WITH CHECK, USING ne valide que la ligne AVANT modification : un brouillon
-- peut alors être promu en `approved` par un UPDATE nu.
SELECT is(
  (SELECT bool_and(with_check IS NOT NULL AND with_check ILIKE '%draft%') FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expenses' AND cmd = 'UPDATE'),
  true,
  'T7: the expenses UPDATE policy has a WITH CHECK pinning the resulting row to draft'
);

SELECT * FROM finish();

ROLLBACK;
