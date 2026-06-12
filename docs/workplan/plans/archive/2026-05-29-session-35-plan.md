# Session 35 — POS Service Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One subagent per Task; Waves A–E are independent and parallelizable, but the recommended execution order is A→B→C→D→E (quick-win-first).

**Goal:** Close the 5 *Major* POS audit findings (F-014 Lock Terminal, F-009 Settings Printing tab, F-003 Held orders DB-backed, F-007 Customer Display live cart mirror, F-005 Virtual keypad) so the POS keeps its doc promises, persists held orders across crashes/terminals, and lets managers self-configure.

**Architecture:** All front-only except F-003. F-003 adds an `is_held BOOLEAN` flag on `orders` (Option A — ratified) plus 3 SECURITY DEFINER RPCs (`hold_order_v1`/`restore_held_order_v1`/`discard_held_order_v1`) modeled on the existing `create_tablet_order_v2` "create order from cart payload" RPC; the POS `heldOrdersStore` becomes a TanStack-Query cache over `SELECT … WHERE is_held` with a realtime sub. F-009 adds a `usePosSettingsStore` (Zustand `persist`, `localStorage`, key `pos:settings`) and refactors `printService` to read the server URL at call-time. F-014 adds an `isLocked` flag to `authStore` + a `<TerminalLockedOverlay>` re-auth gate (cart/shift live in separate stores, untouched). F-007 mirrors the cart to `/display` via `BroadcastChannel`. F-005 adds a `<VirtualKeypadProvider>` + `<QwertyLayout>` to `packages/ui`.

**Tech Stack:** React 18 + TypeScript (strict), Zustand (`persist`), TanStack Query v5, Supabase JS (PIN-JWT fetch wrapper), Postgres (SECURITY DEFINER RPCs, pgTAP), Vitest + `@testing-library/react`, Tailwind semantic tokens (`@breakery/ui`). DB target: **cloud V3 dev `ikcyvlovptebroadgtvd` via MCP** (Docker retired). pnpm + turbo monorepo.

---

## ⚠️ Deviations from the spec (read first)

The spec (`docs/workplan/specs/2026-05-29-session-35-spec.md`) was written 2026-05-29 against assumptions that no longer hold. These are **ratified corrections**:

1. **DEV-S35-PLAN-01 — No S34 draft-order flow exists.** The spec's F-003 premise ("réutilise le draft-order flow S34 / `create_draft_order_with_items_v1`") is wrong: S34 shipped **Station Ticket Printing**, not draft orders, and no `create_draft_order_with_items_v1` migration exists. F-003 therefore builds `hold_order_v1` from scratch, modeled on the canonical "create order from a cart JSONB payload" RPC **`create_tablet_order_v2`** (`supabase/migrations/20260602000011_*`). `cartStore` has **no `draftOrderId` field** — holds are keyed by the returned `order_id` stored in `heldOrdersStore`/query cache instead.

2. **DEV-S35-PLAN-02 — Audit table + permission-gate helper must be verified via MCP (Task 0).** Exploration surfaced two audit conventions in the repo (`audit_log(actor_profile_id, action, subject_table, subject_id, payload)` in a 2026-05-15 migration vs the S25+ CLAUDE.md convention `audit_logs(actor_id, action, entity_type, entity_id, metadata)`) and an out-of-date hardcoded `has_permission`. **Task 0 establishes the exact current table name, columns, and gate helper signature**; every RPC task below references "the verified audit/gate convention from Task 0."

3. **DEV-S35-PLAN-03 — Migration block is `20260620000010..` (verify in Task 0).** Highest existing migration is `20260619000043_gate_customers_read.sql` (timestamps are NOT chronological with session numbers — S34 reused `20260601043059`). Pick the next block strictly above the live `schema_migrations.version` max.

4. **DEV-S35-PLAN-04 — F-015 already partially resolved by S35a.** `printService.SERVER_URL` already reads `import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001'` (line 8) with a code comment anticipating `usePosSettingsStore > VITE_PRINT_SERVER_URL > fallback`. F-009 completes that chain at runtime.

5. **DEV-S35-PLAN-05 — `NumpadVirtual` already exists** (`packages/ui`, modes `pin|cash|numeric`). F-005 reuses its key primitives; only `<QwertyLayout>` + `<VirtualKeypadProvider>` are net-new.

---

## Decisions ratified (2026-06-03)

| Decision | Choice |
|---|---|
| F-003 held persistence | **Option A** — `orders.is_held BOOLEAN` flag (no ENUM ADD VALUE) |
| F-003 discard permission | **Reuse `orders.void`** (no new perm seeded) |
| F-009 settings persistence | **`localStorage` / Zustand `persist`** (`usePosSettingsStore`, key `pos:settings`) — per-terminal |
| F-014 idle behaviour | **Manual lock only** — `useIdleTimeout` (S19) keeps `signOut()`; no idle→lock rewire |

---

## File Structure (created / modified)

### Wave A — F-014 Lock Terminal
- Modify: `apps/pos/src/stores/authStore.ts` — add `isLocked` state + `lock()` / `unlock()` actions.
- Create: `apps/pos/src/features/auth/TerminalLockedOverlay.tsx` — full-screen re-auth gate (UserPicker + PinPad).
- Modify: `apps/pos/src/pages/Pos.tsx` — wire `onLockTerminal`, render overlay when `isLocked`.
- Test: `apps/pos/src/stores/__tests__/authStore.lock.test.ts`, `apps/pos/src/features/auth/__tests__/terminal-locked-overlay.smoke.test.tsx`.

### Wave B — F-009 Settings Printing tab (+ F-015 completion)
- Create: `apps/pos/src/stores/posSettingsStore.ts` — Zustand `persist` (`pos:settings`).
- Modify: `apps/pos/src/services/print/printService.ts` — `SERVER_URL` const → `getServerUrl()` call-time getter reading the store.
- Modify: `apps/pos/src/features/payment/SuccessModal.tsx` — gate print + drawer on `autoPrint` / `autoOpenDrawer` toggles.
- Create: `apps/pos/src/features/settings/components/PrintingSettingsTab.tsx`.
- Modify: `apps/pos/src/features/settings/POSSettingsPage.tsx` — replace `topTab==='printing'` stub (line 78) with `<PrintingSettingsTab/>`.
- Test: `apps/pos/src/stores/__tests__/posSettingsStore.test.ts`, `apps/pos/src/features/settings/__tests__/printing-settings-tab.smoke.test.tsx`, extend `apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx`.

### Wave C — F-003 Held orders DB-backed
- Create migrations (block `20260620000010..`, exact base from Task 0):
  - `_010_add_is_held_to_orders.sql` — column + partial index.
  - `_011_create_hold_order_v1.sql` + `_012_revoke_hold_order_v1.sql`.
  - `_013_create_restore_held_order_v1.sql` + `_014_revoke_restore_held_order_v1.sql`.
  - `_015_create_discard_held_order_v1.sql` + `_016_revoke_discard_held_order_v1.sql`.
- Test (DB): `supabase/tests/held_orders.test.sql` (pgTAP).
- Regen: `packages/supabase/src/types.generated.ts`.
- Create: `apps/pos/src/features/heldOrders/hooks/useHeldOrdersQuery.ts`, `useHoldOrder.ts`, `useDiscardHeldOrder.ts`, `apps/pos/src/features/heldOrders/hooks/useHeldOrdersRealtime.ts`.
- Modify: `apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts` (call `restore_held_order_v1`), `apps/pos/src/features/heldOrders/components/HoldOrderButton.tsx`, `apps/pos/src/features/cart/HeldOrdersModal.tsx`, `apps/pos/src/features/heldOrders/components/HeldOrdersInboxButton.tsx`.
- Test (POS): `apps/pos/src/features/heldOrders/__tests__/hold-order-db.smoke.test.tsx`, `held-orders-query.smoke.test.tsx`.

### Wave D — F-007 Customer Display live cart mirror
- Create: `apps/pos/src/features/display/hooks/useCartBroadcast.ts` (emitter), `useCartBroadcastReceiver.ts` (receiver), `apps/pos/src/features/display/CDActiveCartView.tsx`.
- Modify: `apps/pos/src/features/cart/ActiveOrderPanel.tsx` (mount emitter), `apps/pos/src/features/display/CustomerDisplayPage.tsx` (mount receiver + `CDActiveCartView`, remove Phase-5.A comment).
- Test: `apps/pos/src/features/display/__tests__/cart-broadcast.smoke.test.tsx`, `cd-active-cart-view.smoke.test.tsx`.

### Wave E — F-005 Virtual keypad
- Create: `packages/ui/src/components/QwertyLayout.tsx`, `packages/ui/src/components/VirtualKeypadProvider.tsx`, `packages/ui/src/hooks/useVirtualKeypad.ts`.
- Modify: `packages/ui/src/index.ts` (exports), `apps/pos/src/routes/index.tsx` (wrap `<PosPage/>`), `apps/pos/src/features/cart/CustomerAttachModal.tsx`, `packages/ui/src/components/DiscountModal.tsx`, `apps/pos/src/features/cart/CancelItemModal.tsx` (opt-in `data-vkp`).
- Test: `packages/ui/src/components/__tests__/QwertyLayout.test.tsx`, `VirtualKeypadProvider.test.tsx`, `apps/pos/src/features/cart/__tests__/customer-attach-vkp.smoke.test.tsx`.

---

## Task 0: Schema & environment verification (DB-facing, do once before Wave C; cheap, do up front)

**Files:** none (MCP queries only). Record answers in the session INDEX under "Schema facts".

- [ ] **Step 1: Confirm the migration block base.**

Run (MCP `mcp__plugin_supabase_supabase__list_migrations`, project `ikcyvlovptebroadgtvd`) and read the max `version`. Then choose the next block as `2026MMDD000010` strictly greater than the max. Expected: max is `20260619000043` → use base `20260620000010`. If the live max is higher, bump accordingly and record the chosen base.

- [ ] **Step 2: Confirm the audit table name + columns.**

Run (MCP `execute_sql`):
```sql
SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS cols
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('audit_logs','audit_log')
GROUP BY table_name;
```
Record the exact table name + column set. The RPC tasks below are written against **`audit_logs(actor_id, action, entity_type, entity_id, metadata)`** (S25+ convention). **If the live table differs, adjust every `INSERT INTO audit_logs …` in Wave C to match.**

- [ ] **Step 3: Confirm the permission-gate helper.**

Run (MCP `execute_sql`):
```sql
SELECT p.proname, pg_get_function_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('has_permission','authorize','check_permission')
ORDER BY 1;
```
Also inspect one recent gated RPC for the canonical idiom:
```sql
SELECT pg_get_functiondef('public.record_b2b_payment_v1'::regprocedure);
```
Record the exact gate expression (e.g. `IF NOT has_permission(auth.uid(), 'orders.void') THEN RAISE EXCEPTION …`). Wave C RPCs use **that verified idiom** for the gates `sales.create` (hold/restore) and `orders.void` (discard).

- [ ] **Step 4: Confirm `order_status` enum + `orders`/`order_items` columns used by the cart→order writer.**

Run (MCP `execute_sql`):
```sql
SELECT enum_range(NULL::order_status);
SELECT pg_get_functiondef('public.create_tablet_order_v2'::regprocedure);
```
Read `create_tablet_order_v2`'s body — it is the **canonical template** for inserting an `orders` row + looping `order_items` from a cart payload (item columns: `order_id, product_id, name_snapshot, quantity, unit_price, modifiers, …`). Wave C's `hold_order_v1` mirrors its INSERT shape exactly. Record the precise `order_items` column list and the `orders` columns it sets (`status, order_type, session_id, customer_id, table_number, created_via, idempotency_key, totals`).

- [ ] **Step 5: Confirm the idempotency-keys table + REVOKE template** by reading the two S25 migrations (no DB call needed):

Read `supabase/migrations/20260602000010_create_tablet_order_idempotency_keys_table.sql` and `…000012_revoke_anon_create_tablet_order_v2.sql`. Wave C reuses both shapes verbatim (a dedicated `held_order_idempotency_keys` table + the canonical REVOKE pair: `REVOKE EXECUTE … FROM PUBLIC; REVOKE EXECUTE … FROM anon; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;`).

---

# Wave A — F-014 Lock Terminal (quick win, ~1-2j)

**Approach:** Add an `isLocked` flag to `authStore` that keeps `user`/`sessionToken`/`permissions` intact (so the Supabase PIN-JWT stays valid and `cartStore`/`shiftStore` are untouched). The `<TerminalLockedOverlay>` re-auths via the existing login flow; a same-user unlock just clears the flag, a different-user unlock does a full `login()`.

### Task A1: `authStore` lock/unlock state

**Files:**
- Modify: `apps/pos/src/stores/authStore.ts`
- Test: `apps/pos/src/stores/__tests__/authStore.lock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/pos/src/stores/__tests__/authStore.lock.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../authStore';

const AUTHED = {
  user: { id: 'u1', full_name: 'Tester', role_code: 'CASHIER', employee_code: 'E1' },
  sessionToken: 'tok',
  permissions: ['pos.sale.create'],
  isAuthenticated: true,
  isLoading: false,
  error: null,
  sessionTimeoutMinutes: 30,
  isLocked: false,
} as const;

describe('authStore lock/unlock', () => {
  beforeEach(() => { useAuthStore.setState({ ...AUTHED } as never); });

  it('lock() sets isLocked true but preserves session, user, permissions', () => {
    useAuthStore.getState().lock();
    const s = useAuthStore.getState();
    expect(s.isLocked).toBe(true);
    expect(s.user?.id).toBe('u1');
    expect(s.sessionToken).toBe('tok');
    expect(s.permissions).toEqual(['pos.sale.create']);
    expect(s.isAuthenticated).toBe(true);
  });

  it('unlock() clears isLocked without touching the session', () => {
    useAuthStore.getState().lock();
    useAuthStore.getState().unlock();
    const s = useAuthStore.getState();
    expect(s.isLocked).toBe(false);
    expect(s.sessionToken).toBe('tok');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test authStore.lock`
Expected: FAIL — `lock is not a function` / `isLocked` undefined.

- [ ] **Step 3: Implement `isLocked` + `lock`/`unlock`**

In `apps/pos/src/stores/authStore.ts`, add to the `AuthState` interface (next to `isAuthenticated`):
```ts
  isLocked: boolean;
  lock: () => void;
  unlock: () => void;
```
Add `isLocked: false` to the store's initial state object, and implement the actions inside the `create(persist((set, get) => ({ … })))` body:
```ts
  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),
```
In `logout()`, also set `isLocked: false` in the reset (so a fresh login never starts locked). Do **not** add `isLocked` to `partialize` — lock state must not survive a page reload (a reload re-runs login/validateSession).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test authStore.lock`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/stores/authStore.ts apps/pos/src/stores/__tests__/authStore.lock.test.ts
git commit -m "feat(pos): authStore lock/unlock — pause terminal without dropping the PIN session"
```

### Task A2: `<TerminalLockedOverlay>` re-auth gate

**Files:**
- Create: `apps/pos/src/features/auth/TerminalLockedOverlay.tsx`
- Test: `apps/pos/src/features/auth/__tests__/terminal-locked-overlay.smoke.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/pos/src/features/auth/__tests__/terminal-locked-overlay.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAuthStore } from '@/stores/authStore';
import { TerminalLockedOverlay } from '../TerminalLockedOverlay';

const loginMock = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'u1', full_name: 'Alice', role_code: 'CASHIER', employee_code: 'E1' },
    sessionToken: 'tok', permissions: [], isAuthenticated: true, isLoading: false,
    error: null, sessionTimeoutMinutes: 30, isLocked: true,
    login: loginMock, unlock: () => useAuthStore.setState({ isLocked: false } as never),
  } as never);
});

describe('TerminalLockedOverlay', () => {
  it('renders the locked state with the current user name', () => {
    render(<TerminalLockedOverlay />);
    expect(screen.getByText(/locked/i)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('a correct PIN re-auths via login() and unlocks', async () => {
    render(<TerminalLockedOverlay />);
    for (const d of '123456') {
      fireEvent.click(screen.getByRole('button', { name: d }));
    }
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('u1', '123456'));
    await waitFor(() => expect(useAuthStore.getState().isLocked).toBe(false));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test terminal-locked-overlay`
Expected: FAIL — module `../TerminalLockedOverlay` not found.

- [ ] **Step 3: Implement the overlay**

```tsx
// apps/pos/src/features/auth/TerminalLockedOverlay.tsx
import { useState } from 'react';
import { Lock } from 'lucide-react';
import { FullScreenModal, NumpadPin } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';

/**
 * Shown over the whole POS when authStore.isLocked is true. The cashier (or a
 * colleague) re-enters a PIN to resume. The session token, cart, and shift are
 * never cleared — login() re-issues the JWT and unlock() drops the gate.
 */
export function TerminalLockedOverlay() {
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const unlock = useAuthStore((s) => s.unlock);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(pin: string) {
    if (!user) return;
    setError(null);
    setIsVerifying(true);
    try {
      await login(user.id, pin);
      unlock();
    } catch {
      setError('Incorrect PIN');
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <FullScreenModal open onOpenChange={() => { /* gate — cannot dismiss */ }} title="Terminal locked">
      <div className="m-auto w-full max-w-sm space-y-6 text-center">
        <div className="grid place-items-center">
          <div className="h-16 w-16 rounded-full bg-gold-soft border border-gold grid place-items-center">
            <Lock className="h-7 w-7 text-gold" aria-hidden />
          </div>
        </div>
        <div className="space-y-1">
          <h2 className="font-serif text-2xl">Terminal locked</h2>
          <p className="text-text-secondary text-sm">{user?.full_name ?? 'Cashier'} — enter your PIN to resume</p>
        </div>
        <NumpadPin onSubmit={(pin) => { void handleSubmit(pin); }} isLoading={isVerifying} error={error} />
      </div>
    </FullScreenModal>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test terminal-locked-overlay`
Expected: PASS (2 tests). (`NumpadPin` renders digit buttons labelled `0`–`9` and auto-submits on `maxLength` 6.)

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/auth/TerminalLockedOverlay.tsx apps/pos/src/features/auth/__tests__/terminal-locked-overlay.smoke.test.tsx
git commit -m "feat(pos): TerminalLockedOverlay — PIN re-auth gate preserving cart + shift"
```

### Task A3: Wire `onLockTerminal` + render overlay in `Pos.tsx`

**Files:**
- Modify: `apps/pos/src/pages/Pos.tsx`
- Test: `apps/pos/src/pages/__tests__/pos-lock-terminal.smoke.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/pos/src/pages/__tests__/pos-lock-terminal.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAuthStore } from '@/stores/authStore';
import { TerminalLockedOverlay } from '@/features/auth/TerminalLockedOverlay';

// This locks in the contract: when isLocked, the overlay is rendered.
describe('POS lock terminal wiring', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Bob', role_code: 'CASHIER', employee_code: 'E1' },
      sessionToken: 'tok', permissions: [], isAuthenticated: true, isLoading: false,
      error: null, sessionTimeoutMinutes: 30, isLocked: true,
      login: async () => {}, unlock: () => {},
    } as never);
  });

  it('renders TerminalLockedOverlay when authStore.isLocked is true', () => {
    render(<TerminalLockedOverlay />);
    expect(screen.getByRole('heading', { name: /terminal locked/i })).toBeInTheDocument();
  });
});
```

> Note: this is a thin contract guard (rendering full `PosPage` pulls heavy providers). The real wiring is verified by inspection in Step 3 + the A2 overlay test.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test pos-lock-terminal`
Expected: PASS only after A2 exists; if A2 done, it already passes — so first assert the **wiring** is absent by grepping. Run: `git grep -n "onLockTerminal" apps/pos/src/pages/Pos.tsx` → Expected: no match (callback not wired yet).

- [ ] **Step 3: Implement the wiring**

In `apps/pos/src/pages/Pos.tsx`:
1. Import: `import { TerminalLockedOverlay } from '@/features/auth/TerminalLockedOverlay';`
2. Read lock state + action near the other `useAuthStore` selectors:
```tsx
  const isLocked = useAuthStore((s) => s.isLocked);
  const lock = useAuthStore((s) => s.lock);
```
3. Pass the callback to `<SideMenuDrawer>` (alongside the existing props, ~line 170-180):
```tsx
        onLockTerminal={() => { setMenuOpen(false); lock(); }}
```
4. Render the overlay at the end of the page tree (after the other modals), so it covers everything when locked:
```tsx
      {isLocked && <TerminalLockedOverlay />}
```

- [ ] **Step 4: Verify**

Run: `git grep -n "onLockTerminal\|TerminalLockedOverlay" apps/pos/src/pages/Pos.tsx` → Expected: 2+ matches.
Run: `pnpm --filter @breakery/app-pos test pos-lock-terminal` → Expected: PASS.
Run: `pnpm --filter @breakery/app-pos typecheck` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/pages/Pos.tsx apps/pos/src/pages/__tests__/pos-lock-terminal.smoke.test.tsx
git commit -m "feat(pos): wire Lock Terminal — SideMenuDrawer callback + overlay gate"
```

---

# Wave B — F-009 Settings Printing tab + F-015 completion (~3-5j)

### Task B1: `usePosSettingsStore` (Zustand persist)

**Files:**
- Create: `apps/pos/src/stores/posSettingsStore.ts`
- Test: `apps/pos/src/stores/__tests__/posSettingsStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/pos/src/stores/__tests__/posSettingsStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { usePosSettingsStore } from '../posSettingsStore';

describe('posSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    usePosSettingsStore.setState({ printerUrl: '', autoPrint: true, autoOpenDrawer: true });
  });

  it('defaults: empty url, autoPrint + autoOpenDrawer on', () => {
    const s = usePosSettingsStore.getState();
    expect(s.printerUrl).toBe('');
    expect(s.autoPrint).toBe(true);
    expect(s.autoOpenDrawer).toBe(true);
  });

  it('setPrinterUrl persists to localStorage under pos:settings', () => {
    usePosSettingsStore.getState().setPrinterUrl('http://192.168.1.50:3001');
    expect(usePosSettingsStore.getState().printerUrl).toBe('http://192.168.1.50:3001');
    const raw = localStorage.getItem('pos:settings');
    expect(raw).toContain('192.168.1.50');
  });

  it('toggles flip booleans', () => {
    usePosSettingsStore.getState().setAutoPrint(false);
    usePosSettingsStore.getState().setAutoOpenDrawer(false);
    const s = usePosSettingsStore.getState();
    expect(s.autoPrint).toBe(false);
    expect(s.autoOpenDrawer).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test posSettingsStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```ts
// apps/pos/src/stores/posSettingsStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface PosSettingsState {
  printerUrl: string;        // '' = fall back to VITE_PRINT_SERVER_URL then localhost:3001
  autoPrint: boolean;        // auto-print receipt on SuccessModal mount
  autoOpenDrawer: boolean;   // auto-pop the cash drawer (cash payments)
  setPrinterUrl: (url: string) => void;
  setAutoPrint: (on: boolean) => void;
  setAutoOpenDrawer: (on: boolean) => void;
}

export const usePosSettingsStore = create<PosSettingsState>()(
  persist(
    (set) => ({
      printerUrl: '',
      autoPrint: true,
      autoOpenDrawer: true,
      setPrinterUrl: (url) => set({ printerUrl: url.trim() }),
      setAutoPrint: (on) => set({ autoPrint: on }),
      setAutoOpenDrawer: (on) => set({ autoOpenDrawer: on }),
    }),
    {
      name: 'pos:settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ printerUrl: s.printerUrl, autoPrint: s.autoPrint, autoOpenDrawer: s.autoOpenDrawer }),
    },
  ),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test posSettingsStore`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/stores/posSettingsStore.ts apps/pos/src/stores/__tests__/posSettingsStore.test.ts
git commit -m "feat(pos): usePosSettingsStore — per-terminal print settings (localStorage pos:settings)"
```

### Task B2: `printService` reads the store at call-time (completes F-015)

**Files:**
- Modify: `apps/pos/src/services/print/printService.ts`
- Test: extend `apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx`

- [ ] **Step 1: Write the failing test (append a case)**

Append to the existing `print-server-url-config.smoke.test.tsx`:
```tsx
  it('prefers usePosSettingsStore.printerUrl over the env var', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_PRINT_SERVER_URL', 'http://env-host:3001');
    const { usePosSettingsStore } = await import('@/stores/posSettingsStore');
    usePosSettingsStore.setState({ printerUrl: 'http://store-host:3001' });
    const fetchSpy = mockFetchOk();
    const { openCashDrawer } = await import('@/services/print/printService');
    await openCashDrawer();
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('store-host');
    expect(calledUrl).not.toContain('env-host');
  });
```
(Reuse the file's existing `mockFetchOk()` helper; if it is local, keep it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test print-server-url-config`
Expected: FAIL — the request still uses the env host (URL resolved at module load).

- [ ] **Step 3: Implement the call-time getter**

In `apps/pos/src/services/print/printService.ts`, replace the module-level constant (line 8):
```ts
const SERVER_URL = import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001';
```
with a getter and update all usages:
```ts
import { usePosSettingsStore } from '@/stores/posSettingsStore';

/** Resolution order (DEV-S35-PLAN-04): store override > VITE env > localhost fallback. */
function getServerUrl(): string {
  const override = usePosSettingsStore.getState().printerUrl;
  if (override) return override;
  return import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001';
}
```
Then in `printReceipt`, `printStationTicket`, and `openCashDrawer`, replace every reference to `SERVER_URL` with `getServerUrl()` (the call is made at request time, so a settings change takes effect immediately — no reload).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test print-server-url-config`
Expected: PASS (existing cases + the new store-precedence case).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/services/print/printService.ts apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx
git commit -m "fix(pos): printService reads server URL from usePosSettingsStore at call-time (completes F-015)"
```

### Task B3: Gate auto-print + auto-drawer in `SuccessModal`

**Files:**
- Modify: `apps/pos/src/features/payment/SuccessModal.tsx`
- Test: `apps/pos/src/features/payment/__tests__/success-modal-auto-toggles.smoke.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/pos/src/features/payment/__tests__/success-modal-auto-toggles.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { printReceipt, openCashDrawer } from '@/services/print/printService';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { SuccessModal, type SuccessModalProps } from '../SuccessModal';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, Toaster: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) } }, supabaseUrl: 'http://x' }));
vi.mock('@/features/cart/hooks/useStationPrinters', () => ({ useStationPrinters: () => ({ data: new Map([['cashier', { ip_address: '1.1.1.1', port: 9100, name: 'C' }]]) }) }));
vi.mock('@/services/print/printService', () => ({ printReceipt: vi.fn().mockResolvedValue({ success: true }), openCashDrawer: vi.fn().mockResolvedValue({ success: true }), getMockPrintBuffer: () => [], clearMockPrintBuffer: () => undefined }));

const printMock = vi.mocked(printReceipt);
const drawerMock = vi.mocked(openCashDrawer);

function props(p?: Partial<SuccessModalProps>): SuccessModalProps {
  return { open: true, orderNumber: 'O1', total: 1000, changeGiven: 0, pointsEarned: 0, cashReceived: 1000, cashierName: 'C',
    cart: { items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
    paymentMethod: 'cash', onNewOrder: vi.fn(), ...p };
}
function wrap(n: React.ReactElement) { return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>; }

beforeEach(() => { vi.clearAllMocks(); });

describe('SuccessModal auto toggles', () => {
  it('autoPrint=false skips printReceipt on mount', async () => {
    usePosSettingsStore.setState({ autoPrint: false, autoOpenDrawer: true });
    render(wrap(<SuccessModal {...props()} />));
    await waitFor(() => expect(drawerMock).toHaveBeenCalled());
    expect(printMock).not.toHaveBeenCalled();
  });

  it('autoOpenDrawer=false skips openCashDrawer on mount', async () => {
    usePosSettingsStore.setState({ autoPrint: true, autoOpenDrawer: false });
    render(wrap(<SuccessModal {...props()} />));
    await waitFor(() => expect(printMock).toHaveBeenCalled());
    expect(drawerMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test success-modal-auto-toggles`
Expected: FAIL — both still fire unconditionally.

- [ ] **Step 3: Implement the gating**

In `apps/pos/src/features/payment/SuccessModal.tsx`, read the settings near the top of the component:
```ts
import { usePosSettingsStore } from '@/stores/posSettingsStore';
// …inside SuccessModal():
  const autoPrint = usePosSettingsStore((s) => s.autoPrint);
  const autoOpenDrawer = usePosSettingsStore((s) => s.autoOpenDrawer);
```
Rework the mount effect so each side effect is conditional (preserve the S35a `mountedRef` guard + cash-gated warning):
```ts
  useEffect(() => {
    mountedRef.current = true;
    if (!open) return;
    void (async () => {
      const tasks: Promise<unknown>[] = [];
      if (autoPrint) tasks.push(handlePrint());
      const drawerTask = autoOpenDrawer ? openCashDrawer() : Promise.resolve({ success: true } as const);
      tasks.push(drawerTask);
      const drawer = await drawerTask;
      await Promise.all(tasks);
      if (!mountedRef.current) return;
      if (autoOpenDrawer && props.paymentMethod === 'cash' && !drawer.success) {
        toast.warning('Cash drawer did not open — please open it manually');
      }
    })();
    return () => { mountedRef.current = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
```
The manual **Reprint** button (`handlePrint` via the footer) is unaffected — it always prints on demand.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test success-modal-auto-toggles`
Expected: PASS (2 tests). Then re-run the S35a guard test: `pnpm --filter @breakery/app-pos test cash-drawer-error-toast` → Expected: PASS (3 tests, defaults keep both toggles on).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/payment/SuccessModal.tsx apps/pos/src/features/payment/__tests__/success-modal-auto-toggles.smoke.test.tsx
git commit -m "feat(pos): SuccessModal honours autoPrint + autoOpenDrawer settings"
```

### Task B4: `<PrintingSettingsTab>` + wire into `POSSettingsPage`

**Files:**
- Create: `apps/pos/src/features/settings/components/PrintingSettingsTab.tsx`
- Modify: `apps/pos/src/features/settings/POSSettingsPage.tsx` (replace stub at line 78)
- Test: `apps/pos/src/features/settings/__tests__/printing-settings-tab.smoke.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/pos/src/features/settings/__tests__/printing-settings-tab.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { PrintingSettingsTab } from '../components/PrintingSettingsTab';

beforeEach(() => {
  localStorage.clear();
  usePosSettingsStore.setState({ printerUrl: '', autoPrint: true, autoOpenDrawer: true });
});

describe('PrintingSettingsTab', () => {
  it('editing the URL persists to the store', () => {
    render(<PrintingSettingsTab />);
    const input = screen.getByLabelText(/print server url/i);
    fireEvent.change(input, { target: { value: 'http://192.168.1.77:3001' } });
    expect(usePosSettingsStore.getState().printerUrl).toBe('http://192.168.1.77:3001');
  });

  it('toggling auto-print flips the store flag', () => {
    render(<PrintingSettingsTab />);
    fireEvent.click(screen.getByRole('switch', { name: /auto-print/i }));
    expect(usePosSettingsStore.getState().autoPrint).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test printing-settings-tab`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tab**

```tsx
// apps/pos/src/features/settings/components/PrintingSettingsTab.tsx
import { Input, SectionLabel } from '@breakery/ui';
import { usePosSettingsStore } from '@/stores/posSettingsStore';

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-3 border-b border-border-subtle"
    >
      <span className="text-sm text-text-primary">{label}</span>
      <span className={`h-6 w-11 rounded-full transition-colors ${checked ? 'bg-gold' : 'bg-bg-overlay'} relative`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

export function PrintingSettingsTab() {
  const { printerUrl, autoPrint, autoOpenDrawer, setPrinterUrl, setAutoPrint, setAutoOpenDrawer } = usePosSettingsStore();
  return (
    <div className="space-y-6 max-w-lg">
      <div className="space-y-2">
        <SectionLabel as="label" htmlFor="print-server-url">Print server URL</SectionLabel>
        <Input
          id="print-server-url"
          aria-label="Print server URL"
          placeholder="http://localhost:3001"
          value={printerUrl}
          onChange={(e) => setPrinterUrl(e.target.value)}
        />
        <p className="text-xs text-text-muted">Leave blank to use the build default (VITE_PRINT_SERVER_URL → localhost:3001).</p>
      </div>
      <div>
        <Toggle label="Auto-print receipt on payment" checked={autoPrint} onChange={setAutoPrint} />
        <Toggle label="Auto-open cash drawer (cash)" checked={autoOpenDrawer} onChange={setAutoOpenDrawer} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tab test**

Run: `pnpm --filter @breakery/app-pos test printing-settings-tab`
Expected: PASS (2 tests). (Confirm `SectionLabel` accepts `as="label"` + `htmlFor`; if not, use a plain `<label>`.)

- [ ] **Step 5: Wire into the page**

In `apps/pos/src/features/settings/POSSettingsPage.tsx`:
1. Import: `import { PrintingSettingsTab } from './components/PrintingSettingsTab';`
2. Replace line 78 `{topTab === 'printing' && <PlaceholderSection title="Printing" />}` with:
```tsx
        {topTab === 'printing' && <PrintingSettingsTab />}
```
Leave the `kds` / `devices` top-tabs as `PlaceholderSection` (out of scope this session).

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @breakery/app-pos test POSSettingsPage` → Expected: PASS (update the existing "switches to Printing placeholder" test if it asserts placeholder text — it should now assert the URL field appears).
Run: `pnpm --filter @breakery/app-pos typecheck` → Expected: PASS.
```bash
git add apps/pos/src/features/settings/components/PrintingSettingsTab.tsx apps/pos/src/features/settings/POSSettingsPage.tsx apps/pos/src/features/settings/__tests__/printing-settings-tab.smoke.test.tsx apps/pos/src/features/settings/__tests__/POSSettingsPage.test.tsx
git commit -m "feat(pos): POS Settings Printing tab — server URL + auto-print/drawer toggles (F-009)"
```

---

# Wave C — F-003 Held orders DB-backed (~3-5j, largest)

> **Prereq:** Task 0 completed. All RPC SQL below uses **the audit/gate convention verified in Task 0** — if the live audit table is not `audit_logs(actor_id, action, entity_type, entity_id, metadata)` or the gate idiom differs, adjust each RPC accordingly before applying.

### Task C1: `is_held` column + partial index

**Files:**
- Create migration: `supabase/migrations/<base>_010_add_is_held_to_orders.sql`

- [ ] **Step 1: Write the migration**

```sql
-- <base>_010_add_is_held_to_orders.sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_held BOOLEAN NOT NULL DEFAULT false;

-- Partial index: held lookups are a tiny slice of orders.
CREATE INDEX IF NOT EXISTS orders_is_held_idx
  ON public.orders (session_id, created_at DESC)
  WHERE is_held = true;
```

- [ ] **Step 2: Apply via MCP**

Apply with `mcp__plugin_supabase_supabase__apply_migration` (project `ikcyvlovptebroadgtvd`, name `add_is_held_to_orders`, body = the SQL above).
Verify: `execute_sql` → `SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='is_held';` → Expected: 1 row.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/*_add_is_held_to_orders.sql
git commit -m "feat(db): orders.is_held flag + partial index (F-003 held orders)"
```

### Task C2: `held_order_idempotency_keys` table + `hold_order_v1` RPC + REVOKE pair

**Files:**
- Create migration: `<base>_011_create_hold_order_v1.sql`
- Create migration: `<base>_012_revoke_hold_order_v1.sql`

- [ ] **Step 1: Write the table + RPC migration**

```sql
-- <base>_011_create_hold_order_v1.sql
-- Dedicated idempotency table (S25 pattern): one hold per client_uuid ("this cart, this tap").
CREATE TABLE IF NOT EXISTS public.held_order_idempotency_keys (
  client_uuid UUID PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.held_order_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.held_order_idempotency_keys FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.held_order_idempotency_keys FROM authenticated;
GRANT SELECT ON TABLE public.held_order_idempotency_keys TO authenticated;
CREATE POLICY held_order_idem_select_auth ON public.held_order_idempotency_keys
  FOR SELECT TO authenticated USING (true);

-- hold_order_v1: create a held (draft + is_held) order from a cart JSONB payload.
-- Mirrors create_tablet_order_v2's order + order_items insert shape (verified Task 0).
CREATE OR REPLACE FUNCTION public.hold_order_v1(
  p_client_uuid   UUID,
  p_cart_payload  JSONB,
  p_table_number  TEXT DEFAULT NULL,
  p_notes         TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_order_id   UUID;
  v_existing   UUID;
  v_item       JSONB;
  v_order_no   TEXT;
  v_subtotal   NUMERIC(12,2) := 0;
  v_total      NUMERIC(12,2) := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
  -- GATE: sales.create (use the exact idiom verified in Task 0)
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- Idempotency replay: same client_uuid → return the first order_id.
  SELECT order_id INTO v_existing FROM held_order_idempotency_keys WHERE client_uuid = p_client_uuid;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  -- Totals from the payload items (unit_price * quantity + modifier adjustments).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_payload->'items') LOOP
    v_subtotal := v_subtotal
      + ((v_item->>'unit_price')::NUMERIC * (v_item->>'quantity')::NUMERIC)
      + COALESCE((
          SELECT SUM((m->>'price_adjustment')::NUMERIC) * (v_item->>'quantity')::NUMERIC
          FROM jsonb_array_elements(COALESCE(v_item->'modifiers','[]'::jsonb)) m
        ), 0);
  END LOOP;
  v_total := v_subtotal; -- held orders are pre-tax drafts; tax computed at checkout.

  v_order_no := 'HOLD-' || to_char(now(),'YYYYMMDD') || '-' || substr(p_client_uuid::text,1,8);

  INSERT INTO orders (status, is_held, order_type, session_id, customer_id, table_number,
                      created_via, idempotency_key, order_number, subtotal, tax_amount, total, notes)
  VALUES ('draft', true,
          COALESCE(p_cart_payload->>'order_type','dine_in')::order_type,
          NULL, NULLIF(p_cart_payload->>'customerId','')::UUID, p_table_number,
          'pos', p_client_uuid, v_order_no, v_subtotal, 0, v_total, p_notes)
  RETURNING id INTO v_order_id;

  -- order_items loop (column list per Task 0 / create_tablet_order_v2).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_payload->'items') LOOP
    INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, modifiers)
    VALUES (v_order_id,
            (v_item->>'product_id')::UUID,
            v_item->>'name',
            (v_item->>'quantity')::NUMERIC,
            (v_item->>'unit_price')::NUMERIC,
            COALESCE(v_item->'modifiers','[]'::jsonb));
  END LOOP;

  INSERT INTO held_order_idempotency_keys (client_uuid, order_id) VALUES (p_client_uuid, v_order_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'order.held', 'orders', v_order_id,
          jsonb_build_object('table_number', p_table_number, 'item_count', jsonb_array_length(p_cart_payload->'items')));

  RETURN v_order_id;
EXCEPTION WHEN unique_violation THEN
  SELECT order_id INTO v_existing FROM held_order_idempotency_keys WHERE client_uuid = p_client_uuid;
  RETURN v_existing;
END $$;
```

- [ ] **Step 2: Write the REVOKE pair migration**

```sql
-- <base>_012_revoke_hold_order_v1.sql
REVOKE EXECUTE ON FUNCTION public.hold_order_v1(UUID, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_order_v1(UUID, JSONB, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hold_order_v1(UUID, JSONB, TEXT, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

- [ ] **Step 3: Apply both via MCP** (`apply_migration` ×2). Verify the function exists and anon lacks EXECUTE:
```sql
SELECT has_function_privilege('anon','public.hold_order_v1(uuid,jsonb,text,text)','EXECUTE') AS anon_can_exec;
```
Expected: `false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_create_hold_order_v1.sql supabase/migrations/*_revoke_hold_order_v1.sql
git commit -m "feat(db): hold_order_v1 RPC + idempotency table + REVOKE pair (F-003)"
```

### Task C3: `restore_held_order_v1` + REVOKE pair

**Files:**
- Create: `<base>_013_create_restore_held_order_v1.sql`, `<base>_014_revoke_restore_held_order_v1.sql`

- [ ] **Step 1: Write the RPC**

```sql
-- <base>_013_create_restore_held_order_v1.sql
-- Flip is_held=false and return the cart payload for rehydration (mirror pickup_tablet_order).
CREATE OR REPLACE FUNCTION public.restore_held_order_v1(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_order   RECORD;
  v_items   JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id, order_type, customer_id, table_number, notes
    INTO v_order
  FROM orders WHERE id = p_order_id AND is_held = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'held_order_not_found' USING ERRCODE='P0002'; END IF;

  UPDATE orders SET is_held = false, updated_at = now() WHERE id = p_order_id;

  SELECT jsonb_agg(jsonb_build_object(
           'product_id', oi.product_id, 'name', oi.name_snapshot,
           'quantity', oi.quantity, 'unit_price', oi.unit_price,
           'modifiers', COALESCE(oi.modifiers,'[]'::jsonb)))
    INTO v_items
  FROM order_items oi WHERE oi.order_id = p_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'order.held_restored', 'orders', p_order_id, '{}'::jsonb);

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_type', v_order.order_type,
    'customerId', v_order.customer_id,
    'tableNumber', v_order.table_number,
    'notes', v_order.notes,
    'items', COALESCE(v_items, '[]'::jsonb));
END $$;
```

- [ ] **Step 2: Write the REVOKE pair**

```sql
-- <base>_014_revoke_restore_held_order_v1.sql
REVOKE EXECUTE ON FUNCTION public.restore_held_order_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_held_order_v1(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.restore_held_order_v1(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

- [ ] **Step 3: Apply via MCP + verify** anon cannot execute (as in C2 Step 3).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_restore_held_order_v1.sql
git commit -m "feat(db): restore_held_order_v1 RPC + REVOKE pair (F-003)"
```

### Task C4: `discard_held_order_v1` (gate `orders.void`) + REVOKE pair

**Files:**
- Create: `<base>_015_create_discard_held_order_v1.sql`, `<base>_016_revoke_discard_held_order_v1.sql`

- [ ] **Step 1: Write the RPC**

```sql
-- <base>_015_create_discard_held_order_v1.sql
-- Discard a held order: status='voided'. Reason >= 10 chars. Gate: orders.void (ratified reuse).
CREATE OR REPLACE FUNCTION public.discard_held_order_v1(p_order_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
  IF NOT has_permission(v_uid, 'orders.void') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF length(trim(COALESCE(p_reason,''))) < 10 THEN
    RAISE EXCEPTION 'reason_too_short' USING ERRCODE='P0001';
  END IF;

  UPDATE orders
     SET status = 'voided', is_held = false, void_reason = p_reason, voided_by = v_uid, voided_at = now()
   WHERE id = p_order_id AND is_held = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'held_order_not_found' USING ERRCODE='P0002'; END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'order.held_discarded', 'orders', p_order_id, jsonb_build_object('reason', p_reason));
END $$;
```
> Note: confirm `orders` has `void_reason`/`voided_by`/`voided_at` (Task 0 Step 4 listed them). If absent, drop those SET columns and keep `status='voided'` + the audit row.

- [ ] **Step 2: Write the REVOKE pair**

```sql
-- <base>_016_revoke_discard_held_order_v1.sql
REVOKE EXECUTE ON FUNCTION public.discard_held_order_v1(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.discard_held_order_v1(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.discard_held_order_v1(UUID, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

- [ ] **Step 3: Apply via MCP + verify.**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_discard_held_order_v1.sql
git commit -m "feat(db): discard_held_order_v1 RPC (gate orders.void) + REVOKE pair (F-003)"
```

### Task C5: pgTAP suite for held orders

**Files:**
- Create: `supabase/tests/held_orders.test.sql`

- [ ] **Step 1: Write the pgTAP suite** (run inside a `BEGIN … ROLLBACK` envelope via `execute_sql`)

```sql
-- supabase/tests/held_orders.test.sql
BEGIN;
SELECT plan(10);

-- Fixtures: a CASHIER auth.uid + a MANAGER, a product. Use existing seed helpers if present;
-- otherwise create minimal rows. (Adapt to the project's pgTAP fixture convention from
-- supabase/tests/inventory.test.sql.)
-- … set up auth context via set_config('request.jwt.claims', …) per existing tests …

-- T1 happy: hold_order_v1 creates a draft+is_held order and returns its id
SELECT isnt(
  public.hold_order_v1(gen_random_uuid(),
    '{"items":[{"product_id":"<PID>","name":"Espresso","quantity":1,"unit_price":25000,"modifiers":[]}],"order_type":"dine_in"}'::jsonb,
    'T1', NULL),
  NULL, 'T1 hold_order_v1 returns an order id');

-- T2 the order row is draft + is_held=true
SELECT is((SELECT status::text FROM orders WHERE is_held), 'draft', 'T2 held order status = draft');
SELECT ok((SELECT is_held FROM orders WHERE is_held LIMIT 1), 'T2b is_held=true');

-- T3 idempotency: same client_uuid returns the same order id (no second row)
-- … call hold_order_v1 twice with a fixed client_uuid, assert equal + count(orders)=1 …
SELECT ok(true, 'T3 idempotent replay returns first order_id'); -- replace with real assert

-- T4 restore flips is_held=false and returns items
-- SELECT is((public.restore_held_order_v1('<OID>')->>'order_id'), '<OID>', 'T4 restore returns payload');
-- SELECT is((SELECT is_held FROM orders WHERE id='<OID>'), false, 'T4b is_held cleared');

-- T5 discard requires reason >= 10 chars → raises
SELECT throws_ok($$ SELECT public.discard_held_order_v1('<OID>','short') $$, 'P0001', NULL, 'T5 short reason rejected');

-- T6 discard happy → status voided
-- SELECT lives_ok($$ SELECT public.discard_held_order_v1('<OID>','customer left the queue') $$, 'T6 discard ok');
-- SELECT is((SELECT status::text FROM orders WHERE id='<OID>'),'voided','T6b voided');

-- T7 perm gate: a role lacking pos.sale.create → P0003 on hold
-- … switch jwt to a role without the perm, assert throws_ok P0003 …
SELECT ok(true, 'T7 perm gate enforced'); -- replace with real assert

-- T8 anon cannot execute hold_order_v1
SELECT is(has_function_privilege('anon','public.hold_order_v1(uuid,jsonb,text,text)','EXECUTE'), false, 'T8 anon revoked');

-- T9 restore on a non-held order → P0002
SELECT throws_ok($$ SELECT public.restore_held_order_v1(gen_random_uuid()) $$, 'P0002', NULL, 'T9 restore missing → not found');

-- T10 audit row written on hold
SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE action='order.held'), 'T10 audit logged');

SELECT * FROM finish();
ROLLBACK;
```
> Fill the `<PID>`/`<OID>` placeholders and auth-context setup using the exact fixture idiom from an existing pgTAP file (`supabase/tests/inventory.test.sql` or `orders_list_v2`). Every `SELECT ok(true, …)` marker MUST be replaced with a real assertion before this task is "done".

- [ ] **Step 2: Run via MCP** (`execute_sql`, paste the whole `BEGIN…ROLLBACK`). Expected: `# Looks like you passed 10 tests` / all `ok`.

- [ ] **Step 3: Iterate** until 10/10 pass (fix RPCs if a test surfaces a bug — log any corrective migration).

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/held_orders.test.sql
git commit -m "test(db): held_orders pgTAP 10/10 (hold/restore/discard/perm/idempotency)"
```

### Task C6: Regen types

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`

- [ ] **Step 1:** Regen via `mcp__plugin_supabase_supabase__generate_typescript_types`, write the result to `packages/supabase/src/types.generated.ts`.
- [ ] **Step 2:** Run `pnpm --filter @breakery/supabase typecheck` → Expected: PASS.
- [ ] **Step 3: Commit**
```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(db): regen types after F-003 held orders RPCs"
```

### Task C7: POS hooks — query, hold, restore, discard, realtime

**Files:**
- Create: `apps/pos/src/features/heldOrders/hooks/useHeldOrdersQuery.ts`, `useHoldOrder.ts`, `useDiscardHeldOrder.ts`, `useHeldOrdersRealtime.ts`
- Modify: `apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts`
- Test: `apps/pos/src/features/heldOrders/__tests__/held-orders-query.smoke.test.tsx`

- [ ] **Step 1: Write the failing test** (query hook shape + hold mutation calls the RPC)

```tsx
// apps/pos/src/features/heldOrders/__tests__/held-orders-query.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: (...a: unknown[]) => fromMock(...a),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), }),
    removeChannel: vi.fn(),
  },
}));

import { useHoldOrder } from '../hooks/useHoldOrder';

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { vi.clearAllMocks(); rpcMock.mockResolvedValue({ data: 'order-1', error: null }); });

describe('useHoldOrder', () => {
  it('calls hold_order_v1 with a client_uuid + cart payload', async () => {
    const { result } = renderHook(() => useHoldOrder(), { wrapper: wrap() });
    await result.current.mutateAsync({
      cartPayload: { items: [], order_type: 'dine_in' }, tableNumber: '5', notes: null,
    });
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('hold_order_v1', expect.objectContaining({
      p_cart_payload: expect.any(Object), p_table_number: '5',
    })));
    const arg = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(typeof arg.p_client_uuid).toBe('string');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test held-orders-query`
Expected: FAIL — `useHoldOrder` not found.

- [ ] **Step 3: Implement the hooks**

```ts
// apps/pos/src/features/heldOrders/hooks/useHoldOrder.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface HoldOrderArgs {
  cartPayload: Record<string, unknown>;
  tableNumber: string | null;
  notes: string | null;
}

export function useHoldOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cartPayload, tableNumber, notes }: HoldOrderArgs) => {
      const { data, error } = await supabase.rpc('hold_order_v1', {
        p_client_uuid: crypto.randomUUID(),
        p_cart_payload: cartPayload,
        p_table_number: tableNumber,
        p_notes: notes,
      });
      if (error) throw error;
      return data as string; // order_id
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['held-orders'] }); },
  });
}
```

```ts
// apps/pos/src/features/heldOrders/hooks/useHeldOrdersQuery.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface HeldOrderRow {
  id: string;
  order_number: string;
  table_number: string | null;
  notes: string | null;
  total: number;
  created_at: string;
}

export function useHeldOrdersQuery() {
  return useQuery({
    queryKey: ['held-orders'],
    queryFn: async (): Promise<HeldOrderRow[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, table_number, notes, total, created_at')
        .eq('is_held', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as HeldOrderRow[];
    },
  });
}
```

```ts
// apps/pos/src/features/heldOrders/hooks/useDiscardHeldOrder.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useDiscardHeldOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: string; reason: string }) => {
      const { error } = await supabase.rpc('discard_held_order_v1', { p_order_id: orderId, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['held-orders'] }); },
  });
}
```

```ts
// apps/pos/src/features/heldOrders/hooks/useHeldOrdersRealtime.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Invalidate the held-orders query on any orders change (multi-terminal visibility). */
export function useHeldOrdersRealtime(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const channelName = `held-orders-${crypto.randomUUID()}`; // StrictMode-safe: uuid inside effect
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes' as never, { event: '*', schema: 'public', table: 'orders' }, () => {
        void qc.invalidateQueries({ queryKey: ['held-orders'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);
}
```

- [ ] **Step 4: Rewire `useRestoreHeldOrder`**

Replace the body of `apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts` to call the RPC, then rehydrate the cart via `cartStore.restoreCart(...)` using the domain `fromHeldOrder` mapping where applicable:
```ts
// apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';

export function useRestoreHeldOrder() {
  const qc = useQueryClient();
  const restoreCart = useCartStore((s) => s.restoreCart);
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.rpc('restore_held_order_v1', { p_order_id: orderId });
      if (error) throw error;
      return data as {
        order_type: string; customerId: string | null; tableNumber: string | null;
        items: Array<{ product_id: string; name: string; quantity: number; unit_price: number; modifiers: unknown[] }>;
      };
    },
    onSuccess: (payload) => {
      restoreCart({
        items: payload.items.map((i) => ({
          id: crypto.randomUUID(), product_id: i.product_id, name: i.name,
          unit_price: i.unit_price, quantity: i.quantity, modifiers: (i.modifiers ?? []) as never[],
        })),
        order_type: payload.order_type as 'dine_in' | 'take_out',
        tableNumber: payload.tableNumber,
        customerId: payload.customerId,
      } as never);
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
    },
  });
}
```
> Confirm `restoreCart`'s exact `Cart` shape from `cartStore.ts` and adapt the mapping (the explorer confirmed `restoreCart(cart: Cart)` exists). Keep the domain `fromHeldOrder` helper if it cleanly maps the RPC payload; otherwise map inline as above.

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @breakery/app-pos test held-orders-query`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/features/heldOrders/hooks/*.ts apps/pos/src/features/heldOrders/__tests__/held-orders-query.smoke.test.tsx
git commit -m "feat(pos): held-orders DB hooks — query, hold, restore, discard, realtime"
```

### Task C8: Wire the UI (HoldOrderButton, HeldOrdersModal, InboxButton)

**Files:**
- Modify: `apps/pos/src/features/heldOrders/components/HoldOrderButton.tsx`, `apps/pos/src/features/cart/HeldOrdersModal.tsx`, `apps/pos/src/features/heldOrders/components/HeldOrdersInboxButton.tsx`
- Test: `apps/pos/src/features/heldOrders/__tests__/hold-order-db.smoke.test.tsx`

- [ ] **Step 1: Write the failing test** (HoldOrderButton calls `useHoldOrder` with the current cart, then clears it)

```tsx
// apps/pos/src/features/heldOrders/__tests__/hold-order-db.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mutateAsync = vi.fn().mockResolvedValue('order-1');
vi.mock('../hooks/useHoldOrder', () => ({ useHoldOrder: () => ({ mutateAsync, isPending: false }) }));

import { HoldOrderButton } from '../components/HoldOrderButton';
import { useCartStore } from '@/stores/cartStore';

function wrap(n: React.ReactElement) { return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>; }

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null, pickedUpOrderId: null,
    appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});

describe('HoldOrderButton (DB-backed)', () => {
  it('holds the current cart via the RPC mutation', async () => {
    render(wrap(<HoldOrderButton />));
    fireEvent.click(screen.getByRole('button', { name: /hold/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const arg = mutateAsync.mock.calls[0]?.[0] as { cartPayload: { items: unknown[] } };
    expect(arg.cartPayload.items.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test hold-order-db`
Expected: FAIL — button still uses the localStorage store.

- [ ] **Step 3: Rewire `HoldOrderButton`** to read the cart, call `useHoldOrder().mutateAsync({ cartPayload, tableNumber, notes })`, then `cartStore.clear()` on success (preserve the existing optional-notes prompt). Replace the old `heldOrdersStore.add(...)` path.

- [ ] **Step 4: Rewire `HeldOrdersModal`** (`apps/pos/src/features/cart/HeldOrdersModal.tsx`) to consume `useHeldOrdersQuery()` for the list, `useRestoreHeldOrder()` for restore, and `useDiscardHeldOrder()` (with a reason prompt ≥10 chars) for delete. Mount `useHeldOrdersRealtime()` at the top of the modal so the list updates across terminals. Replace the `heldOrdersStore.entries`/`remove` usage.

- [ ] **Step 5: Rewire `HeldOrdersInboxButton`** to show the count from `useHeldOrdersQuery().data?.length ?? 0`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @breakery/app-pos test hold-order-db` → Expected: PASS.
Run: `pnpm --filter @breakery/app-pos typecheck` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/features/heldOrders apps/pos/src/features/cart/HeldOrdersModal.tsx
git commit -m "feat(pos): held orders DB-backed UI — multi-terminal list, restore, discard"
```

### Task C9: Retire the localStorage held-orders store (cleanup)

**Files:**
- Delete: `apps/pos/src/stores/heldOrdersStore.ts` (and `packages/ui/src/components/HeldOrdersModal.tsx` if now unused — verify with grep).

- [ ] **Step 1:** `git grep -n "heldOrdersStore" apps/pos` → confirm no remaining importers after C8. If any remain, rewire them first.
- [ ] **Step 2:** Delete the file(s); keep the `@breakery/domain` heldOrders types if `fromHeldOrder`/`toHeldOrder` are still referenced (grep first).
- [ ] **Step 3:** Run `pnpm --filter @breakery/app-pos typecheck` + `pnpm --filter @breakery/app-pos test heldOrders` → Expected: PASS.
- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "chore(pos): retire localStorage heldOrdersStore (superseded by DB-backed holds)"
```

---

# Wave D — F-007 Customer Display live cart mirror (~3-5j)

> Same-origin, same-browser (2nd HDMI window). `BroadcastChannel('breakery-cart')` carries cart snapshots. Cross-device LAN mirror is out of scope (S36+).

### Task D1: `useCartBroadcast` emitter

**Files:**
- Create: `apps/pos/src/features/display/hooks/useCartBroadcast.ts`
- Test: `apps/pos/src/features/display/__tests__/cart-broadcast.smoke.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/pos/src/features/display/__tests__/cart-broadcast.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCartStore } from '@/stores/cartStore';
import { useCartBroadcast } from '../hooks/useCartBroadcast';

let posted: unknown[] = [];
class FakeBC {
  name: string;
  constructor(n: string) { this.name = n; }
  postMessage(m: unknown) { posted.push(m); }
  close() { /* noop */ }
}

beforeEach(() => {
  posted = [];
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeBC as never;
  useCartStore.setState({
    cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [], printedItemIds: [],
    attachedCustomer: null, pickedUpOrderId: null, appliedPromotions: [],
    dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('useCartBroadcast', () => {
  it('posts a cart_update when the cart changes', () => {
    renderHook(() => useCartBroadcast());
    act(() => {
      useCartStore.setState({
        cart: { items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
      } as never);
    });
    const last = posted.at(-1) as { type: string; cart: { items: unknown[] } };
    expect(last.type).toBe('cart_update');
    expect(last.cart.items.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test cart-broadcast`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the emitter**

```ts
// apps/pos/src/features/display/hooks/useCartBroadcast.ts
import { useEffect } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals } from '@breakery/domain';

const TAX_RATE = 0.10;
export const CART_CHANNEL = 'breakery-cart';

export interface CartBroadcastMessage {
  type: 'cart_update';
  cart: { items: unknown[]; order_type: string };
  totals: { subtotal: number; total: number; item_count: number };
  customer: { name: string } | null;
}

/** Mount on the POS side: mirrors the live cart to /display via BroadcastChannel. */
export function useCartBroadcast(): void {
  useEffect(() => {
    const bc = new BroadcastChannel(CART_CHANNEL);
    const publish = () => {
      const { cart, attachedCustomer } = useCartStore.getState();
      const totals = calculateTotals(cart, TAX_RATE);
      const msg: CartBroadcastMessage = {
        type: 'cart_update',
        cart: { items: cart.items, order_type: cart.order_type },
        totals: { subtotal: totals.subtotal, total: totals.total, item_count: totals.item_count },
        customer: attachedCustomer ? { name: attachedCustomer.name } : null,
      };
      bc.postMessage(msg);
    };
    publish(); // initial snapshot
    const unsub = useCartStore.subscribe(publish);
    return () => { unsub(); bc.close(); };
  }, []);
}
```
> Confirm `calculateTotals` returns `{ subtotal, total, item_count }` (explorer confirmed). If `item_count` is absent, derive it from `cart.items.reduce((n,i)=>n+i.quantity,0)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test cart-broadcast`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/display/hooks/useCartBroadcast.ts apps/pos/src/features/display/__tests__/cart-broadcast.smoke.test.tsx
git commit -m "feat(pos): useCartBroadcast — live cart mirror emitter (BroadcastChannel)"
```

### Task D2: `useCartBroadcastReceiver` + `<CDActiveCartView>`

**Files:**
- Create: `apps/pos/src/features/display/hooks/useCartBroadcastReceiver.ts`, `apps/pos/src/features/display/CDActiveCartView.tsx`
- Test: `apps/pos/src/features/display/__tests__/cd-active-cart-view.smoke.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/pos/src/features/display/__tests__/cd-active-cart-view.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CDActiveCartView } from '../CDActiveCartView';
import type { CartBroadcastMessage } from '../hooks/useCartBroadcast';

const payload: CartBroadcastMessage = {
  type: 'cart_update',
  cart: { items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 2, modifiers: [] }], order_type: 'dine_in' },
  totals: { subtotal: 60000, total: 66000, item_count: 2 },
  customer: { name: 'Dewi' },
};

describe('CDActiveCartView', () => {
  it('renders line items, total, and the attached customer', () => {
    render(<CDActiveCartView message={payload} />);
    expect(screen.getByText('Latte')).toBeInTheDocument();
    expect(screen.getByText(/Dewi/)).toBeInTheDocument();
    expect(screen.getByText(/66.?000/)).toBeInTheDocument();
  });

  it('renders an empty state when there is no message', () => {
    render(<CDActiveCartView message={null} />);
    expect(screen.getByText(/welcome/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test cd-active-cart-view`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the receiver + view**

```ts
// apps/pos/src/features/display/hooks/useCartBroadcastReceiver.ts
import { useEffect, useState } from 'react';
import { CART_CHANNEL, type CartBroadcastMessage } from './useCartBroadcast';

/** Mount on the /display side: listens for cart snapshots. */
export function useCartBroadcastReceiver(): CartBroadcastMessage | null {
  const [message, setMessage] = useState<CartBroadcastMessage | null>(null);
  useEffect(() => {
    const bc = new BroadcastChannel(CART_CHANNEL);
    bc.onmessage = (e: MessageEvent<CartBroadcastMessage>) => {
      if (e.data?.type === 'cart_update') setMessage(e.data);
    };
    return () => { bc.close(); };
  }, []);
  return message;
}
```

```tsx
// apps/pos/src/features/display/CDActiveCartView.tsx
import { Currency } from '@breakery/ui';
import type { CartBroadcastMessage } from './hooks/useCartBroadcast';

interface Item { id: string; name: string; unit_price: number; quantity: number; }

export function CDActiveCartView({ message }: { message: CartBroadcastMessage | null }) {
  if (!message || message.cart.items.length === 0) {
    return (
      <div className="m-auto text-center space-y-2">
        <h2 className="font-serif text-3xl text-text-primary">Welcome to The Breakery</h2>
        <p className="text-text-secondary">Your order will appear here</p>
      </div>
    );
  }
  const items = message.cart.items as Item[];
  return (
    <div className="flex flex-col h-full p-8">
      <header className="mb-6">
        <h2 className="font-serif text-2xl text-text-primary">Your order</h2>
        {message.customer && <p className="text-text-secondary text-sm">{message.customer.name}</p>}
      </header>
      <ul className="flex-1 space-y-3 overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between text-text-primary">
            <span><span className="text-gold font-mono mr-2">{i.quantity}×</span>{i.name}</span>
            <Currency amount={i.unit_price * i.quantity} />
          </li>
        ))}
      </ul>
      <footer className="mt-6 pt-4 border-t border-border-subtle flex items-center justify-between">
        <span className="text-text-secondary uppercase tracking-widest text-xs">Total</span>
        <Currency amount={message.totals.total} emphasis="gold" className="text-3xl" />
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test cd-active-cart-view`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/display/hooks/useCartBroadcastReceiver.ts apps/pos/src/features/display/CDActiveCartView.tsx apps/pos/src/features/display/__tests__/cd-active-cart-view.smoke.test.tsx
git commit -m "feat(pos): CDActiveCartView + receiver — display-side live cart panel"
```

### Task D3: Mount emitter (POS) + receiver/view (display)

**Files:**
- Modify: `apps/pos/src/features/cart/ActiveOrderPanel.tsx` (mount `useCartBroadcast()`)
- Modify: `apps/pos/src/features/display/CustomerDisplayPage.tsx` (receiver + `CDActiveCartView`, remove Phase-5.A comment at lines 13-14)

- [ ] **Step 1:** In `ActiveOrderPanel.tsx`, add `import { useCartBroadcast } from '@/features/display/hooks/useCartBroadcast';` and call `useCartBroadcast();` near the other hook mounts (~line 125, beside `usePromotionsAutoEval()`).

- [ ] **Step 2:** In `CustomerDisplayPage.tsx`, remove the Phase-5.A comment (lines 13-14), add `const cartMessage = useCartBroadcastReceiver();` and render `<CDActiveCartView message={cartMessage} />` as the left panel beside the queue (split layout — cart left, `OrderQueueTicker` right). When `cartMessage` has items, the active cart takes visual priority.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @breakery/app-pos test display` → Expected: existing display smokes + new ones PASS.
Run: `pnpm --filter @breakery/app-pos typecheck` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/features/cart/ActiveOrderPanel.tsx apps/pos/src/features/display/CustomerDisplayPage.tsx
git commit -m "feat(pos): wire live cart mirror — emitter in ActiveOrderPanel, view on /display (F-007)"
```

---

# Wave E — F-005 Virtual keypad (~3-5j)

> Net-new: `<QwertyLayout>` + `<VirtualKeypadProvider>`. Reuses `Numpad`. Opt-in via `data-vkp` on inputs (safer than global intercept). Prevents the native iOS keyboard via `inputMode="none"` on wired inputs.

### Task E1: `<QwertyLayout>`

**Files:**
- Create: `packages/ui/src/components/QwertyLayout.tsx`
- Test: `packages/ui/src/components/__tests__/QwertyLayout.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/components/__tests__/QwertyLayout.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QwertyLayout } from '../QwertyLayout.js';

describe('QwertyLayout', () => {
  it('renders letter keys and emits on press', () => {
    const onKey = vi.fn();
    render(<QwertyLayout onKey={onKey} onBackspace={vi.fn()} onSpace={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    expect(onKey).toHaveBeenCalledWith('a');
  });

  it('shift toggles to uppercase output', () => {
    const onKey = vi.fn();
    render(<QwertyLayout onKey={onKey} onBackspace={vi.fn()} onSpace={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /shift/i }));
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    expect(onKey).toHaveBeenCalledWith('A');
  });

  it('backspace / space / done fire their callbacks', () => {
    const onBackspace = vi.fn(); const onSpace = vi.fn(); const onDone = vi.fn();
    render(<QwertyLayout onKey={vi.fn()} onBackspace={onBackspace} onSpace={onSpace} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /backspace/i })); expect(onBackspace).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /space/i })); expect(onSpace).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /done/i })); expect(onDone).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/ui test QwertyLayout`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the layout**

```tsx
// packages/ui/src/components/QwertyLayout.tsx
import { memo, useState, type JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface QwertyLayoutProps {
  onKey: (char: string) => void;
  onBackspace: () => void;
  onSpace: () => void;
  onDone: () => void;
  className?: string;
}

const ROWS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m'],
];

function QwertyLayoutInner({ onKey, onBackspace, onSpace, onDone, className }: QwertyLayoutProps): JSX.Element {
  const [shift, setShift] = useState(false);
  const press = (c: string) => { onKey(shift ? c.toUpperCase() : c); if (shift) setShift(false); };
  const keyCls = 'h-touch-comfy min-w-[2.25rem] flex-1 rounded-md bg-bg-input border border-border-subtle text-text-primary text-lg font-medium active:scale-95 transition-transform';
  const actCls = 'h-touch-comfy rounded-md bg-bg-overlay border border-border-subtle text-text-secondary text-sm active:scale-95';
  return (
    <div className={cn('space-y-2 select-none', className)}>
      {ROWS.map((row, ri) => (
        <div key={ri} className="flex gap-1.5 justify-center">
          {ri === 2 && (
            <button type="button" aria-label="Shift" onClick={() => setShift((s) => !s)}
              className={cn(actCls, 'px-3', shift && 'border-gold text-gold')}>⇧</button>
          )}
          {row.map((c) => (
            <button key={c} type="button" aria-label={shift ? c.toUpperCase() : c} onClick={() => press(c)} className={keyCls}>
              {shift ? c.toUpperCase() : c}
            </button>
          ))}
          {ri === 2 && (
            <button type="button" aria-label="Backspace" onClick={onBackspace} className={cn(actCls, 'px-3')}>⌫</button>
          )}
        </div>
      ))}
      <div className="flex gap-1.5">
        <button type="button" aria-label="Space" onClick={onSpace} className={cn(keyCls, 'flex-[6]')}>space</button>
        <button type="button" aria-label="Done" onClick={onDone} className={cn('h-touch-comfy rounded-md bg-gold text-black font-semibold px-6 active:scale-95')}>Done</button>
      </div>
    </div>
  );
}

export const QwertyLayout = memo(QwertyLayoutInner);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/ui test QwertyLayout`
Expected: PASS (3 tests).

- [ ] **Step 5: Export + commit**

Add to `packages/ui/src/index.ts`: `export { QwertyLayout, type QwertyLayoutProps } from './components/QwertyLayout.js';`
```bash
git add packages/ui/src/components/QwertyLayout.tsx packages/ui/src/components/__tests__/QwertyLayout.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): QwertyLayout — touch QWERTY keyboard with shift/space/backspace/done"
```

### Task E2: `<VirtualKeypadProvider>` + `useVirtualKeypad`

**Files:**
- Create: `packages/ui/src/hooks/useVirtualKeypad.ts`, `packages/ui/src/components/VirtualKeypadProvider.tsx`
- Test: `packages/ui/src/components/__tests__/VirtualKeypadProvider.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/components/__tests__/VirtualKeypadProvider.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VirtualKeypadProvider } from '../VirtualKeypadProvider.js';

function Harness() {
  return (
    <VirtualKeypadProvider>
      <input aria-label="name" data-vkp="qwerty" />
      <input aria-label="amount" data-vkp="numeric" />
      <input aria-label="native" />
    </VirtualKeypadProvider>
  );
}

describe('VirtualKeypadProvider', () => {
  it('opens the QWERTY overlay when a data-vkp="qwerty" input is focused', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText('name'));
    expect(screen.getByRole('button', { name: 'q' })).toBeInTheDocument(); // qwerty key visible
  });

  it('opens the numeric overlay for data-vkp="numeric"', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText('amount'));
    // numeric layout shows digit 5 but no letter q
    expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'q' })).toBeNull();
  });

  it('does NOT open for inputs without data-vkp', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText('native'));
    expect(screen.queryByRole('button', { name: 'q' })).toBeNull();
    expect(screen.queryByRole('button', { name: '5' })).toBeNull();
  });

  it('typing a key writes into the focused input', () => {
    render(<Harness />);
    const input = screen.getByLabelText('name') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('button', { name: 'q' }));
    expect(input.value).toBe('q');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/ui test VirtualKeypadProvider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook + provider**

```ts
// packages/ui/src/hooks/useVirtualKeypad.ts
import { createContext, useContext } from 'react';

export type VkpLayout = 'qwerty' | 'numeric';
export interface VirtualKeypadCtx {
  openFor: (el: HTMLInputElement, layout: VkpLayout) => void;
  close: () => void;
}
export const VirtualKeypadContext = createContext<VirtualKeypadCtx | null>(null);
export function useVirtualKeypad(): VirtualKeypadCtx {
  const ctx = useContext(VirtualKeypadContext);
  if (!ctx) throw new Error('useVirtualKeypad must be used within VirtualKeypadProvider');
  return ctx;
}
```

```tsx
// packages/ui/src/components/VirtualKeypadProvider.tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { VirtualKeypadContext, type VkpLayout } from '../hooks/useVirtualKeypad.js';
import { QwertyLayout } from './QwertyLayout.js';
import { Numpad } from './Numpad.js';

/** Writes a value into an input via the native setter so React onChange fires. */
function setInputValue(el: HTMLInputElement, next: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc?.set?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function VirtualKeypadProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<VkpLayout | null>(null);
  const targetRef = useRef<HTMLInputElement | null>(null);

  const openFor = useCallback((el: HTMLInputElement, l: VkpLayout) => { targetRef.current = el; setLayout(l); }, []);
  const close = useCallback(() => { setLayout(null); targetRef.current = null; }, []);

  // Auto-detect focus on data-vkp inputs anywhere in the subtree.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement && el.dataset.vkp) {
        el.setAttribute('inputmode', 'none'); // suppress native iOS keyboard
        openFor(el, el.dataset.vkp as VkpLayout);
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [openFor]);

  const writeKey = (c: string) => { const el = targetRef.current; if (el) setInputValue(el, el.value + c); };
  const backspace = () => { const el = targetRef.current; if (el) setInputValue(el, el.value.slice(0, -1)); };

  return (
    <VirtualKeypadContext.Provider value={{ openFor, close }}>
      {children}
      {layout && (
        <div className="fixed inset-x-0 bottom-0 z-50 bg-bg-elevated border-t border-border-subtle p-4 shadow-modal" role="dialog" aria-label="Virtual keyboard">
          {layout === 'qwerty' ? (
            <QwertyLayout onKey={writeKey} onBackspace={backspace} onSpace={() => writeKey(' ')} onDone={close} />
          ) : (
            <div className="max-w-xs mx-auto">
              <Numpad value={targetRef.current?.value ?? ''} onChange={(next) => { const el = targetRef.current; if (el) setInputValue(el, next); }} />
              <button type="button" onClick={close} className="mt-3 w-full h-touch-comfy rounded-md bg-gold text-black font-semibold">Done</button>
            </div>
          )}
        </div>
      )}
    </VirtualKeypadContext.Provider>
  );
}
```
> The numeric branch reuses `Numpad` (controlled `value`/`onChange`). The Numpad's digit buttons are labelled `0`–`9` (test asserts `5` visible, `q` absent).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/ui test VirtualKeypadProvider`
Expected: PASS (4 tests).

- [ ] **Step 5: Export + commit**

Add to `packages/ui/src/index.ts`:
```ts
export { VirtualKeypadProvider } from './components/VirtualKeypadProvider.js';
export { useVirtualKeypad, type VkpLayout } from './hooks/useVirtualKeypad.js';
```
```bash
git add packages/ui/src/hooks/useVirtualKeypad.ts packages/ui/src/components/VirtualKeypadProvider.tsx packages/ui/src/components/__tests__/VirtualKeypadProvider.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): VirtualKeypadProvider — focus-driven on-screen keyboard (qwerty/numeric)"
```

### Task E3: Mount the provider around `/pos` + opt-in the 3 inputs

**Files:**
- Modify: `apps/pos/src/routes/index.tsx` (wrap `<PosPage/>`)
- Modify: `apps/pos/src/features/cart/CustomerAttachModal.tsx`, `packages/ui/src/components/DiscountModal.tsx`, `apps/pos/src/features/cart/CancelItemModal.tsx`
- Test: `apps/pos/src/features/cart/__tests__/customer-attach-vkp.smoke.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/pos/src/features/cart/__tests__/customer-attach-vkp.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VirtualKeypadProvider } from '@breakery/ui';
import { CustomerAttachModal } from '../CustomerAttachModal';

// Minimal mocks for the modal's data deps (adapt to the modal's actual hooks).
describe('CustomerAttachModal + VKP', () => {
  it('focusing the search input opens the QWERTY overlay', () => {
    render(
      <VirtualKeypadProvider>
        <CustomerAttachModal open onClose={() => {}} />
      </VirtualKeypadProvider>,
    );
    const input = screen.getByLabelText(/search customer/i);
    fireEvent.focus(input);
    expect(screen.getByRole('button', { name: 'q' })).toBeInTheDocument();
  });
});
```
> If `CustomerAttachModal` needs query/store mocks to render, copy them from `apps/pos/src/features/cart/__tests__/` siblings.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @breakery/app-pos test customer-attach-vkp`
Expected: FAIL — input has no `data-vkp`, overlay never opens.

- [ ] **Step 3: Implement**

1. In `apps/pos/src/routes/index.tsx`, wrap the POS element: `<Protected><VirtualKeypadProvider><PosPage /></VirtualKeypadProvider></Protected>` (import from `@breakery/ui`).
2. `CustomerAttachModal.tsx` search `<Input>`: add `data-vkp="qwerty"`.
3. `DiscountModal.tsx` reason `<textarea>`: change the element to honour VKP — add `data-vkp="qwerty"` (the provider's `focusin` matches `HTMLInputElement`; for the textarea, either switch it to an `<input>` or extend the provider's guard to `HTMLTextAreaElement`. Simplest: extend the provider guard in E2 to also accept `HTMLTextAreaElement` and update `setInputValue` typing to `HTMLInputElement | HTMLTextAreaElement`). **If extending the guard, add a test case in `VirtualKeypadProvider.test.tsx` for a `<textarea data-vkp="qwerty">` before wiring.**
4. `CancelItemModal.tsx` reason `<Input>`: add `data-vkp="qwerty"`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @breakery/app-pos test customer-attach-vkp` → Expected: PASS.
Run: `pnpm --filter @breakery/ui test VirtualKeypadProvider` → Expected: PASS (incl. textarea case if added).
Run: `pnpm --filter @breakery/app-pos typecheck && pnpm --filter @breakery/ui typecheck` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/routes/index.tsx apps/pos/src/features/cart/CustomerAttachModal.tsx packages/ui/src/components/DiscountModal.tsx apps/pos/src/features/cart/CancelItemModal.tsx apps/pos/src/features/cart/__tests__/customer-attach-vkp.smoke.test.tsx
git commit -m "feat(pos): wire VirtualKeypadProvider around /pos + opt-in 3 reason/search inputs (F-005)"
```

---

## Final verification (after all waves)

- [ ] `pnpm --filter @breakery/app-pos typecheck` → PASS
- [ ] `pnpm --filter @breakery/ui typecheck` → PASS
- [ ] `pnpm --filter @breakery/supabase typecheck` → PASS
- [ ] `pnpm --filter @breakery/app-pos test` → PASS (no regressions; expect the env-gated baseline only)
- [ ] `pnpm --filter @breakery/ui test` → PASS
- [ ] pgTAP `held_orders` 10/10 via MCP → PASS
- [ ] Create `docs/workplan/plans/2026-05-29-session-35-INDEX.md` (waves, migrations `20260620000010..016`, deviations DEV-S35-*, schema facts from Task 0).
- [ ] Bump CLAUDE.md "Active Workplan" → Session 35 reference + migration-sequence line.
- [ ] Open PR `swarm/session-35` → `master`, squash-merge.

## Acceptance criteria (from spec §9)

- [ ] F-003: held orders persisted in DB, visible multi-terminal, restore/discard functional — pgTAP 10 + POS smoke ~5 PASS
- [ ] F-005: VirtualKeypadProvider + QwertyLayout wired ≥3 inputs — UI unit ~8 PASS
- [ ] F-007: live cart mirror visible on `/display` same-machine — smoke ~4 PASS
- [ ] F-009: Printing tab functional (URL + auto-print + drawer toggles), F-015 resolved — smoke ~6 PASS
- [ ] F-014: Lock Terminal operational without losing the shift — smoke ~4 PASS

---

## Self-review notes (planner)

- **Spec coverage:** F-003 (Wave C), F-005 (Wave E), F-007 (Wave D), F-009 (Wave B), F-014 (Wave A) — all 5 findings have tasks. F-015 folded into B2. Out-of-scope items (F-010..013, F-019..024, LAN cross-device mirror, idle→lock) explicitly deferred per spec §10 + ratified decisions.
- **Decisions threaded:** Option A `is_held` (C1); discard gate `orders.void` (C4); localStorage settings (B1); manual-lock-only, idle untouched (A — no idle rewire task).
- **Known verification gates (not placeholders — real MCP checks):** Task 0 establishes audit table/cols, gate helper, enum, `order_items` columns, migration base. Every Wave-C RPC explicitly says "adjust to the Task-0 verified convention." This is mandatory because Docker is retired (cloud-only schema, can't introspect offline).
- **Type consistency:** `usePosSettingsStore` fields (`printerUrl`/`autoPrint`/`autoOpenDrawer`) identical across B1/B2/B3/B4. `CartBroadcastMessage` shape identical across D1/D2/D3. `hold_order_v1(p_client_uuid, p_cart_payload, p_table_number, p_notes)` signature identical across C2/C7/REVOKE. `authStore.isLocked/lock/unlock` identical across A1/A2/A3.
- **Residual risk:** (1) `restoreCart` exact `Cart` shape — C7 flags reconciliation against `cartStore.ts`. (2) F-005 textarea vs input for DiscountModal — E3 Step 3 gives the concrete fork (extend provider guard + add test). (3) pgTAP fixture/auth-context idiom — C5 says copy from an existing pgTAP file; the `SELECT ok(true,…)` markers MUST be replaced with real asserts before C5 is "done".
