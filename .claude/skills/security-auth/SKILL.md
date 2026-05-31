---
name: security-auth
description: Security & auth expert — RLS, REVOKE/anon defense-in-depth, permission gates, PIN JWT fetch wrapper, durable rate-limit, per-role session timeout. Audit security posture AND guide auth changes.
pathPatterns:
  - 'apps/*/src/features/auth/**'
  - 'apps/backoffice/src/features/rbac/**'
  - 'apps/backoffice/src/pages/settings/*Security*'
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

---

## Mental model — Anon defense-in-depth (S20)

Supabase **auto-grants EXECUTE** on all `public` functions to `anon` AND `authenticated` via
`ALTER DEFAULT PRIVILEGES … TO anon`. This means:

> `REVOKE EXECUTE … FROM anon` alone is **insufficient** — anon still inherits EXECUTE through
> its PUBLIC membership (`=X/postgres` ACL entry).

The S20 sweep (`20260524000031`) established the canonical 3-line **REVOKE pair** that every new
SECURITY DEFINER RPC MUST include in its companion REVOKE migration:

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
`PermissionCode`. Every server-side permission must have a matching entry here **and** a seed
migration. The pattern in every SECURITY DEFINER RPC:

```sql
IF NOT has_permission(auth.uid(), 'scope.action') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0003';
END IF;
```

- **Server-side**: `has_permission(auth.uid(), 'scope.action')` in SECURITY DEFINER functions.
- **Client-side**: `hasPermission(userPermissions, 'scope.action')` (`packages/supabase/src/rls/permissions.ts`) consumed via `authStore` in BO + POS.
- **UI gate (BO)**: `<PermissionGate permission="scope.action">` wraps routes + sidebar entries.

Key permission families (verified from `permissions.ts`):
- `accounting.{coa.read, coa.write, gl.read, tb.read, je.create_manual, period.close}` — S26
- `zreports.{read, sign, void}` — S29
- `orders.{read, edit_open, void}` — S31/S33
- `expenses.{thresholds.read, thresholds.write}` — S28
- `display.{read, manage}` — display-stock isolation
- `inventory.*` — 10 granular scopes (see `permissions.ts` lines 75-90)

---

## Mental model — PIN auth + JWT fetch wrapper

`auth-verify-pin` EF issues **HS256 JWTs**. GoTrue uses **ES256** and cannot validate them.

**Fetch wrapper pattern** (`packages/supabase`): `setSupabaseAccessToken` injects the PIN JWT
on every Supabase client request. **Never** bypass with a raw `Authorization` header or
`auth.setSession` — the GoTrue ES256 validation will reject it.

**PIN/secret en header HTTP, jamais en body JSON** (Critical pattern, S25):
- Header: `x-manager-pin` (read by EF, never body JSON — bodies are logged by PostgREST, pgaudit, proxies)
- Hard-cutover rule: drop the body field IN THE SAME COMMIT as the header read. No dual-mode.
- Reference: S25 `supabase/functions/refund-order/index.ts` (body `manager_pin` → header `x-manager-pin`)
- EFs still requiring sweep (deferred post-S30): `void-order`, `cancel-item`, `kiosk-issue-jwt`

**auth-verify-pin** returns a `LoginResponse` including a `permissions` string[] array used by
`hasPermission()` client-side. The session is cached — no roundtrip per check.

---

## Mental model — Durable rate-limit (S19)

`record_rate_limit_v1(p_function_name, p_bucket_key, p_ip_address, p_max_per_window, p_window_sec)`
(migration `20260523000010`) — SECURITY DEFINER, `service_role` only. Atomic upsert against
`edge_function_rate_limits` table. Uses `FOR UPDATE` row-lock on the live bucket; under sustained
attack ≥100 req/s this serializes on the same bucket (DEV-S19-1.A-01 informational, acceptable
at Breakery traffic). **Fail-open on DB error** — deliberate trade-off (logged; don't flip to
fail-closed without pool-sizing analysis, DEV-S19-1.A-02).

`checkRateLimitDurable` in `supabase/functions/_shared/rate-limit.ts` is the EF-side helper.

5 EFs wired (S19): `auth-verify-pin`, `kiosk-issue-jwt` (×2 buckets), `refund-order`,
`void-order`, `cancel-item`. Responses do NOT include `Retry-After` header (gap DEV-S19-2.A-02).

Cron purge: `pg_cron` job `rl-purge` runs daily to clean expired buckets.

---

## Mental model — Per-role session timeout (S19)

`roles.session_timeout_minutes INT NOT NULL DEFAULT 30 CHECK (5..480)` (migration `20260523000020`).
Seeded defaults:
- CASHIER / waiter → 30 min
- MANAGER → 60 min
- ADMIN → 120 min
- SUPER_ADMIN → 240 min

`update_role_session_timeout_v1(p_role_code TEXT, p_minutes INT)` — admin-gated, audit-logged RPC.
`useIdleTimeout` hook in `packages/ui` is mounted in both POS and BO. Fires `signOut()`
immediately on idle (no "about to be signed out" warning — DEV-S19-3.A-01, informational).

`auth-get-session` EF returns `session_timeout_minutes` so the client can configure its timeout.

---

## Mental model — PIN strength (S19)

`evaluatePinStrength` in `packages/utils` (+ Deno mirror `supabase/functions/_shared/pin-strength.ts`).
A cross-package sync test catches drift between the two copies. Warn-only (no blocking).
`auth-change-pin` EF returns `{ ok, weak, weak_reason? }`.
`COMMON_PINS` array: 101 entries (note: dead entry `'232425'` — DEV-S19-2.B-03, informational).

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
- [ ] `<PermissionGate>` wraps every new BO route that requires a perm.

### C. PIN / header security

- [ ] No EF reads `manager_pin` (or any secret) from request body JSON — grep `body.*pin` or
  `req.json().*pin` across `supabase/functions/`.
- [ ] `auth-verify-pin` JWT consumed via `setSupabaseAccessToken` fetch wrapper, NOT raw
  `Authorization` header.

### D. Rate-limit wiring

- [ ] Any new mutating EF that can be triggered by external/unauthenticated callers calls
  `checkRateLimitDurable` with an appropriate bucket.
- [ ] `record_rate_limit_v1` is `service_role` only — never callable from authenticated/anon.
  Verify REVOKE in `20260523000010`.

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
- [ ] pgTAP covers: happy path + perm denied (P0003) + audit_log row.

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
Client-side permission set (canonical closed set — mirror of DB seed)
  packages/supabase/src/rls/permissions.ts

Migrations (security-critical, chronological)
  supabase/migrations/20260524000031_fix_revoke_public_execute_from_public_functions.sql  # S20 global sweep corrective
  supabase/migrations/20260523000010_create_record_rate_limit_v1_rpc.sql                  # S19 rate-limit RPC
  supabase/migrations/20260523000020_add_session_timeout_to_roles.sql                     # S19 per-role timeout
  supabase/migrations/20260523000022_fix_update_role_session_timeout_v1_revoke_anon.sql   # S19 corrective REVOKE anon
  supabase/migrations/20260602000013_alter_default_privileges_revoke_from_public.sql      # S25 canonical template

EF shared helpers
  supabase/functions/_shared/idempotency.ts         # getIdempotencyKey(req)
  supabase/functions/_shared/rate-limit.ts          # checkRateLimitDurable
  supabase/functions/auth-verify-pin/index.ts       # HS256 JWT issuance

CLAUDE.md §Critical patterns (anon defense-in-depth, PIN header, idempotency 2-flavors, S19/S20/S25)
```

---

## Verification before claiming an audit or fix is complete

```bash
# Type check (always run first)
pnpm typecheck

# Auth/RBAC features
pnpm --filter @breakery/app-backoffice test rbac
pnpm --filter @breakery/app-backoffice test auth

# pgTAP via MCP execute_sql (BEGIN/ROLLBACK envelope)
# Run: supabase/tests/idempotency_hardening.test.sql
# Run: supabase/tests/zreports.test.sql (covers sign_zreport_v1 perm gate)

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
