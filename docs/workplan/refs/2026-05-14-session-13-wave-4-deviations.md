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
