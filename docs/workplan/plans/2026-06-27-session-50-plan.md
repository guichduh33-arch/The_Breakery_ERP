# Session 50 — Plan — Vague 1 (waves + ownership)

> Spec: `docs/workplan/specs/2026-06-27-session-50-spec.md` · Branch: `swarm/session-50`
> Migration block: `20260710000051..0NN` (highest existing = `..050`).

## Ownership & coordination

- **db-engineer** (solo owner de TOUTES les migrations — évite les races de numérotation).
- **backoffice-specialist** (UI routes/sidebar — item 4 app-side) — démarre quand db-engineer a seedé les codes.
- **test-engineer** (pgTAP récurrents + CI nets — items 2/3/4-tests/5) — démarre quand db-engineer a livré objets + versions RPC.
- Pipeline : `db-engineer → (backoffice-specialist ∥ test-engineer) → coordinator (closeout)`.
- db-engineer envoie en fin de W1 : liste migrations, **codes de permission seedés**, **versions RPC finales**, statut drift.

---

## Wave 1 — DB (db-engineer, séquentiel, MCP cloud `ikcyvlovptebroadgtvd`)

Un fichier migration par item, numérotation monotone à partir de `20260710000051`.

- [ ] **W1.1 Drift reapply** (`20260710000051_reapply_dispatch_drift.sql`)
  - Vérifier en live (MCP `execute_sql`) lesquels de `030..043` ont appliqué (pg_proc, information_schema.columns, `categories.dispatch_station`).
  - Réappliquer SEULEMENT les absents, idempotent : colonnes via `ADD COLUMN IF NOT EXISTS`, fonctions via `CREATE OR REPLACE` + paire REVOKE, mapping `031` via UPDATE re-runnable. Cible les **vrais** objets (`_resolve_dispatch_stations_v1`, `categories.dispatch_station`).
  - Vérif après : tous objets présents ; `SELECT _resolve_dispatch_stations_v1(<un product_id réel>)` renvoie un array sensé.
  - ⚠️ Si un objet attendu absent ENTRE EN CONFLIT (déjà présent sous une autre forme) → STOP + SendMessage to coordinator.
- [ ] **W1.2 Gate RPC compta/reports** (`20260710000052_gate_financial_report_rpcs.sql`)
  - Pour `get_general_ledger_v1`, `get_trial_balance_v1`, `get_profit_loss_v1`, `get_balance_sheet_v1`, `get_sales_by_hour_v1` : récupérer la déf live (`pg_get_functiondef`), créer `_vN+1` avec en-tête `IF NOT has_permission(auth.uid(), '<code>') THEN RAISE EXCEPTION 'permission denied: <code>' USING ERRCODE='42501'; END IF;`, `DROP FUNCTION _vN(<args>)`.
  - **Codes** : vérifier les codes réels seedés (`accounting.gl.read`, `accounting.tb.read`, `reports.financial.read`, ou fallback `accounting.read`/`reports.read` si les granulaires n'existent pas — utiliser l'existant, ne pas inventer). PL/BS → `reports.financial.read` ; sales-by-hour → `reports.read` (à confirmer).
  - Vérifier call-sites (app/EF/PostgREST) qui appellent un numéro de version → bumper le call-site OU garder le nom non versionné si wrappé. **Ne pas casser le call-site.**
- [ ] **W1.3 Seed permissions** (`20260710000053_seed_b2b_settings_security_perms.sql`)
  - Seed `b2b.read` (grant aux rôles qui voient le B2B Dashboard/Payments) + `settings.security.manage` (grant ADMIN+ uniquement). Idempotent (`ON CONFLICT DO NOTHING`). Confirmer la forme exacte des tables `permissions`/`role_permissions` avant.
- [ ] **W1.4 Gate interne customer RPCs** (`20260710000054_gate_customer_search_rpcs.sql`)
  - `search_customers_v2` + `get_customer_v2` → `_vN+1` avec en-tête `has_permission(auth.uid(),'customers.read')` (ou code réel). DROP ancienne. Vérifier call-sites POS/BO.
- [ ] **W1.5 Fermer les fuites** (`20260710000055_close_definer_view_mv_leaks.sql`)
  - `audit_log` : `ALTER VIEW … SET (security_invoker=on)` + `REVOKE SELECT … FROM authenticated, PUBLIC`.
  - `mv_pl_monthly`, `mv_sales_daily`, `mv_stock_variance` : `REVOKE ALL … FROM authenticated, PUBLIC`. **AVANT de couper** : grep call-sites BO (`from('mv_…')`) — si UI admin légitime lit, GRANT ciblé au role admin + STOP/notify si doute.
  - `v_product_available_stock`, `view_product_allergens_resolved` : `SET (security_invoker=on)` (+ REVOKE si DEFINER fuite PII).
  - Bucket storage `product-images` → privé + policy interdisant le listing anon/authenticated (via `storage.buckets`/`storage.objects` policies ou Management API).
- [ ] **W1.6 Hardening DB** (`20260710000056_search_path_index_hardening.sql`)
  - Re-run advisor `get_advisors(security)` → liste exacte des « Function Search Path Mutable » → `ALTER FUNCTION … SET search_path = public, pg_temp` pour chacune.
  - Index `orders(created_at DESC)` : `CREATE INDEX CONCURRENTLY IF NOT EXISTS … ` **hors** wrapper transactionnel (via `execute_sql`, pas `apply_migration`) — documenter en déviation.
  - Leaked Password Protection (Auth) : activer via Management API/MCP si possible, sinon **escalader à coordinator** comme action manuelle.
- [ ] **W1.7 Regen types** : `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts` + vérifier `git diff`.
- [ ] **W1.8** SendMessage to `coordinator` (et CC `backoffice` + `tester`) : migrations créées, codes seedés, versions RPC finales, statut drift, items escaladés.

## Wave 2a — UI gates (backoffice-specialist, après W1.3)

- [ ] Routes + sidebar items `products` sous `products.read` (ou `inventory.read` — code réel confirmé par db-engineer).
- [ ] B2B Dashboard/Payments sous `b2b.read` (au lieu de `customers.read`).
- [ ] `settings/security` sous `settings.security.manage`.
- [ ] Retirer les 12 casts morts `as PermissionCode` dans `apps/backoffice/src/.../Sidebar.tsx`.
- [ ] `pnpm --filter @breakery/backoffice typecheck` vert. SendMessage to coordinator.

## Wave 2b — Tests + CI (test-engineer, après W1.1-1.6)

- [ ] **pgTAP récurrent fuites** (`supabase/tests/security_leak_guard.test.sql`) : asserte qu'aucune vue SECURITY DEFINER / MV PII-financière n'est SELECT-able par `authenticated`/`anon` sans gate (catalogue dynamique via `pg_views`/`pg_matviews` + `has_table_privilege`).
- [ ] **pgTAP permission-denied** : les 5 RPCs compta/reports + `search_customers_v2`/`get_customer_v2` RAISE pour un rôle sans permission (BEGIN…ROLLBACK, `SET LOCAL role`).
- [ ] **CI** : ajouter `supabase/tests` au `pnpm-workspace.yaml` ; nightly (`pgtap-nightly.yml`) lance les ~62 tests live-RPC avec `SUPABASE_SERVICE_ROLE_KEY` secret ; flip `continue-on-error:false` sur `pgtap-pr.yml` ; gate `types.generated.ts` (gen via MCP/CLI + `git diff --exit-code`) ; gate de dérive `schema_migrations` (compare local↔cloud).
- [ ] SendMessage to coordinator.

## Wave 3 — Closeout (coordinator)

- [ ] `pnpm typecheck` full + ciblés.
- [ ] INDEX `docs/workplan/plans/2026-06-27-session-50-INDEX.md` (migrations, tests, perms, déviations DEV-S50-*).
- [ ] Bump CLAUDE.md §Active Workplan (#125 → session-50).
- [ ] PR Vague 1 (squash-merge par phase si besoin).
- [ ] SendMessage to `main` : récap par item, n° PR, liste migrations.
