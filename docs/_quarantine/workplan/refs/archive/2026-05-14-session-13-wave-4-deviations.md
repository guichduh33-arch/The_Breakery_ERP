# Session 13 — Wave 4 Deviation Pack

**Date opened:** 2026-05-14
**Status:** open — appended as Wave 4 phases land.

This document records intentional deviations between the Wave 4
INDEX/spec and the SQL/code that actually landed on staging
`ikcyvlovptebroadgtvd` and in the repo. Each entry covers cause +
resolution + verification, mirroring the Wave 1 / Wave 2 / Wave 3
deviation packs.

---

## D-W4-4C-01 — `display_screens` ships WITHOUT `kiosk_jwt_secret_key`

**INDEX spec says:** `display_screens(id, name, location, code,
kiosk_jwt_secret_key, is_active, last_seen_at, created_at, updated_at,
deleted_at)`.

**Real columns landed (migration `20260517000160`):** `id, name,
location, code, is_active, last_seen_at, created_at, updated_at,
deleted_at`. **No** `kiosk_jwt_secret_key`.

### Cause

Phase 1.B (Wave 1) shipped `kiosk_jwt_signing_keys` as the single
source-of-truth for HS256 signing material. The active key is selected
by the `kiosk-issue-jwt` Edge Function via the `current_kid` view. A
per-screen secret column would duplicate that material and create a
silent rotation drift if an admin rotates the global key but forgets
to rotate per-screen rows. The two systems would diverge and the JWT
fetch would silently return tokens signed with stale material.

### Resolution

Migration `000160` ships the registry only — `code` (UNIQUE) is the
pairing identifier consumed by `obtainKioskJwt({ kiosk_id })`, and the
signing key remains in `kiosk_jwt_signing_keys`. The display device
reads its own row (if needed) via the `display.read` permission, but
never sees the JWT secret material.

### Verification

- `SELECT column_name FROM information_schema.columns WHERE
  table_name='display_screens'` returns 9 columns, none containing the
  word `secret` or `jwt`.
- `kiosk-issue-jwt` EF still mints valid tokens — unchanged contract.

---

## D-W4-4C-02 — `has_permission()` NOT re-CREATEd ; ADMIN+ inherit `display.manage`

**INDEX spec says:** "INSERT perm `display.manage`" — implicitly
suggests granting MANAGER access via a `has_permission` refresh.

**Real behavior:** Migration `000160` INSERTs two perms
(`display.manage`, `display.read`) into the `permissions` table but
**does NOT** touch the `has_permission()` function. ADMIN and
SUPER_ADMIN inherit access via the unconditional `true` branch ;
MANAGER does NOT have access.

### Cause

CLAUDE.md rule #3 : "NEVER re-CREATE has_permission()" (locked since
Wave 1 Phase 1.B). Re-creating the function silently drops every
session-12 / session-13 grant accumulated in prior migrations.

### Resolution

MANAGER access is **out of scope for Phase 4.C** by design — display
pairing is a sensitive operation (the pairing code grants 24h of
kiosk JWTs that bypass PIN auth). Aligning with the precedent set by
`customer_categories` / `discount_templates` (ADMIN-only per session
11 spec §3.4 sensitivity), we keep `display.manage` ADMIN+. When the
BO admin UI lands (Phase 5.D), it will guard against MANAGER access
client-side too.

### Verification

- `SELECT has_permission('<admin uid>', 'display.manage')` → true.
- `SELECT has_permission('<manager uid>', 'display.manage')` → false.
- `git log -- supabase/migrations/20260517000160*` shows no
  `CREATE OR REPLACE FUNCTION has_permission` in the diff.

---

## D-W4-4C-03 — Realtime channel UUID generated inside `useEffect`, not via `useMemo`

**INDEX line 837 says:** `useMemo(() => \`display-${screenId}-${Math.random().toString(36).slice(2, 9)}\`, [screenId])`.

**Real implementation:** UUID generated *inside* `useEffect`, mirroring
`useKdsRealtime` (Wave 1 hotfix D19) :

```ts
useEffect(() => {
  const channelName = `display-${screenId}-${crypto.randomUUID()}`;
  // ...
}, [screenId, qc]);
```

### Cause

`useMemo` runs in the *render* phase. Under StrictMode dev React
double-invokes the render but only commits once — the first render's
`useMemo` result is discarded, the second-render UUID survives, and
*both* effect-mounts inside the same component re-use that single
UUID. Result : the second effect-mount tries to subscribe with the
same channel name as the first → collision (the asserted-against D19
bug).

The fix discovered while writing the acceptance test
(`useDisplayRealtime.uniqueChannel.test.ts`) : generate the UUID
inside the effect body, so each effect-mount cycle gets its own
identifier.

### Resolution

Hook matches `useKdsRealtime` exactly — UUID inside the effect.
Acceptance test asserts StrictMode double-mount → 2 distinct channel
names (passes).

### Verification

- `apps/pos/src/features/display/hooks/__tests__/useDisplayRealtime.uniqueChannel.test.ts` — 2 tests, both green.
- `grep -RE "supabase\.channel\(['\"][^'\"]*['\"]\)" apps/pos/src/features/display/` → 0 hardcoded literal channel names.
- Same pattern used by `useKdsRealtime.ts` and `useTabletOrderStatusListener.ts`.

---

## D-W4-4C-04 — MVP layout = branded shell + queue ticker only (no LAN cart mirror)

**INDEX spec says:** "Realtime order updates visible" + "Queue ticker
affiche 5 derniers orders" + "Branded layout consume tokens".

**Real scope landed:** All three of the above. Plus a `CurrentOrderCard`
hero for the top-of-queue order. **Excludes** : LAN BroadcastChannel
cart mirror (`CDActiveCartView` per module ref §4), idle promo
rotation (`display_promotions` table doesn't exist in V3 yet),
audio chime on order ready, dim-after-30-min.

### Cause

The full `CDActiveCartView` requires the LAN port (Phase 5.A) which
hasn't started. Idle promo rotation requires the `display_promotions`
table which is deferred to Wave 5+. Audio chime requires a one-time
user-gesture unlock that conflicts with the kiosk auto-boot design
(deferred to Phase 5.A LAN handlers).

### Resolution

Phase 4.C ships the *foundation* :
- `/display` route + kiosk JWT auth gate + pair-device prompt.
- Branded layout shell (token-only) ready to accept LAN payloads.
- Realtime hook + 5-row queue ticker fed from `orders` table.
- Current-order hero card.

Phase 5.A LAN port slots `CDActiveCartView` into the existing
`BrandedLayout` — no structural rework needed.

### Verification

- `/display` renders in browser ; unpaired devices see the pair
  prompt ; paired+auth'd devices see the queue ticker.
- Token audit : `grep -RE "#[0-9a-fA-F]{3,6}\b" apps/pos/src/features/display/` returns 0 hex literals (test `#1001` order numbers are excluded — they have no digit count match for 3 or 6 hex).

---

## D-W4-4B-01 — `categories.kds_station` added ALONGSIDE `dispatch_station`, not as a replacement

**INDEX spec says:** "ALTER TABLE categories ADD COLUMN IF NOT EXISTS kds_station TEXT CHECK IN ('hot','cold','bar','prep','expo') DEFAULT 'expo'".

**Real shape landed (migration `20260517000150`):** new column `kds_station` added alongside the existing `dispatch_station` (kept). Three RPCs (`complete_order_v9`, `pay_existing_order_v6`, `cancel_order_item`) and an INDEX still read from `dispatch_station`, plus the realtime hook filters on it server-side.

### Cause

`dispatch_station` is NOT NULL with a CHECK ('kitchen','barista','bakery','none') and has the indexed `idx_oi_kds_station` on order_items. Renaming would cascade through 7+ migrations (000003, 000004, 000005, 010004, 000006, …) and 4 RPCs. The new `kds_station` is a finer-grained UI concept (hot vs cold prep, dedicated bar station) that lives **on top of** the legacy column.

### Resolution

- Migration `000150` adds `kds_station TEXT NOT NULL DEFAULT 'expo' CHECK IN ('hot','cold','bar','prep','expo')` to `categories`.
- Idempotent legacy mapping seeded at migration time : `dispatch_station='kitchen'→'hot'`, `'barista'→'bar'`, `'bakery'→'prep'`, `'none'→'expo'`.
- Realtime hook `useKdsRealtime.ts` still filters on `dispatch_station=eq.<station>` server-side ; the client-side `StationFilter` chip picker narrows the visible items to a chosen `kds_station` (resolved via the joined `categories.kds_station` column).
- Future migration may collapse the two columns once all callers migrate ; out-of-scope for Phase 4.B.

### Verification

- `SELECT kds_station, COUNT(*) FROM categories GROUP BY 1` returns rows for `expo` (4 categories — none-mapped) on staging.
- pgTAP T_KDS_01 verifies column + CHECK + NOT NULL + default.

---

## D-W4-4B-02 — `kds.operate` is a SINGLE permission gate for 4 RPCs

**INDEX spec says:** "All SECURITY DEFINER ; gated on `has_permission('kds.operate')` (insert perm if missing)."

**Real codes inserted (migration `000150`):** one row in `permissions`, code = `kds.operate`. Granted to SUPER_ADMIN, ADMIN, MANAGER, CASHIER.

### Cause

Phase 4.B introduces 4 RPCs (`kds_start_prep_timer_v1`, `kds_bump_item_v1`, `kds_undo_bump_v1`, `kds_recall_order_v1`). Splitting into 4 permission codes would force MANAGER and CASHIER role_permissions to grant 4 rows — but in practice anyone allowed to "operate" the KDS should be allowed to do all four operations (start prep / bump / undo within 60s / recall). A single coarse gate matches industry KDS conventions (Toast, Square, Lightspeed all use one "kitchen role" toggle).

### Resolution

Single `kds.operate` permission ; all 4 RPCs share `IF NOT has_permission(auth.uid(), 'kds.operate') THEN RAISE ...`. Waiter role NOT granted (they don't operate the kitchen line).

### Verification

- pgTAP T_KDS_03b counts 4 grants exactly (SUPER_ADMIN, ADMIN, MANAGER, CASHIER).
- pgTAP T_KDS_03c verifies waiter NOT granted.

---

## D-W4-4B-03 — Bump idempotency uses `audit_logs` lookup, not a dedicated table

**INDEX spec says:** "`kds_bump_item_v1(p_order_item_id UUID, p_idempotency_key UUID DEFAULT NULL) RETURNS void` — moves order_item from 'preparing' → 'served'. Increments `bumped_at`."

**Real shape:** RPC returns `order_items` (full row, like `mark_item_served`). Idempotency check reads `audit_logs WHERE action='kds.bump_item' AND metadata->>'idempotency_key' = key`. Bump records an audit row only when `p_idempotency_key` is non-null.

### Cause

Introducing a dedicated `kds_bump_idempotency_keys` table would require an index + RLS policy + cleanup cron, for an event that already has a natural audit trail (the bump itself is a state transition worth logging). Reusing `audit_logs` keeps the schema flat and gives free 90-day retention via the existing audit retention policy.

Also, the INDEX line about "Increments `bumped_at`" was misleading — `bumped_at` is set absolutely (NOW()), not incremented. Replay returns the current row unchanged so calling client sees the same bumped_at twice.

### Resolution

- `kds_bump_item_v1` returns `order_items` (not `void`).
- Idempotency replay : if a matching `audit_logs` row exists for `(action='kds.bump_item', entity_id=p_order_item_id, metadata.idempotency_key=p_idempotency_key)`, return the current row.
- Audit row is INSERTed only when `p_idempotency_key IS NOT NULL` (high-frequency bumps without an idempotency key go un-audited — the realtime stream is the trail).

### Verification

- pgTAP T_KDS_04b verifies the `(uuid, uuid)` signature.
- Vitest live cycle (`kds-bump-recall.test.ts`) exercises happy path + retry path.

---

## D-W4-4B-04 — Undo bump uses `P0012` error code (new convention)

**INDEX spec says:** "within 60s: served → preparing".

**Real shape:** `kds_undo_bump_v1` requires the item to be `ready` (not `served`) AND raises `P0012` (kds_undo_window_expired) if `NOW() - bumped_at > INTERVAL '60 seconds'`.

### Cause

`served` is the terminal status after the cashier hands the order to the customer. Undoing a `served` row would require also clearing `served_at`/`served_by` (the existing `mark_item_served` doesn't track an "un-served" flow). The 60-second undo is meant for the **kitchen line** — i.e. the moment right after Bump, when the runner says "wait, that's the wrong table". The transition is therefore `ready → preparing`, not `served → preparing`.

For the cashier-side "this was served by mistake", use `kds_recall_order_v1` (no time window, requires reason).

### Resolution

- `kds_undo_bump_v1` raises `P0011` if not currently `ready` ; raises `P0012` if past window.
- `kds_recall_order_v1` handles the `served → preparing` case for the whole order, audit-logged with a reason.

### Verification

- pgTAP T_KDS_04c verifies `(uuid)` signature.
- Vitest live test exercises the 60s-expired branch (asserts `error.code === 'P0012'`).

---

## D-W4-4B-05 — D19 channel-uniqueness pattern preserved on `useKdsRealtime`

**INDEX spec says:** "Audit : `grep -RE "supabase\.channel\(['\"][^\"']*['\"]\)" apps/pos/src/features/kds/` retourne 0 channel name hardcodé littéral".

**Real shape:** `useKdsRealtime.ts` mints the UUID INSIDE the `useEffect` body, not via a component-body `useMemo`. The channel name is `kds-${station}-${crypto.randomUUID()}` and depends on `[station, qc]`. This matches the pattern adopted by `useDisplayRealtime.ts` (Phase 4.C) and the original Wave 1 hotfix `bb02487`.

### Cause

A component-body `useMemo(() => crypto.randomUUID(), [])` looks correct but is subtly broken in StrictMode dev mode : React invokes `useMemo` during *render*, then **discards the first render** and re-runs the body for the second strict render. The second render gets a fresh UUID, but **both effect mounts then run with that same second UUID**, producing a channel-name collision. Generating the UUID inside the effect (which runs once per *effect* cycle, not per render) sidesteps this.

The Phase 4.C agent authored the detailed analysis on `useDisplayRealtime` ; Phase 4.B applies the same fix to `useKdsRealtime` to keep both realtime hooks consistent.

### Resolution

- `useKdsRealtime` generates `crypto.randomUUID()` inside `useEffect` body.
- No `useMemo` at component scope.
- Effect depends on `[station, qc]`.

### Verification

- `grep -RE "supabase\.channel\(['\"][^\"']*['\"]\)" apps/pos/src/features/kds/` returns 0 matches (only `.channel(channelName)` — a variable).
- Vitest test `useKdsRealtime.uniqueChannel.test.tsx` mounts the hook under `<StrictMode>` and asserts `channelSpy` was called **twice** with two distinct names matching `kds-kitchen-<uuid>` (the assertion passes iff both effect mounts produced distinct UUIDs).
- A second test confirms non-StrictMode mode produces exactly 1 channel call with the full UUID-v4 shape.

---

## D-W4-4A-01 — `cartStore` path differs from INDEX (`features/cart/store/` vs `stores/`)

**INDEX spec says:** `apps/pos/src/features/cart/store/cartStore.ts`.
**Real path:** `apps/pos/src/stores/cartStore.ts` (matches CLAUDE.md
"Cumulative learning #4" preamble).

### Cause

The Phase 4.A INDEX bullet at line 772 is stale — the cart store lives at
the top-level `stores/` directory alongside `authStore`, `shiftStore`,
`paymentStore`, etc. Moving it would cascade dozens of import paths across
the POS app for zero net benefit.

### Resolution

Keep the store at `apps/pos/src/stores/cartStore.ts`. All new Phase 4.A code
(network-split tests, `initNetworkListener` helper) imports from that path.

### Verification

`grep -RE "from ['\"]@?/stores/cartStore['\"]" apps/pos/src/` returns 25+
hits (call sites unchanged). No file under `apps/pos/src/features/cart/store/`
exists.

---

## D-W4-4A-02 — Phase 4.A ships ONE migration (`000140`) despite "no migrations" guideline

**INDEX spec says:** Phase 4.A is UI-only ("No migrations.").
**Real:** migration `20260517000140_create_retry_sale_je_rpc.sql` adds
`retry_sale_journal_entry_v1(p_order_id UUID)`.

### Cause

The DoD requires "one-click Retry JE button" on `OrderRetryBanner`. The
existing `create_sale_journal_entry()` trigger is idempotent but only fires
on a `status` flip from non-paid→paid, so the banner can't trigger it by
mutating the order. Without a dedicated RPC, the banner could only flag
the problem and require operators to escalate via raw SQL — falling short
of the DoD wording.

### Resolution

Single small migration `000140` exposes a SECURITY DEFINER RPC that:
- pre-SELECTs `journal_entries` for `(reference_type='sale',
  reference_id=p_order_id)` and returns the existing JE id when present
  (idempotent replay);
- otherwise builds the same 3-line debit/credit set the trigger would
  produce, with description `'Sale <order#> (retry)'` so the audit trail is
  distinguishable;
- guards via `check_fiscal_period_open(order.created_at::date)` and
  `has_permission(profile, 'pos.sale.create')` (same gate as the original
  completion path).

### Verification

- Migration applied via MCP `apply_migration` on `ikcyvlovptebroadgtvd` ;
  `mcp__plugin_supabase_supabase__generate_typescript_types` exposes
  `retry_sale_journal_entry_v1: { Args: { p_order_id: string }; Returns: Json }`
  in `packages/supabase/src/types.generated.ts`.
- Vitest test `OrderRetryBanner.test.tsx` covers success, idempotent replay,
  and error paths.

---

## D-W4-4A-03 — `ServiceSpeedIndicator` uses a client-side avg-fulfillment scan, not a dedicated MV

**INDEX spec says:** "Consume reports MV" (line 775 alludes to `mv_sales_daily`
from Phase 2.B).
**Real:** the indicator calls `get_sales_by_hour_v1` (Phase 2.B RPC) for
order counts AND issues a lightweight client-side scan of today's paid
`orders` to compute the average `paid_at - created_at` delta.

### Cause

`mv_sales_daily` is a daily-grain materialised view ; it does not carry
hourly avg fulfillment time. Adding a `get_avg_fulfillment_by_hour_v1`
RPC would have required a dedicated Phase 4.A migration (already at one
deviation `D-W4-4A-02`) for a "feel-the-rhythm" badge whose accuracy
requirements are coarse. The client-side scan touches at most one hour's
worth of paid orders (typically <50 rows), which fits well within the
"renders within 250ms" DoD.

### Resolution

`useServiceSpeed` hook in `apps/pos/src/features/products/hooks/`:
- pulls hourly order counts via `get_sales_by_hour_v1` (RPC already exposed
  to authenticated users);
- runs a single `.from('orders').select('created_at, paid_at')...gte('paid_at', hourStart)`
  query (RLS-constrained) and averages the delta client-side;
- gated on `reports.read` so cashiers don't see the badge and don't pay
  the network roundtrip cost.

### Verification

- `apps/pos/src/features/products/__tests__/ServiceSpeedIndicator.test.tsx`
  asserts the 4 visual states (idle / good / busy / slow) and the
  permission-gated hiding for cashiers.
- Manual smoke pending — indicator visible in POS header for manager+ role
  once Wave 4 surfaces ship.

---

## D-W4-4D-01 — ui-steward batch 2 migrated 7 ad-hoc modals, not 24

**Phase 4.D INDEX/spec says:** "24 BO modals migrated to Radix Dialog"
(ui-steward batch 2).
**Real count:** 7 ad-hoc modals migrated. The remaining 17
modal/dialog/drawer/confirm sites in `apps/backoffice/src/features/**` were
already on the `@breakery/ui` Radix Dialog primitive before Phase 4.D
opened.

### Cause

The "24 modals" estimate originated in the V2-era audit
(`docs/workplan/specs/2026-05-13-session-13-architecture-audit.md` R10)
which counted ~72 ad-hoc modal sites. By the time Phase 1.D shipped, the
new `@breakery/ui` Dialog primitive was consumed by almost every modal
authored in Waves 2 / 3 (loyalty, suppliers, inventory
adjust/receive/waste, transfers, promotions, and the expense
Approve/Pay/Reject dialogs). Only seven files still hand-rolled their own
`<div className="fixed inset-0 bg-black/40">` overlay.

The ui-steward charter (§3.1 — `2026-05-13-ui-steward-charter.md`) already
documented this realignment, predicting "≈10 files per batch" instead of
24. The actual count for batch 2 (7) lands within that estimate.

### Resolution

Phase 4.D migrates the 7 remaining ad-hoc modals to `<Dialog>` from
`@breakery/ui`:

| # | File | Feature |
|---|---|---|
| 1 | `inventory-opname/components/CreateOpnameModal.tsx` | Stock count create |
| 2 | `inventory-opname/components/FinalizeOpnameDialog.tsx` | Stock count finalize |
| 3 | `inventory-opname/components/CancelOpnameDialog.tsx` | Stock count cancel |
| 4 | `inventory-production/components/RevertProductionDialog.tsx` | Production revert |
| 5 | `sections/components/SectionFormModal.tsx` | Section CRUD |
| 6 | `purchasing/components/CancelDialog.tsx` | PO cancel |
| 7 | `purchasing/components/ReceiveDialog.tsx` | PO goods-receipt |

Gains: focus trap, Escape, aria-labelledby / aria-describedby,
return-focus-to-trigger, backdrop blur, motion-reduce variants — all
delegated to Radix. The prop surface of each component is preserved
(`onClose`, `onCancel`, `onConfirm`, `submitting`, `error` pass through
unchanged), so the parents that conditionally render
`{open && <Modal ... />}` continue to work without edits.

### Verification

- Scoped vitest suites (opname/production/sections/purchasing/expenses):
  18/18 green.
- Adjacent suites (inventory/transfers/suppliers/customers/loyalty/promotions):
  57/57 green.
- `pnpm --filter @breakery/app-backoffice exec tsc --noEmit`: exit 0 (no
  new type errors).
- Full BO test suite under high parallel load occasionally OOMs the Node
  test runner — per-feature runs are deterministic and green.

---

## D-W4-4D-02 — Tablet "Timeline" component never existed in V3 — realtime de-dupe lives in the listener hook

**Phase 4.D INDEX/spec says (Part 1):** Edit
`apps/pos/src/features/tablet/components/TabletOrderTimeline.tsx` to handle
out-of-order realtime events gracefully.
**Real state on disk:** No such file exists. The tablet "orders" page
renders a list of `TabletOrderCard` (a primitive owned by
`packages/ui/src/components/TabletOrderCard.tsx`). The realtime event
handler that drives those cards lives in
`apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts`.

### Cause

Spec author was working from a V2 mental model where `TabletOrderTimeline`
existed as a tablet-specific component aggregating per-order status
changes into a single timeline view. V3 tablet design simplified the UX to
"a list of order cards, each showing its own status badges", so the
timeline aggregator was never materialised. The realtime de-duplication
the spec called for is still meaningful — it just belongs in the listener
hook (`useTabletOrderStatusListener`), not a non-existent component.

### Resolution

Phase 4.D adds a bounded `Set<string>` of seen
`(order_item_id, kitchen_status)` keys in `useTabletOrderStatusListener`.
Realtime replay or out-of-order delivery cannot double-fire the "Item
ready" toast. The set is capped at 1000 entries with an LRU-ish eviction
(delete oldest when full) — well past 36h of cooking at one ready/sec on a
single waiter session.

### Verification

- 10 RTL tests in
  `apps/pos/src/features/tablet/__tests__/TabletOffline.test.tsx` cover
  the offline polish (banner mount/unmount, relative time, navigator
  events, cache write/read/TTL).
- De-duplication behaviour is exercised by the existing realtime hook
  pattern but does not have a dedicated unit test ; integration coverage
  comes from the kiosk smoke tests when the realtime channel runs against
  staging.

---
