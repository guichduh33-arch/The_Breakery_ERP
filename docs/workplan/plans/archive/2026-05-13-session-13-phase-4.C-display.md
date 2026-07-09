# Session 13 — Phase 4.C — Customer Display build-from-scratch — Sub-plan

> **Status** : in-progress (2026-05-14)
> **Executor** : `coder` (`display-build`)
> **Migration block** : `20260517000160` (optional — display_screens registry)
> **Complexity** : M (~16-20 h)
> **Parent INDEX** : [`./2026-05-13-session-13-INDEX.md`](./2026-05-13-session-13-INDEX.md) §Phase 4.C (line 822)
> **Module ref**  : [`../../reference/04-modules/16-display-customer.md`](../../../reference/04-modules/16-display-customer.md)

## 1. Context (state at startup, verified 2026-05-14)

Wave 1-3 are DONE. Staging project `ikcyvlovptebroadgtvd` already has :

- ✓ `kiosk_jwt_signing_keys` table (Phase 1.B migration `000032`) — current
  signing key referenced via `current_kid` view + `kiosk-issue-jwt` EF.
- ✓ `kiosk-issue-jwt` EF (Wave 1) — mints HS256 JWTs with
  `app_metadata.provider='kiosk'` and `scope IN ('kds', 'display', 'tablet')`.
  Audited via `audit_logs.action = 'kiosk.token.issued'`.
- ✓ `apps/pos/src/lib/kioskAuth.ts` (Wave 1) — shared kiosk client core
  (read/write pairing, `obtainKioskJwt(scope)`, refresh schedule, PIN
  fallback per K7).
- ✓ `apps/pos/src/features/display/hooks/useKioskAuth.ts` (Wave 1) —
  scope='display' variant of useKioskAuth.
- ✓ `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` (Wave 1 hotfix
  D19) — canonical channel-uniqueness pattern with per-mount
  `crypto.randomUUID()` suffix.
- ✓ Design tokens (Phase 1.D) — `--bg-base`, `--gold-base`, `--text-primary`,
  semantic aliases (`--success`, `--warning`), payment-method tokens. All
  exposed via `@breakery/ui` Tailwind preset as `bg-bg-base`, `text-gold`,
  `text-success`, etc.
- ✓ `orders` table (Session 2 + extensions) — columns `id, order_number,
  status order_status, order_type, total, table_number, customer_id,
  sent_to_kitchen_at, paid_at, created_at, updated_at, ...`.
  `order_status` enum = `draft | paid | voided | pending_payment |
  completed`.
- ✓ `order_items` table — `id, order_id, name_snapshot, quantity,
  unit_price, line_total, kitchen_status, ready_at, served_at,
  dispatch_station, ...`.
- ✓ `audit_logs (id, actor_id, action, entity_type, entity_id, metadata,
  created_at)`.
- ✗ No `display_screens` table yet.
- ✗ No `display.manage` / `display.read` permission rows.
- ✗ No `/display` route in `apps/pos/src/routes/index.tsx`.
- ✗ No `CustomerDisplayPage` / `OrderQueueTicker` / `BrandedLayout` /
  `useDisplayRealtime` files.

## 2. Decisions (locked for this phase)

- **D-4C-1 Migration 000160 is OPTIONAL but scoped down to MVP** — we
  ship `display_screens` registry (`id, name, location, code UNIQUE,
  is_active, last_seen_at, created_at, updated_at, deleted_at`) WITHOUT
  the `kiosk_jwt_secret_key` column from the INDEX spec. The actual
  signing key lives in `kiosk_jwt_signing_keys` (Wave 1) — duplicating
  it per-screen would create rotation drift. The `code` column is the
  pairing identifier the admin types into the device during onboarding
  (it maps 1:1 to `kiosk_id` in `obtainKioskJwt`). RLS = SELECT for any
  authenticated user (the display device must read its own row for
  heartbeat) ; INSERT/UPDATE/DELETE = `display.manage` perm (ADMIN+).
- **D-4C-2 NO re-CREATE of `has_permission()`** — per CLAUDE.md rule.
  We INSERT two perms (`display.manage`, `display.read`) but rely on the
  unconditional ADMIN/SUPER_ADMIN branch to grant access. MANAGER is
  excluded by design (display device pairing is sensitive — restrict to
  ADMIN+ as with `customer_categories`).
- **D-4C-3 Realtime channel uniqueness (D19)** — `useDisplayRealtime`
  must use `useMemo(() => crypto.randomUUID(), [])` and embed it in
  the channel name as `display-${screenId}-${mountId}`. Grep audit
  blocks any literal channel name in `apps/pos/src/features/display/`.
- **D-4C-4 `/display` route is publicly navigable** — no `<Protected>`
  guard. The route renders a kiosk-auth gate that fails-soft to a PIN
  fallback (per K7) when the EF is unreachable. Browser users hitting
  the URL without device pairing land on the "Pair device" UI instead
  of a redirect to /login.
- **D-4C-5 Order subscription filter** — subscribe to `orders` (not
  `order_items`) with no station filter. The display surfaces the most
  recent 5 orders whose `status IN ('paid', 'completed')` AND
  `paid_at >= now() - interval '15 minutes'`. The ticker excludes
  voided and draft orders.
- **D-4C-6 MVP layout = active cart placeholder + queue ticker** —
  Phase 4.C ships the route, kiosk auth wiring, realtime queue ticker,
  and branded layout shell. The full `CDActiveCartView` (live cart
  mirror via LAN BroadcastChannel) lands in Phase 5.A when the LAN
  layer is ported. The MVP shows "Welcome to The Breakery" branding +
  queue ticker only.
- **D-4C-7 ID provisioning for kiosk pairing** — the display device is
  paired by an admin via `apps/backoffice` (Phase 5.D) ; in Phase 4.C
  we accept either (a) a pre-existing pairing in `localStorage` (set
  manually by a dev/tester during smoke) OR (b) a "Pair device" inline
  form that calls `writeKioskPairing()` from `lib/kioskAuth`. No BO UI
  this phase.

## 3. Migration plan

### `20260517000160_init_display_screens.sql`

- `CREATE TABLE display_screens (id UUID PK, name TEXT NOT NULL,
  location TEXT, code TEXT UNIQUE NOT NULL, is_active BOOLEAN NOT NULL
  DEFAULT true, last_seen_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT
  NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ)`.
- Index `idx_display_screens_active` ON `display_screens(is_active)
  WHERE deleted_at IS NULL`.
- RLS enabled. Policies :
  - `display_screens_select_authenticated` (SELECT) — any auth user
    (including kiosk scope) reads.
  - `display_screens_insert_manage` (INSERT) — `has_permission(auth.uid(),
    'display.manage')`.
  - `display_screens_update_manage` (UPDATE) — same.
  - `display_screens_delete_manage` (DELETE) — same.
- Trigger `display_screens_set_updated_at` → reuses generic
  `set_updated_at()`.
- Seeds : 2 perms (`display.manage`, `display.read`) into `permissions`.
- COMMENT ON TABLE describing the table + cross-ref to kiosk_jwt design.

## 4. App files (CREATE / UPDATE)

| Path | Type | Role |
|------|------|------|
| `apps/pos/src/features/display/CustomerDisplayPage.tsx` | CREATE | Root page — kiosk auth gate + branded layout + queue ticker. |
| `apps/pos/src/features/display/components/BrandedLayout.tsx` | CREATE | Token-only layout shell (bg-bg-base, gold accents, no hardcoded hex). |
| `apps/pos/src/features/display/components/OrderQueueTicker.tsx` | CREATE | Last 5 orders, animated row reveal. |
| `apps/pos/src/features/display/components/CurrentOrderCard.tsx` | CREATE | Featured "now preparing" card (top of queue). |
| `apps/pos/src/features/display/components/PairDevicePrompt.tsx` | CREATE | Inline pairing form for unpaired devices. |
| `apps/pos/src/features/display/hooks/useDisplayRealtime.ts` | CREATE | Pattern of useKdsRealtime — D19 unique channel. |
| `apps/pos/src/features/display/hooks/useDisplayOrders.ts` | CREATE | TanStack query — last 5 paid/completed orders. |
| `apps/pos/src/routes/index.tsx` | UPDATE | Add `/display` route, NO Protected guard. |
| `apps/pos/src/features/display/__tests__/CustomerDisplayPage.smoke.test.tsx` | CREATE | Smoke — mocked kiosk auth + supabase ; asserts branded layout + queue render. |
| `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx` | CREATE | Unit — 5-row clamp ; empty state. |
| `apps/pos/src/features/display/hooks/__tests__/useDisplayRealtime.uniqueChannel.test.ts` | CREATE | D19 acceptance — StrictMode double-mount → 2 distinct channel names. |

## 5. Test plan

1. pgTAP : optional `supabase/tests/display_screens.test.sql` — verify
   (a) table exists + columns, (b) RLS denies anon SELECT, allows auth
   SELECT, (c) `display.manage` perm row inserted.
2. Vitest unit : `useDisplayRealtime.uniqueChannel.test.ts` mounts the
   hook twice inside `StrictMode` and asserts that
   `supabase.channel(...)` received 2 distinct names that both start
   with the `display-{screenId}-` prefix.
3. Vitest unit : `OrderQueueTicker.test.tsx` — given a 7-row payload,
   renders only 5 rows ; given empty payload, renders the empty-state
   text "Awaiting orders".
4. Vitest smoke : `CustomerDisplayPage.smoke.test.tsx` mocks kiosk auth
   (`status='authenticated'`) + supabase orders query → asserts the
   branded layout header renders "The Breakery" + the queue ticker is
   mounted (1 row from fixture).
5. Manual smoke (out-of-band) : open `/display` in browser → unpaired
   state shows pair form → after pairing, page transitions to authed
   state → seeding a `paid` order in staging triggers a realtime event
   visible within 1s.

## 6. Audit gates (must pass before commit)

- `grep -RE "supabase\.channel\(['\"][^'\"]*['\"]\)" apps/pos/src/features/display/` → 0 matches (D19).
- `grep -RE "#[0-9a-fA-F]{3,6}" apps/pos/src/features/display/` → 0 matches in JSX (tokens only ; hex permitted in comments).
- `pnpm typecheck` → green.

## 7. Out of scope (deferred)

- BO admin UI to manage `display_screens` rows (Phase 5.D).
- LAN BroadcastChannel cart mirror (`CDActiveCartView`) — Phase 5.A.
- Idle promo rotation from `display_promotions` table — deferred to
  Wave 5+ (table not yet created in V3).
- Audio chime on order ready — Phase 5.A.
- Dim-after-30-min — Phase 5.B (settings infra).

## 8. Commit slices

1. `feat(db): session 13 — phase 4.C — init display_screens migration + perms` (000160)
2. `chore(types): regen types.generated.ts post phase-4.C migration` (regen)
3. `feat(pos): session 13 — phase 4.C — display hooks (kioskAuth wire + realtime + orders)`
4. `feat(pos): session 13 — phase 4.C — display components (BrandedLayout, Ticker, CurrentOrder, PairPrompt)`
5. `feat(pos): session 13 — phase 4.C — CustomerDisplayPage + /display route`
6. `test(pos): session 13 — phase 4.C — display smoke + ticker + D19 channel uniqueness`
7. `docs(workplan): session 13 — phase 4.C — append wave-4 deviation pack`
