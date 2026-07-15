# POS Refund Modal C2 Timeout Investigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Investigation-plan note:** This is an *investigation* plan, not a feature build. The TDD loop is inverted — the "failing test" already exists (`refund-modal-pin-header.smoke.test.tsx` C2 times out). The plan structure is **reproduce → isolate → decide (fix vs tracked-skip)**. **No blind fix.** Each diagnostic hypothesis is a step with an exact command and the expected output under each branch. The decision table in Task 9 is binding: the path you take depends on the verdict reached in Tasks 4–8.

**Goal:** Decide the verdict on the 15s timeout of case **C2** in `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx` — is it a **regression** (must be fixed before any refund/order-history merge), a **pre-existing baseline failure** (document + tracked `it.skip`), or a **latent idempotency bug** (fix the modal + escalate) — and apply the corresponding action so the POS refund suite no longer carries a silent timeout. Closes the audit P0 finding "test C2 du refund modal timeout".

**Architecture:** Pure front-end investigation against a Vitest + jsdom render of `RefundOrderModal` driven through a `<Harness>`; all HTTP/Supabase is mocked in the test (so C2 is NOT env-gated like the documented `VITE_SUPABASE_URL` baseline). The prime suspect is the Radix Dialog Portal close→reopen unmount/remount cycle under jsdom: `FullScreenModal` mounts `DialogPrimitive.Portal`/`Content` and the `role="dialog"` div lives inside it, so the test's `waitFor` on portal removal/remount is the most likely place the 15s timeout fires. No DB, no Edge Function, no migration is touched.

**Tech Stack:** Vitest, `@testing-library/react` (`render`/`screen`/`fireEvent`/`waitFor`/`within`/`act`/`cleanup`), jsdom, `@radix-ui/react-dialog` (via `@breakery/ui` `FullScreenModal`), `@tanstack/react-query` (QueryClient wrapper), pnpm + turbo. No types regen, no MCP, no cloud DB.

**Spec:** [`../specs/2026-06-01-pos-refund-test-investigation-spec.md`](../../specs/archive/2026-06-01-pos-refund-test-investigation-spec.md)

**Branch:** `fix/pos-refund-modal-test` (create from `master` @ `70c5cf1`). Commit the spec + this plan first; commit code/test changes only if the verdict (Task 9) requires them.

---

## Verified code facts (read before planning — `file:line` confirmed 2026-06-01)

These anchor every step below. An implementer with zero context should treat this section as ground truth and re-verify only if a step says so.

**Test** `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`:
- Imports `render, screen, fireEvent, cleanup, act, waitFor, within` (`:19`) + `renderHook` (`:20`).
- Mocks `sonner` (`:26-29`) and `@/lib/supabase` with `auth.getSession` + `supabaseUrl: 'http://localhost:54321'` (`:31-40`). **C2 is therefore NOT env-gated** the way the BO `VITE_SUPABASE_URL Required` baseline (DEV-S25-2.A-02) is.
- Helper `driveModalToSubmit(pin)` (`:86-109`): clicks line checkbox `Refund line Americano` (`:88`), fills `Refund amount for cash` (`:91-93`), fills reason placeholder `spilled latte` (`:96-98`), clicks each PIN digit inside the `group` named `Numpad` (`:102-105`), clicks `Verify` (`:108`).
- **C1** `it(...)` (`:126-185`): hook-level — asserts `x-manager-pin` + `x-idempotency-key` headers, `Authorization: Bearer tok`, `Content-Type: application/json`, body has no `manager_pin`/`managerPin`. Reputedly PASSES.
- **C2** `it(...)` (`:196-282`): `<Harness>` (`:209-225`) renders a `toggle` button (`:213`) + `<RefundOrderModal open onClose order onSubmit isPending={false}>`. Flow:
  1. `waitFor` checkbox lands (`:231-233`).
  2. 1st submit fails → `firstUuid = captured[0].idempotencyKey` (`:238`), matches `UUID_V4_RE` (`:239`).
  3. Re-enter PIN `222222` (`:244-247`) + `Verify` (`:248`) → `retryUuid` (`:251`) `expect(retryUuid).toBe(firstUuid)` sticky (`:252`).
  4. **Close**: `fireEvent.click(screen.getByRole('button', { name: /^Close$/i }))` (`:258`).
  5. `waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull())` — dialog removal (`:261-263`).
  6. Reopen: `fireEvent.click(screen.getByTestId('toggle'))` (`:266`).
  7. `waitFor` checkbox remounts (`:269-271`).
  8. `shouldFail = false` (`:275`) → `driveModalToSubmit('333333')` (`:276`) → `waitFor` 3rd call (`:278`), `reopenUuid` matches v4 (`:280`) and `!== firstUuid` (`:281`).

**Modal** `apps/pos/src/features/order-history/components/RefundOrderModal.tsx`:
- `idempotencyKeyRef = useRef<string>(crypto.randomUUID())` (`:51`) — sticky per render.
- `handleClose()` (`:120-128`): `setSelectedQty(new Map())` + `setTenderValues([])` + `setReason('')` + `setPinKey(k+1)` (`:124`) + **`idempotencyKeyRef.current = crypto.randomUUID()`** (`:126`) + `onClose()` (`:127`). → rotation on close ✅.
- `handlePinSubmit(pin)` (`:130-152`): on `!canSubmit` → toast + `setPinKey(k+1)` + return (`:131-139`); on success path `await onSubmit({..., idempotencyKey: idempotencyKeyRef.current})` (`:141-147`) then `handleClose()` (`:148`); on `catch` → `setPinKey(k+1)` only (`:150`), **no rotation** → sticky retry ✅.
- Root render `<FullScreenModal open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>` (`:164`).
- `role="dialog"` div is the modal's own `<div>` (`:165-169`), child of `DialogPrimitive.Content`.
- **Single** Close control: `<button type="button" aria-label="Close" onClick={handleClose}>` X icon (`:175-177`).
- Footer has `<Button variant="secondary" onClick={handleClose}>Cancel</Button>` (`:258`) — label `Cancel`, NOT `Close`.

**`FullScreenModal`** `packages/ui/src/components/FullScreenModal.tsx`:
- `DialogPrimitive.Root` (`:37`) → `Portal` (`:38`) → `Overlay` (`:39`) + `Content` (`:42`) → `Title` SR-only (`:53`) + `children` (`:59`).
- **No `DialogPrimitive.Close` is injected inside the modal** — `FullScreenModalClose = DialogPrimitive.Close` is exported (`:66`) but unused by `RefundOrderModal`. The modal closes via its own X button / footer Cancel / `onOpenChange`. When `open=false`, Radix unmounts the entire `Portal` subtree (including the `role="dialog"` div). **The close→reopen Portal unmount/remount under jsdom is the prime timeout suspect.**

> **Spec imprecision correction (carry as DEV-RT-W2-01):** The spec attributes the timeout to a possible "Close" label ambiguity (spec `:50`, test comment `:255-257`). Code reading shows exactly one `aria-label="Close"` button (the X, `:175`); the test comment about "multiple Cancel buttons" refers to **Cancel** controls, not Close. If there were >1 Close, `getByRole` would **throw** (not time out). Since the symptom is a 15s timeout (not a throw), the Close selector is a **false suspect** — confirmed in Task 6 by `getAllByRole`. Prime suspect remains the Radix Portal close→reopen cycle (`waitFor` `:261-263` / `:269-271`).

---

## File map

| File | Role in this investigation | Touched when |
|---|---|---|
| `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx` | The failing test (C2). Diagnostic instrumentation (temporary), then either the deterministic fix OR the tracked `it.skip`. | Tasks 2, 3 (temp), 9 (final) |
| `apps/pos/src/features/order-history/components/RefundOrderModal.tsx` | Read-only unless Task 8 reveals a real latent bug (low probability). | Task 8 (read), 9c (only if latent bug) |
| `packages/ui/src/components/FullScreenModal.tsx` | Read-only — confirms no `DialogPrimitive.Close` injected, Portal lifecycle. | Task 7 (read) |
| `pnpm-lock.yaml` / `apps/pos/package.json` / `packages/ui/package.json` | Read-only — dependency-bump diff (Radix/testing-library/jsdom/vitest) since S25. | Task 5 (read) |
| `docs/workplan/plans/2026-06-01-pos-refund-test-investigation-INDEX.md` | Closeout INDEX (created). | Task 10 |
| `CLAUDE.md` | Baseline / follow-up entry (Active Workplan §follow-ups + baseline note). | Task 11 |

---

## Task 1: Branch + context anchor

**Files:**
- Read: `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`
- Read: `apps/pos/src/features/order-history/components/RefundOrderModal.tsx`
- Read: `packages/ui/src/components/FullScreenModal.tsx`
- Commit: spec + this plan

- [ ] **Step 1.1: Create the branch from `master` @ `70c5cf1`**

```bash
git checkout master
git pull --ff-only
git checkout -b fix/pos-refund-modal-test
git rev-parse --short HEAD
```

Expected: prints `70c5cf1` (or the current `master` head if it has advanced — note the actual SHA in the INDEX). New branch `fix/pos-refund-modal-test` checked out.

- [ ] **Step 1.2: Re-anchor the `file:line` facts**

Re-read the three files above and confirm each anchor in "Verified code facts" still matches (the codebase may have drifted). If any line number moved, update your working notes — the diagnostic steps below reference symptoms (timeout / null query), not raw line numbers, so they remain valid.

Run: `git diff --stat master -- apps/pos/src/features/order-history apps/pos/src/features/order-history/components packages/ui/src/components/FullScreenModal.tsx`
Expected: empty (no diff yet — branch just created).

- [ ] **Step 1.3: Commit spec + plan**

```bash
git add docs/workplan/specs/2026-06-01-pos-refund-test-investigation-spec.md docs/workplan/plans/2026-06-01-pos-refund-test-investigation-plan.md
git commit -m "docs(pos): refund modal C2 investigation — spec + plan"
```

Expected: one commit created; `git status` clean.

---

## Task 2: Reproduce the failure (whole file)

**Files:**
- Run-only: `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`

- [ ] **Step 2.1: Run the single test file once**

Run: `pnpm --filter @breakery/app-pos test refund-modal-pin-header`
Expected: **C1 PASS**, **C2 FAIL with a timeout** — Vitest output contains `Test timed out in 5000ms.` (default) or the value of the test's configured timeout (~15s per the audit), and a `waitFor` callback that "Timed out" pointing at one of the `waitFor` blocks in C2 (`:231-233`, `:261-263`, or `:269-271`). Record the exact timeout duration and the last `waitFor` line cited in the failure stack.

> If C2 unexpectedly PASSES here (cannot reproduce), STOP and skip to Task 4 (history) to confirm whether it was a transient/flaky failure rather than a hard timeout — a flaky-but-mostly-green C2 changes the verdict toward "flake to stabilize", still handled by Task 9a.

- [ ] **Step 2.2: Confirm C1 alone is green (isolate the contract test)**

Run: `pnpm --filter @breakery/app-pos test refund-modal-pin-header -t "C1"`
Expected: 1 test PASS, 0 fail. Confirms the hook-level header/idempotency contract is intact and the problem is scoped to the modal-level C2.

- [ ] **Step 2.3: Run C2 alone and capture the timeout**

Run: `pnpm --filter @breakery/app-pos test refund-modal-pin-header -t "C2"`
Expected: 1 test FAIL (timeout), 0 pass. Confirms C2 fails in isolation (not a cross-test pollution from C1).

No commit (read-only reproduction).

---

## Task 3: Isolate the exact blocking `waitFor`

**Files:**
- Modify (temporary, reverted in Step 3.4): `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`

- [ ] **Step 3.1: Instrument the three `waitFor` boundaries in C2**

Add temporary `screen.debug()` probes immediately **before** each critical wait in C2. Insert exactly these lines (do NOT commit them):

```tsx
// BEFORE close-removal waitFor (around :260)
// eslint-disable-next-line no-console
console.log('PROBE A — before Close click; dialog present =', !!document.body.querySelector('[role="dialog"]'));
fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
// eslint-disable-next-line no-console
console.log('PROBE B — after Close click; dialog present =', !!document.body.querySelector('[role="dialog"]'));

await waitFor(() => {
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

// eslint-disable-next-line no-console
console.log('PROBE C — after removal waitFor resolved; reopening');
fireEvent.click(screen.getByTestId('toggle'));
// eslint-disable-next-line no-console
console.log('PROBE D — after toggle; dialog present =', !!document.body.querySelector('[role="dialog"]'));
```

- [ ] **Step 3.2: Run C2 with the probes**

Run: `pnpm --filter @breakery/app-pos test refund-modal-pin-header -t "C2"`
Expected: the console probes reveal exactly which boundary blocks. Classify into one of:
- **(a) Portal never removed:** `PROBE B` prints `dialog present = true` and the test times out in the removal `waitFor` — `PROBE C` is never reached. → Radix Portal does not unmount on close under jsdom, OR `handleClose` never fired.
- **(b) Portal never remounts:** `PROBE C` prints (removal resolved) but `PROBE D` shows `dialog present = false` and the remount `waitFor` times out — `open` state desynced after toggle, or Portal does not re-mount.
- **(c) 3rd submit never reaches 3:** all four probes print, dialog is back, but the final `waitFor(onSubmit toHaveBeenCalledTimes(3))` times out — the re-driven flow fails (unexpected state wipe).

Record which branch (a/b/c) is observed. This is the **single most important output of the investigation**.

- [ ] **Step 3.3: (Branch a only) Confirm whether `handleClose` actually fires**

If branch (a), add one more temporary probe right after the Close click and check the modal state reset side-effects via the DOM (the reason input should clear and the line checkbox should be gone if the modal closed). Run again:

Run: `pnpm --filter @breakery/app-pos test refund-modal-pin-header -t "C2"`
Expected: if `PROBE B` still shows `dialog present = true` AND the reason input retains `customer return`, then `handleClose` did NOT fire (selector/click problem) → go diagnose in Task 6. If `PROBE B` shows `dialog present = true` but the reason input is cleared, `handleClose` fired but the Portal subtree was not flushed out of jsdom → Radix/jsdom unmount-timing problem → Task 7.

- [ ] **Step 3.4: Remove all probes**

Strip every `console.log`/`screen.debug()`/`eslint-disable` line added in Steps 3.1–3.3.

Run: `git diff -- apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`
Expected: **empty diff** (probes fully removed; the file is byte-identical to its committed state). No commit (instrumentation was never committed).

---

## Task 4: Pre-existing vs regression — git history & blame

**Files:**
- Read-only: git history of the test file

- [ ] **Step 4.1: List the commits that touched the test file**

Run: `git log --oneline -- apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`
Expected: the S25 authoring commit (the file header says "Session 25 — Phase 2.A.4") plus any later edits. Record the S25 commit SHA and any post-S25 SHAs touching this file.

- [ ] **Step 4.2: Blame the C2 block**

Run: `git blame -L 196,282 -- apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`
Expected: shows who wrote/last-modified the C2 close→reopen block and when. If the C2 block is entirely from the S25 commit with no later edits, the test logic has not changed since authoring — any new timeout must come from an environment/dependency change (Task 5).

- [ ] **Step 4.3: Check whether the modal or FullScreenModal changed since S25**

Run: `git log --oneline <S25_SHA>..HEAD -- apps/pos/src/features/order-history/components/RefundOrderModal.tsx packages/ui/src/components/FullScreenModal.tsx`
(Substitute `<S25_SHA>` with the SHA recorded in Step 4.1.)
Expected: list of commits (possibly empty). If empty, neither the modal nor the Radix wrapper changed → a regression, if any, is environmental (deps), reinforcing Task 5.

No commit (read-only history).

---

## Task 5: Pre-existing vs regression — run on the S25 baseline + dependency bumps

**Files:**
- Read-only: `pnpm-lock.yaml`, `apps/pos/package.json`, `packages/ui/package.json`

- [ ] **Step 5.1: Diff the relevant dependency versions since S25**

Run: `git log -p <S25_SHA>..HEAD -- pnpm-lock.yaml | rg -n "radix-ui/react-dialog|@testing-library/react|jsdom|vitest" | head -50`
Expected: any version bumps to `@radix-ui/react-dialog`, `@testing-library/react`, `jsdom`, or `vitest` between S25 and HEAD. A major bump to Radix or jsdom is the most plausible cause of a Portal-lifecycle behavior change. Record the before/after versions of each.

> Recent PRs noted in CLAUDE.md: turbo 2.9.14 (S27c), PRs #55/#56/#57. Turbo is a runner, not a behavior dependency for jsdom Portals — focus on Radix/testing-library/jsdom/vitest.

- [ ] **Step 5.2: Run C2 on the S25 merge baseline (the decisive regression test)**

```bash
git stash --include-untracked
git checkout <S25_SHA>
pnpm install --frozen-lockfile
pnpm --filter @breakery/app-pos test refund-modal-pin-header -t "C2"
```

Expected — exactly one of:
- **C2 GREEN at S25:** the test passed when authored → the timeout is a **REGRESSION** introduced after S25 (cause: a dependency bump from Step 5.1, since Task 4.3 showed no modal/wrapper code change). → Verdict = **Regression** → Task 9a.
- **C2 RED/timeout at S25:** the test never passed in this environment → **PRE-EXISTING** (and since C2 mocks Supabase per `:31-40`, it is a **non-env-gated** pre-existing failure — a distinct class from the documented `VITE_SUPABASE_URL` BO baseline). → Verdict = **Pre-existing** → Task 9b.

Record the result verbatim (PASS/FAIL + timeout duration).

- [ ] **Step 5.3: Return to the working branch**

```bash
git checkout fix/pos-refund-modal-test
pnpm install --frozen-lockfile
git stash pop
```

Expected: back on `fix/pos-refund-modal-test`, dependencies restored, working tree restored. `git status` shows only your (clean) branch state.

- [ ] **Step 5.4: Confirm C2 is not already tracked as a known-red elsewhere**

Run: `rg -n "refund-modal-pin-header|C2.*refund|DEV-S25-2.A" docs/workplan CLAUDE.md`
Expected: the only references are the S25 INDEX `DEV-S25-2.A-04` ("refund-modal-pin-header.smoke.test.tsx 2/2 PASS") and `DEV-S25-2.A-02` (the BO `VITE_SUPABASE_URL` baseline). **Critically:** S25 recorded C2 as **2/2 PASS** — if confirmed, that is strong evidence C2 was green at S25 (cross-check with Step 5.2's run). If Step 5.2 and the S25 INDEX disagree, the S25 run was environment-specific; record the contradiction in the INDEX as DEV-RT.

No commit (read-only).

---

## Task 6: Diagnostic — rule out the Close-selector (false suspect)

**Files:**
- Modify (temporary, reverted in Step 6.2): `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`

- [ ] **Step 6.1: Assert the Close button is unique**

Temporarily replace the Close click line in C2 with an assertion that counts matching buttons first:

```tsx
const closeButtons = screen.getAllByRole('button', { name: /^Close$/i });
// eslint-disable-next-line no-console
console.log('PROBE CLOSE — count =', closeButtons.length);
expect(closeButtons).toHaveLength(1);
fireEvent.click(closeButtons[0]!);
```

Run: `pnpm --filter @breakery/app-pos test refund-modal-pin-header -t "C2"`
Expected: `PROBE CLOSE — count = 1` (exactly one `aria-label="Close"` button — the X at `RefundOrderModal:175`). This **confirms the Close selector is NOT the cause** (a multi-match would throw before any timeout, and the symptom is a timeout, not a throw). Carry this as **DEV-RT-W2-01** (spec said label-ambiguity; reality = single Close, Portal cycle is the real suspect).

- [ ] **Step 6.2: Revert the probe**

Strip the `PROBE CLOSE` lines, restoring the original single-line `fireEvent.click(screen.getByRole('button', { name: /^Close$/i }))`.

Run: `git diff -- apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`
Expected: **empty diff**. No commit.

---

## Task 7: Diagnostic — Radix Portal unmount/remount under jsdom

**Files:**
- Read-only: `packages/ui/src/components/FullScreenModal.tsx`
- Modify (temporary, reverted in Step 7.3): `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`

- [ ] **Step 7.1: Confirm the Portal structure (read)**

Re-read `FullScreenModal.tsx` and confirm: `DialogPrimitive.Root open={open}` (`:37`) → `Portal` (`:38`) → `Content` (`:42`) → modal `role="dialog"` div is `children` (`:59`); **no `DialogPrimitive.Close` injected** (`:66` exports it but `RefundOrderModal` does not use it). Therefore the only way the `role="dialog"` div leaves the DOM is `open=false` forcing Radix to unmount the Portal subtree. Confirm `handleClose` (`RefundOrderModal:120-128`) calls `onClose()` (`:127`) which in the `<Harness>` sets `open=false` (`:219` → `setOpen(false)`).

- [ ] **Step 7.2: Test the unmount-timing hypothesis with an explicit-timeout `waitFor` + `act` flush**

This step only applies if Task 3.2 landed on branch **(a)** (Portal never removed) or **(b)** (Portal never remounts). Temporarily wrap the close click in `act` and give the removal `waitFor` an explicit timeout so a slow-but-eventual unmount is distinguished from a never-unmount:

```tsx
await act(async () => {
  fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
});
await waitFor(
  () => { expect(document.body.querySelector('[role="dialog"]')).toBeNull(); },
  { timeout: 2000 },
);
```

Run: `pnpm --filter @breakery/app-pos test refund-modal-pin-header -t "C2"`
Expected — exactly one of:
- **Now PASSES (or advances past the removal wait):** the Portal DID unmount but the original `waitFor` was racing an un-flushed React update → root cause = **missing `act` flush around the close transition** (test-side, deterministic fix in Task 9a/9b). 
- **Still times out at 2000ms on removal:** the Portal genuinely never unmounts under this jsdom/Radix combo → **environment limitation** (test-side skip in Task 9b unless verdict is regression-from-bump, then pin the working Radix version or adjust the assertion to `query the modal's own visibility` rather than Portal presence).

Record which outcome occurs — it dictates whether the fix is an `act` wrap (cheap, deterministic) or a skip.

- [ ] **Step 7.3: Revert the probe**

Strip the temporary `act`/timeout changes, restoring the original close + removal `waitFor`.

Run: `git diff -- apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`
Expected: **empty diff**. No commit.

---

## Task 8: Diagnostic — rule out (or confirm) the latent idempotency bug

**Files:**
- Read-only: `apps/pos/src/features/order-history/components/RefundOrderModal.tsx`

- [ ] **Step 8.1: Trace the `idempotencyKeyRef` lifecycle in code (not just via the test)**

Re-read `RefundOrderModal.tsx` and confirm in source — write each finding into your notes:
1. **Initial:** `idempotencyKeyRef = useRef(crypto.randomUUID())` (`:51`) — one UUID per mount.
2. **Submit reads current:** `onSubmit({..., idempotencyKey: idempotencyKeyRef.current})` (`:146`).
3. **Failed submit does NOT rotate:** `catch` branch only `setPinKey(k+1)` (`:150`) — no write to `idempotencyKeyRef`. → **sticky across retry** (matches C2 `expect(retryUuid).toBe(firstUuid)` `:252`).
4. **Close rotates:** `handleClose` (`:126`) sets `idempotencyKeyRef.current = crypto.randomUUID()`. → **fresh on next open** (matches C2 `expect(reopenUuid).not.toBe(firstUuid)` `:281`).
5. **Reopen path:** `onClose()` in `<Harness>` sets `open=false`; toggle sets `open=true` → component is NOT unmounted in the `<Harness>` (it always renders `<RefundOrderModal>`), so the `useRef` survives — but `handleClose` already rotated the value before `onClose`, so the next open reads the fresh UUID. **No stale-key replay path exists.**

- [ ] **Step 8.2: Write the explicit verdict on the latent bug**

State in your notes (verbatim, for the INDEX): *"The S25 DEV-S25-2.A-01 concern — that a retry after reopen could replay an old idempotency key (double-refund) — is ruled out by code: reopen always traverses `handleClose` (`RefundOrderModal:126`) which rotates the key before `onClose`; the failed-retry path (`:150`) deliberately does not rotate. The C2 timeout is therefore a TEST/ENV artifact (Radix Portal close→reopen under jsdom), NOT an application idempotency bug."*

> If — and only if — Step 8.1 reveals a path where a post-reopen submit could reuse a pre-close UUID (it should not, per the code), the verdict flips to **latent bug** → Task 9c + user escalation. Expected outcome: latent bug **ruled out**.

No commit (read-only analysis).

---

## Task 9: Decide & apply — binding decision table

**The path taken is determined strictly by the verdict from Tasks 5 and 8.** In ALL cases: do NOT merge any refund/order-history scope until the verdict is decided and applied (audit P0 gate).

| Verdict (from Tasks 5 + 8) | Action | Sub-task |
|---|---|---|
| **Regression** — C2 green at S25 (Step 5.2), timeout introduced by a post-S25 dependency bump (Step 5.1); latent bug ruled out (Task 8) | **Deterministic test fix** (e.g. `act` wrap around close + explicit-timeout `waitFor`, per Task 7.2 outcome). Run 5× → 0 flake. | 9a |
| **Pre-existing** — C2 red/timeout already at S25 (Step 5.2) AND Task 7.2 shows a genuine never-unmount jsdom limitation; latent bug ruled out | **Tracked `it.skip`** with `DEV-RT` ID + reason, + baseline doc (Task 11). No more 15s silent timeout. | 9b |
| **Latent bug** — Task 8.1 reveals a real stale-key replay path (unexpected) | **Fix `RefundOrderModal`** lifecycle + escalate to user (idempotency semantics change). | 9c |

### Sub-task 9a — Regression: deterministic test fix

**Files:**
- Modify: `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`

- [ ] **Step 9a.1: Apply the minimal fix identified in Task 7.2**

If Task 7.2 showed the `act`-wrap resolves it, apply exactly that to the C2 close transition (and mirror on the reopen toggle if branch (b) was observed):

```tsx
// Close + reopen via toggle (handleClose rotates the ref). Wrap the state
// transitions in act() and give the portal waitFor an explicit timeout so the
// Radix unmount/remount flushes deterministically under jsdom.
await act(async () => {
  fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
});
await waitFor(
  () => { expect(document.body.querySelector('[role="dialog"]')).toBeNull(); },
  { timeout: 2000 },
);

await act(async () => {
  fireEvent.click(screen.getByTestId('toggle'));
});
await screen.findByLabelText(/Refund line Americano/i, undefined, { timeout: 2000 });
```

(`findByLabelText` replaces the `queryByLabelText` + `waitFor` pair `:269-271` — `findBy*` is the testing-library idiom for "wait for appearance" and carries an explicit timeout.)

- [ ] **Step 9a.2: Run C2 once**

Run: `pnpm --filter @breakery/app-pos test refund-modal-pin-header -t "C2"`
Expected: C2 PASS, 0 fail, completes in well under 2s (no 15s timeout).

- [ ] **Step 9a.3: Run the whole file 5× to confirm 0 flake**

```bash
for i in 1 2 3 4 5; do pnpm --filter @breakery/app-pos test refund-modal-pin-header || { echo "FLAKE on run $i"; break; }; done
```

(PowerShell equivalent: `1..5 | % { pnpm --filter @breakery/app-pos test refund-modal-pin-header; if ($LASTEXITCODE -ne 0) { Write-Host "FLAKE on run $_"; break } }`)
Expected: 5 consecutive runs, each C1 PASS + C2 PASS, no `FLAKE` printed. **0 flake is required.**

- [ ] **Step 9a.4: Commit the fix**

```bash
git add apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx
git commit -m "fix(pos): refund modal C2 — flush Radix Portal close/reopen with act + explicit waitFor timeout (regression from <dep> bump)"
```

Expected: one commit; substitute `<dep>` with the bumped dependency from Step 5.1.

### Sub-task 9b — Pre-existing: tracked `it.skip`

**Files:**
- Modify: `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx`

- [ ] **Step 9b.1: Convert C2 to `it.skip` with a tracked comment**

Change the C2 declaration from `it(` to `it.skip(` and prepend this exact comment block (leave C1 untouched):

```tsx
// SKIP DEV-RT-W3-01: Radix Dialog Portal close→reopen does not deterministically
// unmount/remount under jsdom (the [role="dialog"] removal waitFor times out at 15s).
// Pre-existing, NOT a regression — C2 was already red/timeout at the S25 baseline
// (verified: git checkout <S25_SHA> + run = FAIL). The S25 INDEX recorded "2/2 PASS"
// from an environment that flushed the Portal; this CI/jsdom environment does not.
// The idempotency lifecycle is verified CORRECT in code (RefundOrderModal:51 init,
// :150 sticky-retry no-rotate, :126 rotate-on-close) — see Task 8 — so there is NO
// latent double-refund bug; this is purely a jsdom/Radix Portal test-env limitation.
// Re-enable when the Radix/jsdom combo supports deterministic Portal teardown, or
// rewrite C2 to assert modal visibility via the modal's own state rather than the
// Portal node presence.
it.skip('C2: retry reuses UUID; close+reopen rotates UUID; both are UUID v4', async () => {
```

(Substitute `<S25_SHA>` with the SHA from Step 4.1.)

- [ ] **Step 9b.2: Run the file — C2 skipped, C1 green, no timeout**

Run: `pnpm --filter @breakery/app-pos test refund-modal-pin-header`
Expected: C1 PASS, C2 **skipped** (Vitest prints `1 skipped`), the run completes in <2s with **no 15s timeout**.

- [ ] **Step 9b.3: Commit the tracked skip**

```bash
git add apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx
git commit -m "test(pos): refund modal C2 — track as it.skip DEV-RT-W3-01 (pre-existing Radix Portal/jsdom limitation, idempotency verified OK in code)"
```

Expected: one commit.

### Sub-task 9c — Latent bug (low probability): fix modal + escalate

**Files:**
- Modify: `apps/pos/src/features/order-history/components/RefundOrderModal.tsx`

- [ ] **Step 9c.1: STOP and escalate before coding**

If Task 8.1 revealed a real stale-key replay path, the idempotency semantics are about to change. Do NOT fix silently. Escalate to the user with: the exact code path, the replay scenario, and the proposed `idempotencyKeyRef` lifecycle change. Wait for ratification (per CLAUDE.md "escalate on idempotency semantic change"). Only after sign-off, apply the agreed fix (most likely: ensure rotation happens on every `onClose` boundary including `onOpenChange(false)` — already the case at `:164`+`:126`, so a genuine latent bug is unlikely) and add a regression test covering the real prod scenario. Then re-run Task 9a's 5× anti-flake loop on the new test.

Expected: user-ratified fix + green regression test, OR confirmation that 9c does not apply (verdict was 9a/9b).

---

## Task 10: Non-regression sweep + INDEX

**Files:**
- Run-only: POS refund + order-history suites
- Create: `docs/workplan/plans/2026-06-01-pos-refund-test-investigation-INDEX.md`

- [ ] **Step 10.1: Run the broader refund suite**

Run: `pnpm --filter @breakery/app-pos test refund`
Expected: every refund-related POS test green (C1 still PASS; C2 PASS if 9a, or skipped if 9b). 0 unexpected failures.

- [ ] **Step 10.2: Run the order-history suite — must finish without timeout**

Run: `pnpm --filter @breakery/app-pos test order-history`
Expected: the suite **completes** (no 15s silent timeout). This is the binding spec §3 acceptance criterion. Record total duration.

- [ ] **Step 10.3: POS typecheck (no regression from any edit)**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS (the only files touched are a test file and possibly the modal under 9c — both must typecheck).

- [ ] **Step 10.4: Write the INDEX**

Create `docs/workplan/plans/2026-06-01-pos-refund-test-investigation-INDEX.md` with these sections (fill from the recorded results — no placeholders):
1. **Summary** — verdict (regression / pre-existing / latent bug), one line each.
2. **Blocking step identified** — branch (a/b/c) from Task 3.2.
3. **Verdict evidence** — Step 5.2 result (PASS/FAIL at S25) + Step 5.1 dep bumps + Step 5.4 cross-check vs S25 INDEX `DEV-S25-2.A-04`.
4. **Root cause** — Radix Portal close→reopen under jsdom (or the `act`-flush race from Task 7.2).
5. **Action taken** — 9a fix (with the exact diff summary + 5× anti-flake result) OR 9b skip (`DEV-RT-W3-01` + reason).
6. **Latent bug status** — ruled out (Task 8.2 verbatim) or confirmed+escalated (9c).
7. **Tests run** — table `| Suite | Command | Status |` for Steps 10.1/10.2/10.3 + Task 9 runs.
8. **Deviations** — table `| ID | Section | Original | What happened | Reason | Risk |` including DEV-RT-W2-01 (Close-selector false suspect) and the verdict-dependent DEV-RT-W3-01/02.
9. **Acceptance criteria** — the checklist from this plan's Acceptance section, marked.

- [ ] **Step 10.5: Commit the INDEX**

```bash
git add docs/workplan/plans/2026-06-01-pos-refund-test-investigation-INDEX.md
git commit -m "docs(pos): refund modal C2 investigation — INDEX (verdict + evidence)"
```

Expected: one commit.

---

## Task 11: CLAUDE.md baseline / follow-up bump

**Files:**
- Modify: `CLAUDE.md` (§Active Workplan follow-ups + the baseline note)

- [ ] **Step 11.1: Read the current baseline note**

Run: `rg -n "~3 POS|VITE_SUPABASE_URL|DEV-S25-2.A-02" CLAUDE.md`
Expected: locates the existing baseline phrasing ("~3 POS + ~24 BO échecs env-gated").

- [ ] **Step 11.2: Add the verdict-dependent entry**

Edit `CLAUDE.md` §Active Workplan:
- **If 9b (pre-existing skip):** add a follow-up line — `DEV-RT-W3-01: refund-modal-pin-header C2 tracked as it.skip — Radix Dialog Portal close→reopen not deterministic under jsdom (pre-existing, not a regression; idempotency lifecycle verified OK in code RefundOrderModal:51/:126/:150). Re-enable when Radix/jsdom supports deterministic Portal teardown.` AND refine the baseline note to distinguish C2 (non-env-gated, Radix/jsdom, now `it.skip`) from the `VITE_SUPABASE_URL` env-gated failures.
- **If 9a (regression fix):** add a follow-up line — `refund-modal-pin-header C2 fixed (was a regression from <dep> bump): wrapped Radix Portal close/reopen in act() + explicit-timeout waitFor; 5× anti-flake green.` and note C2 is back to green.
- **If 9c (latent bug):** add the escalation outcome + the modal fix reference.

- [ ] **Step 11.3: Commit + open the PR**

```bash
git add CLAUDE.md
git commit -m "docs(claude): refund modal C2 verdict — <regression fix | tracked skip DEV-RT-W3-01>"
git push -u origin fix/pos-refund-modal-test
gh pr create --title "fix(pos): refund modal C2 — <deterministic fix | tracked skip> (Radix Portal/jsdom)" --body "$(cat <<'EOF'
## Verdict
<regression | pre-existing baseline | latent bug> — see INDEX for git evidence.

## What happened
C2 of refund-modal-pin-header.smoke.test.tsx timed out at the Radix Dialog Portal close→reopen step under jsdom. Blocking step: <(a)/(b)/(c)>. Idempotency lifecycle verified correct in code (RefundOrderModal:51 init / :150 sticky-retry / :126 rotate-on-close) — no latent double-refund bug.

## Action
<9a: act-wrap + explicit waitFor timeout, 5× anti-flake green | 9b: it.skip DEV-RT-W3-01 + baseline doc>

## Tests
- pnpm --filter @breakery/app-pos test refund — green
- pnpm --filter @breakery/app-pos test order-history — completes, no timeout
- pnpm --filter @breakery/app-pos typecheck — PASS

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: branch pushed, PR opened. Substitute the angle-bracket choices with the actual verdict.

---

## Acceptance criteria (mirror spec §3)

- [ ] C2 timeout reproduced AND the exact blocking `waitFor` identified (branch a/b/c). *(Tasks 2, 3)*
- [ ] Verdict decided: **regression** OR **pre-existing baseline** (with git/S25-run evidence). *(Task 5)*
- [ ] If regression → C2 PASS deterministically, 0 flake over 5 runs. *(Task 9a)*
- [ ] If pre-existing → baseline documented (CLAUDE.md) + `it.skip` tracked (`DEV-RT-W3-01` + reason), no 15s silent timeout. *(Tasks 9b, 11)*
- [ ] Latent idempotency bug explicitly ruled out (or confirmed + escalated). *(Task 8)*
- [ ] POS refund suite carries no silent timeout. *(Task 10.1)*
- [ ] `pnpm --filter @breakery/app-pos test order-history` completes without timeout. *(Task 10.2)*
- [ ] No merge of refund/order-history scope before the verdict is applied (P0 gate). *(Task 9 preamble)*

---

## Critical patterns to respect (CLAUDE.md)

- **No blind fix** — Tasks 2–8 (reproduce + isolate + diagnose) are mandatory before any Task 9 change.
- **Baseline awareness** — `~3 POS + ~24 BO` env-gated failures (`VITE_SUPABASE_URL`, DEV-S25-2.A-02) are NOT regressions; C2 is a *distinct* class (mocks Supabase `:31-40` → non-env-gated). Don't conflate them.
- **Idempotency 2-flavors (S25)** — `idempotencyKeyRef` is the HTTP-retry-safety flavor (UUID v4 in `useRef`, header `x-idempotency-key`). Any change to its rotation lifecycle alters replay semantics → escalate (Task 9c).
- **PIN in header (S25)** — C1 already verifies `x-manager-pin` header (not body); do not regress that contract — C1 stays untouched.
- **No committed debug** — every `console.log`/`screen.debug()`/`.only` from Tasks 3/6/7 is reverted before any commit (Steps 3.4, 6.2, 7.3).
- **No merge without verdict** — audit P0: no refund/order-history merge until C2 is decided + applied.

---

## Inter-spec dependency

- **`pos-print-bridge-deploy`** (the other 2026-06-01 P0): **no functional dependency** — disjoint scopes (order-history refund vs station printing). Parallelizable. Indirect link: both want a clean `pnpm --filter @breakery/app-pos test` before merge. Deciding C2 first (this plan) removes the only known POS silent-timeout, stabilizing the print-bridge plan's non-regression validation. Recommended ordering: **decide C2 first** (quick win), then ship print-bridge.

---

## Self-Review (run against spec — passed)

**1. Spec coverage** — every spec section maps to a task:
- Spec §1 (what's broken, `file:line`) → Verified code facts + Task 2 (reproduce).
- Spec §2.A (reproduce & isolate) → Tasks 2, 3.
- Spec §2.B (pre-existing vs regression) → Tasks 4, 5.
- Spec §2.C (Radix Portal + jsdom diagnosis) → Tasks 6 (Close false-suspect), 7 (Portal unmount).
- Spec §2.D (decide: fix vs baseline) → Task 9 decision table.
- Spec §3 (acceptance) → Acceptance criteria section (1:1).
- Spec §4 (tests expected: C1 stays, C2 pass-or-skip, 3–5× anti-flake, non-regression) → Tasks 9a.3 (5×), 9b, 10.1/10.2.
- Spec §5 (hors scope) → respected: modal refactor only under 9c (real bug); no other-test audit; no harness migration.
- Spec §6 / risks (P0 gate, latent bug, baseline dependency, jsdom limitation) → Task 9 preamble, Task 8, Task 5.4, Task 7. No gap found.

**2. Placeholder scan** — searched for TBD/TODO/"implement later"/"add appropriate"/"handle edge cases"/"write tests for the above"/"similar to Task N": **none present**. Every code step shows the actual code; every command step shows the exact command + expected output. The only `<...>` angle-bracket tokens are **runtime-resolved values** (`<S25_SHA>` from Step 4.1, `<dep>` from Step 5.1, verdict-choice in PR/commit titles) — these are deliberate placeholders for values the engineer captures during execution, each with an explicit upstream step that produces them, which is allowed (not a content gap). See the "residual placeholder" note in the deliverable below.

**3. Type/name consistency** — `idempotencyKeyRef` (`:51`), `handleClose` (`:120`), `handlePinSubmit` (`:130`), `firstUuid`/`retryUuid`/`reopenUuid`, `driveModalToSubmit`, `DEV-RT-W2-01`/`DEV-RT-W3-01` are used identically across Verified-facts, tasks, INDEX (Task 10.4), and CLAUDE.md (Task 11). The `act`-wrap + `findByLabelText` fix in 9a.1 matches the hypothesis validated in 7.2. No drift. **Self-review passed.**

---

## Execution Handoff

Plan complete and saved to `docs/workplan/plans/2026-06-01-pos-refund-test-investigation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh `pos-specialist` (Tasks 2–9) and `test-engineer` (anti-flake / sweep), reviewing between tasks; `session-coordinator` does the Task 10/11 closeout. Fast iteration, clean handoff at the verdict gate (Task 9).

**2. Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batching reproduce→isolate (Tasks 2–3), then diagnose (Tasks 4–8), then decide+land (Tasks 9–11), with a checkpoint at the Task 9 decision table.

**Which approach?**
