# POS Realtime Channel Uniqueness Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-mount channel UUID generation **inside** the `useEffect` in 3 POS realtime hooks (`usePromotionsRealtime`, `useTableOccupancy`, `useTabletOrderStatusListener`) so each StrictMode effect mount gets its own channel name, eliminating the `useMemo(() => crypto.randomUUID(), [])` body-level anti-pattern that collides under React `<StrictMode>` double-mount.

**Architecture:** No DB, no RPC, no Edge Function, no migration, no types regen. Pure client-side micro-edit + one channel-uniqueness test per hook, exactly mirroring the canonical `useKdsRealtime`/`useDisplayRealtime` pattern. The three hooks are fully independent — one TDD task each (test-first → red → fix → green → commit) plus a final verification task.

**Tech Stack:** React 18 (StrictMode double-mount), `@tanstack/react-query`, `@testing-library/react` `renderHook`, Vitest, `apps/pos` (workspace `@breakery/app-pos`). Channel transport: `supabase.channel(name)` from `@/lib/supabase`.

**Spec:** [`../specs/2026-06-01-pos-realtime-channel-uniqueness-fix-spec.md`](../specs/2026-06-01-pos-realtime-channel-uniqueness-fix-spec.md)
**Branch:** `fix/pos-realtime-channel-uniqueness` (from `master` @ `70c5cf1`)
**Effort:** S (~0.5 day)

---

## Verified facts (code `fichier:ligne`, re-read 2026-06-01)

These line numbers were verified by reading each file in full immediately before authoring this plan. Re-verify with the file's actual content before editing — match on the quoted source string, not on the line number alone.

- **`usePromotionsRealtime.ts`** (43 lines total)
  - Line 8: `import { useEffect, useMemo } from 'react';`
  - Line 19: `const mountId = useMemo(() => crypto.randomUUID(), []);`
  - Line 23: `.channel(`promotions-changes-${mountId}`)`
  - Line 42: deps array `}, [qc, mountId]);`
  - `mountId` is used **only** at line 23 (channel name) — no other consumer.
- **`useTableOccupancy.ts`** (56 lines total)
  - Line 1: `import { useEffect, useMemo } from 'react';`
  - Line 36: `const mountId = useMemo(() => crypto.randomUUID(), []);`
  - Line 46: `.channel(`table_occupancy_realtime-${mountId}`)`
  - Line 53: deps array `}, [queryClient, mountId]);`
  - The hook also runs `useQuery({ queryKey: OCCUPANCY_KEY, queryFn: fetchOccupied, staleTime: 30_000 })` (lines 38-42). `fetchOccupied` (lines 11-28) calls `supabase.from('orders').select(...).not(...).not(...)` — but the test mock replaces `@/lib/supabase` entirely, so `from` is undefined and the query rejects; `retry: false` on the QueryClient keeps it quiet and the `.channel()` call still fires in the effect regardless. `mountId` is used **only** at line 46.
- **`useTabletOrderStatusListener.ts`** (65 lines total)
  - Line 1: `import { useEffect, useMemo, useRef } from 'react';`
  - Line 19: `const mountId = useMemo(() => crypto.randomUUID(), []);`
  - Line 27: `if (!userId) return;` — effect early-returns when no user, so the test MUST mock a non-null `user.id` or `channelSpy` is never called.
  - Line 30: `.channel(`tablet-order-status-${mountId}`)`
  - Line 64: deps array `}, [userId, queryClient, mountId]);`
  - `seenRef` dedupe (line 24) and the `toast.success` + `invalidateQueries(['tablet-orders', userId])` logic (lines 57-58) must stay unchanged. `mountId` is used **only** at line 30.
- **Correct reference pattern** — `apps/pos/src/features/kds/hooks/useKdsRealtime.ts:54-55` generates `const channelName = `kds-${station}-${crypto.randomUUID()}`;` **inside** the effect (no `useMemo`), passes it to `.channel(channelName)`, deps `[station, qc, onEvent]`. The header comment (lines 28-32) explains exactly why the UUID must be inside the effect, not in a body-level `useMemo`.
- **Reference test to mirror** — `apps/pos/src/features/kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx`: a module-scope `channelSpy = vi.fn()`, `vi.mock('@/lib/supabase', ...)` whose `channel(name)` records `channelSpy(name)` and returns `{ on: onMock, subscribe: subscribeMock }` (both `.mockReturnThis()`), a `makeWrapper(strict)` that wraps a `QueryClientProvider` (with `retry: false`) optionally in `<StrictMode>`, then two `it` cases. Sibling: `apps/pos/src/features/display/hooks/__tests__/useDisplayRealtime.uniqueChannel.test.ts` (identical shape).
- **`useAuthStore` selector shape** — `useAuthStore((s) => s.user?.id)` reads `state.user.id`. The store is `create<AuthState>()` where `AuthState` has `user: AuthUser | null` (`apps/pos/src/stores/authStore.ts:24`). To mock, replace `useAuthStore` with a fn that calls its `selector` arg against a fake state `{ user: { id: 'tablet-user-1' } }`.

---

## File Structure

```
apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts                              (EDIT)
apps/pos/src/features/promotions/__tests__/usePromotionsRealtime.uniqueChannel.test.tsx      (CREATE)
apps/pos/src/features/tables/hooks/useTableOccupancy.ts                                       (EDIT)
apps/pos/src/features/tables/__tests__/useTableOccupancy.uniqueChannel.test.tsx              (CREATE)
apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts                            (EDIT)
apps/pos/src/features/tablet/__tests__/useTabletOrderStatusListener.uniqueChannel.test.tsx   (CREATE)
```

- **Test location override** — the writing-plans skill defaults plans to `docs/superpowers/plans/`, but this project's convention (CLAUDE.md) keeps plans under `docs/workplan/plans/` and co-locates tests in a `__tests__/` directory next to the code. This plan follows the project convention: each test lives in the feature's existing `__tests__/` dir, mirroring `kds/__tests__/` and `display/hooks/__tests__/`.
- Each hook owns one responsibility (one realtime subscription); the fix is local to each `useEffect`. No file is split or restructured.

---

## Task 0: Branch

**Files:**
- N/A (git + already-saved spec & plan)

- [ ] **Step 1: Create the fix branch off `master`**

```bash
git checkout master
git checkout -b fix/pos-realtime-channel-uniqueness
```

- [ ] **Step 2: Commit the spec + this plan**

```bash
git add docs/workplan/specs/2026-06-01-pos-realtime-channel-uniqueness-fix-spec.md \
        docs/workplan/plans/2026-06-01-pos-realtime-channel-uniqueness-fix-plan.md
git commit -m "docs(workplan): pos realtime channel uniqueness fix — spec + plan"
```

---

## Task 1: `usePromotionsRealtime` — UUID inside the effect

**Files:**
- Create: `apps/pos/src/features/promotions/__tests__/usePromotionsRealtime.uniqueChannel.test.tsx`
- Modify: `apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts:8,19,23,42`

- [ ] **Step 1: Write the failing test**

Create `apps/pos/src/features/promotions/__tests__/usePromotionsRealtime.uniqueChannel.test.tsx` with this exact content:

```tsx
// apps/pos/src/features/promotions/__tests__/usePromotionsRealtime.uniqueChannel.test.tsx
//
// 2026-06-01 — D19 channel-uniqueness audit for usePromotionsRealtime.
//
// Mirrors `kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx`. Asserts that
// StrictMode double-mounting yields TWO distinct Supabase channel names. A
// regression (body-level `useMemo` UUID) would yield a single shared name
// across both mounts, where the second mount's `.on()` attaches to the
// still-subscribed channel from the first mount (`removeChannel` is async),
// silently dropping later events.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const channelSpy = vi.fn();

vi.mock('@/lib/supabase', () => {
  const onMock = vi.fn().mockReturnThis();
  const subscribeMock = vi.fn().mockReturnThis();
  return {
    supabase: {
      channel: (name: string) => {
        channelSpy(name);
        return {
          on: onMock,
          subscribe: subscribeMock,
        };
      },
      removeChannel: vi.fn(),
    },
  };
});

import { usePromotionsRealtime } from '../hooks/usePromotionsRealtime';

function makeWrapper(strict: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('usePromotionsRealtime — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => usePromotionsRealtime(), {
      wrapper: makeWrapper(true),
    });

    expect(channelSpy).toHaveBeenCalledTimes(2);

    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);

    expect(first).toMatch(/^promotions-changes-/);
    expect(second).toMatch(/^promotions-changes-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel', () => {
    renderHook(() => usePromotionsRealtime(), {
      wrapper: makeWrapper(false),
    });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(
      /^promotions-changes-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @breakery/app-pos test usePromotionsRealtime.uniqueChannel`
Expected: FAIL on "StrictMode double-mount produces 2 distinct channel names" — `expect(first).not.toBe(second)` fails because the body-level `useMemo` returns the same UUID for both StrictMode effect mounts (the second-render UUID is reused across both effect cycles), so `channelSpy` is called twice with the **same** name.

- [ ] **Step 3: Apply the fix**

Edit `apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts`.

3a. Line 8 — drop the unused `useMemo` import.

Before:
```ts
import { useEffect, useMemo } from 'react';
```
After:
```ts
import { useEffect } from 'react';
```

3b. Lines 14-23 — remove the body-level `useMemo`, reword the comment to match `useKdsRealtime`, and build the channel name inside the effect.

Before:
```ts
export function usePromotionsRealtime(): void {
  const qc = useQueryClient();
  // StrictMode double-invokes effects in dev; a static channel name would
  // collide with the still-subscribed channel from the first mount
  // (removeChannel is async). Suffix with a per-mount UUID.
  // Pattern ref: apps/pos/src/features/kds/hooks/useKdsRealtime.ts (C2 fix).
  const mountId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    const channel = supabase
      .channel(`promotions-changes-${mountId}`)
```
After:
```ts
export function usePromotionsRealtime(): void {
  const qc = useQueryClient();

  useEffect(() => {
    // StrictMode double-invokes effects in dev; a static channel name would
    // collide with the still-subscribed channel from the first mount
    // (removeChannel is async). We generate the UUID INSIDE the effect, NOT
    // via a component-body `useMemo` — the memo from the first render is
    // discarded in StrictMode and the second-render UUID would be reused
    // across both effect mounts. Pattern ref: useKdsRealtime.ts.
    const channelName = `promotions-changes-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
```

3c. Line 42 — drop `mountId` from the deps array.

Before:
```ts
  }, [qc, mountId]);
```
After:
```ts
  }, [qc]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test usePromotionsRealtime.uniqueChannel`
Expected: PASS — 2 tests green (2 distinct names under StrictMode, 1 UUID-v4-suffixed name otherwise).

- [ ] **Step 5: Run the feature suite for regression**

Run: `pnpm --filter @breakery/app-pos test promotions`
Expected: PASS — the new uniqueness test plus any pre-existing promotions tests, no new failures versus `master`.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts \
        apps/pos/src/features/promotions/__tests__/usePromotionsRealtime.uniqueChannel.test.tsx
git commit -m "fix(pos): usePromotionsRealtime — generate channel UUID inside useEffect (StrictMode uniqueness)"
```

---

## Task 2: `useTableOccupancy` — UUID inside the effect

**Files:**
- Create: `apps/pos/src/features/tables/__tests__/useTableOccupancy.uniqueChannel.test.tsx`
- Modify: `apps/pos/src/features/tables/hooks/useTableOccupancy.ts:1,36,46,53`

- [ ] **Step 1: Write the failing test**

Create `apps/pos/src/features/tables/__tests__/useTableOccupancy.uniqueChannel.test.tsx` with this exact content. Note the `from` mock returns a query chain resolving to `{ data: [], error: null }` so `fetchOccupied` does not throw — but even if it rejected, `retry: false` keeps it quiet and the `.channel()` effect fires regardless.

```tsx
// apps/pos/src/features/tables/__tests__/useTableOccupancy.uniqueChannel.test.tsx
//
// 2026-06-01 — D19 channel-uniqueness audit for useTableOccupancy.
//
// Mirrors `kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx`. Asserts that
// StrictMode double-mounting yields TWO distinct Supabase channel names. The
// hook also runs a `useQuery(fetchOccupied)`; the supabase mock resolves the
// `from(...).select(...).not(...).not(...)` chain to an empty result so the
// query never throws, and the realtime `.channel()` call still fires in the
// effect under both StrictMode mounts.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const channelSpy = vi.fn();

vi.mock('@/lib/supabase', () => {
  const onMock = vi.fn().mockReturnThis();
  const subscribeMock = vi.fn().mockReturnThis();
  // fetchOccupied calls: from('orders').select(...).not(...).not(...) → awaited.
  const okResult = Promise.resolve({ data: [], error: null });
  const queryChain = {
    select: () => queryChain,
    not: () => queryChain,
    then: (...args: unknown[]) =>
      okResult.then(...(args as Parameters<typeof okResult.then>)),
  };
  return {
    supabase: {
      from: () => queryChain,
      channel: (name: string) => {
        channelSpy(name);
        return {
          on: onMock,
          subscribe: subscribeMock,
        };
      },
      removeChannel: vi.fn(),
    },
  };
});

import { useTableOccupancy } from '../hooks/useTableOccupancy';

function makeWrapper(strict: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('useTableOccupancy — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => useTableOccupancy(), {
      wrapper: makeWrapper(true),
    });

    expect(channelSpy).toHaveBeenCalledTimes(2);

    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);

    expect(first).toMatch(/^table_occupancy_realtime-/);
    expect(second).toMatch(/^table_occupancy_realtime-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel', () => {
    renderHook(() => useTableOccupancy(), {
      wrapper: makeWrapper(false),
    });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(
      /^table_occupancy_realtime-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @breakery/app-pos test useTableOccupancy.uniqueChannel`
Expected: FAIL on "StrictMode double-mount produces 2 distinct channel names" — `expect(first).not.toBe(second)` fails because the body-level `useMemo` UUID is shared across both StrictMode effect mounts, so the two channel names are identical.

- [ ] **Step 3: Apply the fix**

Edit `apps/pos/src/features/tables/hooks/useTableOccupancy.ts`.

3a. Line 1 — drop the unused `useMemo` import.

Before:
```ts
import { useEffect, useMemo } from 'react';
```
After:
```ts
import { useEffect } from 'react';
```

3b. Lines 30-46 — remove the body-level `useMemo`, reword the comment, build the channel name inside the effect. Leave `useQuery`/`fetchOccupied`/the return value untouched.

Before:
```ts
export function useTableOccupancy(): Record<string, boolean> {
  const queryClient = useQueryClient();
  // StrictMode double-invokes effects in dev; a static channel name would
  // collide with the still-subscribed channel from the first mount
  // (removeChannel is async). Suffix with a per-mount UUID.
  // Pattern ref: apps/pos/src/features/kds/hooks/useKdsRealtime.ts (C2 fix).
  const mountId = useMemo(() => crypto.randomUUID(), []);

  const { data: occupied = new Set<string>() } = useQuery({
    queryKey: OCCUPANCY_KEY,
    queryFn: fetchOccupied,
    staleTime: 30_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`table_occupancy_realtime-${mountId}`)
```
After:
```ts
export function useTableOccupancy(): Record<string, boolean> {
  const queryClient = useQueryClient();

  const { data: occupied = new Set<string>() } = useQuery({
    queryKey: OCCUPANCY_KEY,
    queryFn: fetchOccupied,
    staleTime: 30_000,
  });

  useEffect(() => {
    // StrictMode double-invokes effects in dev; a static channel name would
    // collide with the still-subscribed channel from the first mount
    // (removeChannel is async). We generate the UUID INSIDE the effect, NOT
    // via a component-body `useMemo` — the memo from the first render is
    // discarded in StrictMode and the second-render UUID would be reused
    // across both effect mounts. Pattern ref: useKdsRealtime.ts.
    const channelName = `table_occupancy_realtime-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
```

3c. Line 53 — drop `mountId` from the deps array.

Before:
```ts
  }, [queryClient, mountId]);
```
After:
```ts
  }, [queryClient]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test useTableOccupancy.uniqueChannel`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Run the feature suite for regression**

Run: `pnpm --filter @breakery/app-pos test tables`
Expected: PASS — new uniqueness test plus pre-existing tables tests, no new failures versus `master`.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/features/tables/hooks/useTableOccupancy.ts \
        apps/pos/src/features/tables/__tests__/useTableOccupancy.uniqueChannel.test.tsx
git commit -m "fix(pos): useTableOccupancy — generate channel UUID inside useEffect (StrictMode uniqueness)"
```

---

## Task 3: `useTabletOrderStatusListener` — UUID inside the effect

**Files:**
- Create: `apps/pos/src/features/tablet/__tests__/useTabletOrderStatusListener.uniqueChannel.test.tsx`
- Modify: `apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts:1,19,30,64`

- [ ] **Step 1: Write the failing test**

Create `apps/pos/src/features/tablet/__tests__/useTabletOrderStatusListener.uniqueChannel.test.tsx` with this exact content. `useAuthStore` MUST be mocked to return a non-null `user.id`, otherwise the effect early-returns at `if (!userId) return;` and `channelSpy` is never called. `sonner`'s `toast` is mocked because the import is pulled in at module load.

```tsx
// apps/pos/src/features/tablet/__tests__/useTabletOrderStatusListener.uniqueChannel.test.tsx
//
// 2026-06-01 — D19 channel-uniqueness audit for useTabletOrderStatusListener.
//
// Mirrors `kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx`. Asserts that
// StrictMode double-mounting yields TWO distinct Supabase channel names. The
// effect early-returns when there is no authenticated user, so `useAuthStore`
// is mocked to surface a non-null `user.id`; `sonner` is mocked so the toast
// import resolves cleanly.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const channelSpy = vi.fn();

vi.mock('@/lib/supabase', () => {
  const onMock = vi.fn().mockReturnThis();
  const subscribeMock = vi.fn().mockReturnThis();
  return {
    supabase: {
      channel: (name: string) => {
        channelSpy(name);
        return {
          on: onMock,
          subscribe: subscribeMock,
        };
      },
      removeChannel: vi.fn(),
    },
  };
});

// useAuthStore((s) => s.user?.id) must return a non-null id, else the effect
// early-returns and no channel is ever opened.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'tablet-user-1' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useTabletOrderStatusListener } from '../hooks/useTabletOrderStatusListener';

function makeWrapper(strict: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => {
    const tree = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, tree) : tree;
  };
}

describe('useTabletOrderStatusListener — D19 channel uniqueness', () => {
  beforeEach(() => {
    channelSpy.mockClear();
  });

  it('StrictMode double-mount produces 2 distinct channel names', () => {
    renderHook(() => useTabletOrderStatusListener(), {
      wrapper: makeWrapper(true),
    });

    expect(channelSpy).toHaveBeenCalledTimes(2);

    const [first, second] = channelSpy.mock.calls.map((c) => c[0] as string);

    expect(first).toMatch(/^tablet-order-status-/);
    expect(second).toMatch(/^tablet-order-status-/);
    expect(first).not.toBe(second);
  });

  it('non-StrictMode mount produces 1 channel', () => {
    renderHook(() => useTabletOrderStatusListener(), {
      wrapper: makeWrapper(false),
    });

    expect(channelSpy).toHaveBeenCalledTimes(1);
    const name = channelSpy.mock.calls[0]?.[0] as string;
    expect(name).toMatch(
      /^tablet-order-status-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @breakery/app-pos test useTabletOrderStatusListener.uniqueChannel`
Expected: FAIL on "StrictMode double-mount produces 2 distinct channel names" — `expect(first).not.toBe(second)` fails because the body-level `useMemo` UUID is shared across both StrictMode effect mounts.

- [ ] **Step 3: Apply the fix**

Edit `apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts`.

3a. Line 1 — drop the unused `useMemo` import; keep `useEffect` and `useRef`.

Before:
```ts
import { useEffect, useMemo, useRef } from 'react';
```
After:
```ts
import { useEffect, useRef } from 'react';
```

3b. Lines 12-30 — remove the body-level `useMemo`, reword the comment, build the channel name inside the effect after the early-return guard. Keep `seenRef` and the toast/invalidate logic unchanged.

Before:
```ts
export function useTabletOrderStatusListener() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();
  // StrictMode double-invokes effects in dev; a static channel name would
  // collide with the still-subscribed channel from the first mount
  // (removeChannel is async). Suffix with a per-mount UUID.
  // Pattern ref: apps/pos/src/features/kds/hooks/useKdsRealtime.ts (C2 fix).
  const mountId = useMemo(() => crypto.randomUUID(), []);

  // Phase 4.D — dedupe ready events. Realtime can replay events on
  // reconnect or deliver them out of order ; the toast must fire at most
  // once per (order_item_id, kitchen_status) transition.
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`tablet-order-status-${mountId}`)
```
After:
```ts
export function useTabletOrderStatusListener() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();

  // Phase 4.D — dedupe ready events. Realtime can replay events on
  // reconnect or deliver them out of order ; the toast must fire at most
  // once per (order_item_id, kitchen_status) transition.
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    // StrictMode double-invokes effects in dev; a static channel name would
    // collide with the still-subscribed channel from the first mount
    // (removeChannel is async). We generate the UUID INSIDE the effect, NOT
    // via a component-body `useMemo` — the memo from the first render is
    // discarded in StrictMode and the second-render UUID would be reused
    // across both effect mounts. Pattern ref: useKdsRealtime.ts.
    const channelName = `tablet-order-status-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
```

3c. Line 64 — drop `mountId` from the deps array.

Before:
```ts
  }, [userId, queryClient, mountId]);
```
After:
```ts
  }, [userId, queryClient]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test useTabletOrderStatusListener.uniqueChannel`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Run the feature suite for regression**

Run: `pnpm --filter @breakery/app-pos test tablet`
Expected: PASS — new uniqueness test plus pre-existing tablet tests, no new failures versus `master`.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts \
        apps/pos/src/features/tablet/__tests__/useTabletOrderStatusListener.uniqueChannel.test.tsx
git commit -m "fix(pos): useTabletOrderStatusListener — generate channel UUID inside useEffect (StrictMode uniqueness)"
```

---

## Task 4: Verification + PR

**Files:**
- N/A (verification + git)

- [ ] **Step 1: Grep-confirm no remaining body-level UUID anti-pattern**

Run: `pnpm exec rg "useMemo\(\(\) => crypto\.randomUUID\(\)" apps/pos/src`
Expected: no matches (exit code 1, empty output). The three hooks fixed above were the only POS occurrences per the 2026-06-01 audit.

- [ ] **Step 2: Typecheck the POS app**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS — no type errors. (The `useMemo` import was removed from all three files; no dangling references.)

- [ ] **Step 3: Run the three feature suites together**

Run: `pnpm --filter @breakery/app-pos test promotions tables tablet`
Expected: PASS — the 3 new uniqueness tests (6 `it` cases) plus the pre-existing suites, no new failures versus `master`. Note: the project carries a known baseline of ~3 POS env-gated failures (`VITE_SUPABASE_URL Required`, DEV-S25-2.A-02) — those are not regressions; compare against `master` if any failure is in doubt.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin fix/pos-realtime-channel-uniqueness
gh pr create \
  --base master \
  --title "fix(pos): realtime channel UUID inside useEffect (3 hooks) — StrictMode uniqueness" \
  --body "Moves per-mount channel UUID generation inside the \`useEffect\` for 3 POS realtime hooks (\`usePromotionsRealtime\`, \`useTableOccupancy\`, \`useTabletOrderStatusListener\`), eliminating the body-level \`useMemo(() => crypto.randomUUID(), [])\` anti-pattern that collides under React StrictMode double-mount. Applies the project Critical pattern \"Realtime channel names must be unique per mount\" exactly as \`useKdsRealtime.ts\` does. One channel-uniqueness test added per hook. No DB/EF/migration.

Spec: docs/workplan/specs/2026-06-01-pos-realtime-channel-uniqueness-fix-spec.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Acceptance criteria

- [ ] The 3 hooks generate the channel UUID **inside** `useEffect`; no `useMemo(() => crypto.randomUUID(), [])` at component body remains (Task 4 Step 1 grep is empty).
- [ ] `useMemo` import removed from each of the 3 files.
- [ ] No `mountId` in any of the 3 deps arrays.
- [ ] Under `<StrictMode>`, each hook opens 2 distinct channel names (test-proven, 3 hooks).
- [ ] Non-StrictMode, each hook opens 1 channel matching `prefix-<uuid v4>` (test-proven, 3 hooks).
- [ ] Business behaviour unchanged: promotions query invalidation, table occupancy query, tablet `seenRef` dedupe + `toast.success` + `['tablet-orders', userId]` invalidation.
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.
- [ ] `pnpm --filter @breakery/app-pos test promotions tables tablet` PASS (modulo known env-gated baseline).

---

## Risks / dependencies

- **Risk ~nil** — mechanical change covered by uniqueness tests; no DB/EF dependency. Observable behaviour changes only under StrictMode (dev), never prod.
- No cross-task dependency — Tasks 1, 2, 3 are fully independent and can run in parallel (one subagent each). Task 4 runs after all three land.

## Deviations log (fill during execution)

| ID | Severity | Section | What happened | Reason |
|---|---|---|---|---|
| _(à compléter)_ | | | | |
