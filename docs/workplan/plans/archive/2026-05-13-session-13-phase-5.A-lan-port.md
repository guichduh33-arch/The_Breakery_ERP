# Session 13 — Phase 5.A — LAN architecture port (sub-plan)

> Status : in-flight (lan-port subagent).
> Wave : 5. Complexity : L (~24-30h).
> Parent INDEX : [`2026-05-13-session-13-INDEX.md`](2026-05-13-session-13-INDEX.md) line 879.

## Goal

Port the V2 LAN hub/client architecture to V3 per decision **D4**
(hybrid Realtime + BroadcastChannel) + ship the new `print_queue`
infrastructure (21-004), the missing KDS message handlers (21-002),
and targeted print result routing (21-003).

Pure protocol + dedup logic live in `packages/domain/src/lan/` ;
transport + React glue live in `apps/pos/src/features/lan/` ;
operator surfaces (print queue UI, device CRUD) live in
`apps/backoffice/src/features/{print-queue,lan-devices}/`.

## Migration block

| # | Number | Title | Notes |
|---|---|---|---|
| 1 | `20260517000170` | `init_print_queue.sql` | print_queue table + RPCs (enqueue/claim/done/failed) |
| 2 | `20260517000171` | `init_lan_devices.sql` | lan_devices registry + `lan.devices.manage` perm |

Block reserved per INDEX. Monotonic verified : last migration on disk is
`20260517000160` (Phase 4.C) → `170/171` are free.

## File map (deltas)

**New domain (pure TS) :**
- `packages/domain/src/lan/messageDedup.ts` — bounded `Set<string>` + TTL pruning.
- `packages/domain/src/lan/protocol.ts` — typed envelope union (`version: 1`).
- `packages/domain/src/lan/index.ts` — barrel.
- `packages/domain/src/lan/__tests__/{messageDedup,protocol}.test.ts`.

**New POS app :**
- `apps/pos/src/features/lan/lanHub.ts` — hub class (Realtime + BroadcastChannel fanout, dedup).
- `apps/pos/src/features/lan/lanClient.ts` — client class (dual-channel subscribe, dedup).
- `apps/pos/src/features/lan/lanHubMessageHandler.ts` — pure dispatcher (per-msg-type case).
- `apps/pos/src/features/lan/hooks/useLanHub.ts` — D19 per-effect-mount channel.
- `apps/pos/src/features/lan/hooks/useLanClient.ts` — D19 per-effect-mount channel.
- `apps/pos/src/features/lan/hooks/useLanHeartbeat.ts` — 10s tick, writes `last_heartbeat_at`.
- `apps/pos/src/features/lan/__tests__/lanHub.dedup.test.ts`.
- `apps/pos/src/features/lan/__tests__/useLanHub.uniqueChannel.test.tsx`.

**Updated POS :**
- `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` — also broadcast bump events via LAN client.

**New BO :**
- `apps/backoffice/src/features/print-queue/hooks/{usePrintQueue,useEnqueueRetry,useCancelPrintJob}.ts`.
- `apps/backoffice/src/features/print-queue/components/{PrintQueueTable,PrintQueueRow}.tsx`.
- `apps/backoffice/src/features/lan-devices/hooks/useLanDevices.ts`.
- `apps/backoffice/src/features/lan-devices/components/LanDevicesTable.tsx`.
- `apps/backoffice/src/pages/print-queue/PrintQueuePage.tsx`.
- `apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx`.
- Sidebar entries in `BackofficeLayout.tsx` + route registration in `routes/index.tsx`.

**Tests :**
- `supabase/tests/print_queue.test.sql` (pgTAP).
- `supabase/tests/lan_devices.test.sql` (pgTAP).
- `supabase/tests/functions/print-queue.test.ts` (Vitest live).
- `packages/domain/src/lan/__tests__/messageDedup.test.ts` + `protocol.test.ts`.
- `apps/pos/src/features/lan/__tests__/lanHub.dedup.test.ts`.
- `apps/pos/src/features/lan/__tests__/useLanHub.uniqueChannel.test.tsx`.
- `apps/backoffice/src/features/print-queue/__tests__/PrintQueueTable.smoke.test.tsx`.
- `apps/backoffice/src/features/lan-devices/__tests__/LanDevicesPage.smoke.test.tsx`.

## D19 channel uniqueness — corrected pattern

Per Wave 4 deviation D-W4-4C-03 + D-W4-4B-05, channel UUIDs are minted
**inside** `useEffect`, not in a component-body `useMemo`. Each effect
mount runs the body fresh, so StrictMode double-mount produces 2 distinct
UUIDs (a `useMemo` discards the first-render UUID and re-uses the
second-render UUID across both effect mounts → collision).

Pattern :

```ts
useEffect(() => {
  const channelName = `lan-${deviceId}-${crypto.randomUUID()}`;
  const channel = supabase.channel(channelName).on(...).subscribe();
  return () => { void supabase.removeChannel(channel); };
}, [deviceId]);
```

## DoD checklist

- [ ] 2 migrations applied on `ikcyvlovptebroadgtvd` via MCP.
- [ ] `packages/supabase/src/types.generated.ts` regenerated + committed.
- [ ] `pnpm typecheck` green.
- [ ] Hub→Client dedup unit test : same message ID 2x → 1 handler call.
- [ ] Print queue cycle (enqueue → claim → done) green in Vitest live.
- [ ] D19 channel uniqueness : `useLanHub.uniqueChannel.test.tsx` asserts 2 distinct names under StrictMode.
- [ ] Grep audit : `grep -RE "supabase\.channel\(['\"][^\"']*['\"]\)" apps/pos/src/features/lan/` → 0 hits.
- [ ] BO `PrintQueuePage` + `LanDevicesPage` render + smoke green.
- [ ] pgTAP `print_queue` + `lan_devices` suites green.
- [ ] Commits squash-mergeable, Claude co-author.

## Working order

1. Sub-plan (this doc) → commit.
2. Domain (pure TS) — messageDedup + protocol with unit tests TDD.
3. Migrations — `print_queue` + `lan_devices`.
4. POS LAN hooks (D19 corrected pattern).
5. BO print queue + LAN devices UI.
6. Final : types regen, typecheck, suites, commits, deviation pack
   entry under `D-W5-5A-*`.
