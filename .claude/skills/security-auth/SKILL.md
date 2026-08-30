---
name: security-auth
description: >-
  Security & auth expert — RLS, REVOKE/anon defense-in-depth, permission gates, PIN JWT
  fetch wrapper, durable rate-limit, per-role session timeout. Audits security posture AND
  guides auth changes. Use this skill whenever the task mentions RLS, REVOKE, GRANT, anon,
  permission / has_permission / role_permissions / RBAC / PermissionGate, PIN, lockout,
  JWT, rate limit, session timeout, SECURITY DEFINER, login / connexion, role / rôle,
  security / sécurité, auth / authentification — or touches apps auth/rbac features,
  Settings Security pages, supabase functions auth-*, or migrations touching
  rls/permission/rate_limit. Boundary vs security-fraud-guard: THIS skill owns the auth
  MECHANICS (how to build a correct RLS policy / RPC gate / REVOKE pair, the PIN-JWT fetch
  wrapper, rate-limit, session timeout); for the cross-cut FRAUD/MONEY/PII/audit-log
  AUDIT ("qui peut faire quoi", refund/void/discount/cash abuse, data-leak surfaces) →
  security-fraud-guard. Invoke it BEFORE creating any new RPC gate, granting anything
  to anon/authenticated, or relaxing RLS — even for a one-line migration.
pathPatterns:
  - 'apps/*/src/features/auth/**'
  - 'apps/backoffice/src/features/settings/roles/**'
  - 'apps/backoffice/src/pages/settings/security/**'
  - 'apps/backoffice/src/pages/settings/roles/**'
  - 'packages/supabase/src/rls/**'
  - 'supabase/migrations/*rls*.sql'
  - 'supabase/migrations/*permission*.sql'
  - 'supabase/migrations/*rate_limit*.sql'
  - 'supabase/functions/auth-*/**'
  - 'supabase/functions/kiosk-issue-jwt/**'
promptSignals:
  phrases:
    - 'RLS'
    - 'REVOKE'
    - 'anon'
    - 'permission'
    - 'has_permission'
    - 'role_permissions'
    - 'PIN'
    - 'JWT'
    - 'rate limit'
    - 'session timeout'
    - 'RBAC'
    - 'SECURITY DEFINER'
    - 'defense in depth'
---

# Security & Auth — The Breakery ERP

Expert on the security and auth surface: RLS, REVOKE/anon defense-in-depth, permission gates,
PIN JWT fetch wrapper, durable Postgres rate-limit, per-role session timeout. Two use cases:

1. **Audit** the existing auth/security posture for gaps, regressions, and missing REVOKE pairs.
2. **Guide** future changes (new RPC, new perm, new EF, RLS relaxation, auth mechanism change).

**`CLAUDE.md` est la source de vérité** for project-wide critical patterns. This skill adds
security-specific mental models, exact SQL blocks (verified from migrations), audit checklists,
and preventive guidance that CLAUDE.md doesn't carry at this level of detail.

> **Contenu re-vérifié contre le code le 2026-08-31.** Ce qui suit décrit l'état constaté
> à cette date. Les RPC bumpent : une famille est citée sans numéro de version — vérifier
> la version vivante dans `supabase/migrations/` (numéro NAME-block le plus haut) **et** au
> call-site avant de te fier à un `_vN` lu ailleurs. Les comptages sont datés ou renvoyés
> à leur source ; recompter plutôt que citer.

---

## Mental model — Anon defense-in-depth (S20)

Supabase **auto-grants EXECUTE** on all `public` functions to `anon` AND `authenticated` via
`ALTER DEFAULT PRIVILEGES … TO anon`. This means:

> `REVOKE EXECUTE … FROM anon` alone is **insufficient** — anon still inherits EXECUTE through
> its PUBLIC membership (`=X/postgres` ACL entry).

The S20 sweep (`20260524000031`) established the canonical two-statement **REVOKE pair** that
every new SECURITY DEFINER RPC MUST include in its companion REVOKE migration:

```sql
REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

(Verified verbatim from `20260524231054_revoke_pair_get_payments_by_method_v1.sql`.)

The `ALTER DEFAULT PRIVILEGES` line future-proofs new postgres-owned functions so they don't
inherit PUBLIC EXECUTE. It is idempotent — safe to repeat in every migration, and is the
canonical template since S25 (`20260602000013`).

**Extension objects** (`supabase_admin`-owned): pgTAP helpers (`pg_all_foreign_keys`,
`tap_funky`, etc.) are platform-managed and not user-revocable. pgTAP test files exclude them.

---

## Mental model — Permission gates

`packages/supabase/src/rls/permissions.ts` is the **canonical client-side closed set** of
`PermissionCode`. Every permission **code** must have a matching entry here **and** a seed
migration — the *catalogue* of codes is still closed and migration-owned (ADR-031, «ce que
cette décision ne tranche pas»). What is **no longer** migration-owned is who *holds* them:
see «RBAC éditable» below. The pattern in every SECURITY DEFINER RPC:

```sql
IF NOT has_permission(auth.uid(), 'scope.action') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0003';
END IF;
```

- **Server-side**: `has_permission(auth.uid(), 'scope.action')` in SECURITY DEFINER functions.
- **Client-side**: `hasPermission(userPermissions, 'scope.action')` (`packages/supabase/src/rls/permissions.ts`) consumed via `authStore` in BO + POS.
- **UI gate (BO)**: `<PermissionGate permission="scope.action">` wraps routes + sidebar entries.

Key permission families (relevé du 2026-08-31 sur `permissions.ts` — recompter à la source
plutôt que citer ce relevé) :
- `accounting.{coa.read, coa.write, gl.read, tb.read, je.create_manual, period.close, …}`
- `zreports.{read, sign, void}`
- `orders.{read, edit_open, void, refund, reprint_receipt}` — `refund` / `reprint_receipt`
  seedés par `20260813000004_seed_orders_refund_reprint_perms.sql`
- `expenses.{thresholds.read, thresholds.write, …}`
- `display.{read, manage}` — display-stock isolation
- `rbac.{read, manage}` — `rbac.manage` seedé pour le seul SUPER_ADMIN (ADR-031)
- `inventory.*` — famille granulaire (opname, production, réservation, coût…) : la liste
  vivante se lit dans `permissions.ts`, section `inventory.*`.

---

## Mental model — RBAC éditable : codes seedés, grants en DONNÉE (ADR-031 / ADR-032)

Depuis le 2026-08-25, le RBAC n'est plus « un seed figé ». La distinction qui compte :

| Objet | Statut | Comment ça change |
|---|---|---|
| **Codes** de permission (`permissions`) | catalogue **fermé**, seedé | migration + entrée `PermissionCode` |
| **Grants** rôle × permission (`role_permissions`) | **DONNÉE éditable à chaud** | écran BO, RPC `set_role_permission` |
| **Overrides** par utilisateur (`user_permission_overrides`) | **DONNÉE**, GRANT ou DENY, raison + expiration | RPC `set_user_permission_override` / `delete_user_permission_override` |
| **Rôles** eux-mêmes (`roles`) | **cycle de vie** : créer / cloner / supprimer | RPC `create_role` / `delete_role` (ADR-032) |
| **Timeout** de session d'un rôle | éditable dans la fiche rôle | RPC `update_role_session_timeout` |

Lire **ADR-031** (`docs/adr/031-rbac-editable-super-admin.md`) et **ADR-032**
(`docs/adr/032-cycle-de-vie-des-roles.md`) avant de toucher à cette surface.

**Gate des RPC de mutation RBAC = triple**, dans cet ordre : `auth.uid()` non NULL →
`has_permission(uid, 'rbac.manage')` → **test de rôle** `role_code = 'SUPER_ADMIN'`. Le test de
rôle est le vrai verrou : ADMIN et SUPER_ADMIN portent aujourd'hui les mêmes permissions, donc
une permission seule ne peut pas exprimer « super admin uniquement ».

**Garde-fous gravés** (ne pas les affaiblir sans nouvel ADR) :
- ligne SUPER_ADMIN de la matrice **immuable** (`super_admin_row_locked`) — anti-lockout ;
- **aucun override ne cible un profil SUPER_ADMIN** (`super_admin_target_locked`) ;
- mutations de matrice en **INSERT/DELETE strict**, jamais `UPDATE is_granted` : le trigger
  d'audit ne couvre que INSERT/DELETE ;
- rôles `is_system` (SUPER_ADMIN, ADMIN, MANAGER, CASHIER) ni supprimables ni renommables ;
  suppression bloquée tant que le rôle est porté ; le clone ne copie jamais `rbac.manage` ;
- `has_permission` est un pur lookup à cascade (DENY user → grant de rôle → GRANT user → refus
  par défaut) : **un rôle neuf ou un grant neuf prend effet sans migration ni redéploiement**.
- Les permissions d'une session sont **figées au login** (`auth-get-session`) : un changement
  de matrice ne s'applique qu'à la prochaine connexion. C'est assumé, pas un bug.

**Conséquence pour les tests pgTAP** : `role_permissions` est de la DONNÉE, la matrice peut
avoir été éditée en production. Un test ne doit **plus supposer la matrice seedée**. Trois
parades, au choix selon le test : épingler **SUPER_ADMIN** (dont la ligne est verrouillée),
poser les grants/**overrides in-transaction** dans l'enveloppe `BEGIN … ROLLBACK`, ou
s'appuyer sur le **catalogue** `permissions` (toujours seedé) plutôt que sur les grants.

---

## Mental model — PIN auth + JWT fetch wrapper

`auth-verify-pin` EF issues **HS256 JWTs**. GoTrue uses **ES256** and cannot validate them.

**Fetch wrapper pattern** (`packages/supabase`): `setSupabaseAccessToken` injects the PIN JWT
on every Supabase client request. **Never** bypass with a raw `Authorization` header or
`auth.setSession` — the GoTrue ES256 validation will reject it.

**Transport du PIN — le véhicule dépend de la cible** (arbitrage propriétaire 2026-08-31,
gravé dans CLAUDE.md ; deux skills se contredisaient) :

- **Vers une Edge Function → en-tête `x-manager-pin`**, jamais le body JSON : les bodies d'EF
  sont loggés (PostgREST, pgaudit, proxies). Règle de hard-cutover : on retire le champ de body
  DANS LE MÊME COMMIT que la lecture d'en-tête. Pas de dual-mode.
  Référence : `supabase/functions/refund-order/index.ts` (body `manager_pin` → header, S25).
- **Vers une RPC Postgres appelée par PostgREST → argument `p_manager_pin`.** Une RPC ne lit
  pas les en-têtes : l'argument est le seul véhicule qu'elle puisse réellement valider.
  `approve_expense` a précisément été déplacée du header vers l'argument le 2026-06-01 parce
  que la RPC ne lisait jamais l'en-tête — le PIN était transporté, jamais vérifié.
  **Ne pas « re-corriger » ces RPC vers l'en-tête.**
- **Le critère d'audit n'est donc pas le véhicule, mais : la cible vérifie-t-elle le PIN, avec
  verrouillage ?** (helper `_verify_pin_with_lockout` côté SQL, `_shared/manager-pin.ts` côté EF.)

**Balayage EF : SOLDÉ** (vérifié le 2026-08-31). `void-order` et `cancel-item` lisent bien
`req.headers.get('x-manager-pin')` ; `kiosk-issue-jwt` ne consomme aucun PIN (son body est
`kiosk_id` / `scope` / `device_label`). Ne pas rouvrir ce chantier — le relever par grep sur
`supabase/functions/` s'il faut s'en assurer, pas depuis cette fiche.

**auth-verify-pin** returns a `LoginResponse` including a `permissions` string[] array used by
`hasPermission()` client-side. The session is cached — no roundtrip per check.

---

## Mental model — Durable rate-limit (S19)

Famille `record_rate_limit`, signature
`(p_function_name, p_bucket_key, p_ip_address, p_max_per_window, p_window_sec)`
(créée par `20260523000010`, race corrigée par `20260523000012` ; la version vivante est celle
épinglée au call-site dans `_shared/rate-limit.ts`) — SECURITY DEFINER, `service_role` only. Atomic upsert against
`edge_function_rate_limits` table. Uses `FOR UPDATE` row-lock on the live bucket; under sustained
attack ≥100 req/s this serializes on the same bucket (DEV-S19-1.A-01 informational, acceptable
at Breakery traffic). **Fail-open on DB error** — deliberate trade-off (logged; don't flip to
fail-closed without pool-sizing analysis, DEV-S19-1.A-02).

`checkRateLimitDurable` in `supabase/functions/_shared/rate-limit.ts` is the EF-side helper.

Le câblage s'est étendu bien au-delà des 5 EF du premier lot S19 : au 2026-08-31, une dizaine
d'EF appellent `checkRateLimitDurable` (dont `auth-verify-pin`, `auth-change-pin`,
`kiosk-issue-jwt` ×2 buckets, `process-payment`, `refund-order`, `void-order`, `cancel-item`,
`verify-manager-pin`, `generate-pdf`, `generate-zreport-pdf`). **Relever la liste par
`grep -rl checkRateLimitDurable supabase/functions/`, pas depuis cette fiche.**

**`Retry-After` : gap DEV-S19-2.A-02 SOLDÉ** (vérifié le 2026-08-31). Toutes les réponses 429
passent par `rateLimitedResponse` (`_shared/responses.ts`), qui pose l'en-tête `Retry-After` et
l'expose au fetch navigateur via `Access-Control-Expose-Headers`. Les **deux** buckets de
`kiosk-issue-jwt` (IP et `kiosk_id`) le surfacent, comme `auth-verify-pin`. Ne pas re-signaler.

Cron purge: `pg_cron` job `rl-purge` runs daily to clean expired buckets.

---

## Mental model — Per-role session timeout (S19)

`roles.session_timeout_minutes INT NOT NULL DEFAULT 30 CHECK (5..480)` (migration `20260523000020`).
Seeded defaults:
- CASHIER / waiter → 30 min
- MANAGER → 60 min
- ADMIN → 120 min
- SUPER_ADMIN → 240 min

Famille `update_role_session_timeout(p_role_code TEXT, p_minutes INT)` — RPC gatée
(`settings.update` + test de rôle) et audit-loggée. **Attention : la v1 a été DROPPÉE** par le
bump ADR-031 ; ne pas citer un numéro lu ailleurs, vérifier la migration au numéro NAME-block
le plus haut portant ce nom **et** le call-site du hook BO. Depuis l'ADR-031, l'édition du
timeout vit dans la **fiche rôle** (SUPER_ADMIN uniquement) et non plus dans la page Security
des réglages, qui ne garde que la politique PIN.

`useIdleTimeout` hook in `packages/ui` is mounted in both POS and BO. Fires `signOut()`
immediately on idle (no "about to be signed out" warning — DEV-S19-3.A-01, informational).

`auth-get-session` EF returns `session_timeout_minutes` so the client can configure its timeout.

---

## Mental model — PIN strength (S19)

`evaluatePinStrength` in `packages/utils` (+ Deno mirror `supabase/functions/_shared/pin-strength.ts`).
A cross-package sync test catches drift between the two copies. Warn-only (no blocking).
`auth-change-pin` EF returns `{ ok, weak, weak_reason? }`.
`COMMON_PINS` array : 101 entrées au 2026-08-31 — la liste vivante se compte dans
`packages/utils/src/pin-strength.ts`, pas ici (note : entrée morte `'232425'` —
DEV-S19-2.B-03, informationnel).

---

## Audit checklist

### A. REVOKE coverage

- [ ] Every SECURITY DEFINER RPC in `supabase/migrations/` has a companion REVOKE migration —
  grep `CREATE.*FUNCTION` vs `REVOKE EXECUTE` across migrations; any unpaired function is exposed.
- [ ] REVOKE pair includes BOTH `FROM PUBLIC, anon` AND `ALTER DEFAULT PRIVILEGES … FROM PUBLIC`.
  A migration that only does `REVOKE … FROM anon` is incomplete (see S19 corrective `_022`).
- [ ] Tables/views: `REVOKE ALL … FROM anon` on all append-only ledgers (`stock_movements`,
  `display_movements`, `b2b_payments`, `audit_logs`, `expense_approvals`). Verify `pg_class` ACL.
- [ ] `ALTER DEFAULT PRIVILEGES FOR ROLE postgres … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` was
  applied globally (S20 `_031`). Verify it's in `schema_migrations`.

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
  arg (flavor 2) — pick per semantic, see CLAUDE.md §Idempotency 2-flavors.
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

CLAUDE.md §Critical patterns (anon defense-in-depth, transport du PIN, idempotency 2-flavors)
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

Baseline: ~24 BO + ~3 POS test failures are env-gated (`VITE_SUPABASE_URL Required`,
`DEV-S25-2.A-02`) and are NOT regressions — verify against master before escalating.

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
