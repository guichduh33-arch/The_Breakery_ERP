---
name: db-migrations
description: >-
  Migrations/RPC Breakery : versionnement, corps live, numérotation, droits PUBLIC/anon, types et pgTAP sur Supabase cloud V3. Avant tout changement de schéma ou de signature ; invariants métier dans le skill du domaine.
---

Périmètre : supabase/migrations et packages/supabase/src/types.generated.ts, avant toute écriture SQL de schéma ou de RPC. Le choix de ce skill vient de la tâche ; les chemins sont des repères de lecture, pas un hook automatique. Associer [security-auth](../security-auth/SKILL.md) pour le sens des droits et le skill métier concerné pour les invariants.

# DB Migrations & RPC Hygiene — The Breakery ERP

Appliquer AGENTS.md et les invariants du domaine concerné. Vérifier le schéma et le corps live avant toute affirmation sur une RPC ; la lecture du skill ne déclenche pas de sous-agent.

## The 8 rules you must not break

1. **Cloud V3 only — Docker is retired.** Apply/query/regen via MCP against `ikcyvlovptebroadgtvd`:
   - `apply_migration` du connecteur Supabase disponible (name snake_case, body = SQL)
   - `execute_sql` (pgTAP inside a `BEGIN … ROLLBACK` envelope)
   - `generate_typescript_types`
   - **NEVER** `pnpm db:reset`, `supabase start/db reset`, `bash supabase/tests/run_pgtap.sh` — they need Docker and fail.

2. **Never edit a published `_vN` signature.** Create `_vN+1` **and** `DROP FUNCTION public.<name>_vN(<exact old args>)` in the **same** migration. Bump nearly every session — always check the highest live version + the call-site first.

3. **Copy an RPC body from the LIVE definition** (`pg_get_functiondef`), never from the original migration file — cloud↔git drift is real (lesson DEV-S57-02).

4. **REVOKE pair (anon defense-in-depth).** Supabase auto-grants EXECUTE to `anon` via PUBLIC; `REVOKE … FROM anon` alone is INSUFFICIENT. Every admin RPC needs the trio:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM anon;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ```
   Vérifier le rôle effectivement utilisé par l’EF : une RPC appelée sous JWT utilisateur exige le grant correspondant ; une RPC de reversal réservée à service_role ne doit pas devenir appelable par authenticated. Ne pas recopier un GRANT générique.

5. **No `BEGIN;` / `COMMIT;` in a migration body.** MCP `apply_migration` already wraps it in a transaction; an inner COMMIT ends it early and weakens atomicity (lesson S58).

6. **Monotonic numbering.** Check the highest NAME-block in `supabase/migrations/` before picking the next (`20260710000NNN`). Cloud `version`s are clock-assigned; local file names use the NAME-block.

7. **Always regen types after any schema change** → write to `packages/supabase/src/types.generated.ts` and commit. A missing regen is the **#1 cause of broken CI** on this repo. If a bump is behaviour-only (no signature/column change), tag it `[types-noop]` in the migration name.

8. **Append-only ledgers stay append-only.** `stock_movements`, `audit_logs`, `b2b_payment_allocations` — writes only through SECURITY DEFINER RPCs; never relax the RLS that revokes UPDATE/DELETE.

## Before you commit a migration — checklist
- [ ] Highest migration number checked; new name monotonic.
- [ ] If replacing an RPC: `_vN+1` created **and** old `_vN` dropped, body from live.
- [ ] REVOKE trio present for any non-public RPC; grants adaptés au rôle réellement utilisé par l’appelant.
- [ ] No `BEGIN/COMMIT` in the body.
- [ ] Types regenerated + committed (or `[types-noop]`).
- [ ] pgTAP added/updated and run live via `execute_sql` (BEGIN…ROLLBACK); contrôles money-path concernés localisés dans `supabase/tests/` si une vente est touchée.
- [ ] Call-sites (hooks/EF) repointed to the new version.
