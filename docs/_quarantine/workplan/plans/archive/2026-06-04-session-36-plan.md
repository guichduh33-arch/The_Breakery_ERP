# Session 36 — POS Correctness & Security Close-out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One subagent per Task; Waves A/B/C are independent and parallelizable. Recommended execution order is A→B→C (security-first), but any wave may run in isolation.

**Goal:** Close the residual POS correctness/security queue before the next feature wave. Three audit findings (F-008 anon RPC grant, F-002 enum drift dead branches, F-021 broken realtime typings) + three S35 execution follow-ups (idle→lock rewire, customer re-fetch on held restore, VKP a11y in modals). **Zero new feature** — corrections only.

**Architecture:** Wave A is the only DB-facing work: a single corrective migration (REVOKE pair on `send_items_to_kitchen`) plus a documentation-only verification that `kiosk-issue-jwt` carries no body PIN (it does not — confirmed). Waves B + C are front-only. F-002 adds an IO-free `orderTypeLabel` helper to `@breakery/domain` and rewires 3 POS display/history sites. F-021 drops a `'postgres_changes' as never` cast. Wave C rebinds POS idle to `authStore.lock()`, re-fetches the customer object on held-order restore, and portals the `<VirtualKeypadProvider>` overlay into the active Radix Dialog.

**Tech Stack:** React 18 + TypeScript (strict), Zustand, TanStack Query v5, Supabase JS (PIN-JWT fetch wrapper), Postgres (REVOKE pairs, pgTAP), Vitest + `@testing-library/react`, Tailwind semantic tokens (`@breakery/ui`). DB target: **cloud V3 dev `ikcyvlovptebroadgtvd` via MCP** (Docker retired). pnpm + turbo monorepo.

---

## Decisions ratified (2026-06-04 — locked by user, no further confirmation needed)

| Decision | Choice |
|---|---|
| F-002 fix shape | **Option A (locked)** — `orderTypeLabel` helper in `@breakery/domain` (covers full enum) + rewire 3 sites. **Option B (direct in-place replace) REJECTED 2026-06-04** — no ambiguity at execution. Split as Task B1 (helper + pure unit test) → Task B2 (rewire 3 sites + fixture, depends on B1). |
| kiosk-issue-jwt sweep | **Reduce scope** — EF has no body PIN (verified); document as "already compliant" deviation, no code change |
| idle→lock | **Rewire POS idle to `lock()` (locked)** — explicit, ratified reversal of the S35 decision "manual lock only — no idle→lock rewire" (2026-06-03). `lock()` preserves shift+cart vs `signOut()`. Conditional on `isAuthenticated`; BO stays logout-on-idle. Tracked `DEV-S36-C-01` (info). |
| F-017 stock threshold | **Leave as-is** (`<= 3`) — bakery rotation; out of scope unless business decides |
| F-021 type regen | **Conditional** — only regen if the package's Supabase JS types don't already expose the `'postgres_changes'` overload (Task 0 verifies) |

---

## ⚠️ Verified facts (read first)

1. **`order_type` enum is `('dine_in', 'take_out', 'delivery', 'b2b')`** — confirmed in `packages/supabase/src/types.generated.ts:7192,7402`. The correct UI value is `take_out`. `take_away` / `takeaway` are V2-era ghosts that never reach the code.

2. **F-008 grant is real** — `supabase/migrations/20260505000004_send_items_rpc.sql:40` = `GRANT EXECUTE ON FUNCTION send_items_to_kitchen(UUID[]) TO authenticated, anon;`. The RPC signature is `send_items_to_kitchen(UUID[])`.

3. **kiosk-issue-jwt has no body PIN** — `IssueRequest = { kiosk_id?, scope?, device_label? }` (`supabase/functions/kiosk-issue-jwt/index.ts:31-35`). The only secret is `SUPABASE_JWT_SECRET` (env). Nothing to migrate.

4. **F-021 cast is at `apps/pos/src/features/display/hooks/useDisplayRealtime.ts:35`** — `'postgres_changes' as never,`.

5. **idle is wired to logout** — `apps/pos/src/App.tsx:22` = `useIdleTimeout({ timeoutMinutes, onTimeout: logout });`. `useIdleTimeout({ timeoutMinutes, onTimeout })` signature (`packages/ui/src/hooks/useIdleTimeout.ts:27-29`). `authStore.lock()`/`unlock()` exist since S35.

6. **Held restore drops the customer object** — `apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts:54-56` sets `cart.customerId` only; `attachedCustomer` (badge) is never re-fetched.

7. **Highest applied migration is `20260620000016`** — next block base `20260620000017` (verify via `list_migrations` in Task 0).

---

## File Structure (created / modified)

### Wave A — Security
- Create migration: `supabase/migrations/<base>_017_revoke_send_items_to_kitchen_anon.sql`.
- Test (DB): `supabase/tests/send_items_anon_revoke.test.sql` (pgTAP).
- No code change for kiosk-issue-jwt (documentation-only — verified compliant).

### Wave B — Correctness
- Create: `packages/domain/src/orders/orderTypeLabel.ts` (+ `__tests__/orderTypeLabel.test.ts`); export from `packages/domain/src/orders/index.ts` (or `packages/domain/src/index.ts`).
- Modify: `apps/pos/src/features/display/components/OrderQueueTicker.tsx`, `apps/pos/src/features/display/components/CurrentOrderCard.tsx`, `apps/pos/src/features/order-history/OrderHistoryPanel.tsx`.
- Modify (fixture): `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx`.
- Modify: `apps/pos/src/features/display/hooks/useDisplayRealtime.ts` (drop `as never`).
- Test: `apps/pos/src/features/display/__tests__/order-type-label.smoke.test.tsx` (or extend existing display smoke).

### Wave C — S35 follow-ups
- Modify: `apps/pos/src/App.tsx` (idle→lock, conditional on auth).
- Modify: `apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts` (customer re-fetch).
- Modify: `packages/ui/src/components/VirtualKeypadProvider.tsx` (portal overlay into active Dialog).
- Test: `apps/pos/src/__tests__/idle-lock.smoke.test.tsx`, `apps/pos/src/features/heldOrders/__tests__/restore-customer-refetch.smoke.test.tsx`, `packages/ui/src/components/__tests__/vkp-dialog-a11y.test.tsx`.

---

## Task 0: Environment verification (cheap, do once up front)

**Files:** none (MCP queries + reads only). Record answers in the session INDEX under "Schema facts".

- [ ] **Step 1: Confirm the migration block base.** Run MCP `mcp__plugin_supabase_supabase__list_migrations` (project `ikcyvlovptebroadgtvd`), read the max `version`. Expected max `20260620000016` → use base `20260620000017`. If higher, bump and record.

- [ ] **Step 2: Confirm the `send_items_to_kitchen` signature + current grants.** Run MCP `execute_sql`:
  ```sql
  SELECT pg_get_function_identity_arguments('public.send_items_to_kitchen'::regprocedure) AS args;
  SELECT has_function_privilege('anon','public.send_items_to_kitchen(uuid[])','EXECUTE') AS anon_can_exec,
         has_function_privilege('authenticated','public.send_items_to_kitchen(uuid[])','EXECUTE') AS auth_can_exec;
  ```
  Expected before fix: `anon_can_exec = true`, `auth_can_exec = true`. Record the exact arg type string for the REVOKE migration.

- [ ] **Step 3: Confirm F-021 regen need.** Inspect the current Supabase Realtime types in the package: `git grep -n "postgres_changes" packages/supabase node_modules/@supabase/supabase-js/dist/**/*.d.ts` (or read `useOrdersRealtime`/`useKdsRealtime` to confirm they call `.on('postgres_changes', …)` with no cast). If a non-cast call already typechecks elsewhere in the repo, **no regen is needed** — F-021 is a pure cast removal. Record the decision (regen yes/no).

- [ ] **Step 4: Confirm the `OrderType` export path in `@breakery/domain`.** Run `git grep -n "OrderType" packages/domain/src` to locate the type and the right barrel for the new `orderTypeLabel` helper. Record the import path the POS sites will use.

---

# Wave A — Security (DB) — ~XS

**Approach:** One corrective migration applying the canonical S25 REVOKE pair to `send_items_to_kitchen`. No signature bump (the RPC body is fine — only the GRANT is over-broad). No type regen (no functional schema change). The `kiosk-issue-jwt` sweep item is closed by documentation (verified no body PIN).

### Task A1: REVOKE `send_items_to_kitchen` from anon + PUBLIC

**Files:**
- Create migration: `supabase/migrations/<base>_017_revoke_send_items_to_kitchen_anon.sql`
- Test (DB): `supabase/tests/send_items_anon_revoke.test.sql`

- [ ] **Step 1: Write the pgTAP test (failing baseline)**

```sql
-- supabase/tests/send_items_anon_revoke.test.sql
-- Run via MCP execute_sql wrapped in BEGIN; … ROLLBACK; (Docker retired).
BEGIN;
SELECT plan(2);

-- T1: anon must NOT have EXECUTE after the fix.
SELECT is(
  has_function_privilege('anon','public.send_items_to_kitchen(uuid[])','EXECUTE'),
  false,
  'T1 anon cannot EXECUTE send_items_to_kitchen'
);

-- T2: authenticated keeps EXECUTE.
SELECT is(
  has_function_privilege('authenticated','public.send_items_to_kitchen(uuid[])','EXECUTE'),
  true,
  'T2 authenticated retains EXECUTE'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it to verify T1 FAILS** (before the migration). Run via MCP `execute_sql`. Expected: T1 fails (`anon` still has EXECUTE = true), T2 passes.

- [ ] **Step 3: Write the migration**

```sql
-- <base>_017_revoke_send_items_to_kitchen_anon.sql
-- F-008 — send_items_to_kitchen (2026-05-05, pre-S20) granted EXECUTE to anon.
-- Apply the canonical S25 REVOKE pair (REVOKE FROM anon alone is insufficient:
-- anon inherits EXECUTE via PUBLIC membership). See CLAUDE.md Critical patterns S20.
REVOKE EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 4: Apply via MCP** (`apply_migration`, project `ikcyvlovptebroadgtvd`, name `revoke_send_items_to_kitchen_anon`, body = the SQL above).

- [ ] **Step 5: Re-run the pgTAP** (Step 1 file via `execute_sql`). Expected: 2/2 PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_revoke_send_items_to_kitchen_anon.sql supabase/tests/send_items_anon_revoke.test.sql
git commit -m "fix(db): REVOKE send_items_to_kitchen EXECUTE from anon + PUBLIC (F-008)"
```

### Task A2: Document kiosk-issue-jwt compliance (no code change)

**Files:** none (INDEX deviation entry only).

- [ ] **Step 1: Re-confirm by reading** `supabase/functions/kiosk-issue-jwt/index.ts`. Verify `IssueRequest` has no PIN/secret field and that the only secret is `getJwtSecret()` (env). No `x-…-pin` header consumption is needed because there is no PIN.

- [ ] **Step 2: Record the deviation** in the INDEX §Deviations as `DEV-S36-A-01` (Informational): "kiosk-issue-jwt carries no body PIN (only `kiosk_id`/`scope`/`device_label` + env JWT secret) — already compliant with the S25 PIN-in-header rule; the S25 backlog sweep line for this EF is closed with no change." No commit.

---

# Wave B — Correctness (front, TDD) — ~XS

**Approach (Option A — locked 2026-06-04, Option B rejected):** Add an IO-free `orderTypeLabel` helper to `@breakery/domain` that covers the full `OrderType` enum (**Task B1** — helper + pure unit test, no dependency), then rewire the 3 dead-branch POS sites + the fixture to use it (**Task B2** — depends on B1). Do NOT do a direct in-place `'take_away'`→`'take_out'` replace (Option B) — it does not prevent recurrence. Separately, drop the `as never` cast in `useDisplayRealtime` (**Task B3** — independent). All pure front fixes; no DB.

### Task B1: `orderTypeLabel` helper in `@breakery/domain`

**Files:**
- Create: `packages/domain/src/orders/orderTypeLabel.ts`
- Create test: `packages/domain/src/orders/__tests__/orderTypeLabel.test.ts`
- Modify barrel: `packages/domain/src/orders/index.ts` (export path per Task 0 Step 4)

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/orders/__tests__/orderTypeLabel.test.ts
import { describe, it, expect } from 'vitest';
import { ORDER_TYPE_LABELS, orderTypeLabel } from '../orderTypeLabel';
import type { OrderType } from '../../<path-per-task0>';

describe('orderTypeLabel', () => {
  it('maps every enum member to a human label', () => {
    expect(ORDER_TYPE_LABELS.dine_in).toBe('Dine-in');
    expect(ORDER_TYPE_LABELS.take_out).toBe('Takeaway');
    expect(ORDER_TYPE_LABELS.delivery).toBe('Delivery');
    expect(ORDER_TYPE_LABELS.b2b).toBe('B2B');
  });

  it('orderTypeLabel resolves known values', () => {
    expect(orderTypeLabel('take_out')).toBe('Takeaway');
    expect(orderTypeLabel('dine_in')).toBe('Dine-in');
  });

  it('orderTypeLabel falls back to the raw string for unknown values', () => {
    expect(orderTypeLabel('weird_value')).toBe('weird_value');
  });

  it('type-level: ORDER_TYPE_LABELS covers the whole OrderType union', () => {
    // Compile-time guard — every OrderType key must be present.
    const k: Record<OrderType, string> = ORDER_TYPE_LABELS;
    expect(Object.keys(k).length).toBe(4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @breakery/domain test orderTypeLabel` → FAIL (module not found).

- [ ] **Step 3: Implement the helper**

```ts
// packages/domain/src/orders/orderTypeLabel.ts
import type { OrderType } from '../<path-per-task0>';

/** Display labels for every order_type enum member (DB: dine_in|take_out|delivery|b2b). */
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  take_out: 'Takeaway',
  delivery: 'Delivery',
  b2b: 'B2B',
};

/** Resolve any order_type string to a label; unknown values pass through unchanged. */
export function orderTypeLabel(t: string): string {
  return (ORDER_TYPE_LABELS as Record<string, string>)[t] ?? t;
}
```
Add the export to the domain barrel (per Task 0 Step 4).

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @breakery/domain test orderTypeLabel` → PASS (4 tests). Run `pnpm --filter @breakery/domain typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/orders/orderTypeLabel.ts packages/domain/src/orders/__tests__/orderTypeLabel.test.ts packages/domain/src/orders/index.ts
git commit -m "feat(domain): orderTypeLabel helper covering the full order_type enum (F-002)"
```

### Task B2: Rewire the 3 dead-branch POS sites + fix the fixture

**Files:**
- Modify: `apps/pos/src/features/display/components/OrderQueueTicker.tsx` (line 33)
- Modify: `apps/pos/src/features/display/components/CurrentOrderCard.tsx` (line 55)
- Modify: `apps/pos/src/features/order-history/OrderHistoryPanel.tsx` (line 189)
- Modify (fixture): `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx` (line 48)
- Create test: `apps/pos/src/features/display/__tests__/order-type-label.smoke.test.tsx`

- [ ] **Step 1: Write the failing smoke test** (asserts the real DB value renders correctly)

```tsx
// apps/pos/src/features/display/__tests__/order-type-label.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderQueueTicker } from '../components/OrderQueueTicker';

// fakeOrder helper mirrors the existing OrderQueueTicker.test fixtures, but uses
// the REAL DB enum value 'take_out' (not the ghost 'take_away').
function fakeOrder(n: number) {
  return { id: String(n), order_number: `O${n}`, status: 'completed' as const,
    order_type: 'take_out' as const, table_number: null, created_at: new Date().toISOString() };
}

describe('order type labels use real enum values', () => {
  it('renders a take_out order as a pickup/takeaway label, not raw snake_case', () => {
    render(<OrderQueueTicker orders={[fakeOrder(1)] as never} />);
    // Must NOT show the raw enum value.
    expect(screen.queryByText('take_out')).not.toBeInTheDocument();
    // Must show a human label (Pickup or Takeaway depending on the component copy).
    expect(screen.getByText(/pickup|takeaway/i)).toBeInTheDocument();
  });
});
```
> Adapt props to the actual `OrderQueueTicker` signature (read it first). If it takes a different prop shape, mirror the existing `OrderQueueTicker.test.tsx` render call.

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @breakery/app-pos test order-type-label` → FAIL (current code maps `'take_away'`, so `take_out` falls through to raw display).

- [ ] **Step 3: Rewire the sites**

  - `OrderQueueTicker.tsx:33` — replace `if (orderType === 'take_away') return 'Pickup';` with logic keyed on `'take_out'` (keep the "Pickup" copy if that is the display word) — or call `orderTypeLabel(orderType)`.
  - `CurrentOrderCard.tsx:55` — replace `order.order_type === 'take_away'` with `order.order_type === 'take_out'` (or `orderTypeLabel`).
  - `OrderHistoryPanel.tsx:189` — replace the `'takeaway'` ternary with `orderTypeLabel(row.order_type)`.
  - Import `orderTypeLabel` from `@breakery/domain` where used.

- [ ] **Step 4: Fix the fixture** — `OrderQueueTicker.test.tsx:48` `order_type: 'take_away'` → `order_type: 'take_out'`.

- [ ] **Step 5: Run tests** — `pnpm --filter @breakery/app-pos test order-type-label` → PASS. Run the existing display suite: `pnpm --filter @breakery/app-pos test OrderQueueTicker` → PASS (fixture now valid). Verify the sweep: `git grep -n "take_away\|takeaway" apps/pos/src` → only the 2 image-ref comments remain (`ActiveOrderPanel.tsx:15`, `HeldOrdersModal.tsx:10`).

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/features/display/components/OrderQueueTicker.tsx apps/pos/src/features/display/components/CurrentOrderCard.tsx apps/pos/src/features/order-history/OrderHistoryPanel.tsx apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx apps/pos/src/features/display/__tests__/order-type-label.smoke.test.tsx
git commit -m "fix(pos): use real take_out enum value via orderTypeLabel — kill dead take_away branches (F-002)"
```

### Task B3: Drop `'postgres_changes' as never` in `useDisplayRealtime`

**Files:**
- Modify: `apps/pos/src/features/display/hooks/useDisplayRealtime.ts` (line 35)
- (Conditional) Regen: `packages/supabase/src/types.generated.ts` (only if Task 0 Step 3 says regen is needed)

- [ ] **Step 1: Read the hook + a clean reference** — Read `useDisplayRealtime.ts` and `apps/pos/src/features/orders/hooks/useOrdersRealtime.ts` (or `apps/pos/src/features/kds/hooks/useKdsRealtime.ts`) to copy the non-cast `.on('postgres_changes', { … }, cb)` idiom that already typechecks.

- [ ] **Step 2: Remove the cast** — replace `'postgres_changes' as never,` with `'postgres_changes',` and align the filter object + callback typing to match the clean reference. Preserve the **unique-channel-name-per-mount** guard (critical pattern: StrictMode double-mount). If a regen is required (Task 0 Step 3), run MCP `generate_typescript_types` → write `packages/supabase/src/types.generated.ts` → commit it in the same change.

- [ ] **Step 3: Verify** — `pnpm --filter @breakery/app-pos typecheck` → PASS (0 errors). Run the display smoke suite: `pnpm --filter @breakery/app-pos test display` → PASS (no realtime regression). Confirm `git grep -n "as never" apps/pos/src/features/display/hooks/useDisplayRealtime.ts` → no match.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/features/display/hooks/useDisplayRealtime.ts
# include packages/supabase/src/types.generated.ts only if regenerated
git commit -m "fix(pos): drop 'postgres_changes' as never cast in useDisplayRealtime (F-021)"
```

---

# Wave C — S35 follow-ups (front, low) — ~S

**Approach:** Three small, independent rewires. C1 swaps POS idle behaviour to `lock()` (ratified reversal of the S35 "manual lock only" decision — record `DEV-S36-C-01`). C2 re-fetches the customer object on held-order restore. C3 portals the VKP overlay into the active Radix Dialog so it is not `aria-hidden`.

### Task C1: idle → `lock()` (POS, conditional on auth) — ratified reversal of S35 decision (`DEV-S36-C-01`)

**Files:**
- Modify: `apps/pos/src/App.tsx` (line 22)
- Test: `apps/pos/src/__tests__/idle-lock.smoke.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/pos/src/__tests__/idle-lock.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the onTimeout callback passed to useIdleTimeout.
let capturedOnTimeout: (() => void) | undefined;
vi.mock('@breakery/ui', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, useIdleTimeout: (args: { onTimeout: () => void }) => { capturedOnTimeout = args.onTimeout; } };
});

import { useAuthStore } from '@/stores/authStore';

describe('POS idle → lock', () => {
  beforeEach(() => {
    capturedOnTimeout = undefined;
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'A', role_code: 'CASHIER', employee_code: 'E1' },
      sessionToken: 'tok', permissions: [], isAuthenticated: true, isLoading: false,
      error: null, sessionTimeoutMinutes: 30, isLocked: false,
    } as never);
  });

  it('idle timeout locks (not logs out) when authenticated', async () => {
    await import('../App'); // mounting wires useIdleTimeout; adapt if App needs a render
    // If App must be rendered to wire the hook, render it under the test providers instead.
    expect(typeof capturedOnTimeout).toBe('function');
    capturedOnTimeout?.();
    expect(useAuthStore.getState().isLocked).toBe(true);
  });
});
```
> Adapt to how `App` mounts (it may need `render(<App/>)` with the test providers). The contract under test: the `onTimeout` callback sets `isLocked=true` (lock) rather than calling `signOut`/`logout` when `isAuthenticated`.

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @breakery/app-pos test idle-lock` → FAIL (current `onTimeout: logout`).

- [ ] **Step 3: Implement** — In `apps/pos/src/App.tsx`:
  - Read `isAuthenticated` + `lock` from `useAuthStore`.
  - Replace `useIdleTimeout({ timeoutMinutes, onTimeout: logout });` with:
    ```ts
    useIdleTimeout({ timeoutMinutes, onTimeout: () => { if (useAuthStore.getState().isAuthenticated) useAuthStore.getState().lock(); } });
    ```
  - (Keep `logout` imported if used elsewhere; otherwise remove the now-unused import.) Do NOT touch the BackOffice idle wiring.

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @breakery/app-pos test idle-lock` → PASS. Re-run the existing auth/golden-path smokes to confirm no regression: `pnpm --filter @breakery/app-pos test golden-path` → PASS.

- [ ] **Step 5: Record `DEV-S36-C-01`** in the INDEX §Deviations (Informational): S35 plan ratified "manual lock only — no idle→lock rewire" (2026-06-03); S36 explicitly reverses it (ratified user 2026-06-04) because `lock()` preserves shift+cart vs `signOut()`. POS only; BO stays logout-on-idle.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/App.tsx apps/pos/src/__tests__/idle-lock.smoke.test.tsx
git commit -m "feat(pos): idle timeout locks the terminal instead of logging out (S35 reversal, DEV-S36-C-01)"
```

### Task C2: customer re-fetch on held-order restore (DEV-S35-C-05)

**Files:**
- Modify: `apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts`
- Test: `apps/pos/src/features/heldOrders/__tests__/restore-customer-refetch.smoke.test.tsx`

- [ ] **Step 1: Locate the customer lookup primitive** — `git grep -n "searchCustomers\|useCustomerLookup\|from('customers')" apps/pos/src` to find the existing client-side customer fetch (the `CustomerAttachModal` path). Decide whether to call a service fn (preferred, keeps the mutation testable) or a direct SELECT.

- [ ] **Step 2: Write the failing test**

```tsx
// apps/pos/src/features/heldOrders/__tests__/restore-customer-refetch.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { useCartStore } from '@/stores/cartStore';

// RPC returns customerId only (mirrors restore_held_order_v1).
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: { order_id: 'o1', order_type: 'dine_in',
      customerId: 'c1', tableNumber: null, notes: null, items: [] }, error: null }),
    // customer lookup mock (adapt to the real primitive found in Step 1):
    from: vi.fn().mockReturnValue({ select: () => ({ eq: () => ({ single: () =>
      Promise.resolve({ data: { id: 'c1', name: 'Jean Habitué' }, error: null }) }) }) }),
  },
}));

import { useRestoreHeldOrder } from '../hooks/useRestoreHeldOrder';

function wrap({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => { useCartStore.getState().clearCart?.(); });

describe('restore re-attaches the customer object', () => {
  it('restores attachedCustomer (badge), not just customerId', async () => {
    const { result } = renderHook(() => useRestoreHeldOrder(), { wrapper: wrap });
    await result.current.mutateAsync('o1');
    await waitFor(() => {
      const cart = useCartStore.getState().cart ?? useCartStore.getState();
      // assert the attached customer object (name) is present, adapt to the store shape:
      expect(JSON.stringify(cart)).toContain('Jean Habitué');
    });
  });
});
```
> Adapt the customer-lookup mock + the cart-store assertion to the real shapes found in Step 1 and `cartStore`.

- [ ] **Step 3: Run it to verify it fails** — `pnpm --filter @breakery/app-pos test restore-customer-refetch` → FAIL (only `customerId` is set today).

- [ ] **Step 4: Implement** — In `useRestoreHeldOrder.ts`, after the cart remap (line ~61): if `payload.customerId !== null`, fetch the customer object via the Step-1 primitive and set `attachedCustomer` on the cart/store (use the same shape `CustomerAttachModal` produces). Keep `customerId` set regardless (pricing/JE depend on it; the fetch is best-effort — on lookup error, log + keep `customerId` only).

- [ ] **Step 5: Run test to verify it passes** — `pnpm --filter @breakery/app-pos test restore-customer-refetch` → PASS. Re-run `pnpm --filter @breakery/app-pos test held-orders` → PASS (no regression).

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts apps/pos/src/features/heldOrders/__tests__/restore-customer-refetch.smoke.test.tsx
git commit -m "fix(pos): re-fetch customer object on held-order restore — restore the badge (DEV-S35-C-05)"
```

### Task C3: portal the VKP overlay into the active Radix Dialog (DEV-S35-E3-01)

**Files:**
- Modify: `packages/ui/src/components/VirtualKeypadProvider.tsx`
- Test: `packages/ui/src/components/__tests__/vkp-dialog-a11y.test.tsx`

- [ ] **Step 1: Read the current provider** — Read `VirtualKeypadProvider.tsx` to find where the overlay is rendered (root-level today). Identify whether it uses `createPortal`/a fixed root container.

- [ ] **Step 2: Write the failing test**

```tsx
// packages/ui/src/components/__tests__/vkp-dialog-a11y.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Dialog from '@radix-ui/react-dialog';
import { VirtualKeypadProvider } from '../VirtualKeypadProvider';

// Render an input inside a Radix Dialog wrapped by the VKP provider. Focusing the
// input opens the keypad; its overlay must NOT be aria-hidden.
function Harness() {
  return (
    <VirtualKeypadProvider>
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Content>
            <input aria-label="reason" data-vkp inputMode="text" />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </VirtualKeypadProvider>
  );
}

describe('VKP a11y inside a Radix Dialog', () => {
  it('keypad overlay is not aria-hidden when opened from a dialog input', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText('reason'));
    const overlay = screen.getByTestId('vkp-overlay'); // ensure the provider tags it
    expect(overlay).not.toHaveAttribute('aria-hidden', 'true');
    expect(overlay.closest('[aria-hidden="true"]')).toBeNull();
  });
});
```
> If the provider does not yet expose a `data-testid="vkp-overlay"`, add it as part of the fix. Adapt the open-trigger to the provider's actual focus-intercept mechanism.

- [ ] **Step 3: Run it to verify it fails** — `pnpm --filter @breakery/ui test vkp-dialog-a11y` → FAIL (overlay rendered at root, inherits Radix's `aria-hidden` on the rest of the tree).

- [ ] **Step 4: Implement** — In `VirtualKeypadProvider.tsx`: when the keypad opens, detect the nearest open Radix Dialog content container of the focused input (e.g. `document.activeElement?.closest('[role="dialog"]')` or the Radix content node) and `createPortal` the overlay into that container instead of `document.body`. When no dialog is active, keep the current root-level render. Fallback (per spec §4.3 risk): if container detection is unreliable, render the overlay at root with a `z-index` above the dialog AND set an explicit `aria-live`/non-hidden wrapper so it is announced. Tag the overlay with `data-testid="vkp-overlay"`.

- [ ] **Step 5: Run test to verify it passes** — `pnpm --filter @breakery/ui test vkp-dialog-a11y` → PASS. Re-run the existing VKP suite: `pnpm --filter @breakery/ui test VirtualKeypadProvider` → PASS (no regression to the non-dialog path). Run `pnpm --filter @breakery/ui typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/VirtualKeypadProvider.tsx packages/ui/src/components/__tests__/vkp-dialog-a11y.test.tsx
git commit -m "fix(ui): portal VirtualKeypad overlay into the active Radix Dialog — not aria-hidden (DEV-S35-E3-01)"
```

---

# Close-out

### Task Z: Final verification + INDEX + CLAUDE.md bump

- [ ] **Step 1: Full typecheck** — `pnpm typecheck` → expect PASS across all packages (baseline env-gated failures preserved: ~3 POS + ~24 BO `VITE_SUPABASE_URL Required`, NOT regressions — DEV-S25-2.A-02). Diff against `master` if in doubt.

- [ ] **Step 2: Targeted suites** —
  - `pnpm --filter @breakery/domain test orderTypeLabel` → PASS.
  - `pnpm --filter @breakery/app-pos test order-type-label` / `OrderQueueTicker` / `display` / `idle-lock` / `restore-customer-refetch` / `held-orders` / `golden-path` → PASS.
  - `pnpm --filter @breakery/ui test vkp-dialog-a11y` / `VirtualKeypadProvider` → PASS.
  - pgTAP `send_items_anon_revoke` (MCP `execute_sql`) → 2/2 PASS.

- [ ] **Step 3: Sweep guard** — `git grep -n "take_away\|takeaway" apps/pos/src` → only the 2 image-ref comments. `git grep -n "as never" apps/pos/src/features/display/hooks/useDisplayRealtime.ts` → no match.

- [ ] **Step 4: Write the INDEX** — fill `docs/workplan/plans/2026-06-04-session-36-INDEX.md` (scope delivered, migration applied, tests run, deviations, schema facts from Task 0, out-of-scope).

- [ ] **Step 5: Bump `CLAUDE.md` §Active Workplan** — Current session → S36; move S35 → Previous session reference; add S36 follow-ups out-of-scope; bump "Migration sequence active" with the S36 block (`20260620000017`).

- [ ] **Step 6: Finalize the branch** — squash-merge `swarm/session-36` per phase (conventional commits already per-task). Do not force-push `master`.

---

## Notes for executors

- **DB target is cloud V3 dev `ikcyvlovptebroadgtvd` via MCP** — never `pnpm db:reset` / `supabase start` (Docker retired). pgTAP runs via `execute_sql` `BEGIN; … ROLLBACK;`.
- **Critical patterns to respect** (CLAUDE.md): REVOKE pair = `FROM anon, PUBLIC` + `ALTER DEFAULT PRIVILEGES … FROM PUBLIC` (Task A1); `packages/domain` IO-free (Task B1 — no fetch/Supabase/React); unique realtime channel name per mount (Task B3 — preserve); after any schema change regen types + commit (Task B3 conditional).
- **Recommended agent routing**: Wave A → `db-engineer` + `test-engineer`; Wave B → `pos-specialist` (+ domain helper) + `test-engineer`; Wave C → `pos-specialist` (C1/C2) + `backoffice-specialist`/UI owner (C3); pre-merge → `pattern-guardian` read-only diff review.
