# Session 50 — Spec — Vague 1 « cutover sain » (sécurité + drift + CI)

> Date: 2026-06-27 · Branch: `swarm/session-50` · Origin issue: drift #125 + triangulated audit synthesis
> (`docs/workplan/audits/2026-06-27-triangulated-audit-synthesis-and-completion-plan.md`).
> **Read-only after write — la spec est le contrat.**

## Scope (ce qui entre)

Vague 1 du plan de finition : durcissement transversal sans toucher au money-path. 6 items :

1. **Drift de déploiement #125** — réappliquer de façon idempotente les objets dispatch manquants sur le cloud dev + gate CI de dérive `schema_migrations`.
2. **Fermer les fuites confirmées** — `audit_log` view, MVs PII-financières, vues DEFINER désalignées, bucket storage `product-images` + test pgTAP récurrent.
3. **Gater les RPC compta/reports** — `has_permission` en tête de 5 RPCs (GL/TB/PL/BS/sales-by-hour) + pgTAP permission-denied. **Fix #1 par impact.**
4. **Gater routes/sidebar BO** — products, B2B (code dédié), settings/security (nouveau code) + gate interne `has_permission` dans `search_customers_v2`/`get_customer_v2` + retrait des casts morts `as PermissionCode`.
5. **Activer le filet CI** — workspace `supabase/tests`, job nightly live-RPC (service-role secret), flip `continue-on-error:false` sur `pgtap-pr`, gate de dérive `types.generated.ts`.
6. **Durcissement DB rapide** — `search_path` sur les fonctions « mutable » de l'advisor, index `orders(created_at DESC)` CONCURRENTLY, Leaked Password Protection (Auth).

## Hors scope (explicitement)

- **Money-path** : `complete_order_with_payment_v14`, prix de ligne, modifiers, B2B settlement, split tender — **Vague 2**.
- Réécriture de la doc de référence (`docs/reference/04-modules/*`) — findings de l'audit, traités plus tard.
- Phase 2 import (Sales + Expenses bulk).

## Réconciliation de drift (grounding live — IMPORTANT)

Le brief paraphrase les objets ; les **vrais objets source** (vérifiés dans `supabase/migrations/`) sont :
- mig `20260710000031` = **UPDATE de données** sur `categories.dispatch_station` (PAS `product_categories.default_dispatch_stations` — cette table/colonne n'existe pas).
- mig `20260710000041` = `_resolve_dispatch_stations_v1(uuid)` **interne** (préfixe `_`, REVOKE PUBLIC/anon/authenticated) sur `categories` — PAS `resolve_dispatch_stations_v1` public.
- mig `20260710000030` ajoute `categories.dispatch_station` ; `..040` ajoute `products.dispatch_stations` ; `..042/043` snapshot dans les RPCs order/product.

→ **Le db-engineer vérifie en live (MCP) lesquels de `030..043` ont réellement appliqué** et ne réapplique QUE les objets absents, en idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` / UPDATE re-runnable). Il ne crée aucun objet au nom paraphrasé du brief.

## Décisions d'architecture (patterns à appliquer)

- **RPC versioning monotone** : gate ajouté = `_vN+1` + `DROP FUNCTION _vN(<args>)` dans la même migration. Vérifier la version live + tous les call-sites (PostgREST + EF + app) avant bump.
- **anon defense-in-depth** : tout REVOKE EXECUTE sur fonction = aussi `REVOKE EXECUTE … FROM PUBLIC` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`.
- **Vues DEFINER / MV** : `ALTER VIEW … SET (security_invoker=on)` + `REVOKE SELECT … FROM authenticated, PUBLIC` ; pour MV PII-financière, `REVOKE ALL … FROM authenticated, PUBLIC`, GRANT ciblé role admin **seulement si** un call-site UI légitime le lit (vérifier AVANT de couper).
- **Numérotation migrations** : bloc `20260710000051..0NN` (le plus haut actuel = `..050`). Un **seul owner** (db-engineer) émet toutes les migrations pour éviter les races.
- **CONCURRENTLY** : `CREATE INDEX CONCURRENTLY` ne peut PAS tourner dans le wrapper transactionnel d'`apply_migration` → exécuter via `execute_sql` hors transaction (ou `IF NOT EXISTS`), documenter en déviation.
- **Leaked Password Protection** : réglage Auth (dashboard / Management API), pas du SQL — si non automatisable via MCP, escalader à « main » comme action manuelle.
- **Permissions seedées** : nouveaux codes `b2b.read` et `settings.security.manage` → seed + grant aux rôles porteurs (vérifier les codes réels dans `permissions`/`role_permissions` avant ; réutiliser `products.read`/`inventory.read` existants pour le reste).

## Critères d'acceptance par item

- **A1 (drift)** : tous les objets dispatch de `030..043` présents en live (vérif SQL avant/après) ; aucun call-site master cassé ; job CI compare `schema_migrations` local↔cloud et échoue sur dérive.
- **A2 (fuites)** : `audit_log` + MVs financières + vues visées non SELECT-ables par `authenticated`/`anon` (sauf gate explicite) ; bucket `product-images` privé + listing interdit ; **test pgTAP récurrent** vert qui asserte l'absence de fuite.
- **A3 (RPC compta)** : un rôle sans la permission reçoit `permission denied` (RAISE) sur les 5 RPCs ; pgTAP permission-denied vert ; versions bumpées + call-sites OK.
- **A4 (routes/sidebar)** : routes+items products/B2B/settings-security gatés sur le bon code ; `search_customers_v2`/`get_customer_v2` refusent sans permission ; 12 casts `as PermissionCode` retirés ; `pnpm --filter @breakery/backoffice typecheck` vert.
- **A5 (CI)** : `supabase/tests` dans le workspace ; nightly lance les ~62 tests live-RPC avec secret ; `pgtap-pr` en `continue-on-error:false` ; gate `types.generated.ts` (gen + `git diff --exit-code`).
- **A6 (hardening)** : 0 « Function Search Path Mutable » résiduel à l'advisor (re-run pour la liste exacte) ; index `orders(created_at DESC)` présent ; Leaked Password Protection activé OU escaladé.

## Références

- Audit synthèse : `docs/workplan/audits/2026-06-27-triangulated-audit-synthesis-and-completion-plan.md`
- Findings bruts : `docs/workplan/audits/2026-06-27-project-state-and-gaps-findings.md`
- Drift source : `supabase/migrations/20260710000030..043_*.sql`
- Patterns : CLAUDE.md §Critical patterns (anon defense-in-depth S20, RPC versioning, S25 PIN/idempotency).
