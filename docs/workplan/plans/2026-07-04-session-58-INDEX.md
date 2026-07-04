# Session 58 — INDEX — Remise à plat Vague 0 : réparer ce qui trompe l'exploitant

> **Date :** 2026-07-04 · **Branche :** `swarm/session-58` (base master `5b0fa92` + commit docs `94c92e6`)
> **Plan source :** `docs/workplan/remise-a-plat/00-INDEX.md` §3 « Vague 0 » (4 items P0). Exécution : subagent-driven development (1 implémenteur + 1 reviewer par tâche, revue finale de branche : Ready to merge).

## Livré

### T1 — Stopper les échecs CI automatiques (fiche 24 D1.1, fiche 23 C-B1.3) — `0dc7855`
`staging-deploy.yml` (trigger push retiré) et `playwright-e2e.yml` (cron retiré) passent sur `workflow_dispatch` seul tant que staging n'est pas provisionné ; commentaires de réactivation pointant `STAGING_SETUP.md`. Plus aucun run rouge automatique.

### T2 — Labels mensongers (fiche 20 D1.1, fiche 19 D1.1) — `a6347e5`
Sidebar BO « RBAC Editor » → **« Permissions (read-only) »** ; 5 tuiles « (Soon) » du hub Settings reliées aux pages qui existaient déjà : Inventory Config → `settings/inventory`, Loyalty → `/loyalty`, Audit Log → `reports/audit`, Sections → `inventory/sections`, Financial/Accounting → `settings/accounting` (gating inchangé — délégué aux `PermissionGate` des routes, pattern du hub). `PermissionsMatrixPage` : titre déjà honnête, non modifié.

### T3 — Chaîne d'embauche réparée (fiche 01 D2.1 + D1.1) — `00e8af2`, `b0bb4b6`
- **`list_login_users_v1`** (migration `20260710000099`, appliquée cloud) : SECURITY DEFINER STABLE, actifs seulement, exposition minimale (id, full_name, rôle-label), ORDER BY + LIMIT 100, **anon-callable** (pré-auth) avec le trio S20 complet (REVOKE PUBLIC + GRANT anon/authenticated + `COMMENT 'anon-callable: …'`). Carve-out **nommé** dans `security_anon_grants.test.sql` + nouvelle suite `list_login_users.test.sql` (7/7 : grants, actifs seulement, pas de colonne sensible).
- **3 UserPicker dynamiques** (POS Login, POS UserPicker, BO UserPicker) via hook React-Query — un employé créé au BO apparaît au login sans redéploiement. États loading/erreur/vide gérés.
- **PIN = exactement 6 chiffres partout** (migration `20260710000100`, in-place depuis les corps live — DEV-S57-02) : `create_user_v1`, `reset_user_pin_v1`, `UserFormDialog` (4-8→6), copy POS, + `OpenShiftModal` (occurrence trouvée au grep). Types regénérés.

### T4 — Triage nightly pgTAP + live-RPC + drift types (fiche 23 D1 + D2) — `8982385`, `8afab77`, `04bb6c3`, `8a09de8`, `92d93a5`, `e67670a`, `72996b3`
Rapport détaillé : tableau 33/33 dans `.superpowers/sdd/task-4-report.md` (archivé au merge).
- **28/33 suites vertes** (12 déjà vertes post-S57, 16 réparées — staleness S50→S57 : repoints v1→v2/v3/v4/v11/v17, `role`→`role_code`, vocabulaire stations Spec B-1, fixtures sections/sessions, snapshot `{items:[…]}`, GRANT explicite `pg_temp.set_jwt_uid`).
- **3 quarantaines datées** dans `supabase/tests/_quarantine/` (glob nightly non-récursif) : `complete_order_v10_display` (v10 droppée, couvert par `s44_display_symmetry`+`sale_stock_unification`), `category_station_remap` (vocabulaire S34 retiré), `inventory_f1_lots` (infra lots abandonnée 2026-07-04).
- **2 rouges assumées, tests INTACTS** (tripwires) : `users` (F-1), `expenses` (F-4) — voir Findings.
- **Live-RPC réparé** (`8afab77`) : les `fetch failed` étaient un fallback silencieux vers `localhost:54321` (`VITE_SUPABASE_URL` non exportée dans le job) — ni la clé ni le secret. Preuve : nightly dispatché **run 28680835452 : 33 échecs → 4, zéro fetch failed**.
- **Drift types : nul** (regen post-T3 = diff vide) + pseudo-drift structurel corrigé (`--schema public` : la sortie CLI incluait `graphql_public`, absent de la sortie MCP commitée) — à confirmer au prochain nightly planifié.
- CLAUDE.md : dette « secret SUPABASE_SERVICE_ROLE_KEY manquant » périmée, corrigée (`04bb6c3`).
- **Correction d'attendu adjugée** : `purchasing_po` T_PO_06c `124300→122100` (l'ancien attendu = ×1.13, auto-contradictoire avec le `p_vat_rate := 0.11` du test et la politique NON-PKP PPN 11 %).

## Findings (à trancher / chantiers hors T4)

| # | Sév. | Finding | Fix suggéré |
|---|---|---|---|
| F-1 | **P0** | `delete_user_v1` : garde dernier-admin compte les admins `deleted_at IS NULL` **sans filtrer `is_active`** → le seed `SYS-CRON` (SUPER_ADMIN inactif) permet de supprimer le dernier admin réel (lockout administratif). Confirmé live. | `AND is_active = true` dans le sous-compte (migration in-place depuis le corps live) |
| F-2 | P2 | Contrat d'erreur oversell vitrine dégradé v10→v17 : P0002 (garde métier) → 23514 (CHECK brute `display_stock_quantity_check`). Oversell toujours bloqué mais POS/EF peuvent mal traduire. | Garde P0002 dans `_record_sale_stock_v1`, ou classification 23514 côté EF/POS |
| F-4 | **P1** | `_emit_expense_je` référence `EXPENSE_VAT_INPUT` (compte 1151 désactivé, NON-PKP ADR-003) dès `vat_amount > 0` → **toute approbation de dépense avec PPN saisie crasherait** (`mapping_key_unknown`). Bug latent (0 dépense TVA en base). | Fold `vat_amount` dans la ligne de charge (ADR-003) ou interdire `vat_amount>0` à la saisie |
| F-5 | P2 | `import_catalog_v1` : allowlist stations `{kitchen,barista,bakery,none}` désynchronisée de la CHECK live `{kitchen,barista,display,none}` → catégorie `display` inimportable, `bakery` passe la validation puis bute sur la contrainte. | Aligner l'allowlist (migration in-place) |
| — | P3 | `inventory_phase1_complete` : MANAGER a désormais `inventory.recipes.update` (évolution volontaire ?) — hors critère psql, signalé. | Statuer au prochain passage |

## Actions utilisateur
- **Optionnel (recommandé)** : `gh secret set SUPABASE_ANON_KEY --body "<anon key>"` — débloque ~45 tests anon-path du job live-RPC (aujourd'hui 401, plus des erreurs réseau).
- **À confirmer** : le fix drift `--schema public` au prochain nightly planifié (gh rate-limité en fin de session, pas de 2e dispatch).
- **Décision F-3/11 %** : la correction d'attendu purchasing_po suppose PPN 11 % (cohérent NON-PKP) — si 13 % était voulu, c'est la config à changer, pas le test.

## État attendu du prochain nightly post-merge
2 fichiers rouges assumés (`users`, `expenses` — tripwires F-1/F-4) · live-rpc en échecs d'assertions (staleness Vitest documentée §4c du rapport, pas réseau) · drift vert.

## Leçons durables
- **Pas de `BEGIN;`/`COMMIT;` dans les corps de migrations** appliqués via MCP `apply_migration` (déjà wrappé — le COMMIT interne termine la tx externe et affaiblit l'atomicité). Deux sessions de suite ont shippé le pattern.
- Le critère « rouge » du nightly pgTAP est le code de sortie psql (erreur SQL dure), pas les `not ok` — le critère de session `num_failed()=0` via MCP est plus strict.
- Workers de subagents : les rapports SendMessage peuvent router vers la session principale au lieu de l'orchestrateur — prévoir le relais contrôleur.

## Tests / validation
- pgTAP : 28/33 vertes preuve MCP `num_failed()=0` + suites T3 (`list_login_users` 7/7, `security_anon_grants`) ; nightly dispatché 28680835452 (33→4).
- Vitest : POS 541/546 (3 échecs pré-existants hors périmètre documentés), BO 706/707 (1 skip) au fil des tâches ; typecheck 6/6 ; suite complète monorepo re-passée au closeout (voir PR).
- Revues : 4 revues de tâche (T1/T2 sonnet, T3/T4 opus) toutes Approved ; revue finale de branche (fable) : **Ready to merge**, checklist pattern-guardian 10/10.
