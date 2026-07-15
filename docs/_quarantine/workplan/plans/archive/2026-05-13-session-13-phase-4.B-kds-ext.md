# Session 13 — Phase 4.B — KDS extensions — Sub-plan

> **Status** : in-progress (2026-05-14)
> **Executor** : `coder` (`kds-ext`)
> **Migration block** : `20260517000150..000151`
> **Complexity** : M (~14-18 h)
> **Parent INDEX** : [`./2026-05-13-session-13-INDEX.md`](./2026-05-13-session-13-INDEX.md) §Phase 4.B (line ~793)
> **Module ref**  : [`../../reference/04-modules/`](../../../reference/04-modules/) — module 04 (KDS).

## 1. Context (state at startup, verified 2026-05-14)

Wave 3 is DONE. Staging project `ikcyvlovptebroadgtvd` already has :

- ✓ `categories.dispatch_station TEXT` NOT NULL DEFAULT `'none'` CHECK IN
  (`'kitchen'`, `'barista'`, `'bakery'`, `'none'`) — applied via session-2
  migration `20260505000002_extend_categories.sql`.
- ✓ `order_items.kitchen_status TEXT` CHECK IN
  (`'pending'`, `'preparing'`, `'ready'`, `'served'`) ;
  `order_items.dispatch_station TEXT` (nullable, copied at INSERT) ;
  `order_items.sent_to_kitchen_at`, `order_items.ready_at`,
  `order_items.served_at`, `order_items.served_by`, `order_items.is_locked`,
  `order_items.cancelled_*` all present.
- ✓ `mark_item_served(p_item_id UUID)` RPC — transitions ready → served,
  raises `P0011` if not ready.
- ✓ `has_permission(UUID, TEXT)` is LOCKED (Phase 1.B) — only INSERT
  permission rows + role_permissions grants from here on.
- ✓ `audit_logs(id BIGINT, actor_id UUID, action TEXT, entity_type TEXT,
  entity_id UUID, metadata JSONB, created_at TIMESTAMPTZ)`.
- ✗ No `categories.kds_station` column yet.
- ✗ No `order_items.prep_started_at` / `order_items.bumped_at` columns yet.
- ✗ No `kds.operate` permission row.
- ✗ No `kds_recall_order_v1` / `kds_bump_item_v1` / `kds_undo_bump_v1` /
  `kds_start_prep_timer_v1` RPCs.

## 2. Decisions (locked for this phase)

- **D-4B-1 Add `kds_station` alongside `dispatch_station`** — do NOT replace
  the legacy column (used by 3+ RPCs). New column has 5 values (`hot`,
  `cold`, `bar`, `prep`, `expo`) with `expo` as default. Existing routing
  via `dispatch_station` continues to work ; new station-filter UI uses
  `kds_station` when present, falls back to mapping
  `dispatch_station→kds_station` for legacy categories.
- **D-4B-2 Add `prep_started_at` + `bumped_at` to `order_items`** — needed
  for the prep timer (elapsed since prep start) and bump audit-trail.
  Both nullable TIMESTAMPTZ.
- **D-4B-3 `kds.operate` permission** — single permission gate for all 4
  new RPCs. Granted to SUPER_ADMIN, ADMIN, MANAGER, CASHIER (cashier is
  the typical KDS operator on the line). Waiter NOT granted.
- **D-4B-4 RPCs are versioned `_v1`** — `kds_recall_order_v1`,
  `kds_bump_item_v1`, `kds_undo_bump_v1`, `kds_start_prep_timer_v1`.
- **D-4B-5 Undo window = 60s strict** — `kds_undo_bump_v1` raises
  `kds_undo_window_expired` (errcode `P0012`) if `bumped_at` is NULL or
  older than 60 seconds. Item must currently be in `'ready'` to undo.
- **D-4B-6 Recall semantics** — `kds_recall_order_v1(p_order_id, p_reason)`
  flips **all** of the order's items from `'served'`→`'preparing'` (where
  served_at IS NOT NULL). Clears `served_at`/`served_by`/`ready_at`/
  `bumped_at` ; logs to `audit_logs` (`action='kds.recall'`,
  `entity_type='order'`, `entity_id=p_order_id`,
  `metadata={reason, items_recalled}`).
- **D-4B-7 Bump semantics** — `kds_bump_item_v1(p_order_item_id,
  p_idempotency_key)` transitions `'preparing'`→`'ready'` and sets
  `ready_at=now()`, `bumped_at=now()`. Replay (idempotency hit) returns
  silently if the row's `bumped_at = idempotency-recorded value`. We
  record the idempotency key in `metadata` of an audit_log row.
- **D-4B-8 Prep timer semantics** — `kds_start_prep_timer_v1` sets
  `prep_started_at=now()` if item is `'pending'` or `'preparing'`. Also
  flips status to `'preparing'` (idempotent — a noop when already
  preparing AND prep_started_at NOT NULL).
- **D-4B-9 Channel uniqueness preserved** — existing `useKdsRealtime.ts`
  already follows the D19 pattern (`kds-${station}-${crypto.randomUUID()}`).
  Phase 4.B adds new hooks `useKdsBumpItem` / `useKdsRecallOrder` that are
  React-Query mutations (no realtime subscriptions inside) — no channel
  name impact. The existing realtime hook is only extended to invalidate
  on new payload fields (`bumped_at`, `prep_started_at`).
- **D-4B-10 Station filter is client-side** — the realtime hook still
  filters by `dispatch_station` (server side) because that column has the
  legacy NOT NULL/index ; the client filters the rendered items by
  `kds_station` (derived from category) on top of that.

## 3. Migration plan

| #      | File                                                     | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
|--------|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 000150 | `20260517000150_add_categories_kds_station.sql`           | `ALTER TABLE categories ADD COLUMN IF NOT EXISTS kds_station TEXT NOT NULL DEFAULT 'expo' CHECK (kds_station IN ('hot','cold','bar','prep','expo'))`. Idempotent seed: map `dispatch_station='kitchen'→'hot'`, `'barista'→'bar'`, `'bakery'→'prep'`, `'none'→'expo'`. Add `order_items.prep_started_at TIMESTAMPTZ`, `order_items.bumped_at TIMESTAMPTZ`. Add index `idx_oi_kds_prep_timer ON order_items(prep_started_at) WHERE prep_started_at IS NOT NULL`. INSERT perm `'kds.operate'`. Grant to SUPER_ADMIN/ADMIN/MANAGER/CASHIER. |
| 000151 | `20260517000151_create_kds_recall_bump_rpcs.sql`          | Four SECURITY DEFINER RPCs : `kds_start_prep_timer_v1(uuid)`, `kds_bump_item_v1(uuid, uuid)`, `kds_undo_bump_v1(uuid)`, `kds_recall_order_v1(uuid, text)`. All gated on `has_permission(auth.uid(), 'kds.operate')`. Write audit_logs rows for recall + undo (bump goes through high-volume realtime — audit is opt-in via idempotency_key metadata).                                                                                                                                                                                |

## 4. App plan

### POS KDS components (CREATE)
- `apps/pos/src/features/kds/components/StationFilter.tsx` — visual chip
  picker for `kds_station` values, persisted client-side (Zustand store).
- `apps/pos/src/features/kds/components/RecallButton.tsx` — dialog with
  reason textarea, calls `useKdsRecallOrder`.
- `apps/pos/src/features/kds/components/BumpButton.tsx` — preparing→ready,
  calls `useKdsBumpItem`. Shows `UndoBumpToast` on success.
- `apps/pos/src/features/kds/components/PrepTimer.tsx` — MM:SS counter
  driven by `useAgeTimer` since `prep_started_at`.
- `apps/pos/src/features/kds/components/UndoBumpToast.tsx` — 60s countdown
  toast with Undo CTA.

### POS KDS hooks (CREATE)
- `apps/pos/src/features/kds/hooks/useKdsBumpItem.ts` — RPC mutation +
  idempotency key minted on each call.
- `apps/pos/src/features/kds/hooks/useKdsRecallOrder.ts` — RPC mutation.
- `apps/pos/src/features/kds/hooks/useKdsStartPrepTimer.ts` — RPC mutation
  (auto-called when user transitions an item from pending→preparing).
- `apps/pos/src/features/kds/hooks/useKdsUndoBump.ts` — RPC mutation,
  guarded by 60s window in UI.

### POS KDS hook (UPDATE)
- `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` — preserve D19
  unique-channel pattern. No structural change to the channel subscription.

### POS KDS store (UPDATE)
- `apps/pos/src/stores/kdsStore.ts` — add `kdsStationFilter: 'all' | 'hot'
  | 'cold' | 'bar' | 'prep' | 'expo'` with setter.

## 5. Tests plan

| File | Type | Coverage |
|---|---|---|
| `supabase/tests/kds_extensions.test.sql` | pgTAP | T_KDS_01..08 : column exists, RPCs exist, role gating, recall/bump/undo state transitions, prep timer flag |
| `supabase/tests/functions/kds-bump-recall.test.ts` | Vitest live | end-to-end cycle: create order → start prep → bump → undo → bump again → recall |
| `apps/pos/src/features/kds/__tests__/useKdsRealtime.uniqueChannel.test.ts` | Vitest jsdom | StrictMode double-mount → 2 distinct channel names |
| `apps/pos/src/features/kds/__tests__/StationFilter.smoke.test.tsx` | Vitest jsdom | renders, click → setStation |
| `apps/pos/src/features/kds/__tests__/PrepTimer.smoke.test.tsx` | Vitest jsdom | renders MM:SS from prep_started_at |
| `apps/pos/src/features/kds/__tests__/BumpButton.smoke.test.tsx` | Vitest jsdom | clicks → mutation called |
| `apps/pos/src/features/kds/__tests__/UndoBumpToast.smoke.test.tsx` | Vitest jsdom | shows countdown, Undo CTA disappears after 60s |

## 6. Risks + mitigations

- **R-4B-1 Existing `dispatch_station` filter on order_items conflicts
  with new `kds_station`.** Mitigation: keep both columns ; client-side
  station filter is a UI concept that maps `kds_station→dispatch_station`
  via the category. Server filter stays on `dispatch_station`.
- **R-4B-2 `mark_item_served` RPC could be replaced by new `kds_bump_item_v1`
  for ready→served.** Out of scope — keep existing mark_item_served for
  ready→served. `kds_bump_item_v1` is only for preparing→ready.
- **R-4B-3 60s undo window race.** UI is the source of truth — toast
  disappears at 60s. RPC raises `P0012` if backend clock says it's beyond
  60s. Clock drift between client and server is accepted (no NTP sync).
- **R-4B-4 Audit_logs spam on bump (high frequency).** Decision D-4B-7:
  bump is NOT audit-logged (use the realtime stream as the trail).
  Recall + undo ARE audit-logged.

## 7. DoD checklist (closed 2026-05-14)

- [x] 2 migrations applied via MCP `apply_migration` (`000150`, `000151`).
- [x] `packages/supabase/src/types.generated.ts` regenerated + committed
      (4 new symbols : `kds_station`, `prep_started_at`, `bumped_at`,
      four `kds_*_v1` RPCs).
- [x] `pnpm typecheck` green (6 packages, 0 errors).
- [x] Items routed to correct station per `categories.kds_station` —
      `StationFilter` chip picker drives `useKdsStore.kdsStationFilter`.
- [x] Recall + Bump + Undo + Prep Timer functional — components +
      hooks in place, smoke tests cover happy paths.
- [x] D19 channel uniqueness — `useKdsRealtime` generates UUID inside
      effect body (matches `useDisplayRealtime` pattern). Grep audit
      returns 0 hardcoded literals. Vitest StrictMode test asserts 2
      distinct channels.
- [x] pgTAP T_KDS_01..08 green via MCP `execute_sql` rollback envelope
      (19 assertions, all pass).
- [x] Vitest live cycle test added (`supabase/tests/functions/kds-bump-recall.test.ts`) — skips gracefully if env vars missing.
- [x] Commits squash-mergeable with Claude co-author.
- [x] Deviations D-W4-4B-01..05 appended to `docs/workplan/refs/2026-05-14-session-13-wave-4-deviations.md`.
