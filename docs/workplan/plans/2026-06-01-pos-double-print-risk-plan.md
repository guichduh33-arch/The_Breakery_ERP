# POS Double-Print Risk — Typed LAN Client + Gated Legacy-Chit Deprecation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the post-S34 double-print risk on kitchen tickets by (P1) typing the `lanHubMessageHandler.ts` Supabase client as `SupabaseClient<Database>` unconditionally and dropping the `as never` RPC casts, then (P2) deprecating the legacy `enqueue_print_job_v1('kitchen_chit')` path on `kds.bump` — but only behind a hard inter-plan gate so kitchen printing is never silenced before the S34 bridge (Path A) is proven reachable.

**Architecture:** Two volets in one branch. **P1 (Task 2-3)** is unconditional and risk-free: export a centralized `TypedSupabaseClient = SupabaseClient<Database>` from `@breakery/supabase` (Option B — keeps the app off a direct `@supabase/supabase-js` import, matching the deliberate decoupling in `lanHub.ts:28-34`), consume it in the handler, and remove every `as never`. **P2 (Task 5)** is GATED: it only runs if the multi-printer print-bridge is deployed/reachable (acceptance §3 of the `pos-print-bridge-deploy` plan — "mixed order → 3 prep tickets + cashier receipt") OR the deprecation ships behind a feature flag that is explicitly OFF. If neither holds, P2 STOPs, only P1 ships, and the dependency is tracked as a follow-up. Deprecating Path B (the only durable print path on bump) without Path A proven = a P0 "silent kitchen" regression.

**Tech Stack:** pnpm 9.15 + turbo monorepo; TypeScript strict (`@breakery/supabase` re-exports the generated `Database` type from `@supabase/supabase-js`'s `SupabaseClient<Database>`); React + Vitest (`apps/pos`); Supabase cloud V3 dev (`ikcyvlovptebroadgtvd`) via MCP for any types regen (none expected — the 3 LAN RPCs are already in `types.generated.ts`). No DB migration.

**Spec:** [`../specs/2026-06-01-pos-double-print-risk-spec.md`](../specs/2026-06-01-pos-double-print-risk-spec.md)
**Branch:** `fix/pos-double-print-risk` (create from `master` @ `70c5cf1`)
**Effort:** S-M (~0.5-1 day repo work; P2 gated on an external dependency)
**No DB migration.** `enqueue_print_job_v1` stays in the DB (still used by generic `print.request`); the deprecation is client-side only.

---

## Verified code facts (checked `file:line` before planning)

- **Path A (S34, canonical)** — bridge direct: `useFireToStations` → `printStationTicket` (`apps/pos/src/services/print/printService.ts`) POST `/print/ticket`. Wired in `PaymentTerminal` auto-fire + `SendToKitchenButton`. Intact, untouched by this plan.
- **Path B (S13 legacy, to deprecate)** — print-queue DB: `apps/pos/src/features/lan/lanHubMessageHandler.ts:99-117`. On `kds.bump` with `msg.payload.new_status === 'preparing'` (`:99`) it calls `ctx.supabase.rpc('enqueue_print_job_v1', { ... ticket_type: 'kitchen_chit' ... })` (`:100-112`). **Active path**: `handleLanMessage` (`:33`) is wired via `lanHub.ts` (`onMessage` → `handleLanMessage`) mounted by `useLanHub`.
- **`any` typing** — `lanHubMessageHandler.ts:13-14`:
  ```ts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SupabaseClient = any;
  ```
  Used at `LanHandlerContext.supabase` (`:24`). Consequence: `ctx.supabase.rpc(...)` is not type-checked, hence the `as never` escape hatches at `:107` (the `p_payload` object on the kitchen_chit call), `:112` (the args object of `enqueue_print_job_v1` on bump), `:133` (the args object of `enqueue_print_job_v1` in `handlePrintRequest`), and `:176` (the args object of `update_lan_heartbeat_v1` in `handleHeartbeat`). There is also a value-cast `msg.payload.data as never` at `:128` and `msg.payload.reference_id as never` at `:131` inside the `:126-133` call — these are field-level casts inside the same RPC call and must be re-evaluated when the call is typed.
- **`print.request` generic** (`handlePrintRequest`, `:120-156`) — distinct from the bump auto-chit; it enqueues via `enqueue_print_job_v1` (`:126-133`) for explicit jobs (≠ `kitchen_chit` auto). **Kept** — outside the deprecation decision (confirm in Task 1).
- **Centralized type availability (decisive for Option B)** — `@breakery/supabase` (`packages/supabase/src/index.ts`) currently exports `type { Database, Json }` (`:9`) but **NOT** `SupabaseClient`. The concrete client type lives in `packages/supabase/src/client.ts:1,4` as `SupabaseClient<Database>` (imported from `@supabase/supabase-js`). **Option B therefore requires adding a `TypedSupabaseClient` re-export** to `packages/supabase/src/index.ts` (Task 2) — it does not exist yet.
- **RPCs present in generated types (P1.4 pre-verified — present, no regen)** — `packages/supabase/src/types.generated.ts` contains `enqueue_print_job_v1` (`:5851`), `update_lan_heartbeat_v1` (`:6969`), and `claim_print_job_v1` (`:5552`, print-server side, not in this handler). So typing the client will type-check the RPC names/args without a migration or regen. If — and only if — a typecheck reveals a missing RPC, regen via MCP (Task 3, Step 3.5 contingency).
- **Decoupling precedent** — `lanHub.ts:28-34` deliberately uses `type SupabaseClient = any` + `type RealtimeChannel = any` to avoid a direct `@supabase/supabase-js` dep in the app (comment `:28-30`). Option B (centralized `TypedSupabaseClient` from `@breakery/supabase`) respects that decoupling — the app imports from the workspace package, not from `@supabase/supabase-js` directly. Typing `lanHub.ts` itself is out of scope (follow-up).
- **Bridge plan acceptance criterion for the gate** — `docs/workplan/plans/2026-06-01-pos-print-bridge-deploy-plan.md` Acceptance §3 (its acceptance list, line ~610): "Real repro (mixed order → 3 prep tickets + cashier receipt) — **deferred**, depends on the deployed bridge." The bridge hardware deploy is tracked as `DEV-S34-W0-02` and is explicitly external/non-mergeable in that plan (Task 6). **As of 2026-06-01 the bridge is NOT yet deployed** → the gate (a) is NOT satisfied; only gate (b) feature-flag-OFF is available for P2.
- **Existing LAN tests (non-regression)** — `apps/pos/src/features/lan/__tests__/lanHub.dedup.test.ts`, `apps/pos/src/features/lan/__tests__/useLanHub.uniqueChannel.test.tsx`. Path A smoke: `apps/pos/src/features/cart/__tests__/fire-to-stations.smoke.test.tsx`.

---

## Inter-plan dependency (materialized)

```
pos-print-bridge-deploy                              pos-double-print-risk
  (Path A — deploys the bridge)                        Task 5 = P2 (deprecate Path B kitchen_chit)
  Acceptance §3: mixed order → 3 prep                       ▲
  tickets + cashier receipt (DEV-S34-W0-02)                 │  GATE (Task 4, P0.4)
        │                                                   │
        └── bridge deployed & reachable ──(gate a)──────────┤
                                                            │
            feature flag VITE_LEGACY_KITCHEN_CHIT           │
            shipped explicitly OFF ───────(gate b)──────────┘
                                                            │
            neither (a) nor (b) ───── STOP P2 ──────────────┘  (ship P1 only + follow-up)
```

**Gate rule (Task 4):** Task 5 (P2) starts ONLY if **(a)** the print-bridge is deployed & reachable — 5 printers registered in `lan_devices`, `printStationTicket` POST to `/print/ticket` confirmed, real repro = 1 mixed order → 3 prep tickets + receipt (bridge plan acceptance §3) — **OR (b)** P2 ships behind a feature flag (`import.meta.env.VITE_LEGACY_KITCHEN_CHIT`) that is **explicitly OFF/absent by default**, so the legacy chit keeps running until ops flips the flag post-bridge.
**If neither (a) nor (b): STOP Task 5.** Ship P1 (Task 2-3) only. Track the unmet dependency in the INDEX (Task 6) and CLAUDE.md (Task 7). Rationale: hard-deleting Path B without a proven Path A = P0 "silent kitchen" (no print on bump).

> **As of 2026-06-01, the bridge is NOT deployed** (bridge plan Task 6 is external/unexecuted, `DEV-S34-W0-02` open). The realistic path for P2 in this PR is **gate (b) feature-flag-OFF**. Task 5 is authored for both (a) and (b); pick at execution per Task 4's recorded answer.

---

## File Structure

### Modified
| Path | Change | Volet |
|---|---|---|
| `packages/supabase/src/index.ts:9` | Add a `TypedSupabaseClient` re-export (`SupabaseClient<Database>` from `@supabase/supabase-js`). One new exported type alias; no behavior change. | P1 (Task 2) |
| `apps/pos/src/features/lan/lanHubMessageHandler.ts:13-14` | Replace `type SupabaseClient = any` (+ remove the `eslint-disable`) with an import of `TypedSupabaseClient`; retype `LanHandlerContext.supabase` (`:24`). | P1 (Task 2) |
| `apps/pos/src/features/lan/lanHubMessageHandler.ts:107,112,128,131,133,176` | Remove the `as never` casts now that the client is typed (per RPC call, verifying typecheck after each). | P1 (Task 3) |
| `apps/pos/src/features/lan/lanHubMessageHandler.ts:92-117` | (GATED P2) Deprecate the `kitchen_chit` block — hard-remove (gate a) or feature-flag (gate b) — and fix the stale comment `:92-95`. | P2 (Task 5) |

### Created (tests)
| Path | Responsibility | Volet |
|---|---|---|
| `apps/pos/src/features/lan/__tests__/lan-hub-typed-client.test.ts` | Runtime smoke proving `handleHeartbeat` / `handlePrintRequest` call `.rpc(...)` with the right name + arg shape under a typed mock client. Compile-time benefit: a wrong RPC name now breaks `typecheck`. | P1 (Task 3) |
| `apps/pos/src/features/lan/__tests__/lan-hub-no-kitchen-chit.smoke.test.tsx` | (GATED P2) Proves `kds.bump` no longer enqueues `kitchen_chit` (gate a: never; gate b: not when flag OFF, yes when flag ON). | P2 (Task 5) |

### Created (closeout)
| Path | Responsibility |
|---|---|
| `docs/workplan/plans/2026-06-01-pos-double-print-risk-INDEX.md` | Closeout INDEX (Task 6). |

> **CLAUDE.md "NEVER create files unless absolutely necessary":** the only new source files are two test files (co-located in `__tests__/`, required by the spec's test section) and the INDEX. The `TypedSupabaseClient` export is added to the **existing** `packages/supabase/src/index.ts` — no new package file.

---

## Task 1: Branch + ratification + dependency-gate decision (BLOCKING, no code)

**Files:** none changed (branch + decisions recorded in this plan's Deviations log)

- [ ] **Step 1.1: Create the branch from the pinned base**

```bash
git checkout master
git pull --ff-only
git checkout -b fix/pos-double-print-risk
git log -1 --oneline
```

Expected: HEAD at or after `70c5cf1`; new branch checked out.

- [ ] **Step 1.2: Confirm the verified anchors still match (no drift)**

```bash
git grep -n "type SupabaseClient = any" apps/pos/src/features/lan/lanHubMessageHandler.ts
git grep -n "as never" apps/pos/src/features/lan/lanHubMessageHandler.ts
git grep -n "kitchen_chit" apps/pos/src/features/lan/lanHubMessageHandler.ts
```

Expected: `type SupabaseClient = any` at line 14; `as never` at lines 107, 112, 128, 131, 133, 176 (six occurrences — note `:128` and `:131` are field casts inside the `:126-133` call); `kitchen_chit` at line 104. If any line drifted, re-read the file and update the edit anchors in Tasks 2/3/5 before proceeding — do not edit with a stale anchor.

- [ ] **Step 1.3: RATIFY the canonical decision (escalation — transverse printing impact)**

Have the user/business ratify: **Path A (S34 bridge) is canonical → deprecate the `enqueue_print_job_v1('kitchen_chit')` on `kds.bump`** (spec §2.A default). The S35 KDS screen handles the on-screen bump, not printing. Record the ratified decision in this plan's **Deviations log** (and later the INDEX). If the user instead keeps Path B with an anti-double guard, STOP this plan and re-spec — that alternative is out of scope here.

- [ ] **Step 1.4: Clarify the fate of generic `print.request`**

Confirm `handlePrintRequest` (`:120-156`) is **kept** (explicit jobs, ≠ the bump auto-chit) and is not swept by the P0.2 decision. Record the confirmation in the Deviations log.

- [ ] **Step 1.5: GATE DECISION (Task 4 input) — pick (a) or (b) or STOP**

Check the state of [`pos-print-bridge-deploy`](2026-06-01-pos-print-bridge-deploy-plan.md). Record one of:
- **(a)** Bridge deployed & reachable — its acceptance §3 met (real repro: 1 mixed order → 3 prep tickets + receipt; 5 `lan_devices` printer rows present). → Task 5 hard-removes the block.
- **(b)** Bridge NOT yet deployed (expected as of 2026-06-01, `DEV-S34-W0-02` open) → Task 5 ships behind `VITE_LEGACY_KITCHEN_CHIT` **OFF**.
- **STOP** — if neither is acceptable to ship, skip Task 5 entirely; deliver P1 only (Tasks 2-3) + follow-up in INDEX/CLAUDE.md.

Record the chosen branch (a/b/STOP) in the Deviations log; it drives Task 4 and Task 5.

- [ ] **Step 1.6: Commit the spec + this plan**

```bash
git add docs/workplan/specs/2026-06-01-pos-double-print-risk-spec.md docs/workplan/plans/2026-06-01-pos-double-print-risk-plan.md
git commit -m "docs(workplan): pos double-print risk — spec + plan"
```

Expected: one commit on `fix/pos-double-print-risk`.

---

## Task 2: Centralize the typed client + retype the handler (P1, unconditional)

**Files:**
- Modify: `packages/supabase/src/index.ts:9`
- Modify: `apps/pos/src/features/lan/lanHubMessageHandler.ts:11-31`

> Option B (chosen): export the type from `@breakery/supabase` so the app stays decoupled from `@supabase/supabase-js` (consistent with `lanHub.ts:28-34`). The alias also becomes reusable to type `lanHub.ts` later.

- [ ] **Step 2.1: Add the `TypedSupabaseClient` re-export to `@breakery/supabase`**

Edit `packages/supabase/src/index.ts`. The current line 9 is:

```ts
export type { Database, Json } from './types.generated.js';
```

Add a new export line immediately after it (the package already depends on `@supabase/supabase-js` — `client.ts:1` imports `SupabaseClient` from it):

```ts
export type { Database, Json } from './types.generated.js';
// Project-wide typed Supabase client. Re-exported here so app/edge code can type
// a client as SupabaseClient<Database> WITHOUT taking a direct dep on
// @supabase/supabase-js (keeps apps decoupled — cf. apps/pos lanHub.ts decoupling).
import type { SupabaseClient as SupabaseClientGeneric } from '@supabase/supabase-js';
import type { Database as DatabaseGenerated } from './types.generated.js';
export type TypedSupabaseClient = SupabaseClientGeneric<DatabaseGenerated>;
```

(The local aliases `SupabaseClientGeneric` / `DatabaseGenerated` avoid colliding with the `Database` name already re-exported on line 9.)

- [ ] **Step 2.2: Typecheck the package in isolation**

```bash
pnpm --filter @breakery/supabase typecheck
```

Expected: PASS. The new export is type-only; no runtime change. If `@supabase/supabase-js` is not resolvable as a type import here, it is already a direct dependency of this package (`client.ts:1`), so this should not fail — if it does, do not add it to `apps/pos`; the type lives in the package by design.

- [ ] **Step 2.3: Replace the `any` alias in the handler with the typed import**

Edit `apps/pos/src/features/lan/lanHubMessageHandler.ts`. The current `:11-21` block is:

```ts
import type { QueryClient } from '@tanstack/react-query';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;
import type {
  LanMessage,
  KdsBumpMessage,
  PrintRequestMessage,
  PrintResultMessage,
  HeartbeatMessage,
} from '@breakery/domain';
```

Replace it with (drop the `eslint-disable` + the `any` alias; import the centralized type):

```ts
import type { QueryClient } from '@tanstack/react-query';
import type { TypedSupabaseClient } from '@breakery/supabase';
import type {
  LanMessage,
  KdsBumpMessage,
  PrintRequestMessage,
  PrintResultMessage,
  HeartbeatMessage,
} from '@breakery/domain';
```

- [ ] **Step 2.4: Retype `LanHandlerContext.supabase`**

In the same file, the `LanHandlerContext` interface (`:23-31`) currently declares:

```ts
export interface LanHandlerContext {
  supabase: SupabaseClient;
  /** Optional react-query client to invalidate on inbound events. */
  queryClient?: QueryClient;
  /** Hub's own device id, for `to=`-targeted replies. */
  hubDeviceId: string;
  /** Callback to send a reply back through the hub transport. */
  reply: (msg: LanMessage) => void;
}
```

Change only the first field to the centralized type:

```ts
export interface LanHandlerContext {
  supabase: TypedSupabaseClient;
  /** Optional react-query client to invalidate on inbound events. */
  queryClient?: QueryClient;
  /** Hub's own device id, for `to=`-targeted replies. */
  hubDeviceId: string;
  /** Callback to send a reply back through the hub transport. */
  reply: (msg: LanMessage) => void;
}
```

- [ ] **Step 2.5: Typecheck POS — expect it to surface the `as never` casts as now-typed**

```bash
pnpm --filter @breakery/app-pos typecheck
```

Expected: with the client typed, the `as never` casts at `:107/:112/:128/:131/:133/:176` are now either unnecessary or actively masking the real argument types. The typecheck may PASS while the casts are still present (an `as never` is assignable to anything) — that is fine for this step; Task 3 removes them one by one. If the typecheck FAILS here, it means a real RPC name/shape mismatch was masked by `any` (a genuine latent bug) — record it and fix the call to the correct shape before continuing.

- [ ] **Step 2.6: Commit**

```bash
git add packages/supabase/src/index.ts apps/pos/src/features/lan/lanHubMessageHandler.ts
git commit -m "refactor(supabase): export TypedSupabaseClient; type lanHub handler client (remove any)"
```

Expected: one commit.

---

## Task 3: Remove the `as never` casts + add the typed-client smoke (P1, unconditional)

**Files:**
- Modify: `apps/pos/src/features/lan/lanHubMessageHandler.ts:107,112,128,131,133,176`
- Test: `apps/pos/src/features/lan/__tests__/lan-hub-typed-client.test.ts` (create)

- [ ] **Step 3.1: Write the typed-client runtime smoke (failing-first is N/A — assertion-only, but author before edits to lock the contract)**

Create `apps/pos/src/features/lan/__tests__/lan-hub-typed-client.test.ts` with exactly this content. It builds a minimal mock that satisfies `TypedSupabaseClient` at the surface used by the handler (`rpc`), and asserts the RPC name + arg shape for `heartbeat` and `print.request`. The primary win is compile-time (the file imports the typed `LanHandlerContext`), the runtime asserts guard the arg shapes.

```ts
// apps/pos/src/features/lan/__tests__/lan-hub-typed-client.test.ts
//
// fix/pos-double-print-risk — handler consumes a typed SupabaseClient<Database>.
//
// Compile-time: this file imports the typed LanHandlerContext, so a wrong RPC
// name or arg key in the handler would fail `pnpm --filter @breakery/app-pos
// typecheck`. Runtime: assert the RPC name + arg shape for the non-gated handlers
// (heartbeat, print.request) that survive regardless of the P2 gate.

import { describe, it, expect, vi } from 'vitest';
import {
  handleLanMessage,
  type LanHandlerContext,
} from '../lanHubMessageHandler';
import type { HeartbeatMessage, PrintRequestMessage } from '@breakery/domain';

function makeCtx(rpc: ReturnType<typeof vi.fn>): LanHandlerContext {
  return {
    // The handler only uses `.rpc()`; cast the minimal stub through unknown to
    // the typed client surface. A real client would satisfy the full type.
    supabase: { rpc } as unknown as LanHandlerContext['supabase'],
    queryClient: undefined,
    hubDeviceId: 'hub-1',
    reply: vi.fn(),
  };
}

describe('lanHubMessageHandler — typed client', () => {
  it('heartbeat calls update_lan_heartbeat_v1 with p_device_code', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = makeCtx(rpc);
    const msg: HeartbeatMessage = {
      version: 1,
      id: crypto.randomUUID(),
      from: 'kds-tablet-7',
      type: 'heartbeat',
      ts: Date.now(),
      payload: {},
    };

    await handleLanMessage(msg, ctx);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('update_lan_heartbeat_v1', {
      p_device_code: 'kds-tablet-7',
    });
  });

  it('print.request calls enqueue_print_job_v1 with the request payload', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null });
    const ctx = makeCtx(rpc);
    const msg: PrintRequestMessage = {
      version: 1,
      id: crypto.randomUUID(),
      from: 'pos-1',
      type: 'print.request',
      ts: Date.now(),
      payload: {
        data: { foo: 'bar' },
        reference_type: 'order',
        reference_id: 'ord-1',
        priority: 7,
      },
    };

    await handleLanMessage(msg, ctx);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('enqueue_print_job_v1', {
      p_device_id: null,
      p_payload: { foo: 'bar' },
      p_source: 'pos',
      p_reference_type: 'order',
      p_reference_id: 'ord-1',
      p_priority: 7,
    });
  });
});
```

> **Domain-shape note for the executor:** if the real `HeartbeatMessage` / `PrintRequestMessage` shapes in `@breakery/domain` differ from the literals above (e.g. `payload` keys), the typecheck will tell you exactly which key is wrong — adjust the literal to match the imported type. Do not invent fields the type doesn't declare. The assertion values (`p_*` keys) must mirror what the handler passes at `:100-112` / `:126-133`.

- [ ] **Step 3.2: Remove the `as never` on the `print.request` call (`:126-133`) and its field casts**

In `handlePrintRequest` the current call is:

```ts
  const { data, error } = await ctx.supabase.rpc('enqueue_print_job_v1', {
    p_device_id:      null,
    p_payload:        msg.payload.data as never,
    p_source:         'pos',
    p_reference_type: msg.payload.reference_type,
    p_reference_id:   msg.payload.reference_id as never,
    p_priority:       msg.payload.priority ?? 5,
  } as never);
```

Remove the trailing `} as never)` and the two field-level `as never` casts:

```ts
  const { data, error } = await ctx.supabase.rpc('enqueue_print_job_v1', {
    p_device_id:      null,
    p_payload:        msg.payload.data,
    p_source:         'pos',
    p_reference_type: msg.payload.reference_type,
    p_reference_id:   msg.payload.reference_id,
    p_priority:       msg.payload.priority ?? 5,
  });
```

Run after this single edit:

```bash
pnpm --filter @breakery/app-pos typecheck
```

Expected: PASS. If `p_payload` (typed `Json`) rejects `msg.payload.data`, that means the domain `data` type is wider than `Json` — narrow it at the call with a typed local (`const p_payload: Json = msg.payload.data;`) rather than re-adding `as never`. If `p_reference_id` rejects, coerce to the column type the generated args expect (do not re-add `as never`).

- [ ] **Step 3.3: Remove the `as never` on the heartbeat call (`:174-176`)**

Current:

```ts
  const { error } = await ctx.supabase.rpc('update_lan_heartbeat_v1', {
    p_device_code: msg.from,
  } as never);
```

New (drop the cast):

```ts
  const { error } = await ctx.supabase.rpc('update_lan_heartbeat_v1', {
    p_device_code: msg.from,
  });
```

Run:

```bash
pnpm --filter @breakery/app-pos typecheck
```

Expected: PASS (`p_device_code` is `string`, `msg.from` is `string`).

- [ ] **Step 3.4: Remove the `as never` on the kitchen_chit call (`:100-112`) — typing only, deprecation is Task 5**

> This step types the call **without removing it** (removal/flagging is the GATED Task 5). It is safe and unconditional: a correctly-typed call is strictly better than an `any`-masked one even if the block is later deprecated.

Current:

```ts
    const { error } = await ctx.supabase.rpc('enqueue_print_job_v1', {
      p_device_id:      null,
      p_payload:        {
        ticket_type:    'kitchen_chit',
        order_item_id:  msg.payload.order_item_id,
        order_id:       msg.payload.order_id,
        station:        msg.payload.station,
      } as never,
      p_source:         'kds',
      p_reference_type: 'order_item',
      p_reference_id:   msg.payload.order_item_id,
      p_priority:       5,
    } as never);
```

New (drop both `as never`):

```ts
    const { error } = await ctx.supabase.rpc('enqueue_print_job_v1', {
      p_device_id:      null,
      p_payload:        {
        ticket_type:    'kitchen_chit',
        order_item_id:  msg.payload.order_item_id,
        order_id:       msg.payload.order_id,
        station:        msg.payload.station,
      },
      p_source:         'kds',
      p_reference_type: 'order_item',
      p_reference_id:   msg.payload.order_item_id,
      p_priority:       5,
    });
```

Run:

```bash
pnpm --filter @breakery/app-pos typecheck
```

Expected: PASS. If `p_payload` (typed `Json`) rejects the object literal, annotate a local `const p_payload: Json = { ... };` and pass it — do not re-add `as never`.

- [ ] **Step 3.5 (CONTINGENCY — only if a typecheck above blames a missing RPC): regen types**

Only if Step 3.2/3.3/3.4 fails with "argument of type ... 'enqueue_print_job_v1' is not assignable" because an RPC is **absent** from `types.generated.ts` (pre-verified present at `:5851`/`:6969`, so this is unexpected): regen via MCP `mcp__plugin_supabase_supabase__generate_typescript_types` (`project_id='ikcyvlovptebroadgtvd'`), write the result to `packages/supabase/src/types.generated.ts`, commit `chore(supabase): regen types for LAN RPCs`, and re-run the failing typecheck. Record the deviation. Skip this step entirely if no typecheck blamed a missing RPC.

- [ ] **Step 3.6: Run the typed-client smoke**

```bash
pnpm --filter @breakery/app-pos test lan-hub-typed-client
```

Expected: 2 PASS (heartbeat → `update_lan_heartbeat_v1`; print.request → `enqueue_print_job_v1`).

- [ ] **Step 3.7: Final P1 typecheck — no new `eslint-disable`**

```bash
pnpm --filter @breakery/app-pos typecheck
git grep -n "eslint-disable" apps/pos/src/features/lan/lanHubMessageHandler.ts
```

Expected: typecheck PASS; the `git grep` returns **no matches** in the handler (the `:13` disable is gone and none were added) — this satisfies spec §3 "sans nouveaux `eslint-disable`".

- [ ] **Step 3.8: Commit P1**

```bash
git add apps/pos/src/features/lan/lanHubMessageHandler.ts apps/pos/src/features/lan/__tests__/lan-hub-typed-client.test.ts
git commit -m "refactor(pos): remove as never casts on LAN RPCs (typed client) + typed-client smoke"
```

Expected: one commit. **P1 is now complete and independently mergeable.**

---

## Task 4: Materialize the dependency gate (BLOCKING for Task 5, no code)

**Files:** none changed (gate evaluation, recorded in Deviations log)

> This task does not write code. It evaluates the inter-plan gate from Task 1.5 and decides whether Task 5 runs, and in which mode.

- [ ] **Step 4.1: Evaluate gate (a) — bridge deployed & reachable**

Confirm against [`pos-print-bridge-deploy`](2026-06-01-pos-print-bridge-deploy-plan.md) Acceptance §3: are the 5 `lan_devices` printer rows present in prod/dev AND has the real repro been observed (1 mixed order → 3 prep tickets on barista/kitchen/bakery + cashier receipt)? Verify the seed via MCP `execute_sql` (`project_id='ikcyvlovptebroadgtvd'`):

```sql
SELECT capabilities ->> 'station' AS station, ip_address, port
FROM lan_devices
WHERE device_type = 'printer' AND is_active AND deleted_at IS NULL
  AND capabilities ->> 'station' IN ('barista','kitchen','bakery','cashier','waiter')
ORDER BY station;
```

If this returns 5 rows AND the physical repro is signed off → **gate (a) satisfied → Task 5 mode = hard-remove**.

- [ ] **Step 4.2: Evaluate gate (b) — feature-flag-OFF fallback**

If gate (a) is not satisfied (expected as of 2026-06-01, `DEV-S34-W0-02` open), decide whether to ship the deprecation behind `VITE_LEGACY_KITCHEN_CHIT` **OFF by default** (the legacy chit keeps running; flipping the flag is a post-bridge ops action). If yes → **gate (b) satisfied → Task 5 mode = feature-flag**.

- [ ] **Step 4.3: STOP decision**

If neither (a) nor (b) is acceptable to ship in this PR → **SKIP Task 5 entirely.** Deliver P1 only (Tasks 2-3). Jump to Task 6 and record the unmet dependency as a follow-up + deviation. Do NOT hard-remove or flag the block. Record the final gate verdict (a / b / STOP) in the Deviations log; it is the single source of truth for Task 5's mode.

---

## Task 5: Deprecate the legacy kitchen_chit path (P2, GATED on Task 4)

> **DO NOT START unless Task 4 recorded gate (a) or (b).** If Task 4 = STOP, skip to Task 6.

**Files:**
- Modify: `apps/pos/src/features/lan/lanHubMessageHandler.ts:88-118`
- Test: `apps/pos/src/features/lan/__tests__/lan-hub-no-kitchen-chit.smoke.test.tsx` (create)

- [ ] **Step 5.1: Write the failing deprecation smoke**

Create `apps/pos/src/features/lan/__tests__/lan-hub-no-kitchen-chit.smoke.test.tsx` with exactly this content. It covers BOTH gate modes; the executor keeps the cases matching the chosen mode (the others stay valid documentation of intent).

```tsx
// apps/pos/src/features/lan/__tests__/lan-hub-no-kitchen-chit.smoke.test.tsx
//
// fix/pos-double-print-risk P2 (GATED) — kds.bump must NOT enqueue a kitchen_chit
// print job once Path A (S34 bridge) is canonical. Two gate modes:
//   (a) hard-remove: bump NEVER enqueues kitchen_chit.
//   (b) feature-flag VITE_LEGACY_KITCHEN_CHIT: OFF (default) = no chit; ON = chit.
// printService.ts pattern: env read at module load, so flag cases vi.resetModules()
// after vi.stubEnv, then dynamically import the handler.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { KdsBumpMessage } from '@breakery/domain';

function bumpPreparing(): KdsBumpMessage {
  return {
    version: 1,
    id: crypto.randomUUID(),
    from: 'kds-tablet-7',
    type: 'kds.bump',
    ts: Date.now(),
    payload: {
      order_item_id: 'oi-1',
      order_id: 'ord-1',
      station: 'kitchen',
      new_status: 'preparing',
    },
  };
}

function isKitchenChitCall(call: unknown[]): boolean {
  if (call[0] !== 'enqueue_print_job_v1') return false;
  const args = call[1] as { p_payload?: { ticket_type?: string } } | undefined;
  return args?.p_payload?.ticket_type === 'kitchen_chit';
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('lan hub — kds.bump no longer enqueues kitchen_chit', () => {
  // -- GATE (a): hard-remove. Keep this block when Task 4 = gate (a). --
  it('[gate a] never enqueues kitchen_chit on bump', async () => {
    vi.resetModules();
    const { handleLanMessage } = await import('../lanHubMessageHandler');
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = {
      supabase: { rpc } as never,
      queryClient: { invalidateQueries: vi.fn() } as never,
      hubDeviceId: 'hub-1',
      reply: vi.fn(),
    };

    await handleLanMessage(bumpPreparing(), ctx);

    const chitCalls = rpc.mock.calls.filter(isKitchenChitCall);
    expect(chitCalls).toHaveLength(0);
  });

  // -- GATE (b): feature flag. Keep these two when Task 4 = gate (b). --
  it('[gate b] flag OFF (unset) → no kitchen_chit', async () => {
    vi.stubEnv('VITE_LEGACY_KITCHEN_CHIT', '');
    vi.resetModules();
    const { handleLanMessage } = await import('../lanHubMessageHandler');
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = {
      supabase: { rpc } as never,
      queryClient: { invalidateQueries: vi.fn() } as never,
      hubDeviceId: 'hub-1',
      reply: vi.fn(),
    };

    await handleLanMessage(bumpPreparing(), ctx);

    expect(rpc.mock.calls.filter(isKitchenChitCall)).toHaveLength(0);
  });

  it('[gate b] flag ON → kitchen_chit re-enqueued (proves the flag works)', async () => {
    vi.stubEnv('VITE_LEGACY_KITCHEN_CHIT', '1');
    vi.resetModules();
    const { handleLanMessage } = await import('../lanHubMessageHandler');
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = {
      supabase: { rpc } as never,
      queryClient: { invalidateQueries: vi.fn() } as never,
      hubDeviceId: 'hub-1',
      reply: vi.fn(),
    };

    await handleLanMessage(bumpPreparing(), ctx);

    expect(rpc.mock.calls.filter(isKitchenChitCall)).toHaveLength(1);
  });
});
```

> The mock `supabase`/`queryClient` are cast `as never` **in the test only** (a test stub need not satisfy the full client type). This is unrelated to the production `as never` removed in Task 3.

- [ ] **Step 5.2: Run the smoke to verify it fails for the right reason**

```bash
pnpm --filter @breakery/app-pos test lan-hub-no-kitchen-chit
```

Expected: under gate (a), the `[gate a]` case FAILS (the un-edited handler still enqueues the chit → `chitCalls` length 1). Under gate (b), `[gate b] flag OFF` FAILS for the same reason. This confirms the test exercises the real path before the edit.

- [ ] **Step 5.3a: Apply the deprecation — GATE (a) hard-remove**

> Use this step ONLY if Task 4 = gate (a). For gate (b), use Step 5.3b instead.

In `handleKdsBump` (`:88-118`), the current body is:

```ts
async function handleKdsBump(
  msg: KdsBumpMessage,
  ctx: LanHandlerContext,
): Promise<void> {
  // The bump itself is performed by the kds RPC on the originating device.
  // The hub just invalidates downstream caches so the cashier-side
  // dashboards reflect the new state immediately. We also enqueue a
  // kitchen-chit print job if the new_status is 'preparing' (D-W5-5A-* design).
  ctx.queryClient?.invalidateQueries({ queryKey: ['kds'] });
  ctx.queryClient?.invalidateQueries({ queryKey: ['orders'] });

  if (msg.payload.new_status === 'preparing') {
    const { error } = await ctx.supabase.rpc('enqueue_print_job_v1', {
      p_device_id:      null,
      p_payload:        {
        ticket_type:    'kitchen_chit',
        order_item_id:  msg.payload.order_item_id,
        order_id:       msg.payload.order_id,
        station:        msg.payload.station,
      },
      p_source:         'kds',
      p_reference_type: 'order_item',
      p_reference_id:   msg.payload.order_item_id,
      p_priority:       5,
    });
    if (error !== null) {
      // Surface but don't throw — print queue is best-effort.
      console.warn('[lan-hub] enqueue_print_job failed', error.message);
    }
  }
}
```

Replace the whole function with (drop the `if (preparing)` enqueue block; keep the invalidations; fix the comment):

```ts
async function handleKdsBump(
  msg: KdsBumpMessage,
  ctx: LanHandlerContext,
): Promise<void> {
  // The bump itself is performed by the kds RPC on the originating device.
  // The hub just invalidates downstream caches so the cashier-side dashboards
  // reflect the new state immediately.
  //
  // Kitchen-ticket printing is NO LONGER triggered here. Since S34, prep tickets
  // are printed via the direct station bridge (Path A: useFireToStations ->
  // printStationTicket POST /print/ticket). The legacy print-queue chit on bump
  // (enqueue_print_job_v1 'kitchen_chit') was deprecated to remove the post-S34
  // double-print risk — see plan 2026-06-01-pos-double-print-risk (P0.2 ratified:
  // Path A canonical). The S35 KDS screen owns the on-screen bump, not printing.
  void msg;
  ctx.queryClient?.invalidateQueries({ queryKey: ['kds'] });
  ctx.queryClient?.invalidateQueries({ queryKey: ['orders'] });
}
```

- [ ] **Step 5.3b: Apply the deprecation — GATE (b) feature-flag OFF**

> Use this step ONLY if Task 4 = gate (b). For gate (a), use Step 5.3a instead.

Replace the whole `handleKdsBump` function with (wrap the enqueue in an explicit, default-OFF flag; fix the comment):

```ts
async function handleKdsBump(
  msg: KdsBumpMessage,
  ctx: LanHandlerContext,
): Promise<void> {
  // The bump invalidates downstream caches so cashier-side dashboards refresh.
  ctx.queryClient?.invalidateQueries({ queryKey: ['kds'] });
  ctx.queryClient?.invalidateQueries({ queryKey: ['orders'] });

  // Legacy kitchen-chit print path (S13). Since S34, prep tickets print via the
  // direct station bridge (Path A: useFireToStations -> printStationTicket). To
  // avoid the post-S34 double-print risk, this legacy enqueue is OFF by default
  // and only runs when VITE_LEGACY_KITCHEN_CHIT === '1'. The flag exists ONLY as
  // a rollback during print-bridge rollout; it MUST be removed once the bridge is
  // stable in prod. See plan 2026-06-01-pos-double-print-risk (gate b) +
  // 2026-06-01-pos-print-bridge-deploy (DEV-S34-W0-02).
  const legacyChitEnabled = import.meta.env.VITE_LEGACY_KITCHEN_CHIT === '1';
  if (legacyChitEnabled && msg.payload.new_status === 'preparing') {
    const { error } = await ctx.supabase.rpc('enqueue_print_job_v1', {
      p_device_id:      null,
      p_payload:        {
        ticket_type:    'kitchen_chit',
        order_item_id:  msg.payload.order_item_id,
        order_id:       msg.payload.order_id,
        station:        msg.payload.station,
      },
      p_source:         'kds',
      p_reference_type: 'order_item',
      p_reference_id:   msg.payload.order_item_id,
      p_priority:       5,
    });
    if (error !== null) {
      // Surface but don't throw — print queue is best-effort.
      console.warn('[lan-hub] enqueue_print_job failed', error.message);
    }
  }
}
```

> If `import.meta.env.VITE_LEGACY_KITCHEN_CHIT` is not yet declared in the POS Vite env typing and typecheck complains, add it to `apps/pos/src/vite-env.d.ts` `ImportMetaEnv` (`readonly VITE_LEGACY_KITCHEN_CHIT?: string;`) in the same commit — Vite env vars are `string | undefined`, so `=== '1'` narrows correctly.

- [ ] **Step 5.4: Run the deprecation smoke**

```bash
pnpm --filter @breakery/app-pos test lan-hub-no-kitchen-chit
```

Expected: PASS for the cases matching the chosen gate mode (gate a: `[gate a]` green; gate b: both `[gate b]` cases green). Remove (or `it.skip`) the cases for the non-chosen mode so the suite is clean — document which were kept in the INDEX.

- [ ] **Step 5.5: Non-regression — remaining handlers + Path A + typecheck**

```bash
pnpm --filter @breakery/app-pos typecheck
pnpm --filter @breakery/app-pos test lan
pnpm --filter @breakery/app-pos test fire-to-stations
```

Expected: typecheck PASS; `lanHub.dedup` + `useLanHub.uniqueChannel` + the new smokes PASS (other handlers — `print.request`, `heartbeat`, `order.update`, `kds.recall/undo`, `print.result` — unchanged); `fire-to-stations` (Path A) stays green (we only touched the bump path). Pre-existing env-gated failures (`VITE_SUPABASE_URL Required`, DEV-S25-2.A-02) are tolerated — not regressions.

- [ ] **Step 5.6: Commit P2**

```bash
git add apps/pos/src/features/lan/lanHubMessageHandler.ts apps/pos/src/features/lan/__tests__/lan-hub-no-kitchen-chit.smoke.test.tsx
# include apps/pos/src/vite-env.d.ts if Step 5.3b required the flag typing
git commit -m "fix(pos): single canonical kitchen print path — deprecate legacy kitchen_chit on kds.bump"
```

Expected: one commit. P2 complete (in the chosen gate mode).

---

## Task 6: INDEX closeout

**Files:**
- Create: `docs/workplan/plans/2026-06-01-pos-double-print-risk-INDEX.md`

- [ ] **Step 6.1: Write the INDEX**

Create `docs/workplan/plans/2026-06-01-pos-double-print-risk-INDEX.md` with these sections (project INDEX format):
- **Summary** — P1 typed the LAN handler client (`TypedSupabaseClient` exported from `@breakery/supabase`, `any` removed, `as never` casts removed); P2 deprecated the legacy `kitchen_chit` on `kds.bump` in gate mode [a hard-remove | b flag OFF | SKIPPED].
- **Migrations applied** — table: **none** (client-side only; `enqueue_print_job_v1` stays in DB).
- **New files** — `packages/supabase/src/index.ts` (modified, `TypedSupabaseClient` export); `apps/pos/.../lan-hub-typed-client.test.ts`; if P2 ran: `apps/pos/.../lan-hub-no-kitchen-chit.smoke.test.tsx` (+ `vite-env.d.ts` if flag typing added).
- **Files modified** — `lanHubMessageHandler.ts` (typed client + casts removed [+ chit deprecation if P2]); `packages/supabase/src/index.ts` (TypedSupabaseClient).
- **Tests run** — table: `lan-hub-typed-client` 2 PASS; `app-pos typecheck` PASS; if P2: `lan-hub-no-kitchen-chit` PASS + `lan` suite + `fire-to-stations` PASS.
- **Permissions seeded** — none.
- **RPCs added/bumped** — none (types regen only if Step 3.5 contingency fired).
- **Deferred** — P2 if gate STOP; bridge hardware deploy (`DEV-S34-W0-02`); flag removal once bridge stable (gate b); typing `lanHub.ts` itself.
- **§Dependency** — explicit: P2 depended on `pos-print-bridge-deploy` acceptance §3 (mixed order → 3 prep tickets + receipt). State the gate verdict (a/b/STOP) and why.
- **Deviations** — table `| ID | Section | Original | What happened | Reason | Risk |`. Minimum entries: canonical decision P0.2 ratified (`DEV-DPR-T1-01`); gate verdict a/b/STOP (`DEV-DPR-T4-01`); Option B chosen for typing + new `TypedSupabaseClient` export not in original spec wording (`DEV-DPR-T2-01`); feature flag introduced if gate (b) (`DEV-DPR-T5-01`); types regen if Step 3.5 fired (`DEV-DPR-T3-01`).
- **Acceptance criteria** — mirror spec §3 (checkboxes), marking the dependency-respected criterion.

- [ ] **Step 6.2: Commit the INDEX**

```bash
git add docs/workplan/plans/2026-06-01-pos-double-print-risk-INDEX.md
git commit -m "docs(workplan): pos double-print risk — INDEX"
```

Expected: one commit.

---

## Task 7: CLAUDE.md bump + PR (closeout)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 7.1: Bump CLAUDE.md §Active Workplan**

Add a "Current chantier" note under §Active Workplan (hors cycle session numéroté): `fix/pos-double-print-risk` — LAN hub handler client typed `SupabaseClient<Database>` via new `TypedSupabaseClient` export from `@breakery/supabase` (`any` + `as never` removed); canonical kitchen print path = Path A (S34 bridge direct); legacy `enqueue_print_job_v1('kitchen_chit')` on `kds.bump` [deprecated hard | behind `VITE_LEGACY_KITCHEN_CHIT` OFF | deferred — gate not met]. **Migration sequence: NONE** (client-side only). Cross-ref the gate: depends on `pos-print-bridge-deploy` acceptance §3 (`DEV-S34-W0-02`). If gate (b): note the flag must be removed once the bridge is stable. If gate (a) met: update DEV-S34-W0-02 to reflect the bridge is deployed.

- [ ] **Step 7.2: Commit + open PR**

```bash
git add CLAUDE.md
git commit -m "docs(claude): bump active workplan — pos double-print risk"
git push -u origin fix/pos-double-print-risk
gh pr create --base master --head fix/pos-double-print-risk \
  --title "fix(pos): type lanHub Supabase client + (gated) deprecate legacy kitchen_chit" \
  --body "P1 (unconditional): export TypedSupabaseClient from @breakery/supabase, type lanHubMessageHandler client as SupabaseClient<Database>, remove all as never casts on LAN RPCs. P2 (GATED on pos-print-bridge-deploy acceptance §3): deprecate the legacy enqueue_print_job_v1('kitchen_chit') on kds.bump — hard-removed when the bridge is proven reachable, otherwise behind VITE_LEGACY_KITCHEN_CHIT (OFF by default) to avoid a P0 silent-kitchen regression. No DB migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR opened. PR title/scope reflects whether P2 shipped. Squash-merge after review.

> **PR title fallback (P1-only, gate STOP):** use `fix(pos): type lanHub Supabase client (remove SupabaseClient = any + as never)` and note in the body that P2 is deferred pending the bridge.

---

## Acceptance criteria (mirror spec §3)

- [ ] Canonical decision Path A vs Path B ratified and documented. *(Task 1.3, INDEX §Deviations)*
- [ ] If Path B kitchen_chit deprecated: `kds.bump` no longer enqueues `kitchen_chit` (or behind an explicitly-OFF flag); no double-ticket for the same item. *(Task 5, smoke 5.1/5.4)*
- [ ] `lanHubMessageHandler.ts` no longer uses `type SupabaseClient = any`; client typed `SupabaseClient<Database>` (via `TypedSupabaseClient`). *(Task 2.3-2.4)*
- [ ] `as never` casts on RPC calls removed where typing allows. *(Task 3.2-3.4)*
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS, **without new `eslint-disable`**. *(Task 3.7)*
- [ ] **Inter-plan dependency respected** — Path B not hard-deprecated until Path A (bridge) is proven reachable (gate a) OR shipped flag-OFF (gate b). *(Task 4)*

---

## Risks & dependencies (mirror spec §6 — materialized)

| # | Risk | Materialized mitigation |
|---|---|---|
| 1 | **P0 "silent kitchen"** — deprecating Path B without a deployed bridge | **Blocking gate (Task 4)**: P2 runs only if bridge reachable (a) OR flag-OFF (b); STOP + ship P1 only otherwise. Explicit dependency on `pos-print-bridge-deploy` acceptance §3. |
| 2 | Transverse printing decision | Ratification (Task 1.3) before any deprecation code. |
| 3 | LAN RPCs absent from `types.generated.ts` | Pre-verified present (`enqueue_print_job_v1:5851`, `update_lan_heartbeat_v1:6969`). Contingency regen (Step 3.5) only if a typecheck blames a missing RPC. |
| 4 | Decoupling precedent (`lanHub.ts` deliberate `any`) | Option B chosen: `TypedSupabaseClient` centralized in `@breakery/supabase` — no direct `@supabase/supabase-js` import in the app (Task 2.1). |
| 5 | No DB migration; `enqueue_print_job_v1` still used by `print.request` | Deprecation is client-side; `handlePrintRequest` kept (Task 1.4). |
| 6 | Feature flag (gate b) becomes permanent debt | Flag comment + INDEX + CLAUDE.md mark it for removal once the bridge is stable (Task 5.3b, 7.1). |

---

## Out of scope (mirror spec §5)

- The S35 KDS screen itself (`is_locked`/`kitchen_status`).
- LAN hub protocol / message-format redesign.
- The external print server polling `claim_print_job_v1` (out-of-monorepo process).
- DB-side migration/drop of `enqueue_print_job_v1` (kept for generic `print.request`).
- Typing `lanHub.ts` itself (`type SupabaseClient = any` `:34`, `type RealtimeChannel = any` `:32`) — follow-up now that `TypedSupabaseClient` exists (track in backlog).

---

## Self-Review (run against the spec — completed)

**1. Spec coverage** — every spec section maps to a task:
- Spec §1 (proof of breakage: `:13-14` any, `:99-117` chit, `as never` `:107/112/133/176`) → Task 1.2 confirms anchors; Task 2-3 type + de-cast; Task 5 deprecates the chit.
- Spec §2.A (canonical decision + deprecate Path B) → Task 1.3 ratification + Task 4 gate + Task 5.
- Spec §2.B (type the client, Option B centralized) → Task 2 (`TypedSupabaseClient` export + handler retype) + Task 3 (remove casts). The spec said "from `@breakery/supabase` / `@supabase/supabase-js`"; the instruction mandates Option B (centralized), implemented by adding the missing `TypedSupabaseClient` export — a real gap discovered (the package exported only `Database`/`Json`). Recorded as `DEV-DPR-T2-01`.
- Spec §3 acceptance → mirrored 1:1 in Acceptance criteria.
- Spec §4 tests → `lan-hub-no-kitchen-chit.smoke` (Task 5.1) + `lan-hub-typed-client` (Task 3.1) + non-regression `lan` + `fire-to-stations` (Task 5.5).
- Spec §5 out-of-scope → mirrored in Out of scope.
- Spec §6 risks/deps → mirrored + materialized in the gate (Task 4) and the Inter-plan dependency diagram. **No gaps.**

**2. Placeholder scan** — searched for TBD / TODO / "add error handling" / "implement later" / "similar to Task N" / undefined types. Every code step shows complete code; every command shows the exact command + expected output. **Residual non-actionable placeholders, each justified:**
- INDEX section *contents* (Task 6.1) and CLAUDE.md note (Task 7.1) are described, not pre-written verbatim — these are closeout documents whose final values (which gate fired, which test cases kept) are only known at execution; the section list + required fields are fully enumerated, which is the correct level of detail for a closeout step.
- The prod printer IPs / "real LAN repro" referenced for gate (a) are intrinsically out-of-repo (bridge plan, hardware) — correctly external, not a code placeholder.
- The Step 5.3a/5.3b branch is a deliberate either/or driven by Task 4's recorded verdict, not an unresolved TBD — both branches show complete code.
No actionable code placeholder remains.

**3. Type consistency** — verified against the read files: `TypedSupabaseClient` is defined once in `packages/supabase/src/index.ts` (Task 2.1) and imported under the same name in the handler (Task 2.3) and tests; `LanHandlerContext.supabase` retyped to it (Task 2.4); the smoke's `LanHandlerContext['supabase']` indexed access matches. RPC names/args mirror the handler exactly: `update_lan_heartbeat_v1` `{ p_device_code }` (`:174-176` ↔ test 3.1 ↔ assertion), `enqueue_print_job_v1` `{ p_device_id, p_payload, p_source, p_reference_type, p_reference_id, p_priority }` (`:126-133` ↔ test 3.1 ↔ assertion), the `kitchen_chit` `p_payload.ticket_type` shape (`:102-107` ↔ `isKitchenChitCall` in test 5.1). `KdsBumpMessage.payload.new_status === 'preparing'` matches `:99`. The feature-flag key `VITE_LEGACY_KITCHEN_CHIT` is named identically in Step 5.3b, the smoke 5.1, the comment, the INDEX, and CLAUDE.md. **No naming/shape drift found.** (Caveat noted inline at Step 3.1/5.1: the executor must reconcile the test `*Message` literals with the actual `@breakery/domain` shapes — the typecheck enforces this.)

---

## Execution Handoff

Plan complete and saved to `docs/workplan/plans/2026-06-01-pos-double-print-risk-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review between tasks. Recommended split: `db-engineer` or a package-level agent for Task 2 (`@breakery/supabase` export), `pos-specialist` for Tasks 3 + 5 (handler + smokes), `test-engineer` for non-regression (Task 5.5) + INDEX (Task 6), `session-coordinator` for the gate decision (Task 4) + closeout (Task 7). **Tasks 2-3 (P1) are independent of the gate and can ship first; Task 5 (P2) is sequential after Task 4's verdict.** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session with checkpoints (after Task 3 = P1 done, after Task 4 = gate verdict, after Task 5 = P2 done, after Task 7 = closeout). Viable: small footprint (2 edited source files + 2-3 new test files + INDEX + CLAUDE.md). REQUIRED SUB-SKILL: superpowers:executing-plans.

Which approach?
