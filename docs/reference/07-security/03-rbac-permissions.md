# 03 — RBAC & Permissions

> **Last verified**: 2026-05-03

## Overview

AppGrav V2 uses a three-tier RBAC model:

1. **Roles** — coarse-grained groupings (`SUPER_ADMIN`, `OWNER`, `ADMIN`, `MANAGER`, `CASHIER`, `BAKER`, `INVENTORY`, `SERVER`, `BARISTA`, `KITCHEN`, `VIEWER`). Stored in `roles` with a `hierarchy_level` (0-100). Users get one or more via `user_roles`.
2. **Permissions** — fine-grained codes of the form `<module>.<action>` (e.g., `sales.void`, `accounting.journal.create`). Stored in `permissions`. Wired to roles via `role_permissions`.
3. **User-level overrides** — `user_permissions` rows can grant or revoke a specific code for an individual user, with optional time bounds (`valid_from`, `valid_until`). Overrides win over role-based grants — see the resolution order in `user_has_permission()` ([02-rls-patterns.md](./02-rls-patterns.md)).

The same permission code is checked **three times** (defence-in-depth):

- **UI level** — `<PermissionGuard permission="...">` hides the button (so the user does not see it).
- **Edge Function** — `supabase.rpc('user_has_permission', { p_user_id, p_permission_code })` rejects the call (so a crafted HTTP request is denied).
- **RLS** — the `WITH CHECK` clause on the table policy rejects the row (so even a service-role caller running on behalf of a user is blocked).

## Permission codes (canonical list)

Source: [src/types/auth.ts:150-238](../../../src/types/auth.ts) (`TPermissionCode` union), seeded by initial migrations and reflected in `permissions` table.

| Module | Codes |
|---|---|
| **admin** | `admin.roles`, `admin.permissions`, `admin.audit` |
| **sales** | `sales.view`, `sales.create`, `sales.void`, `sales.discount`, `sales.refund`, `sales.report`, `sales.export` |
| **inventory** | `inventory.view`, `inventory.create`, `inventory.update`, `inventory.delete`, `inventory.adjust`, `inventory.transfer` |
| **products** | `products.view`, `products.create`, `products.update`, `products.delete`, `products.pricing` |
| **customers** | `customers.view`, `customers.create`, `customers.update`, `customers.delete`, `customers.loyalty` |
| **reports** | `reports.view`, `reports.sales`, `reports.sales.personal`, `reports.inventory`, `reports.financial`, `reports.analytics`, `reports.purchases`, `reports.audit`, `reports.alerts`, `reports.export`, `reports.configure` |
| **users** | `users.view`, `users.create`, `users.update`, `users.delete`, `users.roles`, `users.permissions` |
| **accounting** | `accounting.view`, `accounting.manage`, `accounting.journal.create`, `accounting.journal.update`, `accounting.vat.manage` |
| **expenses** | `expenses.view`, `expenses.create`, `expenses.update`, `expenses.delete`, `expenses.approve`, `expenses.categories` |
| **settings** | `settings.view`, `settings.update`, `settings.backup`, `settings.network`, `backoffice.access` |
| **production** | `production.view`, `production.create`, `production.update`, `production.recipes` |
| **purchases** | `purchases.view`, `purchases.create`, `purchases.approve`, `purchases.receive` |
| **pos** | `pos.open_drawer`, `pos.close_session`, `pos.no_sale`, `pos.price_override`, `pos.access` |
| **kds** | `kds.view`, `kds.update` |

`is_sensitive = true` permissions (subset) require an extra confirmation modal in the UI before invocation: `sales.void`, `sales.refund`, `sales.discount`, `pos.price_override`, `users.delete`, `users.roles`, `accounting.journal.update`. The `is_sensitive` flag lives on each row of `permissions` and is exposed to the client via `IEffectivePermission.is_sensitive`.

## Roles (hierarchy)

| Code | Hierarchy | Typical scope |
|---|---|---|
| `SUPER_ADMIN` | 100 | Engineering / break-glass; cannot be deleted. |
| `OWNER` | 90 | Business owner; full read+write on all modules. |
| `ADMIN` | 80 | Day-to-day admin; can manage users, products, settings. |
| `MANAGER` | 70 | Shift manager; void/refund/discount + reports + cash mgmt. |
| `BAKER` | 60 | Production + recipes + inventory adjust. |
| `INVENTORY` | 55 | Stock counts, transfers, supplier mgmt. |
| `CASHIER` | 50 | POS sales, no void/refund. |
| `SERVER` | 45 | Tablet ordering, table service. |
| `BARISTA` | 40 | KDS view, kitchen station. |
| `KITCHEN` | 40 | KDS view, kitchen station (savoury). |
| `VIEWER` | 10 | Read-only reports. |

Selectors derived from hierarchy:

- `selectIsAdmin` ([authStore.ts:302](../../../src/stores/authStore.ts)) — any of `SUPER_ADMIN`, `OWNER`, `ADMIN`.
- `selectIsSuperAdmin` — any of `SUPER_ADMIN`, `OWNER`.
- `selectIsManager` — any of `SUPER_ADMIN`, `OWNER`, `ADMIN`, `MANAGER`.
- `usePermissions().isManagerOrAbove` ([usePermissions.ts:91](../../../src/hooks/usePermissions.ts)) — derived from `hierarchy_level >= 70`.

## `usePermissions` hook signature

Source: [src/hooks/usePermissions.ts](../../../src/hooks/usePermissions.ts).

```ts
const {
  // Permission checks
  hasPermission,           // (code: TPermissionCode) => boolean
  hasAnyPermission,        // (codes: TPermissionCode[]) => boolean
  hasAllPermissions,       // (codes: TPermissionCode[]) => boolean
  canAccessModule,         // (module: TPermissionModule) => boolean
  isSensitivePermission,   // (code: TPermissionCode) => boolean

  // Role checks
  hasRole,                 // (code: TRoleCode) => boolean
  hasAnyRole,              // (codes: TRoleCode[]) => boolean
  isAdmin,                 // SUPER_ADMIN | OWNER | ADMIN
  isSuperAdmin,            // SUPER_ADMIN | OWNER
  isManagerOrAbove,        // hierarchy_level >= 70
  primaryRole,             // role with highest hierarchy_level

  // Data
  permissions,             // IEffectivePermission[]
  roles,                   // IRole[]
  user,                    // UserProfile | null
  accessibleModules,       // TPermissionModule[] (set of modules with >= 1 granted perm)
  getModulePermissions,    // (module) => IEffectivePermission[]
  getGrantedModulePermissions, // (module) => IEffectivePermission[]
} = usePermissions();
```

Memoisation: `hasPermission` is wrapped in `useCallback`, so callsites passing it as a dep to React Query / effects do not retrigger on every render unless the underlying `permissions` array changes.

## Guard components

### `<PermissionGuard>` — element-level

Source: [src/components/auth/PermissionGuard.tsx](../../../src/components/auth/PermissionGuard.tsx).

```tsx
// Single permission
<PermissionGuard permission="sales.void">
  <VoidButton />
</PermissionGuard>

// Multiple — ANY grants access (default)
<PermissionGuard permissions={['sales.void', 'sales.refund']}>
  <SensitiveActions />
</PermissionGuard>

// Multiple — ALL required
<PermissionGuard permissions={['inventory.view', 'inventory.update']} requireAll>
  <InventoryEditor />
</PermissionGuard>

// Role-based
<PermissionGuard role="MANAGER">
  <ManagerDashboard />
</PermissionGuard>

// With visible "Access denied" instead of hiding
<PermissionGuard permission="accounting.manage" showAccessDenied>
  <ChartOfAccountsEditor />
</PermissionGuard>
```

Default behaviour when no permission/role is supplied: **deny** (secure default).

### `<ModuleAccessGuard>` — module-level

Source: [src/components/auth/ModuleAccessGuard.tsx](../../../src/components/auth/ModuleAccessGuard.tsx).

Wraps an entire route. Checks `canAccessModule(module)` (i.e. user has at least one granted permission in that module). Used in route files, e.g. accounting routes wrap the whole tree in `<ModuleAccessGuard module="accounting">`.

### `<POSAccessGuard>` and `<BackOfficeAccessGuard>`

Top-level route guards that gate the two app contexts:

- `POSAccessGuard` — requires `pos.access` and an active POS session, redirects to `/pos/login` otherwise.
- `BackOfficeAccessGuard` — requires `backoffice.access`, redirects to `/login` otherwise.

Both are layered above `ModuleErrorBoundary` and `ModuleAccessGuard`, so a single missing permission cannot crash the rest of the app.

## Where each layer is enforced

| Layer | What | Where checked | Failure mode |
|---|---|---|---|
| UI | Hide / disable button | `<PermissionGuard>`, `usePermissions().hasPermission` | Button not rendered (or rendered with `showAccessDenied`) |
| Route | Redirect away | `<ModuleAccessGuard>`, `<BackOfficeAccessGuard>` | Redirect to `/forbidden` or `/login` |
| Edge Function | Reject request | `supabase.rpc('user_has_permission', {...})` | HTTP 403 with `{error: 'Permission denied: <code>'}` |
| RLS | Reject row write | `WITH CHECK (public.user_has_permission(auth.uid(), '<code>'))` | Postgres `42501` insufficient_privilege |

The triple-check is intentional — a UI bug or a stale build cannot leak a privileged action because the Edge Function or RLS policy will still refuse.

## Pattern: gating a sensitive action

```tsx
// 1. UI hides the button unless the user has the right
<PermissionGuard permission="sales.void">
  <Button onClick={handleVoid}>Void Order</Button>
</PermissionGuard>

// 2. Hook wraps the call in a sensitivity check
function handleVoid() {
  if (isSensitivePermission('sales.void')) {
    requirePinConfirmation(() => voidOrder.mutate(orderId));
  } else {
    voidOrder.mutate(orderId);
  }
}

// 3. The mutation calls an RPC; the RPC re-checks the permission
// (in PL/pgSQL: IF NOT public.user_has_permission(auth.uid(), 'sales.void') THEN RAISE EXCEPTION ...)

// 4. Even if (3) is bypassed, the RLS UPDATE policy on `orders` enforces
//    WITH CHECK (public.user_has_permission(auth.uid(), 'sales.void'))
//    when status transitions to 'voided'.
```

## Updating permissions for a role

Single source of truth is the `update_role_permissions(p_role_id uuid, p_permission_ids uuid[])` RPC. The admin UI calls it from `src/pages/admin/RolesPage.tsx`. The RPC:

- Takes the new permission set as a UUID array.
- Diffs against `role_permissions.role_id = p_role_id`.
- Inserts the additions, deletes the removals, leaves untouched the unchanged.
- Wraps the change in a transaction.
- Records the diff in `audit_logs` via a trigger.

Roles flagged `is_system = true` (`SUPER_ADMIN`, `OWNER`) cannot have their permission set reduced — the RPC raises `EXCEPTION 'Cannot modify system role'`.

## Time-boxed grants

`user_roles.valid_from / valid_until` and `user_permissions.valid_from / valid_until` let admins grant temporary privileges (e.g., a substitute manager for a 2-week shift). The `user_has_permission()` SQL helper filters on these bounds with `(valid_from IS NULL OR valid_from <= NOW())` and `(valid_until IS NULL OR valid_until > NOW())`, so an expired grant silently disappears without a manual revoke.

## Edge Function pattern (re-stated)

Every Edge Function that mutates data:

```ts
// 1. Resolve caller identity
const session = await validateSessionToken(req);            // x-session-token (PIN flow)
//   OR
const { data: { user } } = await supabaseAuth.auth.getUser(); // JWT (admin flow)
const requestingUserId = await resolveProfileId(callerAuthId);

// 2. Re-check permission server-side (defence-in-depth, never trust the client)
const { data: hasPermission } = await supabase.rpc('user_has_permission', {
  p_user_id: requestingUserId,
  p_permission_code: 'users.update',
});
if (!hasPermission) {
  return errorResponse('Permission denied: users.update required', 403, req);
}

// 3. Perform the mutation with service_role client (bypasses RLS for performance,
//    but the permission check above ensures correctness)
await supabaseAdmin.from('user_profiles').update(...).eq('id', target_id);

// 4. Log to audit_logs
await supabase.from('audit_logs').insert({ user_id: requestingUserId, action, ... });
```

Concrete example: [auth-user-management/index.ts:118-131](../../../supabase/functions/auth-user-management/index.ts) computes the required permission per action (`users.create | users.update | users.delete`) and rejects with 403 before touching any table.

## Bootstrapping a new role / permission

1. Add the code to the `TPermissionCode` union in [src/types/auth.ts](../../../src/types/auth.ts).
2. Insert the row into `permissions` via a migration (with `module`, `action`, `name_*`, `is_sensitive`).
3. Wire the permission to the relevant roles via `role_permissions` inserts.
4. Add `<PermissionGuard>` / `usePermissions` checks in UI.
5. Add `WITH CHECK (public.user_has_permission(auth.uid(), '<code>'))` to RLS policies that gate the action.
6. Add `user_has_permission` calls in any Edge Function that mutates the same data.
7. Re-run `/security-review` and `/db-schema-audit`.

## Cross-references

- [01-auth-flow-pin.md](./01-auth-flow-pin.md) — how the permission set arrives in the client (returned by `auth-verify-pin` and `auth-get-session`).
- [02-rls-patterns.md](./02-rls-patterns.md) — `user_has_permission()` SQL body and resolution order (direct override → role grant).
- [04-edge-function-security.md](./04-edge-function-security.md) — full Edge Function permission template.
- [src/types/auth.ts](../../../src/types/auth.ts) — TypeScript source of truth for permission and role types.
