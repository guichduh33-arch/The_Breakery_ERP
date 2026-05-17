# Session 19 — Spec (Hardening polish: durable rate-limit + session timeout per role + PIN strength warn)

**Date:** 2026-05-17
**Branch:** `swarm/session-19` (off `7239b8d` master, post-S18 merge PR #22)
**INDEX:** [`../plans/2026-05-17-session-19-INDEX.md`](../plans/2026-05-17-session-19-INDEX.md) *(to be written by writing-plans next)*
**Migration block reserved:** `20260523000001..099`
**Approach:** 3 independent hardening threads (A=durable rate-limit, B=session timeout per role, C=PIN strength warn) executed phased by layer — DB → utils+EF → UI → closeout. 5 Waves, 9 phases.

---

## 1. Goal global

Close 3 P1/P2 hardening items from `docs/workplan/backlog-by-module/01-auth-permissions.md` that share enough infrastructure (auth/EF/permission gating) to bundle into one session :

1. **Thread A — Finish Postgres-backed rate-limit (TASK-01-002 follow-up).** S13 shipped the in-memory side (`_shared/rate-limit.ts`) and seeded the `edge_function_rate_limits` table, but `checkRateLimitDurable` is a stub (line 99 : *"Postgres backing deferred to a follow-up RPC."*). Cross-instance correctness is currently broken — an attacker hitting a cold-start EF instance bypasses the in-memory bucket. S19 finishes the durable backstop and migrates all 5 rate-limited EFs to use it.

2. **Thread B — Per-role session timeout (TASK-01-006).** Currently no `useSessionTimeout` hook exists in V3 at all (the V2 hook didn't carry over). Sessions only expire when the JWT expires (~24h) regardless of role. Adds `roles.session_timeout_minutes` column with a security-leaning default profile (cashier 30, admin 120, super 240) and wires an idle-timeout hook in both POS and BO.

3. **Thread C — PIN strength warn (TASK-01-008).** No PIN strength check exists today — users can set `123456`, `000000`, `111111`. Warn-only mode (no blocking) : util in `packages/utils`, `auth-change-pin` EF returns a `weak` flag, both BO and POS PIN-change UIs surface a non-blocking yellow warning. Includes building a POS self-change PIN UI (currently absent in V3) so the warn pattern works end-to-end.

**Why now :** The roadmap top-priorité table (`00-roadmap-globale.md`) lists rate limiting and RLS anon as still-active P1. Investigation revealed RLS anon is fully done in S13 (zero `TO anon USING(true)` remain) but the rate-limit work is only half done. Closing this gap is high security value at low effort. TASK-01-006 and TASK-01-008 are bundled because they share the auth surface and same RBAC gates, and would otherwise sit untouched in the backlog.

**In :**
- New RPC `record_rate_limit_v1(...)` SECURITY DEFINER, atomic upsert into `edge_function_rate_limits`, returns `(allowed, retry_after_sec, current_count)`.
- pg_cron purge job `rl-purge` daily at 19:05 UTC (matches existing pgTAP nightly window).
- Wire `_shared/rate-limit.ts::checkRateLimitDurable` to the new RPC ; in-memory stays as the fast pre-check.
- Migrate all 5 rate-limited EFs (`auth-verify-pin`, `kiosk-issue-jwt` × 2 buckets, `refund-order`, `void-order`, `cancel-item`) to `checkRateLimitDurable`.
- New column `roles.session_timeout_minutes INT NOT NULL DEFAULT 30 CHECK (BETWEEN 5 AND 480)`, seeded per role.
- New RPC `update_role_session_timeout_v1(p_role_code, p_minutes)` SECURITY DEFINER, gated `settings.update` + admin role, audit-logged.
- Extend `auth-get-session` EF response to include `session_timeout_minutes` (joined from `roles`).
- New `useIdleTimeout` hook in `packages/ui/src/hooks/`, mounted in both POS and BO root.
- New BackOffice page `/settings/security` (per-role timeout editor) — wires the `(Soon)` tile already present in `SettingsHubPage`.
- New util `packages/utils/src/pin-strength.ts` (sequence + repetition + top-100 leaked) + Deno-compatible copy in `supabase/functions/_shared/pin-strength.ts` (rules stay in sync via an inline diff test).
- Extend `auth-change-pin` EF response with `{ weak: boolean, weak_reason?: 'sequence'|'repetition'|'common' }`.
- BO `UserDetailPage.tsx` Reset PIN section consumes `weak` flag + client-side pre-check.
- New POS `ChangePinModal.tsx` + `useChangePin.ts` hook, mounted via a new "Change PIN" item in `SideMenuDrawer.tsx`.
- pgTAP coverage on both RPCs ; Vitest live RPC tests ; unit tests on pin-strength + useIdleTimeout ; BO/POS smoke tests for new pages/modals.

**Out :**
- `pos_config.enforce_strong_pin` setting — warn-only is the S19 scope (per user decision).
- 2FA admin (TASK-01-010) — its own session.
- Pre-existing PIN format mismatch (UserDetailPage validates 4-8, EF requires exactly 6) — log as `DEV-S19-3.B-01` informational, fix in S20+.
- Session-timeout DST/timezone edge cases — out (idle is wall-clock delta, no calendar math).
- Admin reset PIN on POS device for someone else — out (BO is the canonical admin path).
- All S13-S18 deferred items (Playwright CI, pg_net birthday cron, Cash Flow IF/Financing, mv_pl_monthly reuse, staging-deploy secrets, WAC landed cost, mobile shell, modal focus traps).
- Allergen receipt/display (DEV-S15-5.C-01 wontfix).
- Phantom tables verification (`system_alerts`, `customer_invoices`) — separate session.

---

## 2. Scope — what's included

### 2.1 Wave 0 — Spec + INDEX

**Phase 0.1** — Author this spec + INDEX skeleton.

| # | File | Action |
|---|---|---|
| — | `docs/workplan/specs/2026-05-17-session-19-spec.md` | CREATE (this doc) |
| — | `docs/workplan/plans/2026-05-17-session-19-INDEX.md` | CREATE (by writing-plans next) |

Commit : `docs(workplan): session 19 — phase 0.1 — spec + INDEX`.

### 2.2 Wave 1 — DB layer (parallel : 1.A + 1.B)

#### Phase 1.A — Durable rate-limit RPC + pg_cron purge (Thread A, solo within wave)

| # | File | Purpose |
|---|---|---|
| 10 | `supabase/migrations/20260523000010_create_record_rate_limit_v1_rpc.sql` | New RPC `record_rate_limit_v1(p_function_name TEXT, p_bucket_key TEXT, p_ip_address TEXT, p_max_per_window INT, p_window_sec INT DEFAULT 60) RETURNS TABLE (allowed BOOLEAN, retry_after_sec INT, current_count INT)`. SECURITY DEFINER. Service-role only (`REVOKE ALL FROM authenticated, anon`). |
| 11 | `supabase/migrations/20260523000011_schedule_rl_purge_cron.sql` | Register `cron.schedule('rl-purge', '5 19 * * *', $$DELETE FROM edge_function_rate_limits WHERE window_end < now() - interval '1 hour'$$)`. Idempotent (`SELECT cron.unschedule(...) WHERE EXISTS`). |

**RPC atomic logic (CTE)** :
```sql
WITH live AS (
  SELECT id, request_count
  FROM edge_function_rate_limits
  WHERE function_name = p_function_name
    AND bucket_key = p_bucket_key
    AND window_end > now()
  ORDER BY window_end DESC
  LIMIT 1
  FOR UPDATE
),
upsert AS (
  INSERT INTO edge_function_rate_limits
    (function_name, bucket_key, ip_address, request_count, window_start, window_end)
  SELECT p_function_name, p_bucket_key, p_ip_address, 1, now(), now() + (p_window_sec || ' seconds')::INTERVAL
  WHERE NOT EXISTS (SELECT 1 FROM live)
  RETURNING id, request_count
),
bump AS (
  UPDATE edge_function_rate_limits e
  SET request_count = e.request_count + 1
  FROM live
  WHERE e.id = live.id AND live.request_count < p_max_per_window
  RETURNING e.id, e.request_count
)
SELECT
  COALESCE(
    (SELECT TRUE FROM upsert),
    (SELECT TRUE FROM bump),
    FALSE
  ) AS allowed,
  CASE WHEN (SELECT TRUE FROM bump) IS NOT NULL OR (SELECT TRUE FROM upsert) IS NOT NULL THEN 0
       ELSE GREATEST(0, EXTRACT(EPOCH FROM ((SELECT window_end FROM live JOIN edge_function_rate_limits e ON e.id = live.id) - now()))::INT)
  END AS retry_after_sec,
  COALESCE((SELECT request_count FROM upsert), (SELECT request_count FROM bump), (SELECT request_count FROM live)) AS current_count;
```
(Phase 1.A implementer may simplify equivalent — the contract is the public surface.)

**Grants** : `REVOKE ALL ON FUNCTION record_rate_limit_v1 FROM anon, authenticated; GRANT EXECUTE TO service_role;`.

Tests :

| # | File | Coverage |
|---|---|---|
| pgTAP | `supabase/tests/record_rate_limit_v1.test.sql` (CREATE) | Atomic upsert ; allowed transitions to false at threshold ; window rollover after `window_end` ; concurrent buckets isolated (`function_name + bucket_key` independent) ; cron job registered ; permission gate (service-role only) ; CHECK constraints hold. |
| Vitest live | `supabase/tests/functions/rate-limit-durable.test.ts` (CREATE) | RPC smoke against V3 dev ; simulate 2 service-role clients hammering the same bucket — combined count is enforced cross-instance. |

#### Phase 1.B — `roles.session_timeout_minutes` + update RPC (Thread B)

| # | File | Purpose |
|---|---|---|
| 20 | `supabase/migrations/20260523000020_add_session_timeout_to_roles.sql` | `ALTER TABLE roles ADD COLUMN session_timeout_minutes INT NOT NULL DEFAULT 30 CHECK (session_timeout_minutes BETWEEN 5 AND 480);` then seed per code (CASHIER 30, waiter 30, MANAGER 60, ADMIN 120, SUPER_ADMIN 240). |
| 21 | `supabase/migrations/20260523000021_create_update_role_session_timeout_v1_rpc.sql` | RPC `update_role_session_timeout_v1(p_role_code TEXT, p_minutes INT) RETURNS BOOLEAN`. SECURITY DEFINER. Gate : `has_permission(auth.uid(), 'settings.update')` AND caller role IN ('SUPER_ADMIN', 'ADMIN'). Validates bounds. Writes `audit_logs` row with `action='role.session_timeout_changed'`, `entity_type='roles'`, `entity_id=p_role_code`, payload `{before, after}`. Raises `P0003` forbidden or `P0001` invalid_minutes on violation. |

Tests :

| # | File | Coverage |
|---|---|---|
| pgTAP | `supabase/tests/update_role_session_timeout_v1.test.sql` (CREATE) | Permission gate (non-admin → P0003) ; CHECK violation (1 minute → P0001) ; happy path mutates `roles.session_timeout_minutes` ; audit log row written ; nonexistent role code raises. |
| Vitest live | `supabase/tests/functions/role-session-timeout.test.ts` (CREATE) | RPC live smoke against V3 dev. |

### 2.3 Wave 2 — Utils + Edge Functions (parallel : 2.A + 2.B)

#### Phase 2.A — Wire durable rate-limit + migrate 5 EFs (Thread A)

| # | File | Action |
|---|---|---|
| — | `supabase/functions/_shared/rate-limit.ts` | UPDATE : replace the stub body of `checkRateLimitDurable` (line 88-101) with the real RPC call via `getAdminClient().rpc('record_rate_limit_v1', {...})`. Keep in-memory `checkRateLimit` as the fast-fail pre-check inside the durable function. Fail-open on DB error (log + return allowed:true) to avoid lockouts on transient DB issues. |
| — | `supabase/functions/auth-verify-pin/index.ts` | UPDATE : swap `checkRateLimit('verify-pin:'+ip, 3)` → `await checkRateLimitDurable({functionName:'auth-verify-pin', bucketKey:'ip:'+ip, ipAddress:ip, maxPerWindow:3, windowSec:60})`. |
| — | `supabase/functions/kiosk-issue-jwt/index.ts` | UPDATE : two buckets — IP (10/min) and kiosk-id (1/min), both via `checkRateLimitDurable`. |
| — | `supabase/functions/refund-order/index.ts` | UPDATE : swap to durable (`refund-order`, IP bucket, 10/min). |
| — | `supabase/functions/void-order/index.ts` | UPDATE : swap to durable (`void-order`, IP bucket, 10/min). |
| — | `supabase/functions/cancel-item/index.ts` | UPDATE : swap to durable (`cancel-item`, IP bucket, 10/min). |

Tests :

| # | File | Coverage |
|---|---|---|
| Vitest live | `supabase/tests/functions/auth-verify-pin-rate-limit.test.ts` | EXTEND : add a cross-instance simulation (two `supabase-js` clients with the same IP header) — combined attempts above 3/min → 429. |

#### Phase 2.B — PIN strength util + `auth-change-pin` extension (Thread C, layer 1)

| # | File | Action |
|---|---|---|
| — | `packages/utils/src/pin-strength.ts` | CREATE. Exports `evaluatePinStrength(pin: string): { weak: boolean; reason: 'sequence' \| 'repetition' \| 'common' \| null }`. Rules : repetition (all same digit) ; sequence (`+1` or `-1` strict for ≥4 digits) ; common (inlined top-100 leaked PIN list — start from the well-known Datagenetics dataset, curated to 100 entries). |
| — | `packages/utils/src/__tests__/pin-strength.test.ts` | CREATE. ~30 cases : known-weak (`123456`, `654321`, `111111`, `000000`, `121212`, `159753`) ; known-strong (`285741`, `936027`) ; edge (`12` too short → return weak:false reason:null since out of valid PIN range) ; null/empty input. |
| — | `supabase/functions/_shared/pin-strength.ts` | CREATE. Deno-compatible copy of the util (no `package.json` import path in Deno). Marked with a header comment : *"// MIRROR of packages/utils/src/pin-strength.ts. Keep in sync. See sync test below."*. |
| — | `supabase/functions/auth-change-pin/index.ts` | UPDATE : after `PIN_REGEX.test(new_pin)`, call `evaluatePinStrength(new_pin)`. Extend response shape : `{ ok: true, weak: boolean, weak_reason?: 'sequence'\|'repetition'\|'common' }`. Backward compatible (existing callers ignoring `weak` keep working). |

Tests :

| # | File | Coverage |
|---|---|---|
| Unit | `packages/utils/src/__tests__/pin-strength.test.ts` | (see above) |
| Vitest live | `supabase/tests/functions/auth-change-pin-strength.test.ts` (CREATE) | Live EF smoke : POST with a weak PIN → response has `weak:true, weak_reason:'sequence'` ; strong PIN → `weak:false`. |
| Sync | `supabase/tests/functions/_shared_pin-strength_sync.test.ts` (CREATE) | Cross-import both files and assert `evaluatePinStrength` returns the same result for ~10 sentinel inputs — fails CI if the two copies drift. |

### 2.4 Wave 3 — UI surfaces (parallel : 3.A + 3.B + 3.C)

#### Phase 3.A — Session timeout per role UI (Thread B, layer 2)

| # | File | Action |
|---|---|---|
| — | `supabase/functions/auth-get-session/index.ts` | UPDATE : SQL query joins `roles` and returns `session_timeout_minutes` alongside the existing session shape. Update the returned `SessionResponse` interface. |
| — | `apps/pos/src/stores/authStore.ts` | UPDATE : store `sessionTimeoutMinutes: number` ; expose via selector. |
| — | `apps/backoffice/src/stores/authStore.ts` | UPDATE : same. |
| — | `packages/ui/src/hooks/useIdleTimeout.ts` | CREATE. `useIdleTimeout({ timeoutMinutes, onTimeout, events? })` — registers `mousedown`, `keydown`, `touchstart`, `scroll` (debounced 1s), resets `setTimeout`, fires `onTimeout` after idle. Returns `{ remainingMs, reset }`. |
| — | `packages/ui/src/hooks/__tests__/useIdleTimeout.test.ts` | CREATE. Fake timers ; activity resets ; timeout fires. |
| — | `apps/pos/src/main.tsx` (or root layout) | UPDATE : mount `useIdleTimeout({ timeoutMinutes: useAuthStore(s => s.sessionTimeoutMinutes), onTimeout: () => signOut() })`. |
| — | `apps/backoffice/src/layouts/RootLayout.tsx` (or equivalent) | UPDATE : same. |
| — | `apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx` | CREATE. Table of 5 roles with `timeout_minutes` input (5-480) + Save per row ; calls `update_role_session_timeout_v1`. Toast on success. Gated `settings.update`. |
| — | `apps/backoffice/src/pages/settings/security/__tests__/SecuritySettingsPage.smoke.test.tsx` | CREATE. Render + edit + save mock. |
| — | `apps/backoffice/src/pages/settings/SettingsHubPage.tsx` | UPDATE : remove `(Soon)` from the Security & PIN tile, link to `/settings/security`. |
| — | `apps/backoffice/src/routes/index.tsx` | UPDATE : add `/settings/security` route. |

#### Phase 3.B — PIN strength warn in BO `UserDetailPage` (Thread C, layer 2)

| # | File | Action |
|---|---|---|
| — | `apps/backoffice/src/pages/users/UserDetailPage.tsx` | UPDATE : after the existing `handleResetPin` success branch, surface a yellow banner ("⚠ This PIN is weak ({reason}). Consider a stronger PIN.") when the response has `weak: true`. Also add a client-side pre-check on `pinDraft` change : show the same hint inline below the input field as the user types (uses the `packages/utils` util directly). |
| — | `apps/backoffice/src/pages/users/__tests__/UserDetailPage.smoke.test.tsx` | UPDATE (or CREATE) : assert weak hint appears for weak PIN inputs ; assert success banner branches on weak vs not-weak responses. |

#### Phase 3.C — PIN strength UI on POS (Thread C, layer 3)

| # | File | Action |
|---|---|---|
| — | `apps/pos/src/features/auth/hooks/useChangePin.ts` | CREATE. react-query mutation that POSTs to `auth-change-pin` EF, returns `{ ok, weak, weak_reason }`. |
| — | `apps/pos/src/features/auth/ChangePinModal.tsx` | CREATE. 3-step modal (Current PIN → New PIN → Confirm New PIN). Each step uses the existing `PinPad` component. Step 2 shows a small italic hint below the keypad while typing if `evaluatePinStrength(draft).weak` is true. On submit success : close modal, toast `"PIN updated"` ; if response `weak:true`, append yellow "Consider a stronger PIN next time. ({reason})". On wrong current PIN : toast error, return to step 1. |
| — | `apps/pos/src/features/auth/__tests__/ChangePinModal.smoke.test.tsx` | CREATE. Full 3-step flow ; weak-hint visible for `123456` ; success toast includes weak warning for weak ; error path for wrong current PIN. |
| — | `apps/pos/src/features/nav/SideMenuDrawer.tsx` | UPDATE : add `onChangePin?: () => void` prop slot. Add menu item "Change PIN" (key icon, label `Change PIN`) that dispatches `onChangePin`. Position between "Sign out" and "Lock terminal" (or wherever feels natural in the existing menu order). |
| — | `apps/pos/src/features/nav/__tests__/SideMenuDrawer.test.tsx` | UPDATE : assert "Change PIN" item present + dispatches `onChangePin`. |
| — | `apps/pos/src/pages/Pos.tsx` | UPDATE : `const [changePinOpen, setChangePinOpen] = useState(false)` ; pass `onChangePin={() => setChangePinOpen(true)}` to drawer ; mount `<ChangePinModal open={changePinOpen} onClose={() => setChangePinOpen(false)} userId={currentUserId} />`. |

### 2.5 Wave 4 — Closeout

#### Phase 4.A — Closeout

- `pnpm typecheck` + `pnpm exec turbo run test --concurrency=1` + `pnpm build` green.
- `mcp__plugin_supabase_supabase__generate_typescript_types` → write to `packages/supabase/src/types.generated.ts` and commit. Verify both new RPCs (`record_rate_limit_v1`, `update_role_session_timeout_v1`) are visible.
- `CLAUDE.md` « Active Workplan » : add S19 entry as previous session, demote S18 to historical, append S19 follow-ups (if any).
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` : drop items 2 (rate limiting) and 3 (RLS anon — already done in S13, just stale) from Top priorités "Actifs". Add S19 row to Sessions complétées table.
- `docs/workplan/backlog-by-module/01-auth-permissions.md` : append `S19 update:` Status notes to TASK-01-002, TASK-01-006, TASK-01-008.
- Open PR to master with body listing : 4 migrations, 2 new RPCs, 1 new BO page, 1 new POS modal, 5 EFs migrated, 1 EF response extended, 1 EF response extended (auth-get-session).
- Smoke on V3 dev :
  - PIN brute-force : 4 consecutive `auth-verify-pin` calls from same IP across separate browser tabs (forcing cold-start EF instances) → 4th gets 429.
  - Session timeout : log in as CASHIER, idle 30 min → auto-logout. Change CASHIER timeout to 5 via `/settings/security`, log in again, idle 5 min → auto-logout.
  - PIN strength : self-change PIN to `123456` via POS ChangePinModal → success toast with weak warning. Same via BO UserDetailPage Reset PIN.

---

## 3. Decisions (numbered for reference)

| # | Decision | Rationale |
|---|---|---|
| D1 | In-memory `checkRateLimit` stays as the fast pre-check inside the durable function. | Two-layer defense : ~0ms in-memory hot path catches the common case ; Postgres backstop catches cross-instance bypass. Matches the docstring intent in S13's `rate-limit.ts`. |
| D2 | Fail-open on DB error in `checkRateLimitDurable` (log + return allowed:true). | Losing rate-limit for one request during a transient DB outage is preferable to denying every caller. Acceptable trade-off because in-memory still applies, and DB outages are rare on Supabase Pro. |
| D3 | pg_cron `rl-purge` daily at 19:05 UTC. | 5 minutes after the pgTAP nightly job (S16 `pgtap-nightly.yml` runs `0 19 * * *`) — no contention, easy to find in logs. Deletes rows older than 1 hour past `window_end` (no risk of deleting active buckets). |
| D4 | All 5 rate-limited EFs migrate to durable (not just `auth-verify-pin` + `kiosk-issue-jwt`). | Uniform pattern reduces footguns ; refund/void/cancel write volume is tiny (~50/day) and the DB cost is negligible. Avoids two coexisting patterns. |
| D5 | `kiosk-issue-jwt` keeps both buckets (IP 10/min + kiosk-id 1/min), both via durable. | The kiosk-id bucket is the actual anti-abuse measure (per-kiosk JWT issuance) ; the IP bucket catches blanket scraping. Both deserve durable backing. |
| D6 | Session timeout default profile : CASHIER 30, waiter 30, MANAGER 60, ADMIN 120, SUPER_ADMIN 240. | Security-leaning : front-line POS users (cashier/waiter) timeout fast since the POS may be physically unattended ; admin/super-admin work in BO with a (more) physically secured laptop and tolerate longer sessions. |
| D7 | `useIdleTimeout` lives in `packages/ui/src/hooks/`. | Shared between POS and BO ; pure React, no IO ; fits the `packages/ui` mandate (UI primitives + shared hooks). Not in `packages/utils` because it depends on React. |
| D8 | `roles.session_timeout_minutes` is the authoritative value (not `pos_config`). | The S13 design ran one global timeout via `pos_config`. Per-role is granular enough ; per-user would be over-engineering and complicates the audit log. |
| D9 | Audit log on every `update_role_session_timeout_v1` call. | Sensitive change (governance) — must be traceable. Action code `role.session_timeout_changed`, payload `{before:int, after:int}`. |
| D10 | PIN strength util in `packages/utils/src/pin-strength.ts` (pure TS). | IO-free, unit-testable, reusable from both apps and the EF. Domain-package rules (per CLAUDE.md) forbid IO ; this fits the mandate. |
| D11 | Deno-compatible mirror copy in `supabase/functions/_shared/pin-strength.ts`. | Deno EFs can't import from `packages/utils` (no `package.json` resolution). A sync test asserts the two copies return the same result for 10 sentinel inputs, failing CI if they drift. |
| D12 | Top-100 leaked PIN list inlined (from the well-known Datagenetics 2012 dataset, curated). | Static, no I/O, refreshable in a future PR. Covers ~30% of real-world PIN choices per the source data. |
| D13 | PIN strength is warn-only ; no `enforce_strong_pin` setting. | Per user decision : start with friction-free warnings, add enforcement (with admin override) in a later session if data shows users keep weak PINs. |
| D14 | PIN strength surfaces in POS ChangePinModal + BO UserDetailPage Reset PIN. | These are the only two PIN-change entry points in V3. Self-change via POS was greenfield (built in 3.C) ; BO covers both self-change and admin reset (the `isSelf` branch already exists in `auth-change-pin`). |
| D15 | Building a POS self-change PIN UI is in S19 scope (not deferred). | Without it, the warn pattern only ships on the BO admin path — half a feature. User explicitly asked to expand Thread C to include the POS surface. |
| D16 | `auth-change-pin` response is extended (not replaced). | Adds `weak`, `weak_reason` keys to the existing `{ok:true}` shape. Backward compatible — existing callers ignoring those keys keep working. |
| D17 | `auth-get-session` response is extended (not replaced). | Adds `session_timeout_minutes`. Same compatibility argument as D16. |
| D18 | Pre-existing 4-vs-6 PIN-format mismatch (UserDetailPage 4-8 vs EF exactly 6) tracked as `DEV-S19-3.B-01` informational. | Found during scoping ; out of S19 surface area. Fix is one regex change in UserDetailPage but coupling it here would mix concerns. |
| D19 | Migration block uses `20260523000010..011` (Thread A) + `20260523000020..021` (Thread B). | Threads get separate 10-number ranges so a thread can be cherry-picked independently if scope shrinks in execution. |
| D20 | No new audit log action codes for rate-limit events (yet). | Rate-limit 429s are already logged via the EF response path + Supabase function logs ; an audit log row per blocked attempt would be expensive (potentially thousands/day during an attack) and noisy. Reconsider in S20 if forensics need it. |

---

## 4. Test plan

### 4.1 pgTAP (DB)

- `supabase/tests/record_rate_limit_v1.test.sql` (CREATE) :
  - Atomic upsert : first call inserts ; second call within window bumps count.
  - `allowed` transitions from true to false at `count >= max_per_window`.
  - Window rollover : sleep past `window_end` → new bucket inserted.
  - Concurrent buckets isolated : (`fn:A, key:X`) ≠ (`fn:A, key:Y`) ≠ (`fn:B, key:X`).
  - Cron job `rl-purge` registered in `cron.job`.
  - CHECK constraints hold (function_name length, ip_address length, request_count ≥ 0).
  - Service-role only : `SET LOCAL ROLE authenticated; SELECT record_rate_limit_v1(...)` → permission denied.

- `supabase/tests/update_role_session_timeout_v1.test.sql` (CREATE) :
  - Permission gate : non-admin caller raises P0003.
  - CHECK bounds : 4 minutes (below 5) raises P0001 ; 481 (above 480) raises P0001.
  - Happy path : ADMIN caller updates `roles.session_timeout_minutes` ; audit log row written with correct shape.
  - Nonexistent role code : raises (does not silently no-op).

### 4.2 Vitest live RPC

- `supabase/tests/functions/rate-limit-durable.test.ts` (CREATE) — two clients hammering the same bucket above the threshold → second client gets `allowed:false` ; verifies cross-instance correctness.
- `supabase/tests/functions/role-session-timeout.test.ts` (CREATE) — happy path + permission rejection.
- `supabase/tests/functions/auth-verify-pin-rate-limit.test.ts` (EXTEND) — add a cross-instance simulation (two `supabase-js` clients with the same IP header → 4th attempt 429).
- `supabase/tests/functions/auth-change-pin-strength.test.ts` (CREATE) — weak vs strong PIN response shape.
- `supabase/tests/functions/_shared_pin-strength_sync.test.ts` (CREATE) — sentinel inputs return the same result in both `packages/utils` and `supabase/functions/_shared` copies.

### 4.3 Unit (pure TS)

- `packages/utils/src/__tests__/pin-strength.test.ts` (CREATE) — ~30 cases as listed in 2.3 Phase 2.B.
- `packages/ui/src/hooks/__tests__/useIdleTimeout.test.ts` (CREATE) — fake timers, activity resets, onTimeout fires after timeout.

### 4.4 Backoffice + POS smoke

- `apps/backoffice/src/pages/settings/security/__tests__/SecuritySettingsPage.smoke.test.tsx` (CREATE) — render 5 roles with current values ; edit + save ; toast.
- `apps/backoffice/src/pages/users/__tests__/UserDetailPage.smoke.test.tsx` (UPDATE or CREATE) — weak banner on weak response ; client-side hint while typing.
- `apps/pos/src/features/auth/__tests__/ChangePinModal.smoke.test.tsx` (CREATE) — 3-step flow ; weak hint at step 2 ; success toast with weak warning ; error path for wrong current PIN.
- `apps/pos/src/features/nav/__tests__/SideMenuDrawer.test.tsx` (UPDATE) — Change PIN item present + dispatches.

### 4.5 CI smoke

- Existing nightly `pgtap-nightly.yml` picks up both new `.test.sql` files automatically.

---

## 5. File map (informative)

```
supabase/migrations/
  20260523000010_create_record_rate_limit_v1_rpc.sql                (CREATE — Wave 1.A)
  20260523000011_schedule_rl_purge_cron.sql                         (CREATE — Wave 1.A)
  20260523000020_add_session_timeout_to_roles.sql                   (CREATE — Wave 1.B)
  20260523000021_create_update_role_session_timeout_v1_rpc.sql      (CREATE — Wave 1.B)

supabase/tests/
  record_rate_limit_v1.test.sql                                     (CREATE — Wave 1.A)
  update_role_session_timeout_v1.test.sql                           (CREATE — Wave 1.B)
  functions/rate-limit-durable.test.ts                              (CREATE — Wave 1.A)
  functions/role-session-timeout.test.ts                            (CREATE — Wave 1.B)
  functions/auth-verify-pin-rate-limit.test.ts                      (EXTEND — Wave 2.A)
  functions/auth-change-pin-strength.test.ts                        (CREATE — Wave 2.B)
  functions/_shared_pin-strength_sync.test.ts                       (CREATE — Wave 2.B)

supabase/functions/
  _shared/rate-limit.ts                                             (UPDATE — Wave 2.A : wire durable)
  _shared/pin-strength.ts                                           (CREATE — Wave 2.B : Deno mirror)
  auth-verify-pin/index.ts                                          (UPDATE — Wave 2.A)
  kiosk-issue-jwt/index.ts                                          (UPDATE — Wave 2.A)
  refund-order/index.ts                                             (UPDATE — Wave 2.A)
  void-order/index.ts                                               (UPDATE — Wave 2.A)
  cancel-item/index.ts                                              (UPDATE — Wave 2.A)
  auth-change-pin/index.ts                                          (UPDATE — Wave 2.B)
  auth-get-session/index.ts                                         (UPDATE — Wave 3.A : session_timeout_minutes)

packages/utils/src/
  pin-strength.ts                                                   (CREATE — Wave 2.B)
  __tests__/pin-strength.test.ts                                    (CREATE — Wave 2.B)

packages/ui/src/hooks/
  useIdleTimeout.ts                                                 (CREATE — Wave 3.A)
  __tests__/useIdleTimeout.test.ts                                  (CREATE — Wave 3.A)

apps/pos/src/
  main.tsx (or root)                                                (UPDATE — Wave 3.A : mount hook)
  stores/authStore.ts                                               (UPDATE — Wave 3.A : sessionTimeoutMinutes)
  pages/Pos.tsx                                                     (UPDATE — Wave 3.C : ChangePinModal mount)
  features/nav/SideMenuDrawer.tsx                                   (UPDATE — Wave 3.C : Change PIN item)
  features/nav/__tests__/SideMenuDrawer.test.tsx                    (UPDATE — Wave 3.C)
  features/auth/ChangePinModal.tsx                                  (CREATE — Wave 3.C)
  features/auth/hooks/useChangePin.ts                               (CREATE — Wave 3.C)
  features/auth/__tests__/ChangePinModal.smoke.test.tsx             (CREATE — Wave 3.C)

apps/backoffice/src/
  layouts/RootLayout.tsx (or equivalent)                            (UPDATE — Wave 3.A : mount hook)
  stores/authStore.ts                                               (UPDATE — Wave 3.A : sessionTimeoutMinutes)
  routes/index.tsx                                                  (UPDATE — Wave 3.A : /settings/security route)
  pages/settings/SettingsHubPage.tsx                                (UPDATE — Wave 3.A : drop (Soon))
  pages/settings/security/SecuritySettingsPage.tsx                  (CREATE — Wave 3.A)
  pages/settings/security/__tests__/SecuritySettingsPage.smoke.test.tsx (CREATE — Wave 3.A)
  pages/users/UserDetailPage.tsx                                    (UPDATE — Wave 3.B : weak banner)
  pages/users/__tests__/UserDetailPage.smoke.test.tsx               (UPDATE or CREATE — Wave 3.B)

packages/supabase/src/types.generated.ts                            (UPDATE — Wave 4 — regen)
CLAUDE.md                                                           (UPDATE — Wave 4 — workplan pointer)
docs/workplan/backlog-by-module/00-roadmap-globale.md               (UPDATE — Wave 4 — roadmap refresh)
docs/workplan/backlog-by-module/01-auth-permissions.md              (UPDATE — Wave 4 — Status notes ×3)

docs/workplan/plans/2026-05-17-session-19-INDEX.md                  (CREATE — Wave 0, by writing-plans)
docs/workplan/specs/2026-05-17-session-19-spec.md                   (CREATE — Wave 0 — this doc)
```

Migration count : **4**. New source files : **~13**. Modified source files : **~15**. New test files : **~10**.

---

## 6. Limitations & known follow-ups (anticipated DEV-S19-… , Session 20+)

| ID (anticipated) | Description |
|---|---|
| `DEV-S19-1.A-01` | RPC `record_rate_limit_v1` holds a row-level lock during the upsert. Under sustained brute-force attack (≥100 req/sec on the same bucket), this could serialize attacker requests but also serialize defender requests on the same bucket. At Breakery's volume (≤20 users), inconsequential ; flag if attack volume ever reaches that level. |
| `DEV-S19-1.A-02` | Fail-open on DB error is a deliberate security trade-off (D2). If logs show frequent fallbacks, investigate the DB connection pool sizing before reconsidering fail-closed. |
| `DEV-S19-1.B-01` | `roles.session_timeout_minutes` is read once at session start. Changing a role's timeout doesn't kick existing users — they keep their original timeout until next login. Acceptable for governance changes ; flag if a forced-rotation requirement emerges. |
| `DEV-S19-2.B-01` | `pin-strength.ts` is duplicated in `packages/utils` and `supabase/functions/_shared`. The sync test catches drift but doesn't prevent it. Consider a build-time copy in `supabase/functions/build.sh` (if it exists) or a Deno-compatible loader in S20+. |
| `DEV-S19-2.B-02` | Top-100 leaked PIN list is inlined as a literal array. Refresh cadence is manual — update when a new public dataset surfaces (~every 2-3 years per historical pace). |
| `DEV-S19-3.A-01` | `useIdleTimeout` triggers `signOut()` immediately on timeout. No "you are about to be signed out" warning toast. Add in a polish PR if cashiers find it disruptive. |
| `DEV-S19-3.B-01` | Pre-existing : `UserDetailPage` validates 4-8 digits, EF requires exactly 6. Out of S19 scope ; one-line regex fix for S20+. |
| `DEV-S19-3.C-01` | POS `ChangePinModal` mounts in `Pos.tsx` only ; tablet ordering shell and KDS don't expose self-change. Consistent with the BO-is-canonical-admin-surface model ; add a Tablet/KDS surface in a later session if requested. |

---

## 7. Out of scope (deferred Session 20+)

- `pos_config.enforce_strong_pin` setting (per user decision, S19 is warn-only).
- 2FA admin / TOTP (TASK-01-010).
- POS PIN-change for *another* user (admin override on the POS device) — BO is the canonical admin path.
- "About to be signed out" warning toast before idle timeout fires.
- Granular permission `rbac.read` audit on `edge_function_rate_limits` debugging view (DEV-S19 if anyone needs to debug).
- Pre-existing 4-vs-6 PIN format mismatch fix (DEV-S19-3.B-01).
- Phantom tables verification (`system_alerts`, `customer_invoices`).
- WAC landed cost shipping pro-rata (TASK-07-012).
- Mobile shell Capacitor (TASK-18-***).
- Compliance fiscale Indonésie (blocked on PKP confirmation).
- All other S13-S18 deferred items.

---

## 8. Success criteria (gate to merge)

- [ ] `pnpm typecheck` green across all workspaces.
- [ ] `pnpm exec turbo run test --concurrency=1` green (modulo pre-existing flakes — 10 BO smoke flakes from DEV-S17-3.A-01 are pre-existing and out of scope).
- [ ] `pnpm build` green.
- [ ] pgTAP green via cloud MCP for `record_rate_limit_v1.test.sql` + `update_role_session_timeout_v1.test.sql`.
- [ ] All Vitest live RPC tests pass against V3 dev cloud.
- [ ] `packages/supabase/src/types.generated.ts` regenerated and committed (both new RPCs visible).
- [ ] `CLAUDE.md` « Active Workplan » updated : S19 as current/previous, S18 demoted.
- [ ] PR open to master with body listing : 4 migrations, 2 new RPCs, 1 pg_cron job, 5 EFs migrated to durable rate-limit, 2 EF responses extended, 1 new BO page (`/settings/security`), 1 new POS modal (`ChangePinModal`), new `useIdleTimeout` hook + new `pin-strength` util.
- [ ] No new `DEV-S19-…` deviation packs beyond §6 (i.e., implementation matches spec or §6 grows transparently).
- [ ] Smoke on V3 dev :
  - PIN brute-force from same IP across 4+ requests (in separate browser tabs forcing cold-start EF instances) → 4th gets 429.
  - Log in as CASHIER, set CASHIER timeout to 5 min via `/settings/security`, log out + log in, idle 5 min → auto-logout fires.
  - Self-change PIN to `123456` via POS `Change PIN` menu → success toast with weak warning.
  - Reset another user's PIN to `000000` via BO `UserDetailPage` → success banner with weak warning.

---

*Spec écrit 2026-05-17 par lead session 19. Brainstorming via `superpowers:brainstorming` skill, 5 clarifying questions + 1 approach approval + 4 design-section approvals. Roadmap top-priorité refresh (drop items 2-3) included in Wave 4 closeout. Source-of-truth for backlog items : `docs/workplan/backlog-by-module/01-auth-permissions.md` TASK-01-002 / -006 / -008. INDEX with phase-by-phase plan to be written next by `superpowers:writing-plans`.*
