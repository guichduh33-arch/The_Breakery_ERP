# security-auth — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Audit checklist
- Preventive checklists
- Sources de vérité (pointers)
- Verification before claiming an audit or fix is complete
- When to escalate

## Audit checklist

### A. REVOKE coverage

- [ ] Every SECURITY DEFINER RPC in `supabase/migrations/` has a companion REVOKE migration —
  grep `CREATE.*FUNCTION` vs `REVOKE EXECUTE` across migrations; any unpaired function is exposed.
- [ ] REVOKE pair includes BOTH `FROM PUBLIC, anon` AND `ALTER DEFAULT PRIVILEGES … FROM PUBLIC`.
  A migration that only does `REVOKE … FROM anon` is incomplete (see S19 corrective `_022`).
- [ ] Tables/views: `REVOKE ALL … FROM anon` on all append-only ledgers (`stock_movements`,
  `display_movements`, `b2b_payments`, `audit_logs`, `expense_approvals`). Verify `pg_class` ACL.
- [ ] `ALTER DEFAULT PRIVILEGES FOR ROLE postgres … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` was
  applied globally (S20 `_031`). Vérifier les ACL effectives et `pg_default_acl` ; le bookkeeping `schema_migrations` endommagé ne prouve pas l’état des droits.

### B. Permission gates

- [ ] Every new `SECURITY DEFINER` function calls `has_permission(auth.uid(), '…')` before any
  data mutation. Grep `SECURITY DEFINER` functions without a `has_permission` call.
- [ ] Every new `PermissionCode` added to `packages/supabase/src/rls/permissions.ts` has a
  corresponding seed row in a migration (grep the code literal in `supabase/migrations/`).
  Le **catalogue de codes** reste seedé par migration ; les **grants** ne le sont plus.
- [ ] `<PermissionGate>` wraps every new BO route that requires a perm.
- [ ] Toute RPC de mutation RBAC porte le **triple gate** (authentifié → `rbac.manage` → test
  de rôle `SUPER_ADMIN`) et respecte les verrous `super_admin_row_locked` /
  `super_admin_target_locked` (ADR-031).
- [ ] Aucun test pgTAP ne suppose la **matrice seedée** : `role_permissions` est de la donnée
  éditable à chaud depuis l'ADR-031 — épingler SUPER_ADMIN, poser les grants/overrides
  in-transaction, ou s'appuyer sur le catalogue `permissions`.

### C. PIN / header security

- [ ] No EF reads `manager_pin` (or any secret) from request body JSON — grep `body.*pin` or
  `req.json().*pin` across `supabase/functions/`.
- [ ] `auth-verify-pin` JWT consumed via `setSupabaseAccessToken` fetch wrapper, NOT raw
  `Authorization` header.

### D. Rate-limit wiring

- [ ] Any new mutating EF that can be triggered by external/unauthenticated callers calls
  `checkRateLimitDurable` with an appropriate bucket.
- [ ] La famille `record_rate_limit` est `service_role` only — jamais appelable depuis
  authenticated/anon. Vérifier le REVOKE dans `20260523000010` et sur la version vivante.

### E. Session timeout + idle

- [ ] `useIdleTimeout` is mounted in all new app roots / modal parents that handle authenticated
  flows (POS + BO main layouts).
- [ ] Any new role seeded in `roles` table includes a `session_timeout_minutes` value.

---

## Preventive checklists

### Before creating a new SECURITY DEFINER RPC

- [ ] `has_permission(auth.uid(), 'scope.action')` gate is the FIRST check in the function body.
- [ ] `audit_logs` INSERT with canonical cols: `actor_id / action / entity_type / entity_id / metadata`.
- [ ] REVOKE pair migration: `REVOKE EXECUTE … FROM PUBLIC, anon` + `ALTER DEFAULT PRIVILEGES … FROM PUBLIC`.
- [ ] New `PermissionCode` added to `permissions.ts` + seed migration in same block.
- [ ] Si la RPC exige un PIN manager : argument `p_manager_pin` (une RPC ne lit pas les
  en-têtes) **vérifié avec verrouillage** via `_verify_pin_with_lockout` — jamais un PIN
  simplement transporté.
- [ ] pgTAP covers: happy path + perm denied (P0003) + audit_log row — sans supposer la
  matrice de grants seedée (voir §RBAC éditable).

### Before relaxing an RLS policy or table ACL

- [ ] Identify the invariant the policy enforces (ledger append-only, balance correctness, etc.).
- [ ] Check whether relaxing creates an unauthenticated write path. If yes, block immediately.
- [ ] Write a regression pgTAP test for the invariant before touching the RLS.
- [ ] Reference: S25 `_014` relax `orders.session_id` NOT NULL caught a dormant S24 bug — every
  relaxation has the potential to surface a hidden constraint violation elsewhere.

### Before adding a new Edge Function

- [ ] Secret/PIN → `x-manager-pin` header (not body).
- [ ] Idempotency: either `getIdempotencyKey(req)` helper (flavor 1) or RPC `p_idempotency_key`
  arg (flavor 2) — pick per semantic, see AGENTS.md §Idempotency 2-flavors.
- [ ] Rate-limit: `checkRateLimitDurable` if the EF is externally callable.
- [ ] REVOKE: since EFs run as `service_role`, the concern is the underlying RPC — confirm REVOKE
  pair on the RPC itself.
- [ ] `audit_logs` with `action = '*.replay'` on idempotency replay hits.

---

## Sources de vérité (pointers)

```
ADR (décisions immuables — les lire avant de toucher au RBAC)
  docs/adr/031-rbac-editable-super-admin.md       # matrice + overrides éditables, SUPER_ADMIN only
  docs/adr/032-cycle-de-vie-des-roles.md          # créer / cloner / supprimer un rôle

Catalogue de codes de permission (closed set client, miroir du seed DB)
  packages/supabase/src/rls/permissions.ts

Migrations (security-critical, chronologique — noms de fichiers vérifiés le 2026-08-31)
  supabase/migrations/20260524000031_fix_revoke_public_execute_from_public_functions.sql  # S20 global sweep corrective
  supabase/migrations/20260523000010_create_record_rate_limit_v1_rpc.sql                  # S19 rate-limit RPC
  supabase/migrations/20260523000012_fix_record_rate_limit_v1_race.sql                    # S19 correctif race
  supabase/migrations/20260523000020_add_session_timeout_to_roles.sql                     # S19 per-role timeout
  supabase/migrations/20260523000022_fix_update_role_session_timeout_v1_revoke_anon.sql   # S19 corrective REVOKE anon
  supabase/migrations/20260602000013_fix_alter_default_privileges_public.sql              # S25 canonical template
  supabase/migrations/20260622000010_create_verify_pin_with_lockout_helper.sql            # PIN + lockout côté SQL
  supabase/migrations/20260813000004_seed_orders_refund_reprint_perms.sql                 # orders.refund / reprint_receipt
  supabase/migrations/20260825000001_seed_rbac_manage_permission.sql                      # ADR-031 rbac.manage
  supabase/migrations/20260825000002_fix_audit_role_permissions_actor_profile.sql         # actor_id = profil, pas auth.uid()
  supabase/migrations/20260825000003_create_set_role_permission_v1.sql                    # ADR-031 mutation matrice
  supabase/migrations/20260825000004_create_user_permission_override_rpcs.sql             # ADR-031 overrides
  supabase/migrations/20260825000006_bump_update_role_session_timeout_v2.sql              # ADR-031 (v1 DROPPÉE ici)
  supabase/migrations/20260825000007_create_role_v1.sql                                   # ADR-032 création + clone
  supabase/migrations/20260825000008_create_delete_role_v1.sql                            # ADR-032 suppression

Surface BO RBAC
  apps/backoffice/src/pages/settings/roles/          # RolesPage, RoleDetailPage
  apps/backoffice/src/features/settings/roles/       # hooks de mutation + matrice
  apps/backoffice/src/pages/settings/security/       # politique PIN uniquement (plus les timeouts)

EF shared helpers
  supabase/functions/_shared/idempotency.ts         # getIdempotencyKey(req)
  supabase/functions/_shared/rate-limit.ts          # checkRateLimitDurable
  supabase/functions/_shared/responses.ts           # rateLimitedResponse → 429 + Retry-After
  supabase/functions/_shared/manager-pin.ts         # verifyManagerPin + lockout par IP
  supabase/functions/auth-verify-pin/index.ts       # HS256 JWT issuance

Fetch wrapper PIN
  packages/supabase/src/client.ts                   # setSupabaseAccessToken

AGENTS.md §Critical patterns (anon defense-in-depth, transport du PIN, idempotency 2-flavors)
```

---

## Verification before claiming an audit or fix is complete

```bash
# Type check (always run first)
pnpm typecheck

# Auth/RBAC features — le filtre vitest matche le CHEMIN du fichier, pas le describe.
# `test rbac` ne matche RIEN (aucun test n'a « rbac » dans son chemin) : localiser par glob.
# Au 2026-08-31 la surface RBAC est sous features/settings/roles/__tests__/ et
# routes/__tests__/permission-gate.test.tsx — relever la liste vivante avant de conclure.
pnpm --filter @breakery/app-backoffice test settings/roles
pnpm --filter @breakery/app-backoffice test permission-gate
pnpm --filter @breakery/app-backoffice test auth

# pgTAP via MCP execute_sql (BEGIN/ROLLBACK envelope)
# Run: supabase/tests/idempotency_hardening.test.sql
# Run: supabase/tests/zreports.test.sql            (couvre le gate de permission de sign_zreport)
# Run: supabase/tests/set_role_permission_v1.test.sql        (ADR-031, triple gate + verrous)
# Run: supabase/tests/user_permission_override_rpcs.test.sql (ADR-031, overrides + audit)
# Run: supabase/tests/role_lifecycle_rpcs.test.sql           (ADR-032, création/clone/suppression)
# Run: supabase/tests/update_role_session_timeout_v2.test.sql

# Packages
pnpm --filter @breakery/utils test          # evaluatePinStrength unit tests
```

Les échecs liés à un environnement manquant se distinguent des régressions en comparant le même test sur la branche de référence. Aucun nombre historique ne prouve qu’un échec actuel est préexistant.

---

## When to escalate

- About to relax **any** RLS policy on a ledger table (`stock_movements`, `display_movements`,
  `b2b_payments`, `audit_logs`) → halt, almost always covers a latent bug elsewhere.
- New RPC where `anon` access might be intentional (public landing-page, embeddable widget) →
  document the explicit business reason + `COMMENT ON FUNCTION … IS 'anon-callable: <reason>'`.
- Changing the JWT algorithm or auth mechanism (HS256 → ES256, or adding OAuth) → full fetch
  wrapper audit required across POS + BO.
- EF body still reads a secret field AND there are external uncontrolled callers → dual-mode
  removal requires caller coordination, escalate before hard-cutover.
- Any finding where `REVOKE … FROM anon` was written without `FROM PUBLIC` in the same block →
  medium severity, ship a corrective migration immediately.
