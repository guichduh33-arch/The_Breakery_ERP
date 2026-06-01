# POS realtime channel uniqueness fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: invoke `superpowers:writing-plans` to author and `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) to run this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a tiny, mechanical, TDD-first fix — one phase per hook, all three are independent and parallelizable.

**Goal:** Move per-mount channel UUID generation **inside** the `useEffect` in 3 POS realtime hooks (`usePromotionsRealtime`, `useTableOccupancy`, `useTabletOrderStatusListener`), eliminating the `useMemo(() => crypto.randomUUID(), [])` anti-pattern that collides under React `<StrictMode>` double-mount. Apply the project Critical pattern "Realtime channel names must be unique per mount" exactly as `useKdsRealtime.ts` does.

**Architecture:** No DB, no RPC, no EF. Pure client-side micro-edit + one channel-uniqueness test per hook. 3 isolated phases (1 hook each) + 1 verification phase. TDD: write the failing uniqueness test first, then apply the fix.

**Tech Stack:** React + React Query + Vitest, `apps/pos`. No migration, no types regen.

**Spec:** [`../specs/2026-06-01-pos-realtime-channel-uniqueness-fix-spec.md`](../specs/2026-06-01-pos-realtime-channel-uniqueness-fix-spec.md)
**Branch:** `fix/pos-realtime-channel-uniqueness` (from `master` @ `70c5cf1`)
**Effort:** S (~0.5 day)

---

## Verified facts (code `fichier:ligne`, 2026-06-01)

- **Anti-pattern confirmed in all 3 hooks** — UUID built at component body via `useMemo`, then suffixed into the channel name:
  - `apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts:19` `const mountId = useMemo(() => crypto.randomUUID(), []);` → `.channel(\`promotions-changes-${mountId}\`)` line 23 ; deps `[qc, mountId]` line 42 ; imports `useMemo` line 8.
  - `apps/pos/src/features/tables/hooks/useTableOccupancy.ts:36` `const mountId = useMemo(...)` → `.channel(\`table_occupancy_realtime-${mountId}\`)` line 46 ; deps `[queryClient, mountId]` line 53 ; imports `useMemo` line 1 ; `mountId` used **only** for the channel name (verified — no other consumer).
  - `apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts:19` `const mountId = useMemo(...)` → `.channel(\`tablet-order-status-${mountId}\`)` line 30 ; deps `[userId, queryClient, mountId]` line 64 ; imports `useMemo` line 1 ; effect early-returns at line 27 `if (!userId) return;` ; keeps `seenRef` dedupe (line 24).
- **Correct reference pattern** — `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` generates `const channelName = \`kds-${station}-${crypto.randomUUID()}\`;` inside the effect (no `useMemo`).
- **Reference test to mirror** — `apps/pos/src/features/kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx`: mocks `@/lib/supabase` with a `channelSpy(name)`, renders the hook under `<StrictMode>` → asserts `channelSpy` called 2× with two distinct names matching the prefix ; renders non-StrictMode → 1 call matching the full `prefix-<uuid v4>` regex. Sibling examples: `useDisplayRealtime.uniqueChannel.test.ts`, `useLanHub.uniqueChannel.test.tsx`.

---

## File Structure (overview)

```
apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts          (EDIT)
apps/pos/src/features/promotions/__tests__/usePromotionsRealtime.uniqueChannel.test.tsx       (NEW)
apps/pos/src/features/tables/hooks/useTableOccupancy.ts                  (EDIT)
apps/pos/src/features/tables/__tests__/useTableOccupancy.uniqueChannel.test.tsx               (NEW)
apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts       (EDIT)
apps/pos/src/features/tablet/__tests__/useTabletOrderStatusListener.uniqueChannel.test.tsx    (NEW)
```

---

## Phase 0 — branch

- [ ] **P0.1** Create `fix/pos-realtime-channel-uniqueness` from `master` @ `70c5cf1` ; commit spec + plan (`docs(workplan): pos realtime channel uniqueness fix — spec + plan`).

---

## Phase 1 — `usePromotionsRealtime` (independent)

- [ ] **P1.1 (test-first)** Write `apps/pos/src/features/promotions/__tests__/usePromotionsRealtime.uniqueChannel.test.tsx`, mirroring `useKdsRealtime.uniqueChannel.test.tsx`. Mock `@/lib/supabase` with `channelSpy`, mock `./usePromotions` (`PROMOTIONS_QUERY_KEY`) if the import chain pulls in supabase. Two cases: StrictMode → 2 distinct names matching `/^promotions-changes-/` ; non-StrictMode → 1 name matching `/^promotions-changes-[0-9a-f]{8}-...$/` UUID v4 regex. Run → **expect failure** (current code reuses one UUID across both StrictMode mounts).
- [ ] **P1.2 (fix)** In `usePromotionsRealtime.ts`: remove the `useMemo` line (19) and drop `useMemo` from the import (line 8). Inside the effect, build `const channelName = \`promotions-changes-${crypto.randomUUID()}\`;` and pass it to `.channel(channelName)`. Change deps array `[qc, mountId]` → `[qc]`. Keep the explanatory comment but reword to match `useKdsRealtime` (UUID inside the effect).
- [ ] **P1.3** Run the new test → **PASS**. Run `pnpm --filter @breakery/app-pos test promotions` → no regression.

---

## Phase 2 — `useTableOccupancy` (independent)

- [ ] **P2.1 (test-first)** Write `apps/pos/src/features/tables/__tests__/useTableOccupancy.uniqueChannel.test.tsx`. Mock `@/lib/supabase` `channelSpy`. The hook also runs a `useQuery(fetchOccupied)` — the supabase mock's `from(...).select(...).not(...).not(...)` chain must resolve to `{ data: [], error: null }` so the query doesn't throw (or just let it reject quietly with `retry:false` — the channel call happens in the effect regardless). Prefix `/^table_occupancy_realtime-/`. Two cases (StrictMode 2 distinct / non-StrictMode 1). Run → **expect failure**.
- [ ] **P2.2 (fix)** In `useTableOccupancy.ts`: remove the `useMemo` line (36) and drop `useMemo` from the import (line 1). Inside the effect, build `const channelName = \`table_occupancy_realtime-${crypto.randomUUID()}\`;`. Change deps `[queryClient, mountId]` → `[queryClient]`. Leave `useQuery`/`fetchOccupied`/return value untouched.
- [ ] **P2.3** Run the new test → **PASS**. `pnpm --filter @breakery/app-pos test tables` → no regression.

---

## Phase 3 — `useTabletOrderStatusListener` (independent)

- [ ] **P3.1 (test-first)** Write `apps/pos/src/features/tablet/__tests__/useTabletOrderStatusListener.uniqueChannel.test.tsx`. Mock `@/lib/supabase` `channelSpy` **and** `@/stores/authStore` so `useAuthStore((s) => s.user?.id)` returns a non-null id — otherwise the effect early-returns at line 27 and `channelSpy` is never called. Prefix `/^tablet-order-status-/`. Two cases (StrictMode 2 distinct / non-StrictMode 1). Run → **expect failure**.
- [ ] **P3.2 (fix)** In `useTabletOrderStatusListener.ts`: remove the `useMemo` line (19) and drop `useMemo` from the import (line 1). Inside the effect (after the `if (!userId) return;` guard), build `const channelName = \`tablet-order-status-${crypto.randomUUID()}\`;`. Change deps `[userId, queryClient, mountId]` → `[userId, queryClient]`. Keep `seenRef` dedupe and the toast/invalidate logic unchanged.
- [ ] **P3.3** Run the new test → **PASS**. `pnpm --filter @breakery/app-pos test tablet` → no regression.

---

## Phase 4 — verification + PR

- [ ] **P4.1** Grep-confirm no remaining `useMemo(() => crypto.randomUUID()` in `apps/pos/src` (the 3 were the only POS occurrences per the audit).
- [ ] **P4.2** `pnpm --filter @breakery/app-pos typecheck` → PASS.
- [ ] **P4.3** `pnpm --filter @breakery/app-pos test promotions tables tablet` → all green (3 new uniqueness tests + existing suites).
- [ ] **P4.4** PR `fix/pos-realtime-channel-uniqueness` → `master`. Title `fix(pos): realtime channel UUID inside useEffect (3 hooks) — StrictMode uniqueness`. Body links spec + lists the 3 hooks.

---

## Acceptance criteria

- [ ] The 3 hooks generate the channel UUID **inside** `useEffect`; no `useMemo(() => crypto.randomUUID(), [])` at component body remains.
- [ ] `useMemo` import removed from each file (unused elsewhere — verified).
- [ ] No `mountId` in any deps array.
- [ ] Under `<StrictMode>`, each hook opens 2 distinct channel names (test-proven).
- [ ] Non-StrictMode, each hook opens 1 channel per argument set.
- [ ] Business behaviour unchanged (query invalidation, tablet dedupe + toast).
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.

---

## Risks / dependencies

- **Risk ~nil** — mechanical change covered by uniqueness tests; no DB/EF dependency. Observable behaviour changes only under StrictMode (dev), never prod.
- No cross-phase dependency — the 3 hook phases can run in parallel (one subagent each).

## Deviations log (fill during execution)

| ID | Severity | Description |
|---|---|---|
| _(à compléter)_ | | |
