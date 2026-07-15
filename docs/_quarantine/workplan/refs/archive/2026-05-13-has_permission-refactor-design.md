---
title: has_permission() Refactor Design (D10 / Audit R14)
date: 2026-05-13
locked: 2026-05-14
owner: arch-steward (Phase 0.1)
scope: Phase 1.B Stream B — single migration 20260517000030
implementer: sec-stream (Phase 1.B subagent)
reviewer: reviewer (dormant id a3ad24f9b7bf6e565)
---

# `has_permission()` Refactor — Design & Migration Plan

> **Goal.** Make `has_permission(p_user_id UUID, p_permission TEXT)` a *pure data lookup* against `permissions` + `role_permissions` tables, executed once, then **never re-published** during Session 13. New permissions are added by INSERT, not by re-CREATE'ing the function body.

---

## 1. Current state in V3 (verified 2026-05-14)

### 1.1 Function form today

`has_permission(p_uid UUID, p_perm TEXT) RETURNS BOOLEAN` is `CREATE OR REPLACE`'d in **11 migrations** — every time a new permission category lands. Body is a giant `CASE WHEN v_role = '<ROLE>' THEN p_perm IN ('<perm-1>', '<perm-2>', …)` block. Latest version (`20260516000018_seed_inventory_perms_phase2.sql`, lines 73-116):

```sql
CREATE OR REPLACE FUNCTION has_permission(p_uid UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role_code INTO v_role
    FROM user_profiles
   WHERE auth_user_id = p_uid AND deleted_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  RETURN CASE
    WHEN v_role IN ('SUPER_ADMIN','ADMIN') THEN true
    WHEN v_role = 'MANAGER' THEN p_perm IN (
      'pos.session.open', …  -- ≈ 30 perms hardcoded
    )
    WHEN v_role = 'CASHIER' THEN p_perm IN (
      'pos.session.open', 'pos.session.close_own', …  -- ≈ 5 perms
    )
    WHEN v_role = 'waiter' THEN p_perm IN ('sales.create','products.read')
    ELSE false
  END;
END $$;
```

A companion `has_permission_for_profile(p_profile_id UUID, p_perm TEXT)` mirrors the body since `20260512000007`.

### 1.2 Tables that exist today

```sql
-- supabase/migrations/20260503000001_init_auth.sql
CREATE TABLE roles (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
  …
  role_code TEXT NOT NULL REFERENCES roles(code),
  …
);
```

### 1.3 What's missing for a pure lookup

- **`role_permissions` join table — ABSENT.** Verified:
  ```
  $ grep -RE "CREATE TABLE role_permissions" supabase/migrations/
  (no hit)
  ```
- Some seed migrations INSERT into `permissions` (`20260508000002`, `20260511000006`, `20260512000007`, `20260513000004`, `20260514000003`, `20260516000004`, `20260516000018`) but **none** seed a `role_permissions` table — they implicitly encode role → permission in the function body.

### 1.4 Other relevant facts

- `has_permission_for_profile(p_profile_id, p_perm)` is the variant used by RPCs that authenticate a manager-by-profile (e.g. `refund_order_rpc` checks `has_permission_for_profile(p_authorized_by, 'pos.sale.refund')` after PIN-verifying a manager). The refactor **must** ship a matching `has_permission_for_profile` body that delegates to the same lookup path — otherwise the refund flow breaks.
- The bare permission check function in V3 takes `p_uid UUID` (auth.users id), not `p_user_id`. The audit R14 / D10 design upstream said `has_permission(role, perm_key)` — that was a simplification. The **canonical V3 signature** stays:
  ```sql
  has_permission(p_user_id UUID, p_permission TEXT) RETURNS BOOLEAN
  ```
  (renaming `p_uid` → `p_user_id` and `p_perm` → `p_permission` for clarity; the new function body resolves `role_code` internally exactly as the current version does — so call sites pass `auth.uid()` unchanged).
- A second function for the explicit-profile path stays:
  ```sql
  has_permission_for_profile(p_profile_id UUID, p_permission TEXT) RETURNS BOOLEAN
  ```

---

## 2. Target signature

```sql
-- Primary variant (auth.uid())
CREATE OR REPLACE FUNCTION has_permission(p_user_id UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
…
$$;

-- Profile-id variant (used by RPCs that resolve manager-by-pin)
CREATE OR REPLACE FUNCTION has_permission_for_profile(p_profile_id UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
…
$$;
```

Both functions remain `STABLE SECURITY DEFINER` to preserve RLS-bypass needs at call sites; both keep `search_path = public` to harden against schema-search-path attacks.

---

## 3. Target logic (explicit DENY > role-grant > permission-grant > default DENY)

The refactored body implements a four-tier lookup. Pseudocode:

```
function has_permission(p_user_id, p_permission):
    # 0. resolve role from user_profiles
    v_role_code = SELECT role_code
                    FROM user_profiles
                   WHERE auth_user_id = p_user_id
                     AND deleted_at IS NULL
                   LIMIT 1
    if v_role_code IS NULL: return FALSE   # unknown user → deny

    # 1. explicit DENY beats everything (user-level override)
    if EXISTS (SELECT 1
                 FROM user_permission_overrides
                WHERE user_profile_id = (SELECT id FROM user_profiles WHERE auth_user_id = p_user_id)
                  AND permission_code = p_permission
                  AND is_granted = FALSE):
        return FALSE

    # 2. role-based GRANT (the common path)
    if EXISTS (SELECT 1
                 FROM role_permissions rp
                WHERE rp.role_code = v_role_code
                  AND rp.permission_code = p_permission
                  AND rp.is_granted = TRUE):
        return TRUE

    # 3. user-level GRANT (explicit override of role's default DENY)
    if EXISTS (SELECT 1
                 FROM user_permission_overrides
                WHERE user_profile_id = (SELECT id FROM user_profiles WHERE auth_user_id = p_user_id)
                  AND permission_code = p_permission
                  AND is_granted = TRUE):
        return TRUE

    # 4. default DENY
    return FALSE
```

### 3.1 SQL form

```sql
CREATE OR REPLACE FUNCTION has_permission(p_user_id UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile_id UUID;
  v_role_code  TEXT;
BEGIN
  SELECT id, role_code
    INTO v_profile_id, v_role_code
    FROM user_profiles
   WHERE auth_user_id = p_user_id
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_profile_id IS NULL OR v_role_code IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Explicit user-level DENY override
  IF EXISTS (
    SELECT 1
      FROM user_permission_overrides
     WHERE user_profile_id = v_profile_id
       AND permission_code = p_permission
       AND is_granted = FALSE
  ) THEN
    RETURN FALSE;
  END IF;

  -- 2. Role-based grant
  IF EXISTS (
    SELECT 1
      FROM role_permissions
     WHERE role_code = v_role_code
       AND permission_code = p_permission
       AND is_granted = TRUE
  ) THEN
    RETURN TRUE;
  END IF;

  -- 3. User-level explicit grant
  IF EXISTS (
    SELECT 1
      FROM user_permission_overrides
     WHERE user_profile_id = v_profile_id
       AND permission_code = p_permission
       AND is_granted = TRUE
  ) THEN
    RETURN TRUE;
  END IF;

  -- 4. Default DENY
  RETURN FALSE;
END $$;
```

And the profile-id variant (identical body, just skip the auth_user_id lookup):

```sql
CREATE OR REPLACE FUNCTION has_permission_for_profile(p_profile_id UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role_code TEXT;
BEGIN
  SELECT role_code
    INTO v_role_code
    FROM user_profiles
   WHERE id = p_profile_id
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_role_code IS NULL THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM user_permission_overrides
     WHERE user_profile_id = p_profile_id
       AND permission_code = p_permission
       AND is_granted = FALSE
  ) THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM role_permissions
     WHERE role_code = v_role_code
       AND permission_code = p_permission
       AND is_granted = TRUE
  ) THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM user_permission_overrides
     WHERE user_profile_id = p_profile_id
       AND permission_code = p_permission
       AND is_granted = TRUE
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END $$;
```

### 3.2 Decision-order rationale

| Step | Why this order |
|---|---|
| 1. DENY override first | A user-level explicit DENY is a security override (e.g., suspended cashier still has CASHIER role but must lose `pos.sale.create`). Must beat any role grant. |
| 2. Role grant | The 95 % case — drives admin matrices and standard workflows. Indexed lookup → O(1) per check. |
| 3. User-level GRANT | The "give this CASHIER promotion authority for one weekend" pattern. Used sparingly. |
| 4. Default DENY | Fail-closed: unknown perm = denied. |

---

## 4. Required new tables

### 4.1 `role_permissions`

```sql
CREATE TABLE role_permissions (
  role_code       TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  is_granted      BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (role_code, permission_code)
);

CREATE INDEX idx_role_permissions_role ON role_permissions(role_code) WHERE is_granted = TRUE;
CREATE INDEX idx_role_permissions_perm ON role_permissions(permission_code) WHERE is_granted = TRUE;

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- ADMIN+ can read everything; non-admin can only read their own role's grants.
CREATE POLICY "admin_read" ON role_permissions FOR SELECT
  USING (has_permission(auth.uid(), 'rbac.read'));
CREATE POLICY "self_read" ON role_permissions FOR SELECT
  USING (
    role_code = (
      SELECT role_code FROM user_profiles
       WHERE auth_user_id = auth.uid()
         AND deleted_at IS NULL
    )
  );
-- All writes via RPCs (SECURITY DEFINER); revoke direct access.
REVOKE INSERT, UPDATE, DELETE ON role_permissions FROM authenticated;
```

### 4.2 `user_permission_overrides`

```sql
CREATE TABLE user_permission_overrides (
  user_profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  is_granted      BOOLEAN NOT NULL,        -- TRUE = explicit GRANT, FALSE = explicit DENY
  reason          TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ,
  PRIMARY KEY (user_profile_id, permission_code)
);

CREATE INDEX idx_upo_user ON user_permission_overrides(user_profile_id);
CREATE INDEX idx_upo_expires
  ON user_permission_overrides(expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read" ON user_permission_overrides FOR SELECT
  USING (has_permission(auth.uid(), 'rbac.read'));
CREATE POLICY "self_read" ON user_permission_overrides FOR SELECT
  USING (
    user_profile_id = (
      SELECT id FROM user_profiles
       WHERE auth_user_id = auth.uid()
         AND deleted_at IS NULL
    )
  );
REVOKE INSERT, UPDATE, DELETE ON user_permission_overrides FROM authenticated;
```

> **Note on `expires_at`.** The function body in 3.1 does not currently filter by `expires_at`. Either (a) the function filters via `AND (expires_at IS NULL OR expires_at > now())` in both EXISTS checks for overrides, **or** (b) a cron EF purges expired overrides nightly. Recommendation: **(a)** — keeps reads correct even if the cron misses a tick.

### 4.3 Seed migration

A separate seed migration (`20260517000031_seed_role_permissions.sql`) populates `role_permissions` by mining the V2 body of `has_permission` (per role). Skeleton:

```sql
-- SUPER_ADMIN and ADMIN: grant ALL existing permissions.
INSERT INTO role_permissions (role_code, permission_code, is_granted)
SELECT 'SUPER_ADMIN', code, TRUE FROM permissions
ON CONFLICT (role_code, permission_code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted)
SELECT 'ADMIN', code, TRUE FROM permissions
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- MANAGER: exactly the set hardcoded in 20260516000018 (≈30 perms).
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('MANAGER', 'pos.session.open', TRUE),
  ('MANAGER', 'pos.session.close_own', TRUE),
  ('MANAGER', 'pos.session.close_other', TRUE),
  ('MANAGER', 'pos.session.view_all', TRUE),
  ('MANAGER', 'pos.sale.create', TRUE),
  ('MANAGER', 'pos.sale.void', TRUE),
  ('MANAGER', 'pos.sale.update', TRUE),
  ('MANAGER', 'pos.sale.refund', TRUE),
  ('MANAGER', 'pos.sale.cancel_item', TRUE),
  ('MANAGER', 'products.read', TRUE),
  -- … rest of manager perms from 20260516000018:73-105
  ('MANAGER', 'inventory.transfer.create', TRUE),
  ('MANAGER', 'inventory.transfer.receive', TRUE),
  ('MANAGER', 'inventory.opname.create', TRUE),
  ('MANAGER', 'inventory.production.create', TRUE)
ON CONFLICT DO NOTHING;

-- CASHIER: the small whitelist.
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('CASHIER', 'pos.session.open', TRUE),
  ('CASHIER', 'pos.session.close_own', TRUE),
  ('CASHIER', 'pos.sale.create', TRUE),
  ('CASHIER', 'products.read', TRUE),
  ('CASHIER', 'payments.process', TRUE)
ON CONFLICT DO NOTHING;

-- waiter: minimum.
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('waiter', 'sales.create', TRUE),
  ('waiter', 'products.read', TRUE)
ON CONFLICT DO NOTHING;

-- Add a new permission `rbac.read` for the RLS policies above.
INSERT INTO permissions (code, module, action, description) VALUES
  ('rbac.read', 'rbac', 'read', 'Read RBAC config (roles, role_permissions, overrides).')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('SUPER_ADMIN', 'rbac.read', TRUE),
  ('ADMIN', 'rbac.read', TRUE)
ON CONFLICT DO NOTHING;
```

---

## 5. Migration plan

### 5.1 Numbering

| File | Purpose |
|---|---|
| `supabase/migrations/20260517000030_refactor_has_permission.sql` | Creates `role_permissions` + `user_permission_overrides` tables, recreates both functions in their final lookup-pure form. |
| `supabase/migrations/20260517000031_seed_role_permissions.sql` | Seeds the join table from the V2 hardcoded body. |
| `supabase/migrations/20260517000032_drop_legacy_has_permission_bodies.sql` | Comment-only migration that re-asserts the function body via `COMMENT ON FUNCTION has_permission IS 'LOCKED 2026-05-14 — DO NOT CREATE OR REPLACE'` — a defensive marker; no functional change. Could be merged into `30` if preferred. |

### 5.2 Ordering

1. **`20260517000030`** — DDL: tables + grants + function bodies.
2. **`20260517000031`** — DML: seed rows. Order matters because the new function reads the tables; if `20260517000030` lands without seeds, every `has_permission()` call returns FALSE until `31` runs. → Both must apply atomically in the same `pnpm db:reset` cycle.
3. **`20260517000032`** — optional comment marker.

### 5.3 Rule for the rest of Session 13

Every new permission introduced by another phase = **INSERT INTO permissions + INSERT INTO role_permissions**. Functions stay untouched. Reviewer flags any `CREATE OR REPLACE FUNCTION has_permission` after `20260517000030` as a blocker.

### 5.4 Optional cleanup (post-Session 13)

The 11 legacy migrations that re-CREATE `has_permission` remain in history (append-only) but are functionally superseded by `20260517000030`. No back-edit needed. A retrofix migration could DROP and recreate from scratch with the lookup body — but that risks breaking `pnpm db:reset` if the seed migrations are non-idempotent. Defer.

---

## 6. Test fixtures (pgTAP)

File: `supabase/tests/has_permission_lookup.test.sql` (new, Phase 1.B).

### 6.1 Naming convention

Each test = one `test_*` plpgsql function returning a pgTAP `ok()/is()/throws_ok()` plan. Prefix: `T_HASPERM_*`.

### 6.2 Test list

| Test name | What it verifies |
|---|---|
| `T_HASPERM_ROLE_GRANT_TRUE` | `has_permission(user_with_role_admin, 'rbac.read')` → TRUE. |
| `T_HASPERM_ROLE_NO_GRANT_FALSE` | `has_permission(user_with_role_cashier, 'rbac.read')` → FALSE (cashier has no row). |
| `T_HASPERM_DENY_OVERRIDE_BEATS_ROLE` | Manager has `pos.sale.refund` via role; insert `user_permission_overrides(manager, 'pos.sale.refund', is_granted=FALSE)` → `has_permission()` returns FALSE. |
| `T_HASPERM_GRANT_OVERRIDE_PROMOTES_CASHIER` | Cashier has no `pos.sale.refund` in role; insert `user_permission_overrides(cashier, 'pos.sale.refund', is_granted=TRUE)` → returns TRUE. |
| `T_HASPERM_UNKNOWN_USER_FALSE` | `has_permission('00000000-0000-0000-0000-000000000000'::uuid, 'rbac.read')` → FALSE. |
| `T_HASPERM_UNKNOWN_PERM_FALSE` | Existing admin user, perm code `'nonexistent.perm'` → FALSE (no INSERT on permissions for that code). |
| `T_HASPERM_DELETED_USER_FALSE` | User with `deleted_at IS NOT NULL` → FALSE. |
| `T_HASPERM_NULL_USER_FALSE` | `has_permission(NULL, 'rbac.read')` → FALSE (no exception). |
| `T_HASPERM_PROFILE_VARIANT_MATCHES` | For every test row above, `has_permission_for_profile(profile_id, perm)` returns the same boolean as `has_permission(auth_user_id, perm)`. |
| `T_HASPERM_EXPIRED_OVERRIDE_IGNORED` | Insert override with `expires_at < now()` → behaves as if absent. |
| `T_HASPERM_NOT_RECREATED` | `SELECT count(*) FROM pg_proc WHERE proname='has_permission'` = 1 (defensive — catches accidental second `CREATE OR REPLACE` landing). |
| `T_HASPERM_BODY_LOCKED` | The function's `prosrc` (source text) contains the canonical phrase `'user_permission_overrides'` (smoke check — if a later migration re-publishes with the old hardcoded body, this fails). |

### 6.3 Coverage map

- Decision-order branches (DENY > role > GRANT > default): tests 3, 4, 1, 2.
- Edge cases (NULL, unknown user, deleted user, unknown perm): tests 5, 7, 8.
- Variant parity (`_for_profile`): test 9.
- TTL on overrides: test 10.
- Lockdown invariants: tests 11, 12.

### 6.4 Vitest live RPC (companion)

File: `supabase/tests/functions/auth-has-permission.test.ts` (new, Phase 1.B).

Round-trip from the client (`packages/supabase` PIN auth fetch wrapper):

```ts
describe('has_permission via RPC (live)', () => {
  it('admin → rbac.read returns true', async () => { … });
  it('cashier → rbac.read returns false', async () => { … });
  it('manager + DENY override → pos.sale.refund returns false', async () => { … });
  it('cashier + GRANT override → pos.sale.refund returns true', async () => { … });
});
```

---

## 7. Verification of "never re-CREATE'd again" rule

End of Session 13, run as a CI gate:

```bash
# Block any migration after 20260517000030 that re-publishes the function.
grep -lE "CREATE (OR REPLACE )?FUNCTION (public\.)?has_permission\b" \
  supabase/migrations/20260517*.sql \
  | grep -v 20260517000030 \
  | grep -v 20260517000032 \
  && exit 1 || exit 0
```

This becomes a step in `.github/workflows/ci.yml` (Phase 0.2 enabler). If grep finds anything → fail PR.

---

## 8. Impact on existing call sites

- `auth.uid()` callers (RLS policies, RPCs that resolve the *current* user): **no change** — they still pass `auth.uid()` to `has_permission()`. Argument name change (`p_uid` → `p_user_id`) is purely cosmetic since callers use positional args.
- `has_permission_for_profile(profile_id, perm)` callers (notably `refund_order_rpc`, `void_order_rpc`, and a handful of inventory RPCs from Session 12): **no change** — signature stable.
- `apps/{pos,backoffice}/src/features/auth/` — no client-side change. The fetch wrapper continues to ask Supabase for `permissions(auth.uid())` (already-existing RPC, separate concern). New `rbac.read` permission seeded but not yet used in UI; module 20 / RBAC matrix (Phase 5) consumes it.

---

## 9. Rollback plan

If post-deploy a regression is found:

1. `pnpm db:reset` on staging (Phase 0.2 staging env per D8) — reapplies migrations from scratch with seeds.
2. If still broken, revert `20260517000031` (the seed) and replace with a one-shot migration that re-INSERTs role grants. Function body never reverts.
3. **NEVER** roll back the function body to the hardcoded form — doing so re-creates the R14 fragility class.

---

## 10. Acceptance criteria for Phase 1.B (this work)

- [ ] Migration `20260517000030` lands; `pnpm db:reset` succeeds.
- [ ] Migration `20260517000031` lands; every previously-granted perm path still passes (proven by Vitest live test suite re-running).
- [ ] `supabase/tests/has_permission_lookup.test.sql` runs green — all 12 `T_HASPERM_*` tests pass.
- [ ] `supabase/tests/functions/auth-has-permission.test.ts` runs green — 4 live-RPC tests pass.
- [ ] CI grep gate (§7) blocks any subsequent migration that re-CREATEs `has_permission`.
- [ ] Reviewer (`reviewer`, id `a3ad24f9b7bf6e565`) signs off.
- [ ] `packages/supabase/src/types.generated.ts` regenerated and committed.

---

*End of has_permission refactor design. Locked 2026-05-14. Implementation = Phase 1.B subagent `sec-stream`.*
