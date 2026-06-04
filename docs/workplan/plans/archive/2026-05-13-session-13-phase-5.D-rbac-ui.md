---
title: Phase 5.D — RBAC UI + audit pairing + last-admin protection
date: 2026-05-13
session: 13
wave: 5
phase: 5.D
status: in-progress
owner: rbac-ui (subagent)
parents:
  - docs/workplan/plans/2026-05-13-session-13-INDEX.md (line 964)
  - docs/workplan/refs/2026-05-13-has_permission-refactor-design.md
  - docs/reference/04-modules/20-users.md
---

# Phase 5.D — RBAC UI + audit pairing + last-admin protection

> **Scope** : Users CRUD (BO) + Permission Matrix viewer + role-change audit
> + last-admin protection + session revocation on role change.
> **Migration block** : `20260517000200` (1 migration).
> **Files target** : 1 migration, 1 feature folder (`apps/backoffice/src/features/users/`),
> 4 pages, routes/layout updates, pgTAP + Vitest live + BO smoke tests.

---

## 1. Constraints (read first)

- **NEVER** re-CREATE `has_permission()` — it is locked since Phase 1.B
  (`20260517000030`). New perms = INSERT INTO permissions + role_permissions.
  CI grep gate enforces this.
- `roles.code` is **UPPERCASE** (`ADMIN`, `MANAGER`, `CASHIER`, `SUPER_ADMIN`)
  except `waiter` lowercase.
- No `staff` table — use `user_profiles`.
- `user_profiles` columns : `id, auth_user_id, employee_code, full_name,
  pin_hash, role_code, is_active, failed_login_attempts, locked_until,
  last_login_at, created_at, updated_at, deleted_at`. **No first/last
  name split**, **no phone**.
- `audit_logs` columns : `id, actor_id, action, entity_type, entity_id,
  metadata, created_at`.
- PIN auth flow uses `auth-verify-pin` EF + custom Supabase fetch wrapper.
  Don't bypass.
- All session-revoke / auth.users delete operations require `auth.admin.*`
  i.e. service-role. From a SECURITY DEFINER RPC we touch
  `auth.users` / `auth.sessions` directly (postgres role has access).

---

## 2. Deviations expected vs INDEX spec

Recorded under `D-W5-5D-NN` in the Wave 5 deviations file.

| # | INDEX says | Reality lands |
|---|------------|---------------|
| 01 | `p_first_name, p_last_name, p_phone` args | Single `p_full_name` arg + optional `p_employee_code`. `user_profiles` has no first/last/phone columns. |
| 02 | "Create row in `auth.users` via admin API call OR same flow as existing creation" | RPC creates the `auth.users` row directly via raw INSERT (mirrors `supabase/seed.sql`) since pg `SECURITY DEFINER` runs as `postgres` and has `auth.users` access. Email = `staff-<emp_code>@thebreakery.local`; password = random bcrypt'd (PIN auth only). |
| 03 | "Revoke active sessions on role change via `auth.sessions` table OR gotrue admin API" | RPC sets `user_profiles.is_active = false` then `true` won't work (rejects pin-auth EF mid-flight). Instead RPC deletes from `auth.sessions WHERE user_id = <auth_user_id>` AND deletes from `user_sessions WHERE user_id = <profile_id> AND ended_at IS NULL` (the custom session table). Audit row in `audit_logs` records `{revoked_session_count}`. |
| 04 | "delete_user_v1 ... soft-delete (set `deleted_at`)" | Implemented as soft-delete. Also `is_active=false` + sessions revoked. Last-admin guard raises `LAST_ADMIN_PROTECTED` with SQLSTATE `P0001` (custom). |
| 05 | "PermissionMatrix component consumes `has_permission()` lookup" | Reads from `role_permissions` JOIN `permissions` (effective grant matrix per role) — the table is the source of truth that `has_permission()` reads. Calling `has_permission()` once per (role, perm) cell would be O(R×P) RPC calls (5×109 = 545 round-trips) for a read-only view. The lookup is equivalent because Phase 1.B made `has_permission()` a pure data lookup against these tables. |

---

## 3. Migration (1)

`supabase/migrations/20260517000200_create_user_rpcs.sql` — five SECURITY DEFINER RPCs:

### 3.1 `create_user_v1`

Signature :
```sql
create_user_v1(
  p_employee_code TEXT,
  p_full_name     TEXT,
  p_role_code     TEXT,
  p_pin           TEXT  -- plaintext (hashed inside via hash_pin())
) RETURNS UUID
```

- Gated `users.create`.
- Validates `p_role_code` exists in `roles`, employee_code unique, pin
  length 4-8 digits, full_name non-empty.
- INSERTs `auth.users` row (synthetic email, disabled password) using same
  pattern as `supabase/seed.sql`.
- INSERTs `user_profiles` row (PIN hashed via `hash_pin()`).
- Audit row : `action='user.create'`, `entity_type='user_profile'`, `entity_id=new_id`,
  metadata `{employee_code, role_code, full_name}`.
- Returns the new `user_profiles.id`.

### 3.2 `update_user_role_v1`

Signature :
```sql
update_user_role_v1(
  p_user_id    UUID,    -- user_profiles.id
  p_new_role_code TEXT,
  p_reason     TEXT
) RETURNS jsonb
```

- Gated `users.update`.
- Validates target exists + not deleted, new role_code exists, reason
  ≥ 3 chars.
- UPDATE `user_profiles.role_code`.
- **Revoke sessions** : DELETE FROM `auth.sessions WHERE user_id = (auth_user_id of target)`
  AND UPDATE `user_sessions SET ended_at=now(), end_reason='role_changed'
  WHERE user_id = p_user_id AND ended_at IS NULL`.
- Audit row : `action='user.role_change'`, `entity_type='user_role'`,
  `entity_id=p_user_id`, metadata `{old_role, new_role, reason, revoked_session_count}`.
- Returns `{old_role, new_role, revoked_session_count}`.

### 3.3 `delete_user_v1`

Signature :
```sql
delete_user_v1(
  p_user_id UUID,    -- user_profiles.id
  p_reason  TEXT
) RETURNS jsonb
```

- Gated `users.update`.
- Validates reason ≥ 3 chars, target exists, target not already deleted.
- **Last-admin guard** : if target.role_code IN ('ADMIN','SUPER_ADMIN')
  AND `(SELECT count(*) FROM user_profiles WHERE role_code IN
  ('ADMIN','SUPER_ADMIN') AND deleted_at IS NULL AND id <> p_user_id) = 0`,
  RAISE EXCEPTION `LAST_ADMIN_PROTECTED` with SQLSTATE `P0001`.
- UPDATE `user_profiles SET deleted_at=now(), is_active=false`.
- Revoke active sessions (same pattern as role_change).
- Audit row : `action='user.delete'`, `entity_type='user_profile'`,
  `entity_id=p_user_id`, metadata `{role_code, reason, revoked_session_count}`.
- Returns `{deleted_at, revoked_session_count}`.

### 3.4 `update_user_profile_v1`

Signature :
```sql
update_user_profile_v1(
  p_user_id   UUID,
  p_full_name TEXT,
  p_employee_code TEXT
) RETURNS VOID
```

- Either caller is the target (self-update of name) OR
  `has_permission(caller, 'users.update')`.
- Validates name non-empty.
- UPDATE `user_profiles SET full_name = p_full_name, employee_code = p_employee_code`.
- Audit row `action='user.profile_update'`, `entity_type='user_profile'`,
  metadata `{old_full_name, new_full_name, old_emp_code, new_emp_code}`.

### 3.5 `reset_user_pin_v1`

Signature :
```sql
reset_user_pin_v1(
  p_user_id  UUID,
  p_new_pin  TEXT
) RETURNS VOID
```

- Either caller is the target OR `has_permission(caller, 'users.update')`.
- Validates pin length 4-8 digits.
- UPDATE `user_profiles SET pin_hash = hash_pin(p_new_pin),
  failed_login_attempts = 0, locked_until = NULL`.
- Audit row `action='user.pin_reset'`, `entity_type='user_profile'`,
  metadata `{by_admin: <bool>}`.

### 3.6 Grants

`GRANT EXECUTE ... TO authenticated`. The `has_permission()` gate inside
each body is the access control mechanism.

---

## 4. Feature folder — `apps/backoffice/src/features/users/`

```
features/users/
  hooks/
    useUsersList.ts          -- SELECT user_profiles where deleted_at IS NULL
    useUserDetail.ts         -- single profile
    useCreateUser.ts         -- RPC create_user_v1
    useUpdateUserRole.ts     -- RPC update_user_role_v1
    useDeleteUser.ts         -- RPC delete_user_v1
    useResetUserPin.ts       -- RPC reset_user_pin_v1
    usePermissionMatrix.ts   -- SELECT role_permissions JOIN permissions
  components/
    UsersTable.tsx
    UserFormDialog.tsx       -- create (full_name, employee_code, role_code, pin)
    RoleChangeDialog.tsx     -- with warning "this will sign the user out of all devices"
    DeleteUserDialog.tsx     -- with reason + last-admin guard message
    PermissionMatrix.tsx     -- read-only table rows = perms, cols = roles, cells = ✓/✗
  __tests__/
    UserFormDialog.smoke.test.tsx
    DeleteUserDialog.lastAdmin.test.tsx
```

## 5. Pages

- `pages/users/UsersListPage.tsx` — table + "+ New user" button.
- `pages/users/NewUserPage.tsx` — opens `UserFormDialog` (create mode).
- `pages/users/UserDetailPage.tsx` — profile view + role-change/delete/reset-pin actions.
- `pages/users/PermissionsMatrixPage.tsx` — consume `usePermissionMatrix`.

## 6. Routes + layout

- `/backoffice/users` → list (permission `users.read`).
- `/backoffice/users/new` → form (permission `users.create`).
- `/backoffice/users/:id` → detail (permission `users.read`).
- `/backoffice/users/permissions` → matrix (permission `rbac.read`).
- Sidebar : "Users" group with sub-items "List", "New", "Permissions".

## 7. Tests

### 7.1 pgTAP — `supabase/tests/users.test.sql`

Tests T_USR_01..10 :

| # | Test | What it verifies |
|---|------|------------------|
| 01 | `create_user_v1` exists with expected signature | Function present. |
| 02 | `create_user_v1` denied for cashier | Permission gate. |
| 03 | `create_user_v1` happy path | Inserts auth.users + user_profiles, audit row. |
| 04 | `update_user_role_v1` happy path | Updates role_code, audit row with old/new/reason. |
| 05 | `update_user_role_v1` revokes sessions | After RPC, `user_sessions.ended_at` is set. |
| 06 | `delete_user_v1` happy path | Sets deleted_at + is_active=false + audit. |
| 07 | `delete_user_v1` last admin protected | Refuses when only one ADMIN/SUPER_ADMIN remains. |
| 08 | `reset_user_pin_v1` happy path | Updates pin_hash + clears locked_until + audit. |
| 09 | `update_user_profile_v1` self-or-admin | Caller=target allowed without users.update; non-self requires perm. |
| 10 | `has_permission()` not re-created | `SELECT prosrc FROM pg_proc WHERE proname='has_permission'` contains 'user_permission_overrides' (locked body). |

### 7.2 Vitest live — `supabase/tests/functions/users.test.ts`

Live RPC cycle :
- admin login → create → assign role → list → role change (audit, sessions
  revoked) → delete (refuse on last admin candidate, succeed on extra one).

### 7.3 BO smoke

- `UserFormDialog.smoke.test.tsx` : renders form, submit calls RPC.
- `DeleteUserDialog.lastAdmin.test.tsx` : mock RPC to throw `LAST_ADMIN_PROTECTED`
  → UI shows guard message.

---

## 8. Order of work

1. ✅ Sub-plan written + committed.
2. Write `users.test.sql` pgTAP (TDD, first run = fail).
3. Author migration `20260517000200`.
4. Apply via MCP `apply_migration`.
5. Re-run pgTAP, fix until green.
6. Regen types via MCP `generate_typescript_types`, write to
   `packages/supabase/src/types.generated.ts`, commit.
7. Vitest live test → run / fix until green.
8. BO feature folder + pages + smoke tests.
9. Routes/layout updates.
10. `pnpm typecheck` green; deviations doc updated; commit set.

---

## 9. DoD checklist (sync with INDEX line 975)

- [ ] 1 migration applied.
- [ ] Types regen committed.
- [ ] `pnpm typecheck` green.
- [ ] CI grep gate : `grep "CREATE OR REPLACE FUNCTION has_permission"` on
      `20260517000200` returns 0.
- [ ] Permission matrix renders the (role, permission) grid.
- [ ] Last-admin protection enforced (T_USR_07).
- [ ] Role change audit row exists (T_USR_04).
- [ ] Sessions revoked on role change (T_USR_05).
- [ ] Tests green : pgTAP + Vitest live + BO smoke.
- [ ] Deviations recorded in `docs/workplan/refs/2026-05-14-session-13-wave-5-deviations.md`.
- [ ] Commits squash-mergeable with Claude co-author.

---

*End of Phase 5.D plan. Written 2026-05-14.*
