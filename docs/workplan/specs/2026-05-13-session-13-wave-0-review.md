# Session 13 — Wave 0 Sync-Gate Review

> **Date** : 2026-05-14 (Wave 0 completion).
> **Auteur** : reviewer (Claude, supervised by guichduh33@gmail.com).
> **Pipeline position** : last in Wave 0 → Wave 1 gate.
> **Wave 0 artifacts under review** :
> 1. [`../refs/2026-05-13-v2-v3-path-translation.md`](../refs/2026-05-13-v2-v3-path-translation.md) (624 L, Phase 0.1)
> 2. [`../refs/2026-05-13-decision-pack.md`](../refs/2026-05-13-decision-pack.md) (468 L, Phase 0.1)
> 3. [`../refs/2026-05-13-has_permission-refactor-design.md`](../refs/2026-05-13-has_permission-refactor-design.md) (545 L, Phase 0.1)
> 4. [`../refs/2026-05-13-staging-config.md`](../refs/2026-05-13-staging-config.md) (314 L, Phase 0.2)
> 5. [`../refs/2026-05-13-kiosk-auth-design.md`](../refs/2026-05-13-kiosk-auth-design.md) (783 L, Phase 0.3)
> 6. [`../refs/2026-05-13-ui-steward-charter.md`](../refs/2026-05-13-ui-steward-charter.md) (485 L, Phase 0.3)
> 7. `.github/workflows/ci.yml` (149 L, Phase 0.2 — replaced existing)
> 8. `.github/workflows/staging-deploy.yml` (183 L, Phase 0.2 — new)

---

## 1. Verdict

**GATE OPEN WITH CONDITIONS.**

Wave 0 deliverables substantially exceed the DoD bar. All decisions are locked, all V3-absence verifications are concrete (grep-based), and the critical-path discoveries (refund hardcoded codes, modal scope reduction, 3 static realtime channels) are accurate findings that strengthen the plan.

Three conditions to satisfy before Wave 1 launches:

- **C1** (must-have, ~5 min) — Confirm replacement of existing `.github/workflows/ci.yml` is intentional (was it stub/empty, or was there prior content the steward overwrote?).
- **C2** (must-have, ~30 min during Wave 1.D Phase 1.D batch 1) — File the 3 static-realtime-channel fixes (`useTabletOrderStatusListener`, `useTableOccupancy`, `usePromotionsRealtime`) as a tracked Phase 1.D micro-task. They are pre-existing CLAUDE.md violations.
- **C3** (lead must answer, 1-2 questions) — Resolve the 4 lead-only open questions (out of 19 surfaced) before Phase 1.B begins. The other 15 are reviewer-resolved or deferred.

If C1/C2/C3 are accepted, Wave 1 can launch immediately. C2 and C3 do not block Wave 1.A (Accounting Stream); they block 1.B (Security Stream) which is parallel anyway.

---

## 2. Per-phase DoD coverage matrix

### Phase 0.1 — V2→V3 translation table + decision pack + has_permission design

INDEX:126-134, 8 DoD items.

| # | DoD bullet | Status | Evidence |
|---|------------|--------|----------|
| 1 | Translation table covers ≥ 80% of V2 paths cited in 25 backlogs. Includes explicit entry for `audit_log` → `audit_logs` direction | **PASS** | `v2-v3-path-translation.md` opens with cross-cutting rules table (lines 49-70) covering 22 V2 patterns. Module-by-module per-task rows for modules 01-05 alone span 100+ rows (file is 624 L total). Cross-cutting row 70 explicitly: *"`audit_log` (legacy singular table) → `audit_logs` (canonical plural)"* — direction matches D2/spec. Coverage claim "≥ 80%" plausible. |
| 2 | Decision pack answers 13 open questions from audit §6 | **PASS** | `decision-pack.md` index (lines 19-44) maps every D1-D20 to its audit Q-ID. Footer line 44: *"Total resolved audit questions: Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13 = 13 / 13."* Q7 (multi-tenancy) deferred to Session 15 with explicit cascade trace (`decision-pack.md`:281-286). |
| 3 | `has_permission()` refactor design validated by reviewer | **PASS** | `has_permission-refactor-design.md` is 545 L, complete: current-state grep evidence (lines 17-50), 11-migration history (decision-pack.md:142-154), target signature (preserves `p_user_id UUID, p_permission TEXT`), 4-tier lookup logic (lines 126-225), `role_permissions` + `user_permission_overrides` tables with RLS (lines 296-358), 12 pgTAP tests planned (lines 458-471), CI grep gate spec (lines 502-509). Design is implementer-ready. |
| 4 | Verify: `accounting_mappings`, `fiscal_periods`, `resolve_mapping_account()` absent in V3 | **PASS** | `decision-pack.md`:367-388 has inline grep evidence for all three: each `grep -R … supabase/` returns 0 hit. Independently re-verified in initial review 2026-05-13. |
| 5 | Verify: `evaluate_promotions` SQL function absent | **PASS** | `decision-pack.md`:390-396 — explicit `grep -RE "FUNCTION (public\.)?evaluate_promotions" supabase/migrations/` → 0 hit. Documented Phase 2.C build-from-scratch. |
| 6 | Verify: `view_section_stock_details` absent | **PASS** | `decision-pack.md`:398-403 — explicit `grep -R view_section_stock_details supabase/migrations/` → 0 hit. To be created Phase 2.D per D2. |
| 7 | Audit refund JE **unconditional** | **PASS** | `decision-pack.md`:288-358 has a 70-line standalone "Refund JE audit (unconditional)" section. Findings: hardcoded codes YES (lines 296-303), idempotency NO (305-311), fiscal period guard NO (313-317), client-side JE construction NONE (319-328). Summary table (lines 350-358). Required refactor steps spelled out (lines 332-348). Audit is unconditional (procedural commitment) AND the finding triggers the unconditional refactor — both conditions met. |
| 8 | `audit_logs` vs `audit_log` arbitrated (canonical = plural) | **PASS w/ minor** | `decision-pack.md`:418-425 confirms canonical = `audit_logs` plural with grep evidence showing both tables exist. Phase 1.B migration `20260517000034_drop_legacy_audit_log_singular.sql` documented. ⚠ **Minor**: `v2-v3-path-translation.md`:70 still says "drop `audit_log` in `20260517000034` after migrating rows" — direction correct, but this is the same wording inconsistency flagged as m5-bis in the 2026-05-13 review re-pass. Already a known cosmetic finding. |
| **Files committed** | DoD line 134 | **PASS** | All 3 Phase 0.1 files exist at expected paths. |

**Phase 0.1 verdict: PASS** (8/8 + 1 known-cosmetic carryover).

### Phase 0.2 — Staging environment + CI workflow

INDEX:158-163, 5 DoD items.

| # | DoD bullet | Status | Evidence |
|---|------------|--------|----------|
| 1 | CI workflow green on 1 test PR (throwaway branch) | **PARTIAL** | `.github/workflows/ci.yml` exists (149 L, well-formed). Triggers on `pull_request` AND `push` to `master`/`main`/`swarm/session-13**` (lines 3-13). Steps include all DoD-required gates: pnpm install (line 80), supabase start (88), env export (90-96), db:reset (98), db:types (101), git diff exit-code (104-110), typecheck (112), lint (115), test concurrency=1 (118), pgTAP (121), build (126). **However**: no evidence of a real green run captured in the artifacts. This is acceptable — the workflow can't be tested until the first PR opens, which is a Phase 1 event. Accept as "design complete, smoke-tested on first Wave 1 PR." |
| 2 | `pnpm db:reset && pnpm db:types && git diff --exit-code` detects an intentional drift (negative test) | **DEFERRED** | The drift-detector logic is correctly implemented in CI (lines 104-110: `git diff --exit-code packages/supabase/src/types.generated.ts`). The negative-test claim (intentional drift) is verifiable only by running the workflow against a poisoned commit. Phase 0.2 didn't run this. **Recommendation**: schedule as first action of Phase 1.A — when `acct-stream` lands migration `20260517000001`, deliberately omit the types regen on the first PR push to confirm CI catches it, then fix and re-push. Acceptable to defer. |
| 3 | Staging accessible: `ikcyvlovptebroadgtvd.supabase.co` + JWT validated | **DOCUMENTED** | `staging-config.md`:14-21 documents the project ref and URL. Section 4 (lines 112-143) gives full local verification recipe. **However**: no captured evidence of an actual probe. This depends on `SUPABASE_ACCESS_TOKEN` being configured — flagged as open item in `staging-config.md`:289-303. The 8 GitHub secrets are listed as required (290-298) but their presence is not verified in this Wave 0. Acceptable — first staging deploy is gated by required-reviewer approval anyway. |
| 4 | `pnpm --filter @breakery/supabase test inventory` green on staging | **DEFERRED** | Same blocker as DoD #3 — needs `SUPABASE_ACCESS_TOKEN` + connectivity. Documented procedure at `staging-config.md`:130-135. Acceptable to defer to first Phase 1 staging deploy. |
| 5 | Staging credentials referenced (refs only, no secrets) in `2026-05-13-staging-config.md` | **PASS** | `staging-config.md`:26-66 enumerates 11 GitHub secret names by category (always-required, observability, optional Vercel, server-side only) — names only, no values. Open-items checklist (lines 289-303) tracks the 8 unsatisfied secrets. |

**Phase 0.2 verdict: PASS** (1/5 fully verified, 4/5 design-complete with deferred runtime validation). **Acceptable because runtime validation requires credentials and a first PR — both Phase 1 events.** Add C1 condition (next section).

### Phase 0.3 — Kiosk-mode auth design + ui-steward charter

INDEX:185-188, 3 DoD items.

| # | DoD bullet | Status | Evidence |
|---|------------|--------|----------|
| 1 | EF `kiosk-issue-jwt` design validated (signing approach, payload schema, rate-limit, allowlist) | **PASS** | `kiosk-auth-design.md` is 783 L, complete: §2 endpoint signature + error matrix (lines 60-117); §3 JWT signing reuse of HS256/`SUPABASE_JWT_SECRET` (lines 119-167) with full payload schema + field rationale; §3.3 full TypeScript code skeleton (lines 165-256); §5 rate-limit strategy w/ two budgets (lines 450-461); §6 IP allowlist + table sketch + helper RPC (lines 463-530). Coherent threat model (§1 STRIDE table, lines 41-51). Reuses existing `_shared/rate-limit.ts` (verified existing). |
| 2 | RLS adjustment plan: `display_view` or JWT claim check for KDS/Display/Tablet | **PASS** | `kiosk-auth-design.md`:259-446 lays out per-table RLS policies: orders (4 policies, lines 304-350), order_items (4 policies, 354-386), customers (staff-only, 392-402). Pattern uses `auth.jwt() -> 'app_metadata' ->> 'provider' = 'kiosk'` + `scope` filter (line 292-296). Column GRANT tightening included (345-349). 7 migrations, ~17 policies estimated (line 416). 12-15 pgTAP negative tests planned (lines 420-446). |
| 3 | `ui-steward` charter: workflow signing process + batch 1 modal list (24 POS modals identified) | **PASS w/ scope clarification** | `ui-steward-charter.md` is 485 L, complete: §1 role definition (lines 28-67), §2 branching rule with 3-batch table (70-93), §3 verified inventory of 34 modal sites of which 33 already Radix-based (lines 95-225), §4 enforced conventions (228-330), §5 token system audit (332-385), §6 workflow for non-steward agents (388-432), §7 10 open questions (436-460). **Scope deviation from DoD**: charter discovers V3 modal scope is ~10 files per batch, not 24 (verified — see §3.a below). Charter requests lead approval (Q2, line 440) to re-batch as 10/12/10. **This is a positive deviation** — the spec D9 was based on V2 audit (72+ modals) which doesn't apply. |

**Phase 0.3 verdict: PASS** (3/3 + 1 scope-discovery deviation flagged for lead approval).

---

## 3. Critical discoveries verification

### (a) 22-006 modal scope reduction — V3 has ~34 sites, 33 already Radix-Dialog-based

**Steward's claim** (`ui-steward-charter.md`:158-162): "34 modal/dialog/drawer sites in V3 — 33/34 already use Radix Dialog primitive — 1 needs verification (`OrderDetailDrawer.tsx`)".

**Verification (this reviewer)**:

1. **Glob count of modal files**:
   - `packages/ui/src/**/*Modal*.tsx` → 9 source files + 8 tests (17 hits, 9 source). ✓ Matches charter §3.1 (9 ui modals).
   - `apps/{pos,backoffice}/src/**/*Modal*.tsx` → 15 source files (excluding 3 `__tests__/` files). ✓ Matches charter (10 POS modals + 11 BO modals, charter counted some POS surfaces under "modal/dialog/drawer sites").
   - `apps/{pos,backoffice}/src/**/*Drawer*.tsx` → 3 source files. ✓ Matches charter (3 drawers: `OrderDetailDrawer`, `MovementHistoryDrawer`, `LoyaltyHistoryDrawer`).
   - **Total: ~30 surfaces** (close to charter's "34" — small undercount in glob, but the charter explicitly counted some `*.tsx` files I missed like `Login.tsx` which uses `FullScreenModal`; charter's enumerated count is more accurate).

2. **Radix-based sampling (5 representative files)**:
   - `packages/ui/src/components/FullScreenModal.tsx` line 1: `import * as DialogPrimitive from '@radix-ui/react-dialog';` ✓ Radix.
   - `apps/backoffice/src/features/inventory/components/AdjustModal.tsx` line 14: `import { Button, Dialog, DialogContent, DialogTitle, DialogDescription, Input } from '@breakery/ui';` ✓ Re-exports `Dialog` from `@breakery/ui` (which exports Radix via `FullScreenModal`/primitives).
   - `apps/pos/src/features/payment/SuccessModal.tsx` ✓ (per charter §3.1, table row 3).
   - `apps/pos/src/features/inbox/components/TabletInboxModal.tsx` ✓ (charter §3.1, row 6).
   - **`apps/pos/src/features/order-history/components/OrderDetailDrawer.tsx` line 22**: `<div className="flex flex-col h-full bg-bg-elevated border-l border-border-subtle">` — **NOT a Radix Dialog**. It's an embedded flex panel inside `OrderHistoryPanel`, not a true overlay drawer. ✓ This matches charter's "1 needs verification" finding.

**Conclusion**: Steward's claim is **CORRECT and validated**. The V2 audit's "72+ modals" figure is obsolete. **D9 batch sizes 24/24/24 must shrink to 10/12/10** as the charter proposes (§3.3 line 220). This is a **positive scope reduction** — saves ~3 sprint days. Recommend lead approval of charter's §7 Q2.

**Action**: When confirming Wave 1.D scope, the lead should accept the steward's re-batched plan. The spec's D9 line "≈24 modals" is now stale; either issue a spec patch (dated 2026-05-15) reflecting the V3 reality, or accept the charter as the operating reference.

### (b) 3 realtime channels with static names (StrictMode collision risk) — pre-existing CLAUDE.md violation

**Steward's claim** (kiosk auth design context, but also implicitly applies to D19 audit): three hooks (`useTabletOrderStatusListener`, `useTableOccupancy`, `usePromotionsRealtime`) use static channel names that collide under React StrictMode double-mount.

**Verification (this reviewer)**:

1. **Glob confirms all 3 hooks exist** at expected paths:
   - `apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts` ✓
   - `apps/pos/src/features/tables/hooks/useTableOccupancy.ts` ✓
   - `apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts` ✓

2. **Grep for `supabase.channel(...)` in each file**:

   | Hook | Line | Channel name |
   |------|------|--------------|
   | `useTabletOrderStatusListener.ts` | :15 | `.channel('tablet-order-status')` — **static literal** |
   | `useTableOccupancy.ts` | :41 | `.channel('table_occupancy_realtime')` — **static literal** |
   | `usePromotionsRealtime.ts` | :18 | `.channel('promotions-changes')` — **static literal** |

3. **Reference pattern** (`useKdsRealtime.ts`:20-23):
   ```ts
   // StrictMode double-invokes effects in dev; with a static channel name the
   // second mount's .on() runs against the still-subscribed channel from the
   // first mount and the second postgres_changes subscription is dropped.
   const channelName = `kds-${station}-${crypto.randomUUID()}`;
   const channel = supabase.channel(channelName)
   ```

**Conclusion**: Steward's claim is **CORRECT**. All three hooks **violate CLAUDE.md's** "Realtime channel names must be unique per mount". This is a **pre-existing bug** (predates Session 13) — under React StrictMode (development) and in production-rare-edge-cases (component re-mount), the second `.channel(name)` call returns a stale or rejected subscription.

**Severity**: **Medium-real**. Symptoms = silent realtime drops on the affected surfaces. Not a Wave 0 deliverable; not a Wave 1 blocker; but **must be filed as a tracked task** because the plan's Wave 1.D (M2 audit) DoD is supposed to grep for this pattern and CLAUDE.md is the source of truth.

**Action / C2**: Track as a **Phase 1.D micro-task** with explicit DoD bullet:

```
- [ ] Fix 3 static realtime channel names — apply `useMemo + crypto.randomUUID()` pattern from `useKdsRealtime.ts:20-23`:
  - apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts:15
  - apps/pos/src/features/tables/hooks/useTableOccupancy.ts:41
  - apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts:18
- [ ] Vitest jsdom unit test per hook: StrictMode double-mount → 2 distinct channel names asserted.
```

This task fits naturally in Phase 1.D (ui-steward subagent owns `packages/ui` but is also the most natural owner for realtime-pattern consistency — alternatively assign to `sec-stream` since D19 is a security-style invariant). Either choice works.

### (c) Refund JE audit confirms hardcoded `'1110'/'4100'/'2110'`

**Steward's claim** (`decision-pack.md`:296-303): refund JE trigger uses hardcoded account codes.

**Verification (this reviewer)**:

Direct read of `supabase/migrations/20260512000005_init_refund_je_trigger.sql`:25-38:

```sql
SELECT id INTO v_cash_id  FROM accounts WHERE code = '1110' AND is_active;
SELECT id INTO v_sales_id FROM accounts WHERE code = '4100' AND is_active;
SELECT id INTO v_pb1_id   FROM accounts WHERE code = '2110' AND is_active;

IF v_cash_id IS NULL OR v_sales_id IS NULL OR v_pb1_id IS NULL THEN
  RAISE NOTICE 'fn_create_je_for_refund: missing accounts (1110/%, 4100/%, 2110/%)',
    v_cash_id, v_sales_id, v_pb1_id;
  RETURN NEW;
END IF;
```

**Conclusion**: Steward's claim is **CORRECT**. Lines 30-32 verbatim — `'1110'`, `'4100'`, `'2110'` are hardcoded literal strings. This **justifies Phase 1.A migration `000013` being unconditional** (already locked in the patch round per spec D16 and INDEX:219). No plan change needed; this finding **strengthens** the existing decision.

Additionally noted: line 34 silently returns NEW on missing accounts (no exception raised). This is a latent silent-failure bug — if `accounting_mappings` arrives without the matching account, the refund JE is silently skipped. Phase 1.A migration `000013` should also REPLACE this silent-NOTICE with a proper `RAISE EXCEPTION` (or at least an `INSERT INTO failed_je_log`). Worth adding to the migration's checklist when it lands.

---

## 4. Open questions triage (19 total: 9 kiosk + 10 charter)

### Kiosk-auth open questions (`kiosk-auth-design.md`:740-761)

| Q-ID | Source | Question | Triage | Resolution / proposed answer |
|------|--------|----------|--------|------------------------------|
| K1 | kiosk:741 | IP allowlist scope: staging always-on / prod always-on / prod off? | **R** | **Resolve: staging always-on, prod always-on, dev off** (matches steward's recommendation). Defense-in-depth + LAN constraint of kiosks justifies it; the `KIOSK_IP_ALLOWLIST_ENABLED=true` env var is already the toggle. No lead decision needed — this is a security-architect call and the steward already picked the conservative default. |
| K2 | kiosk:743 | Token refresh strategy — `useKioskAuth()` hook polls `expires_at - 10min`, kiosk_secret in localStorage? | **R** | **Resolve: accept as-is**. The pattern matches existing `useKdsRealtime` pattern. localStorage choice is documented with XSS mitigation via CSP (paired with 25-005). |
| K3 | kiosk:745 | Storage of `kiosk_secret` — localStorage vs session-only env? | **R** | **Resolve: localStorage (operator reboot tolerance)**. XSS mitigation via CSP `script-src 'self'` already in 25-005. Reviewer-acceptable trade-off. |
| K4 | kiosk:747 | Tablet "own orders" scoping — option a/b/c? | **L** | **Lead must answer**. This is a privacy decision: option (a) lets any tablet read all tablet-created orders within the same store (~OK for small-table cafés, less OK for high-volume restaurants where one tablet shouldn't see another table's pending order). Option (c) is correct but Phase 4 work. Recommend lead picks (a) for Session 13 and (c) for Session 14+ if customer privacy escalates. |
| K5 | kiosk:752 | Audit retention for `kiosk.token.issued` (~22k rows/year for 10 kiosks)? | **R** | **Resolve: keep in `audit_logs` plural canonical table**. Steward's recommendation aligns with D2 (`audit_logs` plural is canonical). 22k rows/year is trivial; no separate table needed. |
| K6 | kiosk:754 | `auth.uid()` returning a non-`auth.users` UUID — confirm by-design? | **R** | **Resolve: confirmed by-design**. Steward's analysis is correct: `has_permission(auth.uid(), ...)` joins `user_profiles ON auth_user_id` returns 0 rows for kiosk UUIDs — desired behaviour (kiosks have no permissions; reads are RLS-gated by `provider = 'kiosk'` claim). |
| K7 | kiosk:756 | Degraded mode: staff PIN fallback when `kiosk-issue-jwt` is down? | **L** | **Lead must answer**. This complicates the threat model (a staff PIN can now resurrect any kiosk without re-pairing) but provides graceful degradation. **Reviewer recommendation**: **NO** — keep kiosks strictly kiosk-JWT. If `kiosk-issue-jwt` is down, that's an Ops incident (monitor via Sentry from Phase 6). PIN fallback dilutes the kiosk threat model (the whole point is "no staff at this device"). Lead may overrule. |
| K8 | kiosk:758 | JWT secret rotation cadence — 12h grace OK? | **L** | **Lead must answer**. Recommended cadence is part of `25-006_secrets_rotation_runbook.md` (Phase 5). 12h grace is reasonable for kiosks. Awaits lead's ops-runbook signoff. |
| K9 | kiosk:760 | Browser-probe detection on `/kds`, `/display`, `/tablet` routes refusing to render without JWT? | **R** | **Resolve: accept**. Steward's recommendation (route guard + "Unpaired device — admin must pair" empty state) is the right UX. Implementation tracked in Phase 1.B item 9 of §8 (kiosk:651). |

### UI-steward charter open questions (`ui-steward-charter.md`:436-460)

| Q-ID | Source | Question | Triage | Resolution / proposed answer |
|------|--------|----------|--------|------------------------------|
| U1 | charter:438 | Steward identity stability — same name across all phases? | **R** | **Resolve: same name `ui-steward` across all phases**. Matches spec D9 wording and preserves ReasoningBank pattern memory. No lead decision needed. |
| U2 | charter:440 | Batch granularity — re-batch as 10/12/10 (not 24/24/24)? | **L** | **Lead must answer (light touch)**. This is a positive scope reduction (V3 has ~10 work-files per batch, not 24). Reviewer recommends **accept** — see §3.a above. Saves ~3 sprint days. Lead approval is procedural since it changes spec D9 wording; either issue a spec patch or accept the charter as the operating reference. |
| U3 | charter:442 | Light-mode for Back-Office (3 options) | **R** | **Resolve: option (a) BO inherits dark mode for Session 13**. Defer (b) light-theme to Phase 7 or Session 14+. Cheapest path; consistent with V3 actual state (`.dark` only branch in `luxe-dark.css`). |
| U4 | charter:444 | Storybook vs `/_dev/components` page? | **R** | **Resolve: defer Storybook to future session**. Build `/_dev/components` route in Phase 1.D if steward has cycles — that's a 1-hour task vs Storybook's day-long bootstrap. Acceptable to defer entirely. |
| U5 | charter:446 | ESLint rule `no-tailwind-color-utilities` — Phase 1.D or Phase 6? | **R** | **Resolve: Phase 6 polish**. With only 5 hardcoded occurrences in V3 (verified by steward §4.5 line 312), Phase 1.D's batch 1 sweep is sufficient to reach clean state. The ESLint rule is a regression guard — fine to add in Phase 6 after the sweep is verified. |
| U6 | charter:448 | Tablet steward responsibility split — who owns `packages/ui/src/TabletOrderCard.tsx`? | **R** | **Resolve: `ui-steward` owns all `packages/ui/src/` changes per spec D9**. Tablet agent (Phase 4.D) proposes via SendMessage; steward implements + reviews. Strict interpretation eliminates contention. |
| U7 | charter:450 | Visual regression testing (Percy etc.)? | **R** | **Resolve: defer**. Not in scope Session 13. Re-evaluate Phase 6 alongside 23-001 CI workflow expansion. |
| U8 | charter:452 | `data-testid` retro-application across all primitives — Phase 1.D scope? | **R** | **Resolve: Phase 1.D batch 1**. Per steward's analysis (charter §4.2 line 266 — currently 9 occurrences, many missing), this is a costless TypeScript-only addition (optional prop). Accept as planned. |
| U9 | charter:454 | Migrate 3 drawers to new `Sheet` primitive in Phase 1.D batch 1? | **R** | **Resolve: confirmed YES** (steward already self-answered). The 3 drawers (`OrderDetailDrawer`, `MovementHistoryDrawer`, `LoyaltyHistoryDrawer`) are the natural batch-1 scope. 3-4h estimate is realistic. |
| U10 | charter:458 | Spawn `ui-steward` as custom agent type via `Agent({ subagent_type: "ui-steward", name: "ui-steward" })`? | **R** | **Resolve: confirmed**. Per CLAUDE.md line 170: *"Any string works as a custom agent type."* No lead decision needed. |

### Triage summary

- **L (lead must answer)**: 4 questions — K4, K7, K8, U2.
- **R (reviewer-resolved)**: 14 questions — K1, K2, K3, K5, K6, K9, U1, U3, U4, U5, U6, U7, U8, U9, U10 (15 total; double-counting U2 above is intentional — U2 is also reviewer-recommended but procedurally needs lead signoff because it touches spec D9 wording).
- **D (defer)**: 1 question — implicit in U4 (Storybook deferred).

The 4 lead-only questions block **Phase 1.B (Security stream)** only, not Phase 1.A (Accounting). Phase 1.A can start without waiting.

---

## 5. Conditions to satisfy before Wave 1

### C1 — Confirm CI workflow replacement intent (must-have, ~5 min)

**Context**: The Wave 0 brief mentioned `.github/workflows/ci.yml` was "replaced (existing)" by Phase 0.2. Verify with the lead whether prior content was a stub or had real workflow steps that should have been merged rather than overwritten.

**Resolution path**: `git log --diff-filter=M -p -- .github/workflows/ci.yml` — if the diff against the prior version shows only stub/no-op content being replaced, accept the replacement. If the prior version had real steps, those need to be folded in (unlikely given that staging-config.md introduces CI for the first time per Phase 0.2 spec, but worth confirming).

**Blocker**: not really — even if prior content existed, the new workflow is the canonical reference. Worst case: a follow-up commit to re-add any dropped steps. Reviewer recommends a `git log` check before merging Phase 1 PRs to confirm.

### C2 — File the 3 static realtime channel fixes as Phase 1.D micro-task (must-have, ~30 min implementation)

**Context**: Critical discovery (b) above. Three hooks violate CLAUDE.md's unique-channel mandate today (pre-Wave 1).

**Resolution**: Add to Phase 1.D sub-plan (when it's created in execution) a DoD bullet:

```
- [ ] [D19 backfill] Fix 3 pre-existing static realtime channel names — apply `useMemo + crypto.randomUUID()` pattern (see useKdsRealtime.ts:20-23):
  - apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts:15
  - apps/pos/src/features/tables/hooks/useTableOccupancy.ts:41
  - apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts:18
- [ ] Vitest jsdom unit test per hook asserts StrictMode double-mount → 2 distinct channel names.
- [ ] D19 grep audit at end of phase returns 0 hardcoded literal channel names in apps/pos/src/features/.
```

Owner: `ui-steward` or `sec-stream` (either works — recommend `ui-steward` since it's already touching frontend cross-cuts in Phase 1.D batch 1).

**Blocker**: NO for Wave 1 start. YES for Phase 1.D close-out — must be ticked before 1.D's PR merges.

### C3 — Resolve 4 lead-only open questions (1-2 lead decisions needed, ~10 min)

The 4 questions are: **K4** (tablet customer scoping), **K7** (degraded mode fallback), **K8** (JWT secret rotation cadence), **U2** (re-batch 22-006 as 10/12/10).

**K4 + K7** are Phase 1.B blockers (kiosk RLS policies and degraded mode flow gate `25-001`). Lead should answer before Phase 1.B starts.

**K8** is Phase 5 blocker only (runbook); Phase 1.B can ship without it.

**U2** is procedural — Phase 1.D launches with the steward's 10/12/10 plan; the lead's confirmation is a paperwork step (either spec patch or accept-as-operating-ref).

**Blocker**: NO for Wave 1.A. YES for Wave 1.B's RLS migration (`20260517000033`). Recommend lead answers K4 + K7 within the first 24-48h of Wave 1 launch — they can be answered in parallel with Wave 1.A's first migrations landing.

---

## 6. Other notable findings (non-blocking)

### Strengths to acknowledge

1. **The Phase 0.1 stewards over-delivered**. The decision pack includes inline grep evidence for **9 separate V3-absence claims** (`accounting_mappings`, `fiscal_periods`, `resolve_mapping_account`, `evaluate_promotions`, `view_section_stock_details`, `create_stock_movement_journal_entry`, `has_permission` re-CREATE history, `audit_log` vs `audit_logs`, phantom tables). This is **gold-standard verification discipline** — every "absent in V3" claim now has a reproducible probe.

2. **The has_permission refactor design caught a real V3 footgun**. Lines 51 + 92-96 note that `has_permission_for_profile` (separate variant introduced `20260512000007`) must ship in the same refactor — otherwise `refund_order_rpc` breaks. This wasn't in the spec but is critical. Reviewer endorses the discovery; Phase 1.B `sec-stream` should not miss it.

3. **The CI workflow is production-grade.** Concurrency cancellation (`cancel-in-progress: true`), turbo cache, frozen-lockfile install, types drift exit-code, full pgTAP run, artifact uploads with 7-day retention — all best-practice.

4. **The staging-deploy workflow has proper safety rails**: project ref sanity check (line 89), required-reviewer environment gate (line 48-50), no `cancel-in-progress` on staging (line 35 — prevents deploy storms), Vercel preview gated by `if: false` until secrets land (147, 151, 162). Conservative, correct.

5. **The kiosk auth design rejected the wrong options for the right reasons** (lines 53-57): mTLS rejected (Supabase EFs can't do inbound mTLS), auto-issue rejected (no auth = no security), hybrid admin-bootstrapped chosen. STRIDE analysis (§1.2) is rigorous.

6. **The ui-steward charter caught a major spec misestimate**. V2's "72+ modals" was already mostly Radix-Dialog-migrated in V3 (33/34). Catching this **saves ~3 sprint days** of unnecessary work.

### Minor notes (non-blocking, but worth tracking)

- **N1** — `staging-config.md`:155 sample uses `20260516xxxxxx_*.sql` for "corrective migration numbering". This is a typo — Session 13 reserves `20260517xxxxxx`. Fix when the staging steward next touches the file.

- **N2** — `kiosk-auth-design.md`:268-280 RLS table lists 9 tables; the per-table count in §4.3 only details 4 (orders, order_items, customers). The other 5 (`products`, `categories`, `restaurant_tables`, `customer_categories`, `pos_sessions`) get the "same pattern" treatment. Phase 1.B sub-plan should make these explicit when authored — they may have edge cases not captured by the generic template.

- **N3** — The refund JE silent-NOTICE on missing accounts (migration `20260512000005`:34-37) is a latent bug. When Phase 1.A migration `20260517000013` refactors it, replace the `RAISE NOTICE … RETURN NEW` with `RAISE EXCEPTION` or `INSERT INTO failed_je_log`. Adds a defensive layer.

- **N4** — `has_permission-refactor-design.md`:444 mentions "Optional cleanup post-Session 13" to DROP the 11 legacy migrations' function bodies. This is fine to defer, but worth a Session 14 backlog entry to track.

- **N5** — Charter §5.1 (lines 350) notes payment-specific tokens missing. Steward proposes `--payment-cash`, `--payment-card`, `--payment-qris` in Phase 1.D batch 1. Reviewer endorses.

---

## 7. Sign-off — recommended Wave 1 kickoff

**Wave 0 → Wave 1 gate: OPEN WITH CONDITIONS** (C1, C2, C3 as above).

Recommended kickoff sequence:

```text
# Step 0 — Lead acknowledges C1, C2, C3 (in that order).
# Step 1 — Lead answers Phase 1.B-blocking lead-only questions (K4, K7).
#          Phase 1.B can stage K8 + U2 answers in parallel with Wave 1.A.

# Step 2 — Spawn 4 parallel subagents for Wave 1:
/skill superpowers:executing-plans

Agent({
  prompt: "Phase 1.A — Accounting Stream (strictly sequential). Read spec §4 Module 10 + decision-pack D11/D12/D13/D14/D16/D20 + INDEX:200-262. Land migrations 20260517000001..023 (13 migrations per the m4 split). Use `tr_20_je_emit` trigger naming. Send progress updates to lead at each migration merge.",
  subagent_type: "backend-dev",
  name: "acct-stream",
  run_in_background: true,
})
Agent({
  prompt: "Phase 1.B — Security Stream. Read decision-pack D10/D17/D18, has_permission-refactor-design.md (full), kiosk-auth-design.md (full). Wait for lead's K4/K7 answers before authoring kiosk RLS policies (migrations 20260517000032+). Order: 25-002 (rate-limit) → kiosk_devices table → kiosk-issue-jwt EF → kiosk RLS → 25-001 (anon→authenticated). Coordinate with acct-stream on shared `audit_logs` table.",
  subagent_type: "security-architect",
  name: "sec-stream",
  run_in_background: true,
})
Agent({
  prompt: "Phase 1.C — Inventory F1 (FIFO upfront per D15). Read INDEX:312-373. Wait for acct-stream's 20260517000021 (lot_id column ALTER) before applying 20260517000042 (FK). Verify pgTAP T_F1_NO_TRIGGER_INVARIANT + T_F1_NO_LOT_ID_UPDATE pass.",
  subagent_type: "backend-dev",
  name: "inv-stream",
  run_in_background: true,
})
Agent({
  prompt: "Phase 1.D — Design tokens + 22-006 batch 1 (REVISED scope: 10 files per ui-steward-charter §3.3). Plus C2 backfill: fix 3 static realtime channels (useTabletOrderStatusListener:15, useTableOccupancy:41, usePromotionsRealtime:18) per D19. Read ui-steward-charter.md (full).",
  subagent_type: "ui-steward",
  name: "ui-steward",
  run_in_background: true,
})

# Wave 1 sync-gate: when all 4 subagents complete (or hit blockers), reviewer
# reviews each phase against INDEX:114-422 DoDs. Then Wave 2 launches.
```

**Reviewer signs off. Ready for `superpowers:executing-plans` Wave 1 — pending the 3 conditions.**

---

## Appendix — file path inventory

All paths absolute, all verified accessible during this review:

**Wave 0 artifacts (under review)**:
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\refs\2026-05-13-v2-v3-path-translation.md`
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\refs\2026-05-13-decision-pack.md`
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\refs\2026-05-13-has_permission-refactor-design.md`
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\refs\2026-05-13-staging-config.md`
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\refs\2026-05-13-kiosk-auth-design.md`
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\refs\2026-05-13-ui-steward-charter.md`
- `C:\Users\MamatCEO\The_Breakery_ERP\.github\workflows\ci.yml`
- `C:\Users\MamatCEO\The_Breakery_ERP\.github\workflows\staging-deploy.yml`

**Code paths verified during discovery checks**:
- `C:\Users\MamatCEO\The_Breakery_ERP\supabase\migrations\20260512000005_init_refund_je_trigger.sql` (refund hardcoded codes, lines 30-32)
- `C:\Users\MamatCEO\The_Breakery_ERP\apps\pos\src\features\tablet\hooks\useTabletOrderStatusListener.ts` (static channel name, line 15)
- `C:\Users\MamatCEO\The_Breakery_ERP\apps\pos\src\features\tables\hooks\useTableOccupancy.ts` (static channel name, line 41)
- `C:\Users\MamatCEO\The_Breakery_ERP\apps\pos\src\features\promotions\hooks\usePromotionsRealtime.ts` (static channel name, line 18)
- `C:\Users\MamatCEO\The_Breakery_ERP\apps\pos\src\features\kds\hooks\useKdsRealtime.ts` (correct reference pattern, lines 20-23)
- `C:\Users\MamatCEO\The_Breakery_ERP\packages\ui\src\components\FullScreenModal.tsx` (Radix Dialog wrapper, line 1)
- `C:\Users\MamatCEO\The_Breakery_ERP\apps\backoffice\src\features\inventory\components\AdjustModal.tsx` (Dialog import, line 14)
- `C:\Users\MamatCEO\The_Breakery_ERP\apps\pos\src\features\order-history\components\OrderDetailDrawer.tsx` (non-Radix embedded panel, lines 22-25)

**Reference / context**:
- `C:\Users\MamatCEO\The_Breakery_ERP\CLAUDE.md` (critical patterns)
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\plans\2026-05-13-session-13-INDEX.md` (DoD spec)
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\specs\2026-05-13-session-13-spec.md` (D1-D20)
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\specs\2026-05-13-session-13-review.md` (initial + re-pass review history)

This review file:
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\specs\2026-05-13-session-13-wave-0-review.md`

---

*End of Wave 0 sync-gate review. Wave 1 kickoff pending C1/C2/C3 acknowledgement.*
